#!/usr/bin/env python3
"""Deterministic reader-side cryptography for the GEEPAK2 archive family."""

from __future__ import annotations

import base64
import hmac
import struct
from dataclasses import dataclass
from functools import lru_cache

import gm_offline_crypto as offline


SIGNATURE = b"\x07GEEPAK2"
HEADER_SIZE = 266
ENCRYPTED_GLOBAL_SIZE = 256
MAX_SLOTS = 1_000_000
PASSWORD_MARKER_OFFSET = 0x44
PASSWORD_MARKER = b"GEEM2"
IMAGE_SECONDARY_OFFSET = 0x320
IMAGE_SECONDARY_SIZE = 8

# This is fixed format material used by GEEPAK2 global headers. It is not an
# archive password and is independent of user content.
FIXED_DES_KEY = bytes.fromhex("40380e1e142486c2")
FIXED_SEED20 = bytes.fromhex("9607e39e247bac55") + bytes([0x8F]) * 12


class GEEPak2Error(ValueError):
    pass


@dataclass(frozen=True)
class GlobalHeader:
    title: str
    header_size: int
    count: int
    version: int
    index_offset: int

    def public_dict(self, image_header_mask: bytes) -> dict[str, object]:
        return {
            "format": "GEEPAK2",
            "family": "gee2",
            "title": self.title,
            "headerSize": self.header_size,
            "slotCount": self.count,
            "version": self.version,
            "indexOffset": self.index_offset,
            "imageHeaderMask": base64.b64encode(image_header_mask).decode("ascii"),
        }


@dataclass(frozen=True)
class PasswordState:
    material: offline.PasswordMaterial
    image_header_mask: bytes


def fixed_material() -> offline.PasswordMaterial:
    return offline.PasswordMaterial(
        password="",
        des_key=FIXED_DES_KEY,
        des_schedule=offline.dcp_des_key_schedule(FIXED_DES_KEY),
        seed20=FIXED_SEED20,
    )


@lru_cache(maxsize=64)
def password_state(password: str) -> PasswordState:
    material = offline.derive_password_material(password, offline.GEE_PASSWORD_SALT)
    object_state = offline.default_gee_vm().set_password_v2(material)
    if object_state[0x178:0x1F8] != material.des_schedule:
        raise GEEPak2Error("GEEPAK2 password schedule derivation failed")
    if object_state[0x1F8:0x20C] != material.seed20:
        raise GEEPak2Error("GEEPAK2 password seed derivation failed")
    secondary = object_state[
        IMAGE_SECONDARY_OFFSET : IMAGE_SECONDARY_OFFSET + IMAGE_SECONDARY_SIZE
    ]
    if len(secondary) != IMAGE_SECONDARY_SIZE:
        raise GEEPak2Error("GEEPAK2 image header state is incomplete")
    stream = offline.des_encrypt_block(material.des_key, material.seed20[:8])
    image_header_mask = bytes(left ^ right for left, right in zip(stream, secondary))
    return PasswordState(material, image_header_mask)


def parse_global_header(
    prefix: bytes,
    password: str,
    file_size: int | None = None,
) -> tuple[GlobalHeader, bytes]:
    if len(prefix) != HEADER_SIZE:
        raise GEEPak2Error(f"GEEPAK2 header must be exactly {HEADER_SIZE} bytes")
    if not prefix.startswith(SIGNATURE):
        raise GEEPak2Error("not a GEEPAK2 file")

    plaintext = offline.default_gee_vm().decrypt_global_v2(
        prefix[10:HEADER_SIZE],
        fixed_material(),
    )
    title_length = plaintext[1]
    title_end = 2 + title_length
    if title_end > len(plaintext):
        raise GEEPak2Error("GEEPAK2 global title is invalid")
    title = plaintext[2:title_end].decode("ascii", errors="replace")
    header_size, count, version, index_offset = struct.unpack_from(
        "<IIII", plaintext, 0x2A
    )
    if (
        title not in {"www.gameofmir.com", "www.gameofmir2.com"}
        or header_size != HEADER_SIZE
        or version != 2
        or index_offset != HEADER_SIZE
        or count > MAX_SLOTS
    ):
        raise GEEPak2Error(
            "unsupported GEEPAK2 global header "
            f"(title={title!r}, size={header_size}, count={count}, "
            f"version={version}, index={index_offset})"
        )
    if file_size is not None and index_offset + count * 4 > file_size:
        raise GEEPak2Error("GEEPAK2 index is outside the file")

    marker_length = plaintext[PASSWORD_MARKER_OFFSET]
    marker_end = PASSWORD_MARKER_OFFSET + 1 + marker_length
    if marker_length != len(PASSWORD_MARKER) or marker_end > len(plaintext):
        raise GEEPak2Error("GEEPAK2 password verifier is invalid")
    state = password_state(password)
    marker = offline.decrypt_feedback(
        plaintext[PASSWORD_MARKER_OFFSET + 1 : marker_end],
        state.material.des_key,
        state.material.seed20,
    )
    if not hmac.compare_digest(marker, PASSWORD_MARKER):
        raise GEEPak2Error("password is incorrect")

    return (
        GlobalHeader(title, header_size, count, version, index_offset),
        state.image_header_mask,
    )


def decrypt_index(encrypted_index: bytes, count: int, password: str) -> bytes:
    if not 0 <= count <= MAX_SLOTS:
        raise GEEPak2Error(f"invalid GEEPAK2 slot count: {count}")
    expected_size = count * 4
    if len(encrypted_index) != expected_size:
        raise GEEPak2Error(
            f"GEEPAK2 encrypted index length {len(encrypted_index)} != {expected_size}"
        )
    state = password_state(password)
    plaintext = offline.decrypt_feedback(
        encrypted_index,
        state.material.des_key,
        state.material.seed20,
    )
    plaintext = bytearray(
        offline.decrypt_feedback(
            plaintext,
            state.material.des_key,
            state.material.seed20,
        )
    )
    scalar = state.material.seed20[0]
    for offset in range(0, len(plaintext), 4):
        value = struct.unpack_from("<I", plaintext, offset)[0] ^ scalar
        struct.pack_into("<I", plaintext, offset, value)
    return bytes(plaintext)
