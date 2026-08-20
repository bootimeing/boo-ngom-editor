#!/usr/bin/env python3
"""Capture the minimal verified GEEPAK2/GEEPAK3 VM pages from the reference tool."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path

from unicorn import Uc, UcError, UC_ARCH_X86, UC_HOOK_MEM_UNMAPPED, UC_MODE_32, UC_PROT_ALL
from unicorn.x86_const import (
    UC_X86_REG_EAX,
    UC_X86_REG_ECX,
    UC_X86_REG_EDX,
    UC_X86_REG_EFLAGS,
    UC_X86_REG_EIP,
    UC_X86_REG_ESP,
)

import geepak2_exact as gee2
import gm_offline_crypto as offline
import probe_gm_geepak3_runtime as runtime


SOURCE_EXE_NAME = "GM工具箱-资源编辑器v3.10.0.exe"
SOURCE_EXE_SHA256 = "9ecafb79034c8471ccac4bd491030c5aa06279ad023471d1701395b4bd0bf585"
GEE3_SAMPLE_HASHES = {
    "indexKeySha256": "d4f4402c4136641276c127b9d4fe0e9df4165a97a2a37191918b215e6e2fba8f",
    "globalHeaderKeySha256": "2ae360c7419c53a8913f44291966e939127933ef6c8c2ba5d7bcd01f31bb5219",
    "imageHeaderKeySha256": "55e0b81dac6639a82871dab097039a08ae61f21b8a6e73a0957a81070482f6d0",
}


class LivePages:
    def __init__(self, process_handle: int):
        self.process_handle = process_handle
        self.pages: dict[int, bytes] = {0: bytes(offline.VM_PAGE_SIZE)}

    def get(self, address: int) -> bytes:
        page = address & ~(offline.VM_PAGE_SIZE - 1)
        if page not in self.pages:
            self.pages[page] = runtime.read_process(
                self.process_handle,
                page,
                offline.VM_PAGE_SIZE,
            )
        return self.pages[page]


def new_emulator(source: LivePages) -> Uc:
    emulator = Uc(UC_ARCH_X86, UC_MODE_32)
    mapped: set[int] = set()

    def map_page(address: int, data: bytes) -> None:
        if address in mapped:
            return
        emulator.mem_map(address, offline.VM_PAGE_SIZE, UC_PROT_ALL)
        emulator.mem_write(address, data)
        mapped.add(address)

    def on_unmapped(_emulator, _access, address, _size, _value, _user_data):
        page = address & ~(offline.VM_PAGE_SIZE - 1)
        try:
            map_page(page, source.get(page))
        except OSError:
            return False
        return True

    emulator.hook_add(UC_HOOK_MEM_UNMAPPED, on_unmapped)
    emulator.mem_map(offline.VM_STACK, 0x10000, UC_PROT_ALL)
    for page in range(
        offline.VM_STACK,
        offline.VM_STACK + 0x10000,
        offline.VM_PAGE_SIZE,
    ):
        mapped.add(page)
    for page in (
        offline.VM_INPUT_A,
        offline.VM_INPUT_B,
        offline.VM_OUTPUT,
        offline.VM_SENTINEL,
    ):
        emulator.mem_map(page, offline.VM_PAGE_SIZE, UC_PROT_ALL)
        mapped.add(page)
    emulator.mem_write(offline.VM_SENTINEL, b"\xCC")
    return emulator


def set_stack(emulator: Uc, *values: int) -> None:
    stack_pointer = offline.VM_STACK + 0xF000
    emulator.mem_write(stack_pointer, struct.pack(f"<{len(values)}I", *values))
    emulator.reg_write(UC_X86_REG_ESP, stack_pointer)
    emulator.reg_write(UC_X86_REG_EFLAGS, 0x202)


def run_to_return(emulator: Uc, entry: int, instruction_limit: int) -> None:
    try:
        emulator.emu_start(entry, offline.VM_SENTINEL, count=instruction_limit)
    except UcError as exc:
        eip = emulator.reg_read(UC_X86_REG_EIP)
        raise RuntimeError(f"VM discovery failed at 0x{eip:08X}: {exc}") from exc
    eip = emulator.reg_read(UC_X86_REG_EIP)
    if eip != offline.VM_SENTINEL:
        raise RuntimeError(f"VM discovery exceeded instruction limit at 0x{eip:08X}")


def discover_set_password(
    source: LivePages,
    entry: int,
    object_size: int,
) -> bytes:
    material = offline.derive_password_material("abc", offline.GEE_PASSWORD_SALT)
    password_data = material.seed20 + material.des_schedule
    emulator = new_emulator(source)
    emulator.mem_write(offline.VM_INPUT_A, password_data)
    emulator.mem_write(offline.VM_OUTPUT, bytes(offline.VM_PAGE_SIZE))
    set_stack(emulator, offline.VM_SENTINEL)
    emulator.reg_write(UC_X86_REG_EAX, offline.VM_OUTPUT)
    emulator.reg_write(UC_X86_REG_EDX, offline.VM_INPUT_A)
    emulator.reg_write(UC_X86_REG_ECX, len(password_data))
    run_to_return(emulator, entry, 120_000_000)
    return bytes(emulator.mem_read(offline.VM_OUTPUT, object_size))


def discover_gee2_global(source: LivePages) -> bytes:
    material = gee2.fixed_material()
    encrypted = bytes(range(256))
    emulator = new_emulator(source)
    emulator.mem_write(offline.VM_INPUT_A, material.des_schedule)
    emulator.mem_write(offline.VM_INPUT_B, material.seed20)
    emulator.mem_write(offline.VM_OUTPUT, encrypted)
    set_stack(emulator, offline.VM_SENTINEL, len(encrypted))
    emulator.reg_write(UC_X86_REG_EAX, offline.VM_INPUT_A)
    emulator.reg_write(UC_X86_REG_EDX, offline.VM_INPUT_B)
    emulator.reg_write(UC_X86_REG_ECX, offline.VM_OUTPUT)
    run_to_return(emulator, offline.GEE2_GLOBAL_DECRYPT_ENTRY, 120_000_000)
    return bytes(emulator.mem_read(offline.VM_OUTPUT, len(encrypted)))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_snapshot(
    path: Path,
    pages: dict[int, bytes],
    gee3_state: bytes,
    gee2_state: bytes,
    gee2_global: bytes,
) -> None:
    entries = []
    for address in sorted(pages):
        data = pages[address]
        filename = f"pages/{address:08x}.bin"
        entries.append(
            {
                "address": f"0x{address:08X}",
                "file": filename,
                "sha256": digest(data),
            }
        )
    manifest = {
        "version": offline.VM_SNAPSHOT_VERSION,
        "sourceExeSha256": SOURCE_EXE_SHA256,
        "pageSize": offline.VM_PAGE_SIZE,
        "setPasswordEntry": f"0x{offline.GEE_SET_PASSWORD_ENTRY:08X}",
        "expandEntry": f"0x{offline.GEE_EXPAND_ENTRY:08X}",
        "finalizeEntry": f"0x{offline.GEE_FINALIZE_ENTRY:08X}",
        "gee2SetPasswordEntry": f"0x{offline.GEE2_SET_PASSWORD_ENTRY:08X}",
        "gee2GlobalDecryptEntry": f"0x{offline.GEE2_GLOBAL_DECRYPT_ENTRY:08X}",
        "sample": {
            "password": "abc",
            "indexKeySha256": digest(
                gee3_state[
                    offline.GEE_INDEX_KEY_OFFSET : offline.GEE_INDEX_KEY_OFFSET + 256
                ]
            ),
            "globalHeaderKeySha256": digest(
                gee3_state[
                    offline.GEE_GLOBAL_KEY_OFFSET : offline.GEE_GLOBAL_KEY_OFFSET + 256
                ]
            ),
            "imageHeaderKeySha256": digest(
                gee3_state[
                    offline.GEE_IMAGE_KEY_OFFSET : offline.GEE_IMAGE_KEY_OFFSET + 1024
                ]
            ),
        },
        "gee2Sample": {
            "password": "abc",
            "objectStateSha256": digest(gee2_state),
            "secondaryStateSha256": digest(gee2_state[0x2A0:0x334]),
            "globalVectorSha256": digest(gee2_global),
        },
        "pages": entries,
    }
    for key, expected in GEE3_SAMPLE_HASHES.items():
        if manifest["sample"][key] != expected:
            raise RuntimeError(f"GEEPAK3 regression for {key}")

    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        for item in entries:
            archive.writestr(item["file"], pages[int(item["address"], 16)])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().with_name(offline.VM_SNAPSHOT_NAME),
    )
    args = parser.parse_args()

    module = runtime.module_base(args.pid, SOURCE_EXE_NAME)
    if module != 0x00400000:
        raise RuntimeError(f"unexpected module base: 0x{module:08X}")
    handle = runtime.kernel32.OpenProcess(runtime.PROCESS_ACCESS, False, args.pid)
    if not handle:
        runtime.fail("OpenProcess")
    try:
        source = LivePages(handle)
        gee3_state = discover_set_password(
            source,
            offline.GEE_SET_PASSWORD_ENTRY,
            offline.GEE_OBJECT_SIZE,
        )
        gee2_state = discover_set_password(
            source,
            offline.GEE2_SET_PASSWORD_ENTRY,
            offline.GEE2_OBJECT_SIZE,
        )
        gee2_global = discover_gee2_global(source)
        write_snapshot(args.out, source.pages, gee3_state, gee2_state, gee2_global)
    finally:
        runtime.kernel32.CloseHandle(handle)

    print(
        json.dumps(
            {
                "out": str(args.out.resolve()),
                "pages": len(source.pages),
                "compressedBytes": args.out.stat().st_size,
                "gee2ObjectStateSha256": digest(gee2_state),
                "gee2GlobalVectorSha256": digest(gee2_global),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
