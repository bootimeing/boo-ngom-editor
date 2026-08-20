#!/usr/bin/env python3
"""Full-corpus regression for the verified GEEPAK2 sample.

The archive password is intentionally accepted only through the environment.
"""

from __future__ import annotations

import hashlib
import os
import struct
import sys
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "tools" / "PakBridge" / "src"))

import geepak2_exact as gee2
import geepak3_exact as gee


PAK_PATH_VALUE = os.environ.get("BOO_GEE2_PAK")
PAK_PATH = Path(PAK_PATH_VALUE) if PAK_PATH_VALUE else None
PAK_SHA256 = "97f4cf98f129a88a1ee44aa29822e53c41f493da6f1296722ab75c7ed919565a"
RGBA_CORPUS_SHA256 = "6cab20a6c2200dd0277d09d61e8eebe40f8bc8598e78c0d8bfa8609c8337c1fd"
SELECTED_RGBA_SHA256 = {
    0: "c7df60a373bdc43fd420ba00632ae89219ccefb8ce7e7dbd26d5b49e5bda1e63",
    1: "209f959c96193b2c47e78f844ad988879d42213305b2466963db68897ebc06ca",
    100: "82ff4163d504aba2db0e8647bd19cb89592777aa3bb2f887048a6b013535d1b2",
    1000: "fdf1ea14fa2e5a163ee2f9f9c62bfa46c833ad3605b917f29e6678a5881057c9",
    2291: "04e08b6681111050aba33ddc0ff649cd9ad5e9c4e5201efc7195d4371e40d9d4",
}


def main() -> None:
    password = os.environ.get("BOO_GEE2_PAK_PASSWORD")
    if PAK_PATH is None or not password:
        print("pak-geepak2.test.py: SKIP (BOO_GEE2_PAK and BOO_GEE2_PAK_PASSWORD are required)")
        return
    if not PAK_PATH.is_file():
        raise FileNotFoundError(f"missing test PAK: {PAK_PATH}")

    data = PAK_PATH.read_bytes()
    actual_pak_hash = hashlib.sha256(data).hexdigest()
    if actual_pak_hash != PAK_SHA256:
        raise AssertionError(f"unexpected test PAK SHA-256: {actual_pak_hash}")

    header, image_mask = gee2.parse_global_header(data[: gee2.HEADER_SIZE], password, len(data))
    if (header.title, header.count, header.version, header.index_offset) != (
        "www.gameofmir2.com",
        2300,
        2,
        266,
    ):
        raise AssertionError(f"unexpected GEEPAK2 header: {header}")
    decrypted_index = gee2.decrypt_index(
        data[header.index_offset : header.index_offset + header.count * 4],
        header.count,
        password,
    )
    offsets = struct.unpack(f"<{header.count}I", decrypted_index)
    if len({offset for offset in offsets if offset}) != 1551:
        raise AssertionError("GEEPAK2 index contains duplicate or missing nonblank offsets")

    corpus = hashlib.sha256()
    raw_bytes = 0
    compressed_count = 0
    raw_count = 0
    formats: Counter[tuple[int, int]] = Counter()
    selected_actual: dict[int, str] = {}
    previous_end = header.index_offset + header.count * 4

    for logical_index, offset in sorted(
        ((index, offset) for index, offset in enumerate(offsets) if offset),
        key=lambda pair: pair[1],
    ):
        if offset < previous_end or offset + 16 > len(data):
            raise AssertionError(f"image {logical_index} overlaps or is out of bounds")
        encrypted_header = data[offset : offset + 16]
        plaintext = bytes(
            encrypted_header[index] ^ image_mask[index]
            if index < len(image_mask)
            else encrypted_header[index]
            for index in range(16)
        )
        image_type, unknown1, unknown2, flags, width, height, x, y, compressed_size = (
            struct.unpack("<BBBBHHhhI", plaintext)
        )
        raw_size = gee.raw_image_size(image_type, flags, width, height)
        payload_size = compressed_size or raw_size
        image_end = offset + 16 + payload_size
        if image_end > len(data):
            raise AssertionError(f"image {logical_index} payload is out of bounds")
        image_header = gee.ImageHeader(
            logical_index,
            offset,
            image_type,
            unknown1,
            unknown2,
            flags,
            width,
            height,
            x,
            y,
            compressed_size,
            plaintext,
        )
        raw = gee.read_image_payload(data, image_header)
        rgba = gee.render_rgba(raw, image_header)
        raw_bytes += len(raw)
        corpus.update(rgba)
        formats[(image_type, flags)] += 1
        if compressed_size:
            compressed_count += 1
        else:
            raw_count += 1
        if logical_index in SELECTED_RGBA_SHA256:
            selected_actual[logical_index] = hashlib.sha256(rgba).hexdigest()
        previous_end = image_end

    if sum(formats.values()) != 1551 or offsets.count(0) != 749:
        raise AssertionError(f"unexpected slot distribution: {sum(formats.values())}/749")
    if (compressed_count, raw_count, raw_bytes) != (1481, 70, 38_963_720):
        raise AssertionError(
            f"unexpected payload totals: compressed={compressed_count}, "
            f"raw={raw_count}, bytes={raw_bytes}"
        )
    expected_formats = Counter({(6, 1): 1066, (5, 0): 248, (3, 0): 113, (6, 0): 80, (7, 0): 44})
    if formats != expected_formats:
        raise AssertionError(f"unexpected image formats: {formats}")
    if selected_actual != SELECTED_RGBA_SHA256:
        raise AssertionError(f"selected image hashes changed: {selected_actual}")
    actual_corpus_hash = corpus.hexdigest()
    if actual_corpus_hash != RGBA_CORPUS_SHA256:
        raise AssertionError(f"RGBA corpus SHA-256 mismatch: {actual_corpus_hash}")

    try:
        gee2.parse_global_header(data[: gee2.HEADER_SIZE], "definitely-wrong", len(data))
    except gee2.GEEPak2Error:
        pass
    else:
        raise AssertionError("wrong password was unexpectedly accepted")

    print(
        "pak-geepak2.test.py: PASS "
        f"slots={header.count} blocks=1551 blank=749 raw_bytes={raw_bytes} "
        f"rgba_sha256={actual_corpus_hash}"
    )


if __name__ == "__main__":
    main()
