/** Bounded reader contracts. These are not universal specifications for engine brands. */
export interface PakFieldContract {
  name: string;
  offset: number;
  length: number;
  representation: string;
}

export interface PakStructureContract {
  id: string;
  evidence: string[];
  globalFields: PakFieldContract[];
  imageFields: PakFieldContract[];
  unknowns: string[];
  offsetsDecoded: boolean;
}

const field = (name: string, offset: number, length: number, representation: string): PakFieldContract =>
  ({ name, offset, length, representation });
const standardImage = [
  field('imageType', 0, 1, 'u8'), field('flags', 3, 1, 'u8'),
  field('width', 4, 2, 'u16le'), field('height', 6, 2, 'u16le'),
  field('x', 8, 2, 'i16le'), field('y', 10, 2, 'i16le'),
  field('compressedSize', 12, 4, 'u32le; zero means raw for this profile'),
];
const standardGlobal = [
  field('declaredHeaderSize', 42, 4, 'u32le'), field('slotCount', 46, 4, 'u32le'),
  field('version', 50, 4, 'u32le; current bounded GOM/GEE profile'),
  field('indexOffset', 54, 4, 'u32le'),
];
const ids = [
  'gom-gameofmir-v2', 'gom-gameofmir2-v2', 'gee2-v2',
  'gee3-main-v2', 'gee3-legacy-v2', 'gee3-alternate-global-v2',
  'hxm2-lz-v0', 'hxm2-lz-v1', 'pack4-plain-bgra', 'pack4-ksf-bgra',
] as const;

export function pakStructureProfileIds(): readonly string[] { return ids; }

export function pakStructureContract(id: string): PakStructureContract {
  if (!(ids as readonly string[]).includes(id)) throw new Error('未登记的 PAK 结构 profile');
  if (id.startsWith('pack4-')) {
    return { id, evidence: ['src/utils/pack4-reader.ts', 'tests/pak-hxm-pack4.test.js',
      'docs/reports/STANDARD_PAK_COMPATIBILITY_FIX_20260924.md'],
    globalFields: [field('slotCount', id === 'pack4-ksf-bgra' ? 24 : 48, 4, 'u32le'),
      field('indexSize', 44, 4, 'u32le')],
    imageFields: [field('width', 0, 2, 'u16le >>> 4'), field('height', 2, 2, 'u16le >>> 4'),
      field('x', 4, 2, 'i16le'), field('y', 6, 2, 'i16le'),
      field('imageType', 12, 1, 'u8'), field('payloadSize', 13, 4, 'u32le')],
    offsetsDecoded: true, unknowns: [
      'Global offset-40 obfuscation is not fully specified; this profile requires an exact trailing index.',
      'Decoded index prefix (40 bytes) and unlisted image-header fields remain opaque.',
      'Only type 3 raw BGRA is implemented; zero-slot encrypted KSF is not verified.',
    ] };
  }
  if (id === 'hxm2-lz-v0' || id === 'hxm2-lz-v1') {
    const v0 = id === 'hxm2-lz-v0';
    return { id, evidence: ['GXX Pak.pas:71-89,800-899,1403-1489,2471-2539',
      'GXX GameImages.pas:1024-1088; RLEUnit.pas:185-250',
      'docs/specifications/PAK_STRUCTURE_CONTRACTS_20260925.md', 'tests/pak-hxm-layouts.test.js'],
    globalFields: [standardGlobal[0], standardGlobal[1], field('version', 50, 1, 'u8'),
      field('versionReservedBytes', 51, 3, 'opaque bytes, not part of version'),
      standardGlobal[3], field('bitCount', 58, 2, 'u16le')],
    imageFields: (v0 ? [field('compressionMode', 0, 1, 'u8; supported 0=raw, 1=RLE, 2=zlib'),
      ...standardImage.filter(item => ['width', 'height', 'x', 'y'].includes(item.name))] : standardImage)
      .map(item => item.name === 'width' || item.name === 'height'
      ? { ...item, representation: 'i16le; supported positive range 1..4096' } : { ...item }),
    offsetsDecoded: true, unknowns: [
      ...(v0 ? [
        'V0 index is signed offset/i32 total data size (including 12-byte header); modes beyond 0/1/2 remain unsupported.',
        'Non-aligned multi-row RLE is unsupported: active GXX code copies aligned bytes from a tight buffer.',
        'V0 has synthetic evidence only; no real V0 corpus/client acceptance.',
      ] : [
        'pf15bit and special SD 4-bit alpha remain unsupported; active GXX pf15bit uses 565, not assumed 555.',
        'Odd-width RGB565 without independent alpha is explicitly unsupported because the active SD detection is ambiguous.',
        'Real V1 corpus coverage is raw BGR24; other implemented layouts have synthetic evidence only.',
      ]),
      'Images with <=4 pixels are decoded for inspection; active GXX client skips texture creation for these images.',
      'Reserved fields are not assigned invented meanings; secret header fields are not exported.',
    ] };
  }
  const legacy = id === 'gee3-legacy-v2';
  return { id, evidence: [id.startsWith('gom-') ? 'src/utils/gom-reader.ts' : 'media/geepak3_exact.js',
    'docs/reports/PAK_STRUCTURE_AND_COVERAGE_20260925.md'],
  globalFields: standardGlobal.map(item => ({ ...item })),
  imageFields: standardImage.filter(item => !legacy || (item.name !== 'x' && item.name !== 'y'))
    .map(item => ({ ...item })),
  offsetsDecoded: !legacy, unknowns: [
    'Contract covers registered reader branches, not every historical file with the same extension.',
    'Unlisted header fields have not been given semantic meanings.',
    ...(legacy ? ['Legacy X/Y are not decoded by this reader; zero defaults are not reported as original coordinates.'] : []),
  ] };
}
