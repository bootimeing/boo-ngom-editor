"""Read-only exact Python 3.12 code-object comparison against a frozen candidate."""
import argparse
import hashlib
import json
import marshal
from pathlib import Path
import sys
import types
import zipfile


def contract(value):
    if isinstance(value, types.CodeType):
        # co_filename is build-location metadata, not executable behavior.
        return {field: contract(getattr(value, field)) for field in (
            'co_argcount', 'co_posonlyargcount', 'co_kwonlyargcount', 'co_nlocals',
            'co_stacksize', 'co_flags', 'co_code', 'co_consts', 'co_names',
            'co_varnames', 'co_name', 'co_qualname', 'co_firstlineno',
            'co_linetable', 'co_exceptiontable', 'co_freevars', 'co_cellvars')}
    if isinstance(value, bytes):
        return {'bytes': value.hex()}
    if isinstance(value, tuple):
        return [contract(item) for item in value]
    if isinstance(value, frozenset):
        return {'frozenset': sorted([contract(item) for item in value], key=repr)}
    if isinstance(value, complex):
        return {'complex': [value.real, value.imag]}
    if value is Ellipsis:
        return {'ellipsis': True}
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('candidate')
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('Run with the candidate build version: Python 3.12')
    base = Path(__file__).resolve().parent
    binary = Path(args.candidate).resolve()
    modules = {'offline_bridge': '__main__boo_pak_bridge', 'gee2_native': 'gee2_native',
               'geepak2_exact': 'geepak2_exact', 'geepak3_exact': 'geepak3_exact',
               'gm_offline_crypto': 'gm_offline_crypto'}
    results = []
    with zipfile.ZipFile(binary / 'lib' / 'library.zip') as archive:
        for source_name, frozen_name in modules.items():
            source = (base / 'src' / f'{source_name}.py').read_bytes()
            source_code = compile(source, source_name, 'exec', optimize=1)
            bytecode = archive.read(f'{frozen_name}.pyc')
            frozen_code = marshal.loads(bytecode[16:])
            expected = json.dumps(contract(source_code), sort_keys=True, ensure_ascii=True)
            actual = json.dumps(contract(frozen_code), sort_keys=True, ensure_ascii=True)
            matches = expected == actual
            results.append({'module': source_name, 'matches': matches,
                            'sourceSha256': hashlib.sha256(source).hexdigest(),
                            'frozenPycSha256': hashlib.sha256(bytecode).hexdigest()})
    print(json.dumps({'candidate': str(binary), 'python': sys.version,
                      'status': 'PASS' if all(item['matches'] for item in results) else 'FAIL',
                      'modules': results}, indent=2, ensure_ascii=True))
    if not all(item['matches'] for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
