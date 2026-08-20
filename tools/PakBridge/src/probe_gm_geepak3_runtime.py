#!/usr/bin/env python3
"""Invoke the GM toolbox's GEEPAK3 key routines inside its 32-bit process."""

from __future__ import annotations

import argparse
import ctypes
import json
import struct
import time
from ctypes import wintypes
from pathlib import Path


PROCESS_ACCESS = (
    0x0002  # PROCESS_CREATE_THREAD
    | 0x0400  # PROCESS_QUERY_INFORMATION
    | 0x0008  # PROCESS_VM_OPERATION
    | 0x0020  # PROCESS_VM_WRITE
    | 0x0010  # PROCESS_VM_READ
    | 0x00100000  # SYNCHRONIZE
)
MEM_COMMIT_RESERVE = 0x1000 | 0x2000
MEM_RELEASE = 0x8000
PAGE_EXECUTE_READWRITE = 0x40
WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 0x102
TH32CS_SNAPPROCESS = 0x00000002
TH32CS_SNAPMODULE = 0x00000008
TH32CS_SNAPMODULE32 = 0x00000010
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
ERROR_BAD_LENGTH = 24
SNAPSHOT_RETRY_TIMEOUT = 1.0

PREFERRED_BASE = 0x00400000
FUNCTION_RVAS = {
    "password_state": 0x0080703C - PREFERRED_BASE,
    "expand_key": 0x00807BDC - PREFERRED_BASE,
    "finalize_key": 0x008072FC - PREFERRED_BASE,
    "crypt": 0x0081ECC0 - PREFERRED_BASE,
}


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


class MODULEENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("th32ModuleID", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("GlblcntUsage", wintypes.DWORD),
        ("ProccntUsage", wintypes.DWORD),
        ("modBaseAddr", ctypes.POINTER(ctypes.c_byte)),
        ("modBaseSize", wintypes.DWORD),
        ("hModule", wintypes.HMODULE),
        ("szModule", wintypes.WCHAR * 256),
        ("szExePath", wintypes.WCHAR * 260),
    ]


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32FirstW.restype = wintypes.BOOL
kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32NextW.restype = wintypes.BOOL
kernel32.Module32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W)]
kernel32.Module32FirstW.restype = wintypes.BOOL
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.VirtualAllocEx.argtypes = [
    wintypes.HANDLE,
    wintypes.LPVOID,
    ctypes.c_size_t,
    wintypes.DWORD,
    wintypes.DWORD,
]
kernel32.VirtualAllocEx.restype = wintypes.LPVOID
kernel32.VirtualFreeEx.argtypes = [wintypes.HANDLE, wintypes.LPVOID, ctypes.c_size_t, wintypes.DWORD]
kernel32.VirtualFreeEx.restype = wintypes.BOOL
kernel32.WriteProcessMemory.argtypes = [
    wintypes.HANDLE,
    wintypes.LPVOID,
    wintypes.LPCVOID,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
kernel32.WriteProcessMemory.restype = wintypes.BOOL
kernel32.ReadProcessMemory.argtypes = [
    wintypes.HANDLE,
    wintypes.LPCVOID,
    wintypes.LPVOID,
    ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t),
]
kernel32.ReadProcessMemory.restype = wintypes.BOOL
kernel32.CreateRemoteThread.argtypes = [
    wintypes.HANDLE,
    wintypes.LPVOID,
    ctypes.c_size_t,
    wintypes.LPVOID,
    wintypes.LPVOID,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
]
kernel32.CreateRemoteThread.restype = wintypes.HANDLE
kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
kernel32.WaitForSingleObject.restype = wintypes.DWORD
kernel32.GetExitCodeThread.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
kernel32.GetExitCodeThread.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL


def fail(message: str) -> None:
    error = ctypes.get_last_error()
    raise OSError(error, f"{message}: {ctypes.FormatError(error)}")


def create_snapshot(flags: int, pid: int, label: str) -> int:
    deadline = time.monotonic() + SNAPSHOT_RETRY_TIMEOUT
    while True:
        snapshot = kernel32.CreateToolhelp32Snapshot(flags, pid)
        if snapshot != INVALID_HANDLE_VALUE:
            return snapshot
        error = ctypes.get_last_error()
        if error != ERROR_BAD_LENGTH or time.monotonic() >= deadline:
            raise OSError(error, f"CreateToolhelp32Snapshot({label}): {ctypes.FormatError(error)}")
        time.sleep(0.01)


def find_process(exe_name: str) -> int:
    snapshot = create_snapshot(TH32CS_SNAPPROCESS, 0, "process")
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        found: list[int] = []
        if kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                if entry.szExeFile.casefold() == exe_name.casefold():
                    found.append(entry.th32ProcessID)
                if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                    break
        if len(found) != 1:
            raise RuntimeError(f"expected one {exe_name!r} process, found {found}")
        return found[0]
    finally:
        kernel32.CloseHandle(snapshot)


def module_base(pid: int, exe_name: str) -> int:
    snapshot = create_snapshot(
        TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid, "module"
    )
    try:
        entry = MODULEENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        if not kernel32.Module32FirstW(snapshot, ctypes.byref(entry)):
            fail("Module32FirstW")
        while True:
            if entry.szModule.casefold() == exe_name.casefold():
                return ctypes.cast(entry.modBaseAddr, ctypes.c_void_p).value
            if not kernel32.Module32NextW(snapshot, ctypes.byref(entry)):
                break
        raise RuntimeError(f"main module {exe_name!r} not found in pid {pid}")
    finally:
        kernel32.CloseHandle(snapshot)


def write_process(handle: int, address: int, data: bytes) -> None:
    buffer = ctypes.create_string_buffer(data)
    written = ctypes.c_size_t()
    if not kernel32.WriteProcessMemory(
        handle, ctypes.c_void_p(address), buffer, len(data), ctypes.byref(written)
    ):
        fail(f"WriteProcessMemory(0x{address:X})")
    if written.value != len(data):
        raise RuntimeError(f"short remote write: {written.value}/{len(data)}")


def read_process(handle: int, address: int, size: int) -> bytes:
    buffer = ctypes.create_string_buffer(size)
    read = ctypes.c_size_t()
    if not kernel32.ReadProcessMemory(
        handle, ctypes.c_void_p(address), buffer, size, ctypes.byref(read)
    ):
        fail(f"ReadProcessMemory(0x{address:X})")
    if read.value != size:
        raise RuntimeError(f"short remote read: {read.value}/{size}")
    return buffer.raw


def mov_imm(register_opcode: int, value: int) -> bytes:
    return bytes([register_opcode]) + struct.pack("<I", value)


def invoke_stub(base: int, module: int, password_ptr: int, data_length: int) -> bytes:
    addr = lambda offset: base + offset
    fn = lambda name: module + FUNCTION_RVAS[name]
    code = bytearray()

    # password_state(password, out128, out20, 0x60)
    code += b"\x68" + struct.pack("<I", 0x60)
    code += mov_imm(0xB9, addr(0x500))  # ecx = out20
    code += mov_imm(0xBA, addr(0x400))  # edx = out128
    code += mov_imm(0xB8, password_ptr)  # eax = Delphi string data
    code += mov_imm(0xBF, fn("password_state"))
    code += b"\xFF\xD7"  # call edi
    code += b"\xC7\x05" + struct.pack("<II", addr(0x300), 1)

    # expand_key(out128, out20, key_a, 1)
    code += b"\x6A\x01"
    code += mov_imm(0xB9, addr(0x600))
    code += mov_imm(0xBA, addr(0x500))
    code += mov_imm(0xB8, addr(0x400))
    code += mov_imm(0xBF, fn("expand_key"))
    code += b"\xFF\xD7"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x304), 2)

    # finalize_key(key_a, key_b)
    code += mov_imm(0xBA, addr(0x700))
    code += mov_imm(0xB8, addr(0x600))
    code += mov_imm(0xBF, fn("finalize_key"))
    code += b"\xFF\xD7"
    code += b"\xC7\x05" + struct.pack("<II", addr(0x308), 3)

    if data_length:
        # crypt(data, key_b, length)
        code += mov_imm(0xB9, data_length)
        code += mov_imm(0xBA, addr(0x700))
        code += mov_imm(0xB8, addr(0x900))
        code += mov_imm(0xBF, fn("crypt"))
        code += b"\xFF\xD7"
        code += b"\xC7\x05" + struct.pack("<II", addr(0x30C), 4)

    code += b"\x33\xC0\xC2\x04\x00"  # xor eax,eax; ret 4
    return bytes(code)


def delphi_string(password: str, encoding: str) -> tuple[bytes, int]:
    if encoding == "ansi":
        payload = password.encode("cp936")
        length = len(payload)
    else:
        payload = password.encode("utf-16le")
        length = len(password)
    prefix = struct.pack("<ii", -1, length)
    return prefix + payload + b"\x00\x00", 8


def run_probe(pid: int, password: str, encoding: str, encrypted: bytes) -> dict[str, object]:
    exe_name = "GM工具箱-资源编辑器v3.10.0.exe"
    module = module_base(pid, exe_name)
    handle = kernel32.OpenProcess(PROCESS_ACCESS, False, pid)
    if not handle:
        fail("OpenProcess")
    remote = 0
    try:
        allocation_size = (0x900 + len(encrypted) + 0xFFF) & ~0xFFF
        allocation_size = max(allocation_size, 0x2000)
        remote = kernel32.VirtualAllocEx(
            handle, None, allocation_size, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE
        )
        if not remote:
            fail("VirtualAllocEx")
        remote = int(remote)
        string_blob, pointer_offset = delphi_string(password, encoding)
        write_process(handle, remote + 0x200, string_blob)
        if encrypted:
            write_process(handle, remote + 0x900, encrypted)
        stub = invoke_stub(
            remote,
            module,
            remote + 0x200 + pointer_offset,
            len(encrypted),
        )
        write_process(handle, remote, stub)

        thread_id = wintypes.DWORD()
        thread = kernel32.CreateRemoteThread(
            handle,
            None,
            0,
            ctypes.c_void_p(remote),
            None,
            0,
            ctypes.byref(thread_id),
        )
        if not thread:
            fail("CreateRemoteThread")
        try:
            wait = kernel32.WaitForSingleObject(thread, 15000)
            if wait == WAIT_TIMEOUT:
                raise TimeoutError("remote key derivation timed out")
            if wait != WAIT_OBJECT_0:
                fail(f"WaitForSingleObject returned 0x{wait:X}")
            exit_code = wintypes.DWORD()
            if not kernel32.GetExitCodeThread(thread, ctypes.byref(exit_code)):
                fail("GetExitCodeThread")
        finally:
            kernel32.CloseHandle(thread)

        stages = struct.unpack("<4I", read_process(handle, remote + 0x300, 16))
        result: dict[str, object] = {
            "pid": pid,
            "module_base": f"0x{module:08X}",
            "remote_thread_exit": f"0x{exit_code.value:08X}",
            "stages": stages,
            "password_state_128": read_process(handle, remote + 0x400, 128).hex(),
            "password_hash_20": read_process(handle, remote + 0x500, 20).hex(),
            "expanded_key_256": read_process(handle, remote + 0x600, 256).hex(),
            "final_key_256": read_process(handle, remote + 0x700, 256).hex(),
        }
        if encrypted:
            result["decrypted"] = read_process(handle, remote + 0x900, len(encrypted))
        return result
    finally:
        if remote:
            kernel32.VirtualFreeEx(handle, ctypes.c_void_p(remote), 0, MEM_RELEASE)
        kernel32.CloseHandle(handle)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int)
    parser.add_argument("--password", default="QQ1167746")
    parser.add_argument("--encoding", choices=("ansi", "utf16"), default="utf16")
    parser.add_argument("--pak", type=Path, help="decrypt a segment from this PAK")
    parser.add_argument("--offset", type=lambda value: int(value, 0), default=10)
    parser.add_argument("--length", type=lambda value: int(value, 0), default=256)
    parser.add_argument("--out", type=Path, help="write decrypted segment as binary")
    args = parser.parse_args()
    exe_name = "GM工具箱-资源编辑器v3.10.0.exe"
    pid = args.pid or find_process(exe_name)
    encrypted = b""
    if args.pak:
        raw = args.pak.read_bytes()
        if len(raw) < 266 or raw[:8] != b"\x07GEEPAK3":
            raise ValueError(f"not a 266-byte GEEPAK3 file: {args.pak}")
        end = args.offset + args.length
        if args.offset < 0 or args.length < 0 or end > len(raw):
            raise ValueError(f"segment {args.offset}:{end} is outside {args.pak}")
        encrypted = raw[args.offset:end]
    result = run_probe(pid, args.password, args.encoding, encrypted)
    decrypted = result.pop("decrypted", None)
    if decrypted is not None:
        if args.out:
            args.out.write_bytes(decrypted)
            result["decrypted_file"] = str(args.out.resolve())
            result["decrypted_bytes"] = len(decrypted)
        else:
            result["decrypted"] = decrypted.hex()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
