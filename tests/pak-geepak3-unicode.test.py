#!/usr/bin/env python3
"""Regression coverage for the alternate GEEPAK3 global-header key path."""

from __future__ import annotations

import base64
import hashlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "tools" / "PakBridge" / "src"))

import gm_offline_crypto as offline
import offline_bridge


PASSWORD = "symbols.test!@#"
REFERENCE_KEY_SHA256 = "0b5b575e22d83b70a0d7ad28d213f22662adf423bd113f3368125621604d3b69"


def main() -> None:
    key = offline.derive_gee_alternate_global_key(PASSWORD)
    if hashlib.sha256(key).hexdigest() != REFERENCE_KEY_SHA256:
        raise AssertionError("alternate GEE global-header key no longer matches GM runtime")

    plaintext = bytearray(256)
    title = b"www.gameofmir.com"
    plaintext[1] = len(title)
    plaintext[2 : 2 + len(title)] = title
    plaintext[0x2A:0x2E] = (266).to_bytes(4, "little")
    plaintext[0x2E:0x32] = (3).to_bytes(4, "little")
    plaintext[0x32:0x36] = (2).to_bytes(4, "little")
    plaintext[0x36:0x3A] = (266).to_bytes(4, "little")

    encrypted = offline.decrypt_gee_alternate_global_header(bytes(plaintext), PASSWORD)
    decrypted = offline.decrypt_gee_alternate_global_header(encrypted, PASSWORD)
    if decrypted != plaintext:
        raise AssertionError("alternate GEE global-header transform is not symmetric")

    profile = offline_bridge.derive_gee_profile(PASSWORD, encrypted)
    returned = base64.b64decode(profile["alternateGlobalHeader"], validate=True)
    if returned != plaintext:
        raise AssertionError("offline bridge did not return the alternate GEE global header")
    if any(symbol in str(profile) for symbol in (PASSWORD, "symbols.test")):
        raise AssertionError("offline bridge profile exposed the password")

    print("pak-geepak3-unicode.test.py: PASS reference key and header roundtrip")


if __name__ == "__main__":
    main()
