#!/usr/bin/env python3
"""Offline local service for deterministic GEEPAK3 and GAMEOFMIR viewing."""

from __future__ import annotations

import argparse
import base64
import ctypes
import getpass
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import zlib
from ctypes import wintypes
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import geepak3_exact as gee
import gm_offline_crypto as offline
import probe_gm_geepak3_runtime as runtime


EXE_NAME = "GM工具箱-资源编辑器v3.10.0.exe"
EXE_SHA256 = "9ecafb79034c8471ccac4bd491030c5aa06279ad023471d1701395b4bd0bf585"
PREFERRED_BASE = 0x00400000
GEE_VMT_RVA = 0x007FBEEC - PREFERRED_BASE
GEE_CREATE_RVA = 0x007FC558 - PREFERRED_BASE
GEE_SET_PASSWORD_DATA_RVA = 0x007FC848 - PREFERRED_BASE
BASE_DESTROY_RVA = 0x00821058 - PREFERRED_BASE
GEE_OBJECT_SIZE = 0x8A4
INDEX_KEY_OFFSET = 0x2A0
GLOBAL_KEY_OFFSET = 0x3A0
IMAGE_KEY_OFFSET = 0x4A0
INDEX_KEY_SIZE = 256
GLOBAL_KEY_SIZE = 256
IMAGE_KEY_SIZE = 1024
GOM_SIGNATURE = b"\x0aGAMEOFMIR2\x00\x00"
GOM_LEGACY_SIGNATURE = b"\x09GAMEOFMIR"
GOM_SIGNATURES = (GOM_SIGNATURE, GOM_LEGACY_SIGNATURE)
GOM_PASSWORD_SALT = 0x8F
GOM_VMT_RVA = 0x007F956C - PREFERRED_BASE
GOM_CREATE_RVA = 0x007F99A4 - PREFERRED_BASE
GOM_SET_PASSWORD_DATA_RVA = 0x0080A334 - PREFERRED_BASE
GOM_INITIALIZE_RVA = 0x0080A4DC - PREFERRED_BASE
GOM_HEADER_CRYPT_RVA = 0x00807194 - PREFERRED_BASE
GOM_OBJECT_SIZE = 0x2A4
GOM_INDEX_POINTER_OFFSET = 0x04
GOM_COUNT_OFFSET = 0x96
MAX_GOM_SLOTS = 1_000_000
MAX_UPLOAD_SIZE = 4 * 1024 * 1024 * 1024
STATIC_FILES = {
    "/": "PakViewer.html",
    "/PakViewer.html": "PakViewer.html",
    "/pako_embedded.js": "pako_embedded.js",
    "/geepak3_exact.js": "geepak3_exact.js",
}
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

runtime.kernel32.QueryFullProcessImageNameW.argtypes = [
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.LPWSTR,
    ctypes.POINTER(wintypes.DWORD),
]
runtime.kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL


class GMBridgeError(RuntimeError):
    pass


def _detect_gom_variant(
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
    raise GMBridgeError("not a supported GAMEOFMIR PAK file")


def is_gom_pak(data: bytes) -> bool:
    return any(data.startswith(signature) for signature in GOM_SIGNATURES)


@dataclass(frozen=True)
class DerivedProfile:
    password: str
    index_key: bytes
    global_header_key: bytes
    image_header_key: bytes
    exe_sha256: str = EXE_SHA256

    def parser_profile(self) -> gee.PasswordProfile:
        return gee.PasswordProfile(
            self.password,
            self.index_key,
            self.global_header_key,
            self.image_header_key,
        )

    def public_dict(self) -> dict[str, str]:
        return {
            "indexKey": base64.b64encode(self.index_key).decode("ascii"),
            "globalHeaderKey": base64.b64encode(self.global_header_key).decode("ascii"),
            "imageHeaderKey": base64.b64encode(self.image_header_key).decode("ascii"),
            "engine": "offline",
            "exeSha256": self.exe_sha256,
        }


@dataclass(frozen=True)
class GOMBlock:
    logical_index: int
    header_offset: int
    payload_offset: int
    compressed_size: int
    payload_size: int
    raw_size: int
    image_type: int
    unknown1: int
    unknown2: int
    flags: int
    width: int
    height: int
    x: int
    y: int
    plaintext: bytes

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

    def image_header(self) -> gee.ImageHeader:
        return gee.ImageHeader(
            self.logical_index,
            self.header_offset,
            self.image_type,
            self.unknown1,
            self.unknown2,
            self.flags,
            self.width,
            self.height,
            self.x,
            self.y,
            self.compressed_size,
            self.plaintext,
        )


@dataclass(frozen=True)
class GOMProfile:
    slot_count: int
    blocks: tuple[GOMBlock, ...]
    family: str = "GM GAMEOFMIR2"
    exe_sha256: str = EXE_SHA256

    def public_dict(self) -> dict[str, object]:
        return {
            "format": "GOM",
            "family": self.family,
            "slotCount": self.slot_count,
            "blocks": [block.public_dict() for block in self.blocks],
            "engine": "offline",
            "exeSha256": self.exe_sha256,
        }


def derive_profile_offline(password: str) -> DerivedProfile:
    try:
        keys = offline.derive_gee_keys(password)
    except offline.OfflineCryptoError as exc:
        raise GMBridgeError(str(exc)) from exc
    return DerivedProfile(
        password=password,
        index_key=keys.index_key,
        global_header_key=keys.global_header_key,
        image_header_key=keys.image_header_key,
    )


def mov_imm(register_opcode: int, value: int) -> bytes:
    return bytes([register_opcode]) + struct.pack("<I", value)


def build_profile_stub(
    remote: int,
    module: int,
    filename_pointer: int,
    password_data: int,
) -> bytes:
    addr = lambda offset: remote + offset
    code = bytearray()

    # TWMGEE3Images.Create(filename)
    code += mov_imm(0xB9, filename_pointer)
    code += mov_imm(0xBA, 1)
    code += mov_imm(0xB8, module + GEE_VMT_RVA)
    code += mov_imm(0xBF, module + GEE_CREATE_RVA)
    code += b"\xFF\xD7"
    code += b"\xA3" + struct.pack("<I", addr(0x300))
    code += b"\xC7\x05" + struct.pack("<II", addr(0x304), 1)

    # object.SetPasswordData(hash20 + state128, 148)
    code += mov_imm(0xB9, 148)
    code += mov_imm(0xBA, password_data)
    code += b"\xA1" + struct.pack("<I", addr(0x300))
    code += mov_imm(0xBF, module + GEE_SET_PASSWORD_DATA_RVA)
    code += b"\xFF\xD7"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x308), 2)

    # Copy the complete object while all three generated keys are live.
    code += b"\x8B\x35" + struct.pack("<I", addr(0x300))
    code += mov_imm(0xBF, addr(0x1000))
    code += mov_imm(0xB9, GEE_OBJECT_SIZE // 4)
    code += b"\xFC\xF3\xA5"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x30C), 3)

    # Destroy and free the Delphi object; DL > 0 requests instance deallocation.
    code += mov_imm(0xBA, 1)
    code += b"\xA1" + struct.pack("<I", addr(0x300))
    code += mov_imm(0xBF, module + BASE_DESTROY_RVA)
    code += b"\xFF\xD7"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x310), 4)

    code += b"\x33\xC0\xC2\x04\x00"
    return bytes(code)


def verify_executable(exe_path: Path) -> str:
    if not exe_path.is_file():
        raise GMBridgeError(f"GM executable not found: {exe_path}")
    digest = hashlib.sha256(exe_path.read_bytes()).hexdigest()
    if digest != EXE_SHA256:
        raise GMBridgeError(
            f"unsupported GM executable build: sha256={digest}, expected={EXE_SHA256}"
        )
    return digest


def process_executable_path(pid: int) -> Path:
    handle = runtime.kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION, False, pid
    )
    if not handle:
        runtime.fail("OpenProcess(query executable path)")
    try:
        capacity = 32768
        buffer = ctypes.create_unicode_buffer(capacity)
        size = wintypes.DWORD(capacity)
        if not runtime.kernel32.QueryFullProcessImageNameW(
            handle, 0, buffer, ctypes.byref(size)
        ):
            runtime.fail("QueryFullProcessImageNameW")
        return Path(buffer.value)
    finally:
        runtime.kernel32.CloseHandle(handle)


def verify_process(pid: int) -> Path:
    runtime.module_base(pid, EXE_NAME)
    exe_path = process_executable_path(pid)
    if exe_path.name.casefold() != EXE_NAME.casefold():
        raise GMBridgeError(
            f"unexpected GM process executable name: {exe_path.name}"
        )
    verify_executable(exe_path)
    return exe_path


def find_or_start_process(exe_path: Path, pid: int | None = None) -> tuple[int, subprocess.Popen | None]:
    if pid is not None:
        runtime.module_base(pid, EXE_NAME)
        return pid, None
    try:
        return runtime.find_process(EXE_NAME), None
    except RuntimeError as exc:
        if "found []" not in str(exc):
            raise

    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    environment = os.environ.copy()
    environment["__COMPAT_LAYER"] = "RunAsInvoker"
    process = subprocess.Popen(
        [str(exe_path)],
        cwd=str(exe_path.parent),
        env=environment,
        startupinfo=startup,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise GMBridgeError(f"GM process exited during startup: {process.returncode}")
        try:
            return runtime.find_process(EXE_NAME), process
        except RuntimeError:
            time.sleep(0.1)
    process.terminate()
    raise GMBridgeError("timed out waiting for the GM process")


def derive_profile(pid: int, password: str, filename: Path) -> DerivedProfile:
    if len(password) > 1024:
        raise GMBridgeError("password exceeds 1024 characters")
    module = runtime.module_base(pid, EXE_NAME)
    password_result = runtime.run_probe(pid, password, "utf16", b"")
    password_state = bytes.fromhex(str(password_result["password_state_128"]))
    password_hash = bytes.fromhex(str(password_result["password_hash_20"]))
    password_data = password_hash + password_state
    if len(password_data) != 148:
        raise GMBridgeError(f"unexpected GM password data size: {len(password_data)}")

    handle = runtime.kernel32.OpenProcess(runtime.PROCESS_ACCESS, False, pid)
    if not handle:
        runtime.fail("OpenProcess")
    remote = 0
    try:
        remote = runtime.kernel32.VirtualAllocEx(
            handle,
            None,
            0x3000,
            runtime.MEM_COMMIT_RESERVE,
            runtime.PAGE_EXECUTE_READWRITE,
        )
        if not remote:
            runtime.fail("VirtualAllocEx")
        remote = int(remote)
        filename_blob, filename_offset = runtime.delphi_string(str(filename.resolve()), "utf16")
        if len(filename_blob) > 0x400:
            raise GMBridgeError("filename is too long for the bridge call buffer")
        runtime.write_process(handle, remote + 0x400, filename_blob)
        runtime.write_process(handle, remote + 0x800, password_data)
        runtime.write_process(
            handle,
            remote,
            build_profile_stub(
                remote,
                module,
                remote + 0x400 + filename_offset,
                remote + 0x800,
            ),
        )

        thread_id = runtime.wintypes.DWORD()
        thread = runtime.kernel32.CreateRemoteThread(
            handle,
            None,
            0,
            ctypes.c_void_p(remote),
            None,
            0,
            ctypes.byref(thread_id),
        )
        if not thread:
            runtime.fail("CreateRemoteThread")
        try:
            wait = runtime.kernel32.WaitForSingleObject(thread, 15000)
            if wait == runtime.WAIT_TIMEOUT:
                raise TimeoutError("GM password profile call timed out")
            if wait != runtime.WAIT_OBJECT_0:
                runtime.fail(f"WaitForSingleObject returned 0x{wait:X}")
            exit_code = runtime.wintypes.DWORD()
            if not runtime.kernel32.GetExitCodeThread(thread, ctypes.byref(exit_code)):
                runtime.fail("GetExitCodeThread")
        finally:
            runtime.kernel32.CloseHandle(thread)
        if exit_code.value != 0:
            raise GMBridgeError(f"GM profile thread failed with 0x{exit_code.value:08X}")

        stages = struct.unpack("<4I", runtime.read_process(handle, remote + 0x304, 16))
        if stages != (1, 2, 3, 4):
            raise GMBridgeError(f"GM profile call stopped at stages {stages}")
        snapshot = runtime.read_process(handle, remote + 0x1000, GEE_OBJECT_SIZE)
        return DerivedProfile(
            password=password,
            index_key=snapshot[INDEX_KEY_OFFSET : INDEX_KEY_OFFSET + INDEX_KEY_SIZE],
            global_header_key=snapshot[
                GLOBAL_KEY_OFFSET : GLOBAL_KEY_OFFSET + GLOBAL_KEY_SIZE
            ],
            image_header_key=snapshot[
                IMAGE_KEY_OFFSET : IMAGE_KEY_OFFSET + IMAGE_KEY_SIZE
            ],
        )
    finally:
        if remote:
            runtime.kernel32.VirtualFreeEx(
                handle, ctypes.c_void_p(remote), 0, runtime.MEM_RELEASE
            )
        runtime.kernel32.CloseHandle(handle)


def run_remote_code(handle: int, address: int, timeout_ms: int, label: str) -> int:
    thread_id = runtime.wintypes.DWORD()
    thread = runtime.kernel32.CreateRemoteThread(
        handle,
        None,
        0,
        ctypes.c_void_p(address),
        None,
        0,
        ctypes.byref(thread_id),
    )
    if not thread:
        runtime.fail("CreateRemoteThread")
    try:
        wait = runtime.kernel32.WaitForSingleObject(thread, timeout_ms)
        if wait == runtime.WAIT_TIMEOUT:
            raise TimeoutError(f"{label} timed out")
        if wait != runtime.WAIT_OBJECT_0:
            runtime.fail(f"WaitForSingleObject returned 0x{wait:X}")
        exit_code = runtime.wintypes.DWORD()
        if not runtime.kernel32.GetExitCodeThread(thread, ctypes.byref(exit_code)):
            runtime.fail("GetExitCodeThread")
        return exit_code.value
    finally:
        runtime.kernel32.CloseHandle(thread)


def derive_password_data(pid: int, password: str, salt: int) -> bytes:
    if len(password) > 1024:
        raise GMBridgeError("password exceeds 1024 characters")
    module = runtime.module_base(pid, EXE_NAME)
    handle = runtime.kernel32.OpenProcess(runtime.PROCESS_ACCESS, False, pid)
    if not handle:
        runtime.fail("OpenProcess")
    remote = 0
    try:
        remote = runtime.kernel32.VirtualAllocEx(
            handle,
            None,
            0x1000,
            runtime.MEM_COMMIT_RESERVE,
            runtime.PAGE_EXECUTE_READWRITE,
        )
        if not remote:
            runtime.fail("VirtualAllocEx")
        remote = int(remote)
        string_blob, pointer_offset = runtime.delphi_string(password, "utf16")
        if len(string_blob) > 0x180:
            raise GMBridgeError("password is too long for the bridge call buffer")
        runtime.write_process(handle, remote + 0x180, string_blob)

        code = bytearray()
        code += b"\x68" + struct.pack("<I", salt)
        code += mov_imm(0xB9, remote + 0x500)  # hash20
        code += mov_imm(0xBA, remote + 0x400)  # state128
        code += mov_imm(0xB8, remote + 0x180 + pointer_offset)
        code += mov_imm(
            0xBF, module + runtime.FUNCTION_RVAS["password_state"]
        )
        code += b"\xFF\xD7"
        code += b"\xC7\x05" + struct.pack("<II", remote + 0x300, 1)
        code += b"\x33\xC0\xC2\x04\x00"
        runtime.write_process(handle, remote, bytes(code))
        exit_code = run_remote_code(handle, remote, 15000, "GM password derivation")
        if exit_code != 0:
            raise GMBridgeError(
                f"GM password derivation failed with 0x{exit_code:08X}"
            )
        if struct.unpack("<I", runtime.read_process(handle, remote + 0x300, 4))[0] != 1:
            raise GMBridgeError("GM password derivation did not complete")
        password_hash = runtime.read_process(handle, remote + 0x500, 20)
        password_state = runtime.read_process(handle, remote + 0x400, 128)
        return password_hash + password_state
    finally:
        if remote:
            runtime.kernel32.VirtualFreeEx(
                handle, ctypes.c_void_p(remote), 0, runtime.MEM_RELEASE
            )
        runtime.kernel32.CloseHandle(handle)


def build_gom_initialize_stub(
    remote: int,
    module: int,
    filename_pointer: int,
    password_data: int,
) -> bytes:
    addr = lambda offset: remote + offset
    code = bytearray()

    code += mov_imm(0xB9, filename_pointer)
    code += mov_imm(0xBA, 1)
    code += mov_imm(0xB8, module + GOM_VMT_RVA)
    code += mov_imm(0xBF, module + GOM_CREATE_RVA)
    code += b"\xFF\xD7"
    code += b"\xA3" + struct.pack("<I", addr(0x300))
    code += b"\xC7\x05" + struct.pack("<II", addr(0x304), 1)

    code += mov_imm(0xB9, 148)
    code += mov_imm(0xBA, password_data)
    code += b"\xA1" + struct.pack("<I", addr(0x300))
    code += mov_imm(0xBF, module + GOM_SET_PASSWORD_DATA_RVA)
    code += b"\xFF\xD7"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x308), 2)

    code += b"\xA1" + struct.pack("<I", addr(0x300))
    code += mov_imm(0xBF, module + GOM_INITIALIZE_RVA)
    code += b"\xFF\xD7"
    code += b"\xA3" + struct.pack("<I", addr(0x30C))
    code += b"\xC7\x05" + struct.pack("<II", addr(0x310), 3)
    code += b"\x33\xC0\xC2\x04\x00"
    return bytes(code)


def build_gom_header_key_stub(remote: int, module: int, password_data: int) -> bytes:
    code = bytearray()
    code += b"\x68" + struct.pack("<I", 16)
    code += mov_imm(0xB9, remote + 0xC00)
    code += mov_imm(0xBA, password_data)
    code += mov_imm(0xB8, password_data + 20)
    code += mov_imm(0xBF, module + GOM_HEADER_CRYPT_RVA)
    code += b"\xFF\xD7"
    code += b"\x33\xC0\xC2\x04\x00"
    return bytes(code)


def build_destroy_stub(module: int, object_pointer: int) -> bytes:
    code = bytearray()
    code += mov_imm(0xBA, 1)
    code += mov_imm(0xB8, object_pointer)
    code += mov_imm(0xBF, module + BASE_DESTROY_RVA)
    code += b"\xFF\xD7"
    code += b"\x33\xC0\xC2\x04\x00"
    return bytes(code)


def derive_gom_profile(pid: int, password: str, filename: Path) -> GOMProfile:
    data = filename.read_bytes()
    if data[: len(GOM_SIGNATURE)] != GOM_SIGNATURE:
        raise GMBridgeError("not a GAMEOFMIR2 PAK file")
    password_data = derive_password_data(pid, password, GOM_PASSWORD_SALT)
    module = runtime.module_base(pid, EXE_NAME)
    handle = runtime.kernel32.OpenProcess(runtime.PROCESS_ACCESS, False, pid)
    if not handle:
        runtime.fail("OpenProcess")
    remote = 0
    object_pointer = 0
    try:
        remote = runtime.kernel32.VirtualAllocEx(
            handle,
            None,
            0x3000,
            runtime.MEM_COMMIT_RESERVE,
            runtime.PAGE_EXECUTE_READWRITE,
        )
        if not remote:
            runtime.fail("VirtualAllocEx")
        remote = int(remote)
        filename_blob, filename_offset = runtime.delphi_string(
            str(filename.resolve()), "utf16"
        )
        if len(filename_blob) > 0x400:
            raise GMBridgeError("filename is too long for the bridge call buffer")
        runtime.write_process(handle, remote + 0x400, filename_blob)
        runtime.write_process(handle, remote + 0x800, password_data)
        runtime.write_process(
            handle,
            remote,
            build_gom_initialize_stub(
                remote,
                module,
                remote + 0x400 + filename_offset,
                remote + 0x800,
            ),
        )
        exit_code = run_remote_code(handle, remote, 30000, "GM GAMEOFMIR2 initialization")
        if exit_code != 0:
            raise GMBridgeError(
                f"GM GAMEOFMIR2 initialization failed with 0x{exit_code:08X}"
            )
        object_pointer, create_stage, password_stage, _initialize_result, initialize_stage = (
            struct.unpack("<5I", runtime.read_process(handle, remote + 0x300, 20))
        )
        if not object_pointer or (create_stage, password_stage, initialize_stage) != (1, 2, 3):
            raise GMBridgeError("GM GAMEOFMIR2 initialization stopped early")

        snapshot = runtime.read_process(handle, object_pointer, GOM_OBJECT_SIZE)
        loaded = snapshot[0x28]
        error_code = snapshot[0x46]
        if loaded != 1 or error_code != 0:
            if error_code == 2:
                raise GMBridgeError("密码错误")
            raise GMBridgeError(
                f"GM could not initialize GAMEOFMIR2 (status={error_code})"
            )
        slot_count = struct.unpack_from("<I", snapshot, GOM_COUNT_OFFSET)[0]
        if slot_count > MAX_GOM_SLOTS:
            raise GMBridgeError(f"GAMEOFMIR2 slot count is too large: {slot_count}")
        index_pointer = struct.unpack_from(
            "<I", snapshot, GOM_INDEX_POINTER_OFFSET
        )[0]
        if slot_count and not index_pointer:
            raise GMBridgeError("GM returned an empty GAMEOFMIR2 index pointer")
        if slot_count:
            runtime_count = struct.unpack(
                "<I", runtime.read_process(handle, index_pointer - 4, 4)
            )[0]
            if runtime_count != slot_count:
                raise GMBridgeError(
                    f"GM index length mismatch: {runtime_count} != {slot_count}"
                )
            offsets = struct.unpack(
                f"<{slot_count}I",
                runtime.read_process(handle, index_pointer, slot_count * 4),
            )
        else:
            offsets = ()

        runtime.write_process(handle, remote + 0xC00, bytes(16))
        runtime.write_process(
            handle,
            remote,
            build_gom_header_key_stub(remote, module, remote + 0x800),
        )
        exit_code = run_remote_code(handle, remote, 15000, "GM GAMEOFMIR2 header key")
        if exit_code != 0:
            raise GMBridgeError(
                f"GM GAMEOFMIR2 header key failed with 0x{exit_code:08X}"
            )
        header_key = runtime.read_process(handle, remote + 0xC00, 16)

        blocks: list[GOMBlock] = []
        seen_offsets: set[int] = set()
        for logical_index, header_offset in enumerate(offsets):
            if header_offset == 0:
                continue
            if header_offset in seen_offsets:
                raise GMBridgeError(
                    f"GAMEOFMIR2 image {logical_index} has a duplicate offset"
                )
            seen_offsets.add(header_offset)
            if header_offset + 16 > len(data):
                raise GMBridgeError(
                    f"GAMEOFMIR2 image {logical_index} header is outside the file"
                )
            plaintext = bytes(
                encrypted ^ key
                for encrypted, key in zip(
                    data[header_offset : header_offset + 16], header_key
                )
            )
            image_type, unknown1, unknown2, flags = plaintext[:4]
            width, height, x, y, compressed_size = struct.unpack_from(
                "<HHhhI", plaintext, 4
            )
            if not (1 <= width <= 4096 and 1 <= height <= 4096):
                raise GMBridgeError(
                    f"GAMEOFMIR2 image {logical_index} has invalid dimensions "
                    f"{width}x{height}"
                )
            try:
                raw_size = gee.raw_image_size(image_type, flags, width, height)
                gee.image_format_name(image_type, flags)
            except gee.GEEPak3Error as exc:
                raise GMBridgeError(
                    f"GAMEOFMIR2 image {logical_index}: {exc}"
                ) from exc
            payload_size = compressed_size or raw_size
            payload_offset = header_offset + 16
            if payload_size <= 0 or payload_offset + payload_size > len(data):
                raise GMBridgeError(
                    f"GAMEOFMIR2 image {logical_index} payload is outside the file"
                )
            if compressed_size:
                cmf, flg = data[payload_offset : payload_offset + 2]
                if (cmf & 0x0F) != 8 or ((cmf << 8) + flg) % 31 != 0:
                    raise GMBridgeError(
                        f"GAMEOFMIR2 image {logical_index} has an invalid zlib header"
                    )
            blocks.append(
                GOMBlock(
                    logical_index,
                    header_offset,
                    payload_offset,
                    compressed_size,
                    payload_size,
                    raw_size,
                    image_type,
                    unknown1,
                    unknown2,
                    flags,
                    width,
                    height,
                    x,
                    y,
                    plaintext,
                )
            )
        return GOMProfile(slot_count, tuple(blocks))
    finally:
        if remote and object_pointer:
            try:
                runtime.write_process(
                    handle, remote, build_destroy_stub(module, object_pointer)
                )
                run_remote_code(handle, remote, 15000, "GM object cleanup")
            except Exception:
                pass
        if remote:
            runtime.kernel32.VirtualFreeEx(
                handle, ctypes.c_void_p(remote), 0, runtime.MEM_RELEASE
            )
        runtime.kernel32.CloseHandle(handle)


def _parse_gom_blocks(
    data: bytes,
    offsets: tuple[int, ...],
    header_key: bytes,
    index_end: int | None = None,
    family: str = "GAMEOFMIR2",
) -> tuple[GOMBlock, ...]:
    blocks: list[GOMBlock] = []
    seen_offsets: set[int] = set()
    if index_end is None:
        index_end = len(GOM_SIGNATURE) + 256 + len(offsets) * 4
    for logical_index, header_offset in enumerate(offsets):
        if header_offset == 0:
            continue
        if header_offset in seen_offsets:
            raise GMBridgeError(
                f"{family} image {logical_index} has a duplicate offset"
            )
        seen_offsets.add(header_offset)
        if header_offset < index_end or header_offset + 16 > len(data):
            raise GMBridgeError(
                f"{family} image {logical_index} header is outside the file"
            )
        plaintext = bytes(
            encrypted ^ key
            for encrypted, key in zip(
                data[header_offset : header_offset + 16], header_key
            )
        )
        image_type, unknown1, unknown2, flags = plaintext[:4]
        width, height, x, y, compressed_size = struct.unpack_from(
            "<HHhhI", plaintext, 4
        )
        if not (1 <= width <= 4096 and 1 <= height <= 4096):
            raise GMBridgeError(
                f"{family} image {logical_index} has invalid dimensions "
                f"{width}x{height}"
            )
        try:
            raw_size = gee.raw_image_size(image_type, flags, width, height)
            gee.image_format_name(image_type, flags)
        except gee.GEEPak3Error as exc:
            raise GMBridgeError(f"{family} image {logical_index}: {exc}") from exc
        payload_size = compressed_size or raw_size
        payload_offset = header_offset + 16
        if payload_size <= 0 or payload_offset + payload_size > len(data):
            raise GMBridgeError(
                f"{family} image {logical_index} payload is outside the file"
            )
        if compressed_size:
            cmf, flg = data[payload_offset : payload_offset + 2]
            if (cmf & 0x0F) != 8 or ((cmf << 8) + flg) % 31 != 0:
                raise GMBridgeError(
                    f"{family} image {logical_index} has an invalid zlib header"
                )
        blocks.append(
            GOMBlock(
                logical_index,
                header_offset,
                payload_offset,
                compressed_size,
                payload_size,
                raw_size,
                image_type,
                unknown1,
                unknown2,
                flags,
                width,
                height,
                x,
                y,
                plaintext,
            )
        )
    return tuple(blocks)


def derive_gom_profile_from_data(password: str, data: bytes) -> GOMProfile:
    signature, family, fixed = _detect_gom_variant(data)
    format_name = family.removeprefix("GM ")
    if len(data) < len(signature) + 256:
        raise GMBridgeError(f"{format_name} global header is truncated")

    global_header = offline.decrypt_feedback(
        data[len(signature) : len(signature) + 256],
        fixed.des_key,
        fixed.seed20,
    )
    title_length = global_header[1]
    title_end = 2 + title_length
    if title_end > len(global_header):
        raise GMBridgeError(f"{format_name} global title is invalid")
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
        raise GMBridgeError(
            f"unsupported {format_name} global header "
            f"(title={title!r}, size={header_size}, version={version}, "
            f"index={index_offset})"
        )
    if slot_count > MAX_GOM_SLOTS:
        raise GMBridgeError(f"{format_name} slot count is too large: {slot_count}")
    index_size = slot_count * 4
    if index_offset + index_size > len(data):
        raise GMBridgeError(f"{format_name} index is outside the file")

    material = offline.derive_password_material(password, GOM_PASSWORD_SALT)
    encrypted_index = data[index_offset : index_offset + index_size]
    decrypted_index = offline.decrypt_feedback(
        encrypted_index,
        material.des_key,
        material.seed20,
    )
    offsets = (
        struct.unpack(f"<{slot_count}I", decrypted_index)
        if slot_count
        else ()
    )
    try:
        blocks = _parse_gom_blocks(
            data,
            offsets,
            offline.gom_image_header_key(password),
            index_offset + index_size,
            format_name,
        )
    except GMBridgeError as exc:
        raise GMBridgeError(f"密码错误，或 {format_name} 索引损坏: {exc}") from exc
    return GOMProfile(slot_count, blocks, family)


def derive_gom_profile_offline(password: str, filename: Path) -> GOMProfile:
    return derive_gom_profile_from_data(password, filename.read_bytes())


def read_gom_payload(data: bytes, block: GOMBlock) -> bytes:
    payload = memoryview(data)[
        block.payload_offset : block.payload_offset + block.payload_size
    ]
    if block.compressed_size:
        try:
            raw = zlib.decompress(payload)
        except zlib.error as exc:
            raise GMBridgeError(
                f"GAMEOFMIR2 image {block.logical_index} zlib decompression failed"
            ) from exc
    else:
        raw = bytes(payload)
    if len(raw) != block.raw_size:
        raise GMBridgeError(
            f"GAMEOFMIR2 image {block.logical_index} raw size "
            f"{len(raw)} != {block.raw_size}"
        )
    return raw


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    if len(rgba) != width * height * 4:
        raise ValueError("RGBA byte count does not match PNG dimensions")

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    scanlines = b"".join(
        b"\x00" + rgba[row * width * 4 : (row + 1) * width * 4]
        for row in range(height)
    )
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(scanlines, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


class BridgeState:
    def __init__(self):
        self.lock = threading.Lock()

    def profile(self, password: str) -> DerivedProfile:
        with self.lock:
            return derive_profile_offline(password)

    def gom_profile(self, password: str, filename: Path) -> GOMProfile:
        with self.lock:
            return derive_gom_profile_offline(password, filename)


def make_handler(state: BridgeState, root: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "PakOfflineEngine/2.2"

        def log_message(self, fmt: str, *args: object) -> None:
            if self.path != "/api/health":
                super().log_message(fmt, *args)

        def send_bytes(self, status: int, content_type: str, payload: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin is not None and self.allowed_origin():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(payload)

        def send_json(self, status: int, value: object) -> None:
            self.send_bytes(
                status,
                "application/json; charset=utf-8",
                json.dumps(value, ensure_ascii=False).encode("utf-8"),
            )

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
            route = urlparse(self.path).path
            if route == "/api/health":
                try:
                    snapshot = offline.default_gee_vm().snapshot_path
                    self.send_json(
                        200,
                        {
                            "ok": True,
                            "engine": "offline",
                            "gmProcessRequired": False,
                            "snapshot": snapshot.name,
                            "formats": ["GEEPAK3", "GAMEOFMIR", "GAMEOFMIR2"],
                        },
                    )
                except Exception as exc:
                    self.send_json(503, {"ok": False, "error": str(exc)})
                return
            filename = STATIC_FILES.get(route)
            if not filename:
                self.send_json(404, {"error": "not found"})
                return
            path = root / filename
            content_type = "text/html; charset=utf-8" if path.suffix == ".html" else "text/javascript; charset=utf-8"
            self.send_bytes(200, content_type, path.read_bytes())

        def do_POST(self) -> None:
            route = urlparse(self.path).path
            if route == "/api/shutdown":
                if not self.allowed_origin():
                    self.send_json(403, {"error": "origin is not allowed"})
                    return
                self.send_json(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if route not in {"/api/gee-profile", "/api/gom-profile"}:
                self.send_json(404, {"error": "not found"})
                return
            if not self.allowed_origin():
                self.send_json(403, {"error": "origin is not allowed"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if route == "/api/gom-profile":
                self.handle_gom_profile(length)
                return
            if length < 2 or length > 65536:
                self.send_json(400, {"error": "invalid request size"})
                return
            try:
                request = json.loads(self.rfile.read(length).decode("utf-8"))
                password = request.get("password")
                if not isinstance(password, str):
                    raise ValueError("password must be a string")
                profile = state.profile(password)
                self.send_json(200, {"ok": True, "profile": profile.public_dict()})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})

        def handle_gom_profile(self, length: int) -> None:
            if length < min(map(len, GOM_SIGNATURES)) or length > MAX_UPLOAD_SIZE:
                self.send_json(400, {"error": "invalid PAK upload size"})
                return
            encoded_password = self.headers.get("X-GM-Password-B64", "")
            try:
                if not encoded_password or len(encoded_password) > 8192:
                    raise ValueError("missing or invalid password header")
                password = base64.b64decode(
                    encoded_password.encode("ascii"), validate=True
                ).decode("utf-8")
            except (UnicodeError, ValueError) as exc:
                self.send_json(400, {"error": str(exc)})
                return

            temporary_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb", prefix="gm-bridge-", suffix=".pak", delete=False
                ) as temporary:
                    temporary_path = Path(temporary.name)
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise GMBridgeError("PAK upload ended before Content-Length")
                        temporary.write(chunk)
                        remaining -= len(chunk)
                profile = state.gom_profile(password, temporary_path)
                self.send_json(200, {"ok": True, "profile": profile.public_dict()})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

        def do_OPTIONS(self) -> None:
            route = urlparse(self.path).path
            if route not in {"/api/gee-profile", "/api/gom-profile"} or not self.allowed_origin():
                self.send_json(403, {"error": "origin is not allowed"})
                return
            self.send_response(204)
            origin = self.headers.get("Origin")
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Content-Type, X-GM-Password-B64"
            )
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()

    return Handler


def password_argument(value: str | None) -> str:
    return value if value is not None else getpass.getpass("PAK password: ")


def main() -> None:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    profile_parser = subparsers.add_parser("profile")
    profile_parser.add_argument("--password")

    view_parser = subparsers.add_parser("view")
    view_parser.add_argument("pak", type=Path)
    view_parser.add_argument("index", type=int)
    view_parser.add_argument("--password")
    view_parser.add_argument("--out", type=Path, required=True)

    serve_parser = subparsers.add_parser("serve")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8765)
    serve_parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()

    if args.command == "profile":
        profile = derive_profile_offline(password_argument(args.password))
        print(json.dumps(profile.public_dict(), indent=2))
        return
    if args.command == "view":
        password = password_argument(args.password)
        data = args.pak.read_bytes()
        if is_gom_pak(data):
            profile = derive_gom_profile_offline(password, args.pak)
            block = next(
                (
                    item
                    for item in profile.blocks
                    if item.logical_index == args.index
                ),
                None,
            )
            if block is None:
                raise GMBridgeError(
                    f"image index is empty or outside the PAK: {args.index}"
                )
            raw = read_gom_payload(data, block)
            rgba = gee.render_rgba(raw, block.image_header())
            write_png(args.out, block.width, block.height, rgba)
            print(
                json.dumps(
                    {
                        "out": str(args.out.resolve()),
                        "index": args.index,
                        "format": gee.image_format_name(
                            block.image_type, block.flags
                        ),
                        "width": block.width,
                        "height": block.height,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return

        profile = derive_profile_offline(password)
        try:
            global_header = gee.parse_global_header(data, profile.parser_profile())
        except gee.GEEPak3Error as exc:
            raise GMBridgeError("密码错误，或该 PAK 不属于当前支持的 GEEPAK3 格式") from exc
        offsets = gee.decrypt_index(data, global_header, profile.parser_profile())
        if args.index < 0 or args.index >= len(offsets) or offsets[args.index] == 0:
            raise GMBridgeError(f"image index is empty or outside the PAK: {args.index}")
        header = gee.decrypt_image_header(
            data,
            args.index,
            offsets[args.index],
            profile.parser_profile(),
            global_header.family,
        )
        raw = gee.read_image_payload(data, header)
        rgba = gee.render_rgba(raw, header)
        write_png(args.out, header.width, header.height, rgba)
        print(
            json.dumps(
                {
                    "out": str(args.out.resolve()),
                    "index": args.index,
                    "format": gee.image_format_name(header.image_type, header.flags),
                    "width": header.width,
                    "height": header.height,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    state = BridgeState()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(state, root))
    print(f"Offline PAK engine: http://{args.host}:{args.port}/")
    print("GM executable is not used; passwords are processed locally and are not logged")
    if args.open_browser:
        webbrowser.open(f"http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except (
        GMBridgeError,
        gee.GEEPak3Error,
        offline.OfflineCryptoError,
        OSError,
        ValueError,
    ) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
