"""GEE2 native transforms vs the unchanged isolated VM and standard DES."""
import hashlib
import base64
import json
import random
import struct
import sys
import threading
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/PakBridge/src'))
import gm_offline_crypto as crypto
import geepak2_exact as gee2
import offline_bridge


def encrypt_feedback(data, material, modified=False):
    # Test-only encoder. The independent VM must decode its global header to
    # the exact expected bytes before this fixture is accepted by the reader.
    import gee2_native as native
    schedule = struct.unpack('<32I', material.des_schedule)
    encrypt = (lambda b: native.des_schedule_block(b, schedule, permutation_mask=0x33333331)) if modified else (lambda b: crypto.des_encrypt_block(material.des_key, b))
    result = bytearray()
    feedback = material.seed20
    end = len(data) // 20 * 20
    for offset in range(0, end, 20):
        block = bytes(a ^ b for a, b in zip(data[offset:offset + 20], feedback))
        feedback = encrypt(block[:8]) + block[8:]
        result.extend(feedback)
    stream = encrypt(feedback[:8]) + feedback[8:]
    result.extend(a ^ b for a, b in zip(data[end:], stream))
    return bytes(result)


def make_fixture(count=3):
    password = 'native-gee2-test'
    material = crypto.derive_password_material(password, crypto.GEE_PASSWORD_SALT)
    plain = bytearray(256)
    title = b'www.gameofmir2.com'
    plain[1] = len(title)
    plain[2:2 + len(title)] = title
    struct.pack_into('<IIII', plain, 0x2A, 266, count, 2, 266)
    plain[gee2.PASSWORD_MARKER_OFFSET] = 5
    plain[gee2.PASSWORD_MARKER_OFFSET + 1:gee2.PASSWORD_MARKER_OFFSET + 6] = encrypt_feedback(b'GEEM2', material)
    encrypted = encrypt_feedback(plain, gee2.fixed_material(), True)
    prefix = gee2.SIGNATURE + bytes(2) + encrypted
    offsets = [0, 278, 294]
    index = struct.pack('<3I', *(value ^ material.seed20[0] for value in offsets))
    index = encrypt_feedback(encrypt_feedback(index, material), material)
    return prefix, index, bytes(plain), offsets


def main():
    # A cold GEE2 reader must not create the protected-code VM.
    gee2.password_state.cache_clear()
    with patch.object(crypto, 'default_gee_vm', side_effect=AssertionError('GEE2 loaded VM')):
        gee2.password_state('native-gee2-test')

    import gee2_native as native
    rng = random.Random(20260920)
    for _ in range(64):
        key = rng.randbytes(8)
        block = rng.randbytes(8)
        schedule = struct.unpack('<32I', crypto.dcp_des_key_schedule(key))
        assert native.des_schedule_block(block, schedule) == crypto.des_encrypt_block(key, block)
        assert native.des_schedule_block(block, schedule, decrypt=True) == crypto.des_decrypt_block(key, block)

    vm = crypto.default_gee_vm()
    for password in ['', 'a', 'native-gee2-test', '中文密码', '😀边界', 'A' * 1024]:
        material = crypto.derive_password_material(password, crypto.GEE_PASSWORD_SALT)
        state = vm.set_password_v2(material)
        secondary = state[gee2.IMAGE_SECONDARY_OFFSET:gee2.IMAGE_SECONDARY_OFFSET + 8]
        stream = crypto.des_encrypt_block(material.des_key, material.seed20[:8])
        expected = bytes(a ^ b for a, b in zip(stream, secondary))
        assert gee2.password_state(password).image_header_mask == expected, 'image mask differential'

    fixed = gee2.fixed_material()
    corpus = [bytes(256), bytes([255]) * 256, bytes(range(256))] + [rng.randbytes(256) for _ in range(9)]
    for encrypted in corpus:
        expected = vm.decrypt_global_v2(encrypted, fixed)
        actual = native.decrypt_global_header(encrypted, fixed.des_schedule, fixed.seed20)
        assert actual == expected, 'global transform differential'
    for size in [0, 1, 255, 257]:
        try:
            native.decrypt_global_header(bytes(size), fixed.des_schedule, fixed.seed20)
        except ValueError:
            pass
        else:
            raise AssertionError('invalid header size accepted')
    prefix, index, plain, offsets = make_fixture()
    assert vm.decrypt_global_v2(prefix[10:], fixed) == plain, 'fixture validated by independent VM'
    gee2.password_state.cache_clear()
    with patch.object(crypto, 'default_gee_vm', side_effect=AssertionError('GEE2 API loaded VM')):
        profile = offline_bridge.derive_gee2_index_profile('native-gee2-test', prefix + index)
        assert profile['slotCount'] == 3
        assert struct.unpack('<3I', base64.b64decode(profile['decryptedIndex'])) == tuple(offsets)
        for bad, password, file_size in [(prefix, 'wrong', 278), (prefix[:-1], '', None),
                                        (b'X' + prefix[1:], '', None), (prefix, 'native-gee2-test', 277),
                                        (make_fixture(1_000_001)[0], 'native-gee2-test', None)]:
            try:
                gee2.parse_global_header(bad, password, file_size)
            except gee2.GEEPak2Error:
                pass
            else:
                raise AssertionError('invalid header/password/bounds accepted')
        server = ThreadingHTTPServer(('127.0.0.1', 0), offline_bridge.make_handler(offline_bridge.BridgeState()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f'http://127.0.0.1:{server.server_port}/api/health', timeout=3) as response:
                assert json.load(response)['cryptoBackend'] == 'native'
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
    print('pak-geepak2-local.test.py: PASS 128 DES blocks, 6 password masks, 12 VM global headers, no-VM cold reader; final=' + hashlib.sha256(actual).hexdigest())


if __name__ == '__main__':
    main()
