#!/usr/bin/env python3
"""Deterministic GEEPAK3 parser for the QQ1167746 password profile."""

from __future__ import annotations

import base64
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path


SIGNATURE = b"\x07GEEPAK3"
GLOBAL_HEADER_SIZE = 266
ENCRYPTED_GLOBAL_SIZE = 256


@dataclass(frozen=True)
class PasswordProfile:
    password: str
    index_key: bytes
    global_header_key: bytes
    image_header_key: bytes


@dataclass(frozen=True)
class GlobalHeader:
    family: str
    plaintext: bytes
    title: str
    header_size: int
    count: int
    version: int
    index_offset: int


@dataclass(frozen=True)
class ImageHeader:
    index: int
    offset: int
    image_type: int
    unknown1: int
    unknown2: int
    flags: int
    width: int
    height: int
    x: int
    y: int
    compressed_size: int
    plaintext: bytes


class GEEPak3Error(ValueError):
    pass


QQ1167746_PROFILE = PasswordProfile(
    password="QQ1167746",
    index_key=base64.b64decode(
        "D0uIybe1eHYICFzU99vEZUrAwo8KH3VIGEjsnLNha/iNBAbD+s8nTIAI5PxgYGBg"
        "BoXKS2BgYGAwBPz8YGBgYA8ARM8UWgjuKGTUmAnZeLGNA4EP6fn78jBI3Oz+z7kU"
        "hwTNx/rd38dIwPjImqWnR84JCI//4fcvQCz4vN/77jtPQMpOer5evfAgqPg/369l"
        "T4LEi6/CP9aAYNxw/7v/PY+DwoTy/fseoIB87Lxff3sKiMjHn5ufphjAmHz3/3OXj"
        "gjEz//e/9cwOGTkz+dVhwsHzMj5r/XfFFDw/Pd/fTePQcTPvyvdZwykrFz/cfuCA"
        "UHAx33p19HsAHz4pNq7TQ=="
    ),
    global_header_key=base64.b64decode(
        "bRWEpWaulkkr5aIPuQstO1Fk5djuIfJElvYUhc7DtVOM+4HmnOShoECFaziW/FLr"
        "O/cJTmHnLACMam1iftGx0rpixwSq9hoFpJ2wFKuOBCUqobuIByWGKH3W/BFGgMDM"
        "taINyGAwkFE+mZfCcRBQ1KoAFaYMSP2EyNM4rk0pL0w/cpQMh0p2LuLbBgtZYdzn"
        "XGjJXzY2ut78l4xzILNkbnaNXjsvnz31aPTApenmobRbLcP4uCoPoHZZmb2ZjLOm"
        "teMrwaop2CjaINcMMW+HcLpe7ptb8/CCHDbfU8ROVCoAF4eh6ppQ2ORnDYgqRh/E"
        "MJsVAQVimVlgE/sGg2J3hA=="
    ),
    image_header_key=base64.b64decode(
        "m3Z+8GCUzj9CKAlRRTpOJKbuS8otBuepT2z2d/M3fUyqhKd79PMxpf6NjRp033iP"
        "VPfo1mZe3sK67jKePSaG1e7JGU7iFS5h4z1WWCJWalrZPpXLYoa/88/oDb2pEZK4"
        "QswowX2bDOg1ZAzyyxb9k1kkWRUApHvoTToEcMdU9sdEMz5b2FLBpfxamANFyJjt"
        "WOTGCdwAsKk0J8hKBwTbf1xVnyQkkIanwxsVf/sukkmVF0uCBKpP6dqufhnLOWjZ"
        "l5wfqmdbjtb41N+z7oHFHFb8D2DFfQlgXyVgE7U/JsF8qsInE1hiRfruJncm25Zy"
        "hcq4u2iJG8wEHX07E8yDR0lVCbTSZcWCfz6Bu1t318g7J3mgeq1loTXxHG0fgpY9"
        "JrikTHnQeQpPqYikp7U36gtxZfQebBBwmG+kz4vRtR9ImhiJJNO8hRvnp4eFI3e4"
        "OdqWj0sgy9FtpKp5JUJrJ69inqZPfNEeFrcrOmhx+kUdVjmsEtcNnL8RuOI1rwB9"
        "ILHWgR2X9rijapuR1gJBKIRwj87yNVaFHbiIDFlvtl+DSZ8gUC8rTzPRt2t68oYB"
        "M4pMclGYNYtM7LCd5ln/9a+D34SPQQ5bCwW7pSaOWia9DL3kihs+1USK6ibkIghW"
        "zPuwNT6nVU4oTn7VIwDoSPPZ5iZvxJNPW1mklpDtiuMakkaS857qGwwP12RW+ozs"
        "o5xr3Hap/ZGu1hvUymKESqVzf9JHK6IXBElASfWnrhq/a/k6R7eG0QAXEEJ5c1jo"
        "WpmMz8ex35jodz36ntWGX9tZyvO2nup+GQnKztpPfKrF4ZLgvBqTBAfJoaMrPg6w"
        "ndRdtbVZjm+fmNF/ehdKhZCXoOqo6Bro2skTk/sX0Q25j3WCCF76+ZnY2MzPcDj7"
        "rXh6zEqXkyA995Zx/ypI8RDM2ROscL/1xD5CzVLpnCfPuM7I7hMXRjCAWIuCT/mY"
        "OXCjOHJmaGvlxNLEXZZAiM6BJqMwebZBlFWzZVUnAnQBHgOGJSH+4fnkIPInGgse0"
        "RygiJ+Wn+WwQ7IzLPIxyC8IVnRwJjnOJ2tJKzVKbYXdcKxis+Rmk/wEIICA5ct7H"
        "Zmd2iYmiLTtSnCHYvpVQoEWIijwMgrUuFaWeyVAvnK+1YVFD+mzLDev61MFnqYQK"
        "vG65apN9GQGBbvc50Vz4ENLScVK2FC6SxEgKMcrTbgqSbsCVvHGLaJou/ziTsXaX"
        "39lgMeMqMDxtDEqsy32UHsQslCQGaS7jmi8TVRN7G4XX1qNiRlcwiQalnN51E/c5"
        "FMlSJfO4RWPkkgDSFi8ZmNeXqlIYwn65Sy1e96clpDv1K06BtxnZHmxZloLLYkkF"
        "LDVBrOCa0Zs4tBDPNgS7A=="
    ),
)


LEGACY_GLOBAL_PREFIX_KEY = bytes.fromhex(
    "74c1c74efcc74ab4e8c5f66f6c25bfa3414342a94c6f90dbc346912fa5b476a4"
    "710bde4be29e676505377d5a047b366c62f826af964e8291749c"
)
LEGACY_INDEX_MASKS = struct.unpack(
    "<64I",
    base64.b64decode(
        "NDe3/RCc3arrryd7Cz/VFLf2+rAoXD60pwdPSzLlTNo68LuzVHZu4TPnOw+fn5+f"
        "sDq395+fn59zY0P3n5+fn/Iz//gpX04rc9PHr1q2e8z9OXz5swCA8e/jow8ABCj"
        "M/fu4ewwCQACrexvXAQawjLO2OPwGCcDEj/vfw4dHg254uze5FgBBUMOL4+sAKZV"
        "3d71yM0KZgDH7k6P/wNYxMH64dHECxcAZv1/fkyykUEC89bQ8AIAY2Ldbl8sIBG"
        "PEt/W9tyADFGkfR5Nj0QUApbZxfrYAERChWy97hwBBZAl4N790MAAg2hsr8x80Kc"
        "gy+/SyPoBQFEaHf8dziMBDeA=="
    ),
)
LEGACY_IMAGE_HEADER_KEY = base64.b64decode(
    "1HD6b5c0nWMAAAAAwTjuTRONObdtt9YDAAAAALbyAWv9+9UH4Z8DgQAAAAAXC9jz"
    "mTGRY/Z4ILsAAAAA8BCu0JpKE71CJMqcAAAAAL9p5LCX1ytNXKXWAgAAAACf3eL2"
    "js4jj/EvRQIAAAAAWE8uPmO6eLxQla0iAAAAAKQZ2AUHD4Diuh7TegAAAAAGxwsI"
    "HX5YET9IdR4AAAAAJEnmw3G+8wMzwBZiAAAAAGYtOS+F+CH0z6FuWQAAAADmcxAd"
    "wq9hQV+mQe8AAAAA6E77GgMJoxktD1FQAAAAANZYZMo6gpLn2KZjBAAAAADXdVTn"
    "DZU9W3l+jMIAAAAAXD+B5KSWcmTLX9ayAAAAAFgBRaqYaKJPuNyQGgAAAADB+/ge"
    "R/if6pL4bxsAAAAAd/RZ6yryOrwdGHhbAAAAAGfFJYsXqdwgNflVXAAAAABrhmN5"
    "ugS31NnGZQgAAAAAfV9FiG0Bi18hiSt0AAAAAIiwQXfcqZzo3mU/UgAAAAAMiC+A"
    "Sz/brTUM5Y0AAAAArmNm7Sz7TTic8Ef3AAAAAAChBLjC/X9c+ImbNQAAAACYM+bL"
    "yBOF49I+fDkAAAAARJ3y0VPKHczseZcWAAAAANe3PGNe0uClXmcsZAAAAACXMDYO"
    "p5d5jyS48UEAAAAA2liLLVdG4KT8jVHPAAAAAOFbG+l5NaJbXwQExwAAAAC+LjDf"
    "8B+PnDpFL8EAAAAARyWtj+e/qPY03JCiAAAAAAqf6StLhICy96ciYQAAAACTs6OR"
    "qSncBbvE2tgAAAAANt8cw2Yth22e/tOuAAAAAGPXD4j9YvGfFlaSvQAAAABE5zKo"
    "4ITpzO+cXyQAAAAABZeD6MoKdjMqKS2yAAAAAFf/xCDNJgSxXT6+xQAAAAA/525X"
    "7fJQS11ooyUAAAAAgUM/XmoBmzNS3DSUAAAAAO3Fq61IjIsV7VLYpAAAAADPqpIW"
    "zE9u5ffqUrwAAAAAXVet3pByqLl8h3hLAAAAAACfFeAE6r3PU7OoWAAAAACBAe5M"
    "iU86wUPtn5IAAAAAbBV3GyZGySbz6GcsAAAAAA53ZgGUQwz49nnpLQAAAAAwQXUc"
    "UegE4e569xYAAAAAVwJEGE3Ch/ZC78yuAAAAAHoJNlQOiQ3ywJgJeQAAAAAMEfqo"
    "BrPW7KaMz68AAAAAVnX6qR+i0iFdg8iDAAAAAIrWtfL6TyA/LbRaKAAAAABu/l7/"
    "vvZmjkC9Kn8AAAAAaAQZ4FGLHhYG9JwrAAAAAKBeL01VPv/shsee/gAAAAD1CQyJ"
    "gzr5x7xlzW8AAAAAmmVVoXn60jkww0MlAAAAAOZ4CRurUFZnNsLo9QAAAABKgKNU"
    "SGpyMcuOKz0AAAAAAu00Jw=="
)


# Palette passed to SetDIBColorTable by the original viewer for WIF_A8.
GEE_A8_PALETTE_BGRA = base64.b64decode(
    "AAAAAAAAgP8AgAD/AICA/4AAAP+AAID/gIAA/8DAwP+XgFX/yLmd/3Nze/8pKS3/"
    "UlJa/1paY/85OUL/GBgd/xAQGP8YGCn/CAgQ/3F58v9fZ+H/Wlr//zEx//9SWtb/"
    "ABCU/xgplP8ACDn/ABBz/wAYtf9SY73/EBhC/5mq//8AEFr/KTlz/zFKpf9ze5T/"
    "MVK9/xAhUv8YMXv/EBgt/zFKjP8AKZT/ADG9/1Jzxv8YMWv/QmvG/wBKzv85Y6X/"
    "GDFa/wAQKv8ACBX/ABg6/wAACP8AACn/AABK/wAAnf8AANz/AADe/wAA+/9Sc5z/"
    "SmuU/ylKc/8YMVL/GEqM/xFEiP8AIUr/EBgh/1qU1v8ha8b/AGvv/wB3//+ElKX/"
    "ITFC/wgQGP8IGCn/ABAh/xgpOf85Y4z/EClC/xhCa/8YSnv/AEqU/3uEjP9aY2v/"
    "OUJK/xghKf8pOUb/lKW1/1pre/+Usc7/c4yl/1pzjP9zlLX/c6XW/0ql7/+Mxu//"
    "QmN7/zlWa/9alL3/ADlj/63G1v8pQlL/GGOU/63W7/9jjKX/Slpj/3ulvf8YQlr/"
    "MYy9/ykxNf9jhJT/Smt7/1qMpf8pSlr/OXuc/xAxQv8hre//ABAY/wAhKf8Aa5z/"
    "WoSU/xhCUv8pWmv/IWN7/yF7nP8Apd7/OVJa/xApMf97vc7/OVpj/0qElP8ppcb/"
    "GJwQ/0qMQv9CjDH/KZQQ/xAYCP8YGAj/ECkI/ylCGP+ttaX/c3Nr/ykpGP9KQhj/"
    "SkIx/97GY///3UT/79aM/zlrc/853vf/jO/3/wDn9/9aa2v/pYxa/++1Of/OnEr/"
    "tYQx/2tSMf/W3t7/tb29/4SMjP/e9/f/GAgA/zkYCP8pEAj/ABgI/wApCP+lUgD/"
    "3nsA/0opEP9rORD/jFIQ/6VaIf9aMRD/hEIQ/4RSMf8xIRj/e1pK/6VrUv9jOSn/"
    "3koQ/yEpKf85Skr/GCkp/ylKSv9Ce3v/Spyc/ylaWv8UQkL/ADk5/wBZWf8sNcr/"
    "IXNr/wAxKf8QOTH/GDkx/wBKQv8YY1L/KXNa/xhKMf8AIRj/ADEY/xA5GP9KhGP/"
    "Sr1r/0q1Y/9KvWP/Spxa/zmMSv9KxmP/StZj/0qEUv8pczH/WsZj/0q9Uv8A/xD/"
    "GCkY/0qISv9K50r/AFoA/wCIAP8AlAD/AN4A/wDuAP8A+wD/lFpK/7VzY//WjHv/"
    "1ntr//+Id//Oxsb/nJSU/8aUnP85MTH/hBgp/4QAGP9SQkr/e0JS/3NaY//3tc7/"
    "nHuM/8wid///qt3/KrTw/58A3/+zF+P/8Pv//6SgoP+AgID/AAD//wD/AP8A////"
    "/wAA//8A/////wD//////w=="
)


def profile_for_password(password: str) -> PasswordProfile:
    if password != QQ1167746_PROFILE.password:
        raise GEEPak3Error(f"unsupported password profile: {password!r}")
    return QQ1167746_PROFILE


def xor_bytes(left: bytes, right: bytes) -> bytes:
    if len(left) != len(right):
        raise ValueError("XOR operands must have equal lengths")
    return bytes(a ^ b for a, b in zip(left, right))


def _header_fields(plaintext: bytes) -> tuple[str, int, int, int, int]:
    title_length = plaintext[1] if plaintext else 0
    title_end = 2 + title_length
    if title_end > len(plaintext):
        raise GEEPak3Error("invalid global title length")
    title = plaintext[2:title_end].decode("ascii", errors="replace")
    header_size = struct.unpack_from("<I", plaintext, 0x2A)[0]
    count = struct.unpack_from("<I", plaintext, 0x2E)[0]
    version = struct.unpack_from("<I", plaintext, 0x32)[0]
    index_offset = struct.unpack_from("<I", plaintext, 0x36)[0]
    return title, header_size, count, version, index_offset


def _valid_header_fields(
    title: str,
    header_size: int,
    count: int,
    version: int,
    index_offset: int,
    file_size: int,
) -> bool:
    return (
        title in {"www.gameofmir.com", "www.gameofmir2.com"}
        and header_size == GLOBAL_HEADER_SIZE
        and version == 2
        and index_offset == GLOBAL_HEADER_SIZE
        and 0 <= count <= 1_000_000
        and index_offset + count * 4 <= file_size
    )


def parse_global_header(data: bytes, profile: PasswordProfile = QQ1167746_PROFILE) -> GlobalHeader:
    if len(data) < GLOBAL_HEADER_SIZE:
        raise GEEPak3Error(f"file is shorter than {GLOBAL_HEADER_SIZE} bytes")
    if data[:8] != SIGNATURE:
        raise GEEPak3Error("not a GEEPAK3 file")
    plaintext = xor_bytes(data[10:266], profile.global_header_key)
    fields = _header_fields(plaintext)
    family = "main"
    if not _valid_header_fields(*fields, len(data)):
        legacy_plaintext = bytearray(ENCRYPTED_GLOBAL_SIZE)
        legacy_plaintext[: len(LEGACY_GLOBAL_PREFIX_KEY)] = xor_bytes(
            data[10 : 10 + len(LEGACY_GLOBAL_PREFIX_KEY)], LEGACY_GLOBAL_PREFIX_KEY
        )
        plaintext = bytes(legacy_plaintext)
        fields = _header_fields(plaintext)
        family = "legacy"
    title, header_size, count, version, index_offset = fields
    if not _valid_header_fields(*fields, len(data)):
        raise GEEPak3Error(
            f"unsupported or wrong-password global header: "
            f"title={title!r}, size={header_size}, count={count}, "
            f"version={version}, index={index_offset}"
        )
    return GlobalHeader(
        family, plaintext, title, header_size, count, version, index_offset
    )


def decrypt_index(
    data: bytes,
    header: GlobalHeader,
    profile: PasswordProfile = QQ1167746_PROFILE,
) -> tuple[int, ...]:
    encrypted = struct.unpack_from(f"<{header.count}I", data, header.index_offset)
    if header.family == "legacy":
        return tuple(
            value ^ LEGACY_INDEX_MASKS[index % 64] ^ index
            for index, value in enumerate(encrypted)
        )
    key = struct.unpack("<64I", profile.index_key)
    return tuple(
        value ^ ((~key[index % 64]) & 0xFFFFFFFF) ^ index
        for index, value in enumerate(encrypted)
    )


def decrypt_image_header(
    data: bytes,
    index: int,
    offset: int,
    profile: PasswordProfile = QQ1167746_PROFILE,
    header_family: str = "main",
) -> ImageHeader:
    if offset <= 0 or offset + 16 > len(data):
        raise GEEPak3Error(f"image {index}: invalid header offset {offset}")
    key_offset = (index % 64) * 16
    if header_family == "legacy":
        key = LEGACY_IMAGE_HEADER_KEY[key_offset : key_offset + 16]
        plaintext_buffer = bytearray(16)
        for position in (*range(8), *range(12, 16)):
            plaintext_buffer[position] = data[offset + position] ^ key[position]
        plaintext = bytes(plaintext_buffer)
    else:
        plaintext = xor_bytes(
            data[offset : offset + 16],
            profile.image_header_key[key_offset : key_offset + 16],
        )
    image_type, unknown1, unknown2, flags = plaintext[:4]
    width, height, x, y, compressed_size = struct.unpack_from("<HHhhI", plaintext, 4)
    if width <= 0 or height <= 0:
        raise GEEPak3Error(f"image {index}: invalid dimensions {width}x{height}")
    if width > 4096 or height > 4096:
        raise GEEPak3Error(f"image {index}: dimensions exceed 4096: {width}x{height}")
    payload_size = compressed_size or raw_image_size(image_type, flags, width, height)
    if payload_size <= 0 or offset + 16 + payload_size > len(data):
        raise GEEPak3Error(
            f"image {index}: invalid compressed size {compressed_size} at {offset}"
        )
    return ImageHeader(
        index,
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


def image_row_size(image_type: int, flags: int, width: int) -> int:
    if image_type == 3:
        return (width + 3) & ~3
    if image_type == 5:
        return (width * 2 + 3) & ~3
    if image_type == 6 and flags == 0:
        return (width * 3 + 3) & ~3
    if image_type == 6 and flags == 1:
        return ((width * 3 + 3) & ~3) + ((width + 3) & ~3)
    if image_type == 7 and flags in (0, 1):
        return width * 4
    raise GEEPak3Error(f"unsupported image layout type={image_type}, flags={flags}")


def raw_image_size(image_type: int, flags: int, width: int, height: int) -> int:
    return image_row_size(image_type, flags, width) * height


def image_format_name(image_type: int, flags: int) -> str:
    formats = {
        (3, 0): "A8_PALETTE",
        (5, 0): "R5G6B5",
        (6, 0): "R8G8B8",
        (6, 1): "R8G8B8_A8",
        (7, 0): "X8R8G8B8",
        (7, 1): "A8R8G8B8",
    }
    try:
        return formats[(image_type, flags)]
    except KeyError as exc:
        raise GEEPak3Error(
            f"unsupported image format type={image_type}, flags={flags}"
        ) from exc


def read_image_payload(data: bytes, header: ImageHeader) -> bytes:
    expected = raw_image_size(
        header.image_type, header.flags, header.width, header.height
    )
    payload_offset = header.offset + 16
    if header.compressed_size:
        payload = data[payload_offset : payload_offset + header.compressed_size]
        inflater = zlib.decompressobj()
        raw = inflater.decompress(payload) + inflater.flush()
        if not inflater.eof:
            raise GEEPak3Error(f"image {header.index}: zlib stream did not reach EOF")
        if inflater.unused_data or inflater.unconsumed_tail:
            raise GEEPak3Error(f"image {header.index}: zlib stream has trailing data")
    else:
        raw = data[payload_offset : payload_offset + expected]
    if len(raw) != expected:
        raise GEEPak3Error(
            f"image {header.index}: raw size {len(raw)} != expected {expected}"
        )
    return raw


def render_rgba(raw: bytes, header: ImageHeader) -> bytes:
    """Convert one decoded GEE image to top-down, straight-alpha RGBA bytes."""
    width, height = header.width, header.height
    expected = raw_image_size(header.image_type, header.flags, width, height)
    if len(raw) != expected:
        raise GEEPak3Error(
            f"image {header.index}: raw size {len(raw)} != expected {expected}"
        )
    image_format_name(header.image_type, header.flags)
    rgba = bytearray(width * height * 4)

    if header.image_type == 3:
        stride = (width + 3) & ~3
        for y in range(height):
            source_y = height - 1 - y
            for x in range(width):
                palette_offset = raw[source_y * stride + x] * 4
                b, g, r, a = GEE_A8_PALETTE_BGRA[palette_offset : palette_offset + 4]
                target = (y * width + x) * 4
                rgba[target : target + 4] = bytes((r, g, b, a))
        return bytes(rgba)

    if header.image_type == 5:
        stride = (width * 2 + 3) & ~3
        for y in range(height):
            source_y = height - 1 - y
            for x in range(width):
                value = struct.unpack_from("<H", raw, source_y * stride + x * 2)[0]
                r5, g6, b5 = (value >> 11) & 31, (value >> 5) & 63, value & 31
                target = (y * width + x) * 4
                rgba[target : target + 4] = bytes(
                    (
                        (r5 << 3) | (r5 >> 2),
                        (g6 << 2) | (g6 >> 4),
                        (b5 << 3) | (b5 >> 2),
                        255,
                    )
                )
        return bytes(rgba)

    if header.image_type == 6:
        color_stride = (width * 3 + 3) & ~3
        alpha_stride = (width + 3) & ~3
        alpha_offset = color_stride * height
        for y in range(height):
            source_y = height - 1 - y
            for x in range(width):
                source = source_y * color_stride + x * 3
                target = (y * width + x) * 4
                b, g, r = raw[source : source + 3]
                a = (
                    raw[alpha_offset + source_y * alpha_stride + x]
                    if header.flags
                    else 255
                )
                rgba[target : target + 4] = bytes((r, g, b, a))
        return bytes(rgba)

    for y in range(height):
        source_y = height - 1 - y
        for x in range(width):
            source = (source_y * width + x) * 4
            target = (y * width + x) * 4
            b, g, r, stored_alpha = raw[source : source + 4]
            rgba[target : target + 4] = bytes(
                (r, g, b, stored_alpha if header.flags else 255)
            )
    return bytes(rgba)


def parse_file(
    path: Path,
    profile: PasswordProfile = QQ1167746_PROFILE,
) -> tuple[bytes, GlobalHeader, tuple[int, ...]]:
    data = path.read_bytes()
    header = parse_global_header(data, profile)
    return data, header, decrypt_index(data, header, profile)
