#!/usr/bin/env python3
"""Regression coverage for the legacy GAMEOFMIR PAK variant."""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "tools" / "PakBridge" / "src"))

import gm_bridge as gm
import gm_offline_crypto as offline


PAK_PATH_VALUE = os.environ.get("BOO_LEGACY_PAK")
PAK_PATH = Path(PAK_PATH_VALUE) if PAK_PATH_VALUE else None
PASSWORD = os.environ.get("BOO_LEGACY_PAK_PASSWORD", "gameofmir")
PAK_SHA256 = "4b9209525355702ead983c8d309e3140a2bc2c09eaa5581ec1af6149f318c22a"
RGBA_CORPUS_SHA256 = (
    "8bbc6814fc56f77b8b0775c7ac3351579920c75e67b40d57a2bb7437731b5cbe"
)


def main() -> None:
    if PAK_PATH is None:
        raise RuntimeError("BOO_LEGACY_PAK must point to the verified legacy GAMEOFMIR sample")
    if not PAK_PATH.is_file():
        raise FileNotFoundError(f"missing test PAK: {PAK_PATH}")

    data = PAK_PATH.read_bytes()
    actual_pak_hash = hashlib.sha256(data).hexdigest()
    if actual_pak_hash != PAK_SHA256:
        raise AssertionError(f"unexpected test PAK SHA-256: {actual_pak_hash}")
    if not gm.is_gom_pak(data):
        raise AssertionError("legacy GAMEOFMIR signature was not recognized")

    if offline.gom_fixed_material().des_key.hex() != "d0740a42ee869c94":
        raise AssertionError("GAMEOFMIR2 fixed key changed")
    if offline.gom_legacy_fixed_material().des_key.hex() != "507892b60c6ed00c":
        raise AssertionError("legacy GAMEOFMIR fixed key changed")

    profile = gm.derive_gom_profile_from_data(PASSWORD, data)
    if (profile.family, profile.slot_count, len(profile.blocks)) != (
        "GM GAMEOFMIR",
        1376,
        368,
    ):
        raise AssertionError(
            f"unexpected profile: {profile.family}, "
            f"slots={profile.slot_count}, blocks={len(profile.blocks)}"
        )

    rgba_corpus = hashlib.sha256()
    raw_bytes = 0
    for block in profile.blocks:
        raw = gm.read_gom_payload(data, block)
        rgba = gm.gee.render_rgba(raw, block.image_header())
        raw_bytes += len(raw)
        rgba_corpus.update(rgba)
    actual_rgba_hash = rgba_corpus.hexdigest()
    if actual_rgba_hash != RGBA_CORPUS_SHA256:
        raise AssertionError(f"RGBA corpus SHA-256 mismatch: {actual_rgba_hash}")

    try:
        gm.derive_gom_profile_from_data("wrong-password", data)
    except gm.GMBridgeError:
        pass
    else:
        raise AssertionError("wrong password was unexpectedly accepted")

    first = profile.blocks[0]
    print(
        f"family={profile.family} slots={profile.slot_count} "
        f"blocks={len(profile.blocks)} raw_bytes={raw_bytes}"
    )
    print(
        f"first={first.logical_index}:{first.width}x{first.height} "
        f"all_rgba_sha256={actual_rgba_hash} matched=100%"
    )


if __name__ == "__main__":
    main()
