#!/usr/bin/env python3
"""Offline HTTP service for GEEPAK3 and GAMEOFMIR password profiles."""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import geepak2_exact as gee2
import geepak3_exact as gee
import gm_offline_crypto as offline


GOM_SIGNATURE = b"\x0aGAMEOFMIR2\x00\x00"
GOM_LEGACY_SIGNATURE = b"\x09GAMEOFMIR"
GOM_SIGNATURES = (GOM_SIGNATURE, GOM_LEGACY_SIGNATURE)
GOM_PASSWORD_SALT = 0x8F
MAX_GOM_SLOTS = 1_000_000
MAX_UPLOAD_SIZE = 4 * 1024 * 1024 * 1024
MAX_GEE2_INDEX_REQUEST = gee2.HEADER_SIZE + gee2.MAX_SLOTS * 4


class OfflineBridgeError(RuntimeError):
    pass


def detect_gom_variant(
    data: bytes,
) -> tuple[bytes, str, offline.PasswordMaterial]:
    if data.startswith(GOM_SIGNATURE):
        return GOM_SIGNATURE, "GM GAMEOFMIR2", offline.gom_fixed_material()
    if data.startswith(GOM_LEGACY_SIGNATURE):
        return (
            GOM_LEGACY_SIGNATURE,
            "GM GAMEOFMIR",
            offline.gom_legacy_fixed_material(),
        )
    raise OfflineBridgeError("not a supported GAMEOFMIR PAK file")


@dataclass(frozen=True)
class GOMBlock:
    logical_index: int
    header_offset: int
    payload_offset: int
    compressed_size: int
    payload_size: int
    raw_size: int
    image_type: int
    flags: int
    width: int
    height: int
    x: int
    y: int

    def public_dict(self) -> dict[str, int | str]:
        return {
            "logicalIndex": self.logical_index,
            "headerOffset": self.header_offset,
            "payloadOffset": self.payload_offset,
            "compressedSize": self.compressed_size,
            "payloadSize": self.payload_size,
            "rawSize": self.raw_size,
            "imageType": self.image_type,
            "flags": self.flags,
            "width": self.width,
            "height": self.height,
            "x": self.x,
            "y": self.y,
            "format": f"GEE_{gee.image_format_name(self.image_type, self.flags)}",
            "family": "gm-gameofmir2",
        }


def derive_gee_profile(
    password: str,
    encrypted_global_header: bytes | None = None,
) -> dict[str, str]:
    keys = offline.derive_gee_keys(password)
    profile = {
        "indexKey": base64.b64encode(keys.index_key).decode("ascii"),
        "globalHeaderKey": base64.b64encode(keys.global_header_key).decode("ascii"),
        "imageHeaderKey": base64.b64encode(keys.image_header_key).decode("ascii"),
        "engine": "offline",
    }
    if encrypted_global_header is not None:
        if len(encrypted_global_header) != 256:
            raise OfflineBridgeError("GEE encrypted global header must be exactly 256 bytes")
        alternate = offline.decrypt_gee_alternate_global_header(
            encrypted_global_header,
            password,
        )
        profile["alternateGlobalHeader"] = base64.b64encode(alternate).decode("ascii")
    return profile


def derive_gee2_header_profile(
    password: str,
    prefix: bytes,
    file_size: int | None = None,
) -> dict[str, object]:
    header, image_header_mask = gee2.parse_global_header(
        prefix,
        password,
        file_size,
    )
    return header.public_dict(image_header_mask)


def derive_gee2_index_profile(password: str, data: bytes) -> dict[str, object]:
    if len(data) < gee2.HEADER_SIZE:
        raise OfflineBridgeError("GEEPAK2 index request is truncated")
    prefix = data[: gee2.HEADER_SIZE]
    header, image_header_mask = gee2.parse_global_header(
        prefix,
        password,
        len(data),
    )
    expected_size = header.index_offset + header.count * 4
    if len(data) != expected_size:
        raise OfflineBridgeError(
            f"GEEPAK2 index request length {len(data)} != {expected_size}"
        )
    decrypted_index = gee2.decrypt_index(
        data[header.index_offset:expected_size],
        header.count,
        password,
    )
    profile = header.public_dict(image_header_mask)
    profile["decryptedIndex"] = base64.b64encode(decrypted_index).decode("ascii")
    return profile


def parse_gom_blocks(
    data: bytes,
    offsets: tuple[int, ...],
    header_key: bytes,
    index_end: int | None = None,
    family: str = "GAMEOFMIR2",
) -> tuple[tuple[GOMBlock, ...], tuple[int, ...]]:
    seen_offsets: set[int] = set()
    entries: list[tuple[int, int]] = []
    if index_end is None:
        index_end = len(GOM_SIGNATURE) + 256 + len(offsets) * 4
    for logical_index, header_offset in enumerate(offsets):
        if header_offset == 0:
            continue
        if header_offset in seen_offsets:
            raise OfflineBridgeError(
                f"{family} image {logical_index} has a duplicate offset"
            )
        seen_offsets.add(header_offset)
        if header_offset < index_end or header_offset + 16 > len(data):
            raise OfflineBridgeError(
                f"{family} image {logical_index} header is outside the file"
            )
        entries.append((logical_index, header_offset))

    blocks: list[GOMBlock] = []
    skipped: list[int] = []
    for logical_index, header_offset in entries:
        try:
            blocks.append(
                parse_gom_block(
                    data,
                    logical_index,
                    header_offset,
                    header_key,
                    family,
                )
            )
        except OfflineBridgeError:
            skipped.append(logical_index)

    assert_malformed_block_tolerance(
        len(entries),
        len(blocks),
        skipped,
        family,
    )
    return tuple(blocks), tuple(skipped)


def parse_gom_block(
    data: bytes,
    logical_index: int,
    header_offset: int,
    header_key: bytes,
    family: str,
) -> GOMBlock:
    plaintext = bytes(
        encrypted ^ key
        for encrypted, key in zip(
            data[header_offset : header_offset + 16], header_key
        )
    )
    image_type, _unknown1, _unknown2, flags = plaintext[:4]
    width, height, x, y, compressed_size = struct.unpack_from(
        "<HHhhI", plaintext, 4
    )
    if not (1 <= width <= 4096 and 1 <= height <= 4096):
        raise OfflineBridgeError(
            f"{family} image {logical_index} has invalid dimensions "
            f"{width}x{height}"
        )
    try:
        raw_size = gee.raw_image_size(image_type, flags, width, height)
        gee.image_format_name(image_type, flags)
    except gee.GEEPak3Error as exc:
        raise OfflineBridgeError(
            f"{family} image {logical_index}: {exc}"
        ) from exc
    payload_size = compressed_size or raw_size
    payload_offset = header_offset + 16
    if payload_size <= 0 or payload_offset + payload_size > len(data):
        raise OfflineBridgeError(
            f"{family} image {logical_index} payload is outside the file"
        )
    if compressed_size:
        if compressed_size < 2:
            raise OfflineBridgeError(
                f"{family} image {logical_index} compressed payload is too short"
            )
        cmf, flg = data[payload_offset : payload_offset + 2]
        if (cmf & 0x0F) != 8 or ((cmf << 8) + flg) % 31 != 0:
            raise OfflineBridgeError(
                f"{family} image {logical_index} has an invalid zlib header"
            )
    return GOMBlock(
        logical_index,
        header_offset,
        payload_offset,
        compressed_size,
        payload_size,
        raw_size,
        image_type,
        flags,
        width,
        height,
        x,
        y,
    )


def assert_malformed_block_tolerance(
    nonempty_count: int,
    valid_count: int,
    skipped: list[int],
    family: str,
) -> None:
    if not skipped:
        return
    allowed = min(8, nonempty_count // 1000)
    if valid_count < 1000 or len(skipped) > allowed:
        preview = ", ".join(str(index) for index in skipped[:8])
        suffix = f" (indices {preview})" if preview else ""
        raise OfflineBridgeError(
            f"{family} has {len(skipped)} malformed image blocks{suffix}"
        )


def derive_gom_profile(password: str, data: bytes) -> dict[str, object]:
    signature, family, fixed = detect_gom_variant(data)
    format_name = family.removeprefix("GM ")
    if len(data) < len(signature) + 256:
        raise OfflineBridgeError(f"{format_name} global header is truncated")

    global_header = offline.decrypt_feedback(
        data[len(signature) : len(signature) + 256],
        fixed.des_key,
        fixed.seed20,
    )
    title_length = global_header[1]
    title_end = 2 + title_length
    if title_end > len(global_header):
        raise OfflineBridgeError(f"{format_name} global title is invalid")
    title = global_header[2:title_end].decode("ascii", errors="replace")
    header_size = struct.unpack_from("<I", global_header, 0x2A)[0]
    slot_count = struct.unpack_from("<I", global_header, 0x2E)[0]
    version = struct.unpack_from("<I", global_header, 0x32)[0]
    index_offset = struct.unpack_from("<I", global_header, 0x36)[0]
    if (
        title != "www.gameofmir.com"
        or header_size != len(signature) + 256
        or version != 2
        or index_offset != header_size
    ):
        raise OfflineBridgeError(
            f"unsupported {format_name} global header "
            f"(title={title!r}, size={header_size}, version={version}, "
            f"index={index_offset})"
        )
    if slot_count > MAX_GOM_SLOTS:
        raise OfflineBridgeError(
            f"{format_name} slot count is too large: {slot_count}"
        )
    index_size = slot_count * 4
    if index_offset + index_size > len(data):
        raise OfflineBridgeError(f"{format_name} index is outside the file")

    material = offline.derive_password_material(password, GOM_PASSWORD_SALT)
    decrypted_index = offline.decrypt_feedback(
        data[index_offset : index_offset + index_size],
        material.des_key,
        material.seed20,
    )
    offsets = (
        struct.unpack(f"<{slot_count}I", decrypted_index)
        if slot_count
        else ()
    )
    try:
        blocks, skipped = parse_gom_blocks(
            data,
            offsets,
            offline.gom_image_header_key(password),
            index_offset + index_size,
            format_name,
        )
    except OfflineBridgeError as exc:
        raise OfflineBridgeError(
            f"密码错误，或 {format_name} 索引损坏: {exc}"
        ) from exc
    return {
        "format": "GOM",
        "family": family,
        "slotCount": slot_count,
        "blocks": [block.public_dict() for block in blocks],
        "skippedMalformedIndices": list(skipped),
        "engine": "offline",
    }


class BridgeState:
    def __init__(self) -> None:
        self.lock = threading.Lock()

    def gee_profile(
        self,
        password: str,
        encrypted_global_header: bytes | None = None,
    ) -> dict[str, str]:
        with self.lock:
            return derive_gee_profile(password, encrypted_global_header)

    def gom_profile(self, password: str, data: bytes) -> dict[str, object]:
        with self.lock:
            return derive_gom_profile(password, data)

    def gee2_header_profile(self, password: str, prefix: bytes) -> dict[str, object]:
        with self.lock:
            return derive_gee2_header_profile(password, prefix)

    def gee2_index_profile(self, password: str, data: bytes) -> dict[str, object]:
        with self.lock:
            return derive_gee2_index_profile(password, data)


def make_handler(state: BridgeState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "PakOfflineEngine/2.3"

        def log_message(self, fmt: str, *args: object) -> None:
            if self.path != "/api/health":
                super().log_message(fmt, *args)

        def send_json(self, status: int, value: object) -> None:
            payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin is not None and self.allowed_origin():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(payload)

        def allowed_origin(self) -> bool:
            origin = self.headers.get("Origin")
            if origin in (None, "null"):
                return True
            parsed = urlparse(origin)
            return (
                parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost"}
                and parsed.port == self.server.server_port
            )

        def do_GET(self) -> None:
            if urlparse(self.path).path != "/api/health":
                self.send_json(404, {"error": "not found"})
                return
            try:
                snapshot = offline.default_gee_vm().snapshot_path
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "engine": "offline",
                        "gmProcessRequired": False,
                        "snapshot": snapshot.name,
                        "formats": [
                            "GEEPAK2",
                            "GEEPAK3",
                            "GAMEOFMIR",
                            "GAMEOFMIR2",
                        ],
                    },
                )
            except Exception as exc:
                self.send_json(503, {"ok": False, "error": str(exc)})

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            if route == "/api/shutdown":
                if not self.allowed_origin():
                    self.send_json(403, {"error": "origin is not allowed"})
                    return
                self.send_json(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if route not in {
                "/api/gee-profile",
                "/api/gee2-header",
                "/api/gee2-index",
                "/api/gom-profile",
            }:
                self.send_json(404, {"error": "not found"})
                return
            if not self.allowed_origin():
                self.send_json(403, {"error": "origin is not allowed"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            try:
                if route == "/api/gee-profile":
                    self.handle_gee_profile(length)
                elif route == "/api/gee2-header":
                    self.handle_gee2_header(length)
                elif route == "/api/gee2-index":
                    self.handle_gee2_index(length)
                else:
                    self.handle_gom_profile(length)
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})

        def read_exact(self, length: int) -> bytes:
            chunks: list[bytes] = []
            remaining = length
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise OfflineBridgeError(
                        "request ended before Content-Length"
                    )
                chunks.append(chunk)
                remaining -= len(chunk)
            return b"".join(chunks)

        def handle_gee_profile(self, length: int) -> None:
            if length < 2 or length > 65536:
                raise OfflineBridgeError("invalid request size")
            request = json.loads(self.read_exact(length).decode("utf-8"))
            password = request.get("password")
            if not isinstance(password, str):
                raise OfflineBridgeError("password must be a string")
            encrypted_global_header = request.get("encryptedGlobalHeader")
            if encrypted_global_header is not None:
                if not isinstance(encrypted_global_header, str):
                    raise OfflineBridgeError("encryptedGlobalHeader must be base64 text")
                try:
                    encrypted_global_header = base64.b64decode(
                        encrypted_global_header.encode("ascii"),
                        validate=True,
                    )
                except (UnicodeError, ValueError) as exc:
                    raise OfflineBridgeError("encryptedGlobalHeader is invalid base64") from exc
            self.send_json(
                200,
                {
                    "ok": True,
                    "profile": state.gee_profile(password, encrypted_global_header),
                },
            )

        def password_from_header(self) -> str:
            encoded_password = self.headers.get("X-GM-Password-B64", "")
            if not encoded_password or len(encoded_password) > 8192:
                raise OfflineBridgeError("missing or invalid password header")
            try:
                return base64.b64decode(
                    encoded_password.encode("ascii"), validate=True
                ).decode("utf-8")
            except (UnicodeError, ValueError) as exc:
                raise OfflineBridgeError(str(exc)) from exc

        def handle_gee2_header(self, length: int) -> None:
            if length != gee2.HEADER_SIZE:
                raise OfflineBridgeError("invalid GEEPAK2 header request size")
            password = self.password_from_header()
            self.send_json(
                200,
                {
                    "ok": True,
                    "profile": state.gee2_header_profile(
                        password,
                        self.read_exact(length),
                    ),
                },
            )

        def handle_gee2_index(self, length: int) -> None:
            if length < gee2.HEADER_SIZE or length > MAX_GEE2_INDEX_REQUEST:
                raise OfflineBridgeError("invalid GEEPAK2 index request size")
            password = self.password_from_header()
            self.send_json(
                200,
                {
                    "ok": True,
                    "profile": state.gee2_index_profile(
                        password,
                        self.read_exact(length),
                    ),
                },
            )

        def handle_gom_profile(self, length: int) -> None:
            if length < min(map(len, GOM_SIGNATURES)) or length > MAX_UPLOAD_SIZE:
                raise OfflineBridgeError("invalid PAK upload size")
            password = self.password_from_header()
            self.send_json(
                200,
                {
                    "ok": True,
                    "profile": state.gom_profile(
                        password,
                        self.read_exact(length),
                    ),
                },
            )

        def do_OPTIONS(self) -> None:
            route = urlparse(self.path).path
            if (
                route not in {
                    "/api/gee-profile",
                    "/api/gee2-header",
                    "/api/gee2-index",
                    "/api/gom-profile",
                }
                or not self.allowed_origin()
            ):
                self.send_json(403, {"error": "origin is not allowed"})
                return
            self.send_response(204)
            origin = self.headers.get("Origin")
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, X-GM-Password-B64",
            )
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    profile_parser = subparsers.add_parser("profile")
    profile_parser.add_argument("--password", required=True)
    serve_parser = subparsers.add_parser("serve")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    if args.command == "profile":
        print(json.dumps(derive_gee_profile(args.password), indent=2))
        return

    server = ThreadingHTTPServer(
        (args.host, args.port),
        make_handler(BridgeState()),
    )
    print(f"Offline PAK engine: http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        main()
    except (
        OfflineBridgeError,
        gee2.GEEPak2Error,
        gee.GEEPak3Error,
        offline.OfflineCryptoError,
        OSError,
        ValueError,
    ) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
