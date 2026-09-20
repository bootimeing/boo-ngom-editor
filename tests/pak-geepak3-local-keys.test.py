#!/usr/bin/env python3
"""Local GEE3 keys: fixed oracle hashes, no-VM path, and optional VM differential.

Only public test passwords are used. No archive credentials are printed.
Run with --differential for the slower independent existing-VM comparison.
"""
from __future__ import annotations

import hashlib
import random
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/PakBridge/src'))
import gm_offline_crypto as crypto
import geepak3_exact as parser
import offline_bridge

VECTORS = [
    ('', ('8dcc0e15eee43d0e785c964200b7e3863b47962657a1ac8ca3add10c6d252612',
          '7ea7b87f1cdf7478b837c645dd091d67aa09bd5ea7cdb8bdf9d733c026ec21e6',
          '3c3549bfa7107dc48ce9bd0035e0c838abbf8b09cf9023302d04d7c3f8fa7100')),
    ('probe-ascii-2026', ('98eac725b7e9f4e2c756bce7b94fc3396734cb344c42b9abb07678602ac3fd00',
          'e10c612e251f6d325c93ac0403a68811abbd455b2233be736c195172624b2729',
          '26148a7a384357a757620db2a03f69b854254534c8ecf1ae92343ac4fe1f0af5')),
    ('symbols.test!@#', ('5cc07f3e8cd6da681c0932b7a682fd8366bc6937e020f58441138304007d7dc7',
          '0b5b575e22d83b70a0d7ad28d213f22662adf423bd113f3368125621604d3b69',
          '46d57bc539226edb7ea1fcdee6265433508590fb740caf079611bed861884da7')),
    ('测试密码123', ('2c1f6773179411b29d9ebd942a2e32325a7b8a6cbc7fa1a86edbce9d3df3b3c1',
          'daae8be72bfa08bb643ae751da6cbbe3677c770655d842323d0be01928ffb8b9',
          '431422cc97d43f86cc886f4f16ce0e0829166259fdf98e3632113e24bd14a4c5')),
]


def parts(keys):
    return keys.index_key, keys.global_header_key, keys.image_header_key


def main():
    crypto.derive_gee_keys.cache_clear()
    crypto.derive_gee_alternate_global_key.cache_clear()
    with patch.object(crypto, 'default_gee_vm', side_effect=AssertionError('GEE3 loaded VM')):
        for i, (password, hashes) in enumerate(VECTORS):
            keys = crypto.derive_gee_keys(password)
            assert tuple(map(len, parts(keys))) == (256, 256, 1024)
            assert tuple(hashlib.sha256(p).hexdigest() for p in parts(keys)) == hashes, i
            assert crypto.derive_gee_keys(password) is keys
            offline_bridge.derive_gee_profile(password, bytes(range(256)))
        known = parser.QQ1167746_PROFILE
        assert parts(crypto.derive_gee_keys(known.password)) == parts(known)
        for length in [0, 255, 257]:
            try:
                crypto.decrypt_gee_alternate_global_header(bytes(length), '')
            except ValueError:
                pass
            else:
                raise AssertionError('invalid header size accepted')
        try:
            crypto.derive_gee_keys('x' * 1025)
        except crypto.OfflineCryptoError:
            pass
        else:
            raise AssertionError('oversized password accepted')

    print('PASS fixed key hashes, cached identity, known profile, bridge no-VM, size guards')
    if '--differential' in sys.argv:
        rng = random.Random(20260915)
        passwords = [p for p, _ in VECTORS] + [known.password, ' ', ' padded ', '\0',
                     'é测试😀', 'x' * 1024, '中' * 1024]
        alphabet = 'abcXYZ019!@# 汉字é😀'
        passwords += [''.join(rng.choice(alphabet) for _ in range(n)) for n in range(1, 18)]
        vm = crypto.default_gee_vm()
        for i, password in enumerate(passwords):
            actual = crypto.derive_gee_keys(password)
            assert actual == vm.derive(password), ('keys', i)
            assert crypto.derive_gee_alternate_global_key(password) == vm.alternate_global_key(password), ('alternate', i)
            data = bytes(rng.randrange(256) for _ in range(256))
            transformed = crypto.decrypt_gee_alternate_global_header(data, password)
            assert transformed == vm.crypt_alternate_global_header(data, password), ('crypt', i)
            assert crypto.decrypt_gee_alternate_global_header(transformed, password) == data
        print(f'PASS independent VM differential: {len(passwords)} password cases, all key bytes and 256-byte transforms')


if __name__ == '__main__':
    main()
