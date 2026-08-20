#!/usr/bin/env python3
"""Password derivation and offline key generation for GM PAK formats."""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import zipfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

try:
    from Crypto.Cipher import DES
except ImportError as exc:  # pragma: no cover - dependency error path
    raise RuntimeError("PyCryptodome is required: python -m pip install pycryptodome") from exc


GEE_PASSWORD_SALT = 0x60
GOM_PASSWORD_SALT = 0x8F
GEE_SET_PASSWORD_ENTRY = 0x007FC848
GEE_EXPAND_ENTRY = 0x00807BDC
GEE_FINALIZE_ENTRY = 0x008072FC
GEE_OBJECT_SIZE = 0x8A4
GEE_INDEX_KEY_OFFSET = 0x2A0
GEE_GLOBAL_KEY_OFFSET = 0x3A0
GEE_IMAGE_KEY_OFFSET = 0x4A0
GEE2_SET_PASSWORD_ENTRY = 0x007FDBB8
GEE2_GLOBAL_DECRYPT_ENTRY = 0x00806B20
GEE2_OBJECT_SIZE = 0x33C
VM_SNAPSHOT_NAME = "geepak3_vm_snapshot.zip"
VM_SNAPSHOT_VERSION = 2
VM_STACK = 0x70000000
VM_INPUT_A = 0x71000000
VM_INPUT_B = 0x71001000
VM_OUTPUT = 0x71002000
VM_SENTINEL = 0x7FFF0000
VM_PAGE_SIZE = 0x1000

GOM_FIXED_DES_KEY = bytes.fromhex("d0740a42ee869c94")
GOM_LEGACY_FIXED_DES_KEY = bytes.fromhex("507892b60c6ed00c")


class OfflineCryptoError(RuntimeError):
    pass


@dataclass(frozen=True)
class PasswordMaterial:
    password: str
    des_key: bytes
    des_schedule: bytes
    seed20: bytes


@dataclass(frozen=True)
class GEEKeys:
    index_key: bytes
    global_header_key: bytes
    image_header_key: bytes


# Each DCPcrypt des_skb row is linear in its six-bit index. These are the
# values at indices 1, 2, 4, 8, 16, and 32 for each row.
_DES_SKB_MASKS = (
    (0x00000010, 0x20000000, 0x00010000, 0x00000800, 0x00000020, 0x00080000),
    (0x02000000, 0x00002000, 0x00200000, 0x00000004, 0x00000400, 0x10000000),
    (0x00000001, 0x00040000, 0x01000000, 0x00000002, 0x00000200, 0x08000000),
    (0x00100000, 0x00000100, 0x00000008, 0x00001000, 0x04000000, 0x00020000),
    (0x10000000, 0x00010000, 0x00000004, 0x20000000, 0x00100000, 0x00001000),
    (0x08000000, 0x00000008, 0x00000400, 0x00020000, 0x00000001, 0x02000000),
    (0x00000100, 0x00080000, 0x01000000, 0x00000010, 0x00200000, 0x00000200),
    (0x04000000, 0x00040000, 0x00000002, 0x00002000, 0x00000020, 0x00000800),
)
_DES_ROTATIONS = (1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1)


def _des_skb(row: int, index: int) -> int:
    value = 0
    for bit, mask in enumerate(_DES_SKB_MASKS[row]):
        if index & (1 << bit):
            value |= mask
    return value


def _perm_op(a: int, b: int, shift: int, mask: int) -> tuple[int, int]:
    temporary = ((a >> shift) ^ b) & mask
    return (a ^ (temporary << shift)) & 0xFFFFFFFF, (b ^ temporary) & 0xFFFFFFFF


def _hperm_op(value: int, shift: int, mask: int) -> int:
    width = 16 - shift
    temporary = (((value << width) & 0xFFFFFFFF) ^ value) & mask
    return (value ^ temporary ^ (temporary >> width)) & 0xFFFFFFFF


def _rotate_left(value: int, shift: int) -> int:
    return ((value << shift) | (value >> (32 - shift))) & 0xFFFFFFFF


def dcp_des_key_schedule(key: bytes) -> bytes:
    """Return TDCP_des.KeyData (32 little-endian DWORDs) for an 8-byte key."""
    if len(key) != 8:
        raise ValueError("DES key must be exactly 8 bytes")

    c, d = struct.unpack("<II", key)
    d, c = _perm_op(d, c, 4, 0x0F0F0F0F)
    c = _hperm_op(c, -2, 0xCCCC0000)
    d = _hperm_op(d, -2, 0xCCCC0000)
    d, c = _perm_op(d, c, 1, 0x55555555)
    c, d = _perm_op(c, d, 8, 0x00FF00FF)
    d, c = _perm_op(d, c, 1, 0x55555555)
    d = (
        ((d & 0x000000FF) << 16)
        | (d & 0x0000FF00)
        | ((d & 0x00FF0000) >> 16)
        | ((c & 0xF0000000) >> 4)
    ) & 0xFFFFFFFF
    c &= 0x0FFFFFFF

    words: list[int] = []
    for rotation in _DES_ROTATIONS:
        c = ((c >> rotation) | (c << (28 - rotation))) & 0x0FFFFFFF
        d = ((d >> rotation) | (d << (28 - rotation))) & 0x0FFFFFFF
        s = (
            _des_skb(0, c & 0x3F)
            | _des_skb(1, ((c >> 6) & 0x03) | ((c >> 7) & 0x3C))
            | _des_skb(2, ((c >> 13) & 0x0F) | ((c >> 14) & 0x30))
            | _des_skb(
                3,
                ((c >> 20) & 0x01)
                | ((c >> 21) & 0x06)
                | ((c >> 22) & 0x38),
            )
        )
        t = (
            _des_skb(4, d & 0x3F)
            | _des_skb(5, ((d >> 7) & 0x03) | ((d >> 8) & 0x3C))
            | _des_skb(6, (d >> 15) & 0x3F)
            | _des_skb(7, ((d >> 21) & 0x0F) | ((d >> 22) & 0x30))
        )
        temporary = ((t << 16) | (s & 0xFFFF)) & 0xFFFFFFFF
        words.append(_rotate_left(temporary, 2))
        temporary = ((s >> 16) | (t & 0xFFFF0000)) & 0xFFFFFFFF
        words.append(_rotate_left(temporary, 6))
    return struct.pack("<32I", *words)


def des_encrypt_block(key: bytes, block: bytes) -> bytes:
    if len(key) != 8 or len(block) != 8:
        raise ValueError("DES ECB requires an 8-byte key and block")
    return DES.new(key, DES.MODE_ECB).encrypt(block)


def des_decrypt_block(key: bytes, block: bytes) -> bytes:
    if len(key) != 8 or len(block) != 8:
        raise ValueError("DES ECB requires an 8-byte key and block")
    return DES.new(key, DES.MODE_ECB).decrypt(block)


@lru_cache(maxsize=128)
def derive_password_material(password: str, salt: int) -> PasswordMaterial:
    if not 0 <= salt <= 0xFF:
        raise ValueError("password salt must fit in one byte")
    if len(password) > 1024:
        raise OfflineCryptoError("password exceeds 1024 characters")
    encoded = password.encode("cp936", errors="replace")
    des_key = hashlib.sha1(encoded).digest()[:8]
    salt_block = bytes([salt]) * 8
    seed20 = des_encrypt_block(des_key, salt_block) + bytes([salt]) * 12
    return PasswordMaterial(
        password=password,
        des_key=des_key,
        des_schedule=dcp_des_key_schedule(des_key),
        seed20=seed20,
    )


def decrypt_feedback(data: bytes, des_key: bytes, seed20: bytes) -> bytes:
    """Decrypt the GAMEOFMIR2 20-byte feedback transform."""
    if len(seed20) != 20:
        raise ValueError("feedback seed must be exactly 20 bytes")
    output = bytearray()
    feedback = seed20
    position = 0
    while len(data) - position >= 20:
        encrypted = data[position : position + 20]
        stage = des_decrypt_block(des_key, encrypted[:8]) + encrypted[8:]
        output.extend(a ^ b for a, b in zip(stage, feedback))
        feedback = encrypted
        position += 20

    tail = data[position:]
    if tail:
        keystream = des_encrypt_block(des_key, feedback[:8]) + feedback[8:]
        output.extend(a ^ b for a, b in zip(tail, keystream))
    return bytes(output)


def _gom_fixed_material(des_key: bytes) -> PasswordMaterial:
    salt_block = bytes([GOM_PASSWORD_SALT]) * 8
    return PasswordMaterial(
        password="",
        des_key=des_key,
        des_schedule=dcp_des_key_schedule(des_key),
        seed20=des_encrypt_block(des_key, salt_block)
        + bytes([GOM_PASSWORD_SALT]) * 12,
    )


def gom_fixed_material() -> PasswordMaterial:
    return _gom_fixed_material(GOM_FIXED_DES_KEY)


def gom_legacy_fixed_material() -> PasswordMaterial:
    return _gom_fixed_material(GOM_LEGACY_FIXED_DES_KEY)


def gom_image_header_key(password: str) -> bytes:
    material = derive_password_material(password, GOM_PASSWORD_SALT)
    return des_encrypt_block(material.des_key, material.seed20[:8]) + material.seed20[8:16]


class GEEKeyVM:
    """Execute the protected GEE key expansion in an isolated x86 VM."""

    def __init__(self, snapshot_path: Path):
        self.snapshot_path = snapshot_path
        self.pages, self.manifest = self._load_snapshot(snapshot_path)

    @staticmethod
    def _load_snapshot(path: Path) -> tuple[dict[int, bytes], dict[str, object]]:
        if not path.is_file():
            raise OfflineCryptoError(f"offline GEE snapshot not found: {path}")
        try:
            with zipfile.ZipFile(path, "r") as archive:
                manifest = json.loads(archive.read("manifest.json"))
                if manifest.get("version") != VM_SNAPSHOT_VERSION:
                    raise OfflineCryptoError(
                        f"unsupported GEE snapshot version: {manifest.get('version')}"
                    )
                pages: dict[int, bytes] = {}
                for item in manifest.get("pages", []):
                    address = int(item["address"], 16)
                    data = archive.read(item["file"])
                    if len(data) != VM_PAGE_SIZE:
                        raise OfflineCryptoError(
                            f"snapshot page 0x{address:08X} has invalid size {len(data)}"
                        )
                    digest = hashlib.sha256(data).hexdigest()
                    if digest != item["sha256"]:
                        raise OfflineCryptoError(
                            f"snapshot page 0x{address:08X} failed SHA-256 validation"
                        )
                    pages[address] = data
        except (OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as exc:
            if isinstance(exc, OfflineCryptoError):
                raise
            raise OfflineCryptoError(f"invalid offline GEE snapshot: {exc}") from exc
        return pages, manifest

    def _new_emulator(self):
        try:
            from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_PROT_ALL
        except ImportError as exc:  # pragma: no cover - dependency error path
            raise OfflineCryptoError(
                "Unicorn is required: python -m pip install unicorn"
            ) from exc

        emulator = Uc(UC_ARCH_X86, UC_MODE_32)
        for address, data in self.pages.items():
            emulator.mem_map(address, VM_PAGE_SIZE, UC_PROT_ALL)
            emulator.mem_write(address, data)
        emulator.mem_map(VM_STACK, 0x10000, UC_PROT_ALL)
        emulator.mem_map(VM_INPUT_A, VM_PAGE_SIZE, UC_PROT_ALL)
        emulator.mem_map(VM_INPUT_B, VM_PAGE_SIZE, UC_PROT_ALL)
        emulator.mem_map(VM_OUTPUT, VM_PAGE_SIZE, UC_PROT_ALL)
        emulator.mem_map(VM_SENTINEL, VM_PAGE_SIZE, UC_PROT_ALL)
        emulator.mem_write(VM_SENTINEL, b"\xCC")
        return emulator

    @staticmethod
    def _set_common_registers(emulator, stack_values: tuple[int, ...]) -> None:
        from unicorn.x86_const import UC_X86_REG_EFLAGS, UC_X86_REG_ESP

        stack_pointer = VM_STACK + 0xF000
        emulator.mem_write(
            stack_pointer,
            struct.pack(f"<{len(stack_values)}I", *stack_values),
        )
        emulator.reg_write(UC_X86_REG_ESP, stack_pointer)
        emulator.reg_write(UC_X86_REG_EFLAGS, 0x202)

    @staticmethod
    def _run(emulator, entry: int, instruction_limit: int) -> None:
        from unicorn import UcError
        from unicorn.x86_const import UC_X86_REG_EIP

        try:
            emulator.emu_start(entry, VM_SENTINEL, count=instruction_limit)
        except UcError as exc:
            eip = emulator.reg_read(UC_X86_REG_EIP)
            raise OfflineCryptoError(
                f"offline GEE VM failed at 0x{eip:08X}: {exc}"
            ) from exc
        eip = emulator.reg_read(UC_X86_REG_EIP)
        if eip != VM_SENTINEL:
            raise OfflineCryptoError(
                f"offline GEE VM exceeded its instruction limit at 0x{eip:08X}"
            )

    def expand(self, material: PasswordMaterial) -> bytes:
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX

        emulator = self._new_emulator()
        emulator.mem_write(VM_INPUT_A, material.des_schedule)
        emulator.mem_write(VM_INPUT_B, material.seed20)
        emulator.mem_write(VM_OUTPUT, bytes(1536))
        self._set_common_registers(emulator, (VM_SENTINEL, 0))
        emulator.reg_write(UC_X86_REG_EAX, VM_INPUT_A)
        emulator.reg_write(UC_X86_REG_EDX, VM_INPUT_B)
        emulator.reg_write(UC_X86_REG_ECX, VM_OUTPUT)
        self._run(emulator, GEE_EXPAND_ENTRY, 80_000_000)
        return bytes(emulator.mem_read(VM_OUTPUT, 1536))

    def finalize(self, expanded_key: bytes) -> bytes:
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX

        if len(expanded_key) != 256:
            raise ValueError("GEE finalize input must be exactly 256 bytes")
        emulator = self._new_emulator()
        emulator.mem_write(VM_INPUT_A, expanded_key)
        emulator.mem_write(VM_OUTPUT, bytes(256))
        self._set_common_registers(emulator, (VM_SENTINEL,))
        emulator.reg_write(UC_X86_REG_EAX, VM_INPUT_A)
        emulator.reg_write(UC_X86_REG_EDX, VM_OUTPUT)
        self._run(emulator, GEE_FINALIZE_ENTRY, 20_000_000)
        return bytes(emulator.mem_read(VM_OUTPUT, 256))

    def set_password(self, material: PasswordMaterial) -> bytes:
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX

        emulator = self._new_emulator()
        password_data = material.seed20 + material.des_schedule
        emulator.mem_write(VM_INPUT_A, password_data)
        emulator.mem_write(VM_OUTPUT, bytes(VM_PAGE_SIZE))
        self._set_common_registers(emulator, (VM_SENTINEL,))
        emulator.reg_write(UC_X86_REG_EAX, VM_OUTPUT)
        emulator.reg_write(UC_X86_REG_EDX, VM_INPUT_A)
        emulator.reg_write(UC_X86_REG_ECX, len(password_data))
        self._run(emulator, GEE_SET_PASSWORD_ENTRY, 120_000_000)
        return bytes(emulator.mem_read(VM_OUTPUT, GEE_OBJECT_SIZE))

    def set_password_v2(self, material: PasswordMaterial) -> bytes:
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX

        emulator = self._new_emulator()
        password_data = material.seed20 + material.des_schedule
        emulator.mem_write(VM_INPUT_A, password_data)
        emulator.mem_write(VM_OUTPUT, bytes(VM_PAGE_SIZE))
        self._set_common_registers(emulator, (VM_SENTINEL,))
        emulator.reg_write(UC_X86_REG_EAX, VM_OUTPUT)
        emulator.reg_write(UC_X86_REG_EDX, VM_INPUT_A)
        emulator.reg_write(UC_X86_REG_ECX, len(password_data))
        self._run(emulator, GEE2_SET_PASSWORD_ENTRY, 120_000_000)
        return bytes(emulator.mem_read(VM_OUTPUT, GEE2_OBJECT_SIZE))

    def decrypt_global_v2(
        self,
        encrypted_header: bytes,
        material: PasswordMaterial,
    ) -> bytes:
        from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX

        if len(encrypted_header) != 256:
            raise ValueError("GEEPAK2 encrypted global header must be exactly 256 bytes")
        emulator = self._new_emulator()
        emulator.mem_write(VM_INPUT_A, material.des_schedule)
        emulator.mem_write(VM_INPUT_B, material.seed20)
        emulator.mem_write(VM_OUTPUT, encrypted_header)
        self._set_common_registers(emulator, (VM_SENTINEL, len(encrypted_header)))
        emulator.reg_write(UC_X86_REG_EAX, VM_INPUT_A)
        emulator.reg_write(UC_X86_REG_EDX, VM_INPUT_B)
        emulator.reg_write(UC_X86_REG_ECX, VM_OUTPUT)
        self._run(emulator, GEE2_GLOBAL_DECRYPT_ENTRY, 120_000_000)
        return bytes(emulator.mem_read(VM_OUTPUT, len(encrypted_header)))

    def derive(self, password: str) -> GEEKeys:
        material = derive_password_material(password, GEE_PASSWORD_SALT)
        object_state = self.set_password(material)
        return GEEKeys(
            index_key=object_state[
                GEE_INDEX_KEY_OFFSET : GEE_INDEX_KEY_OFFSET + 256
            ],
            global_header_key=object_state[
                GEE_GLOBAL_KEY_OFFSET : GEE_GLOBAL_KEY_OFFSET + 256
            ],
            image_header_key=object_state[
                GEE_IMAGE_KEY_OFFSET : GEE_IMAGE_KEY_OFFSET + 1024
            ],
        )


@lru_cache(maxsize=1)
def default_gee_vm() -> GEEKeyVM:
    if getattr(sys, "frozen", False):
        root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    else:
        root = Path(__file__).resolve().parent
    return GEEKeyVM(root / VM_SNAPSHOT_NAME)


@lru_cache(maxsize=64)
def derive_gee_keys(password: str) -> GEEKeys:
    return default_gee_vm().derive(password)
