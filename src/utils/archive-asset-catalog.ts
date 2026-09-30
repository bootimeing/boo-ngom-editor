import type { ArchiveAssetSource, ArchiveSlotStatus } from './archive-types';
import type { DecodedPakAsset, DecodedPakResult } from './pak-reader';

export type ArchiveAssetCatalogRecord = [
  id: number, width: number, height: number, offsetX: number, offsetY: number,
  status: ArchiveSlotStatus, reasonCode?: string,
];

export interface ArchiveAssetCatalogDirectSegment {
  kind: 'direct';
  pakName: string;
  pakPath: string;
  willIdx: number;
  source: ArchiveAssetSource;
  archiveId: string;
  indexGeneration: string;
  profileId?: string;
  slotCount: number;
  /** Replace the single {id} token with the zero-padded original logical ID. */
  urlTemplate: string;
  /** Sorted nonempty/rejected slots only. Missing slots are 1x1 empty slots at (0,0). */
  records: ArchiveAssetCatalogRecord[];
}

export interface ArchiveAssetCatalogFile extends DecodedPakAsset {
  profileId?: string;
  url: string;
}

export interface ArchiveAssetCatalogFilesSegment {
  kind: 'files';
  files: ArchiveAssetCatalogFile[];
}

export interface ArchiveAssetCatalog {
  version: 1;
  segments: Array<ArchiveAssetCatalogDirectSegment | ArchiveAssetCatalogFilesSegment>;
}

export interface ArchiveAssetCatalogUrls {
  /** Receives a validated direct archive ID, never a key/password or a user-supplied template. */
  directTemplate: (archiveId: string) => string;
  fileUrl: (asset: DecodedPakAsset) => string;
}

const STATES = new Set<ArchiveSlotStatus>([
  'empty', 'indexed-unverified', 'decoded', 'recovered', 'unsupported', 'corrupt',
]);

/** Derive a template only from asWebviewUri(archiveResourceUri(archiveId, 0)). */
export function archiveAssetUrlTemplate(zeroImageUrl: string): string {
  const suffix = /\/000000\.png(?=[?#]|$)/g;
  if ((zeroImageUrl.match(suffix) || []).length !== 1 || zeroImageUrl.includes('{id}')) {
    throw new Error('素材资源 URL 模板无效');
  }
  return zeroImageUrl.replace(suffix, '/{id}.png');
}

/** Pure transport builder: no file access, decoding, source writes or secret-bearing spreads. */
export function buildArchiveAssetCatalog(
  results: readonly DecodedPakResult[], urls: ArchiveAssetCatalogUrls
): ArchiveAssetCatalog {
  const sorted = [...results].sort((left, right) => left.willIdx - right.willIdx);
  return { version: 1, segments: sorted.map(result => result.storageMode === 'direct'
    ? directSegment(result, urls) : {
      kind: 'files', files: result.assets.map(asset => legacyFile(asset, result.profileId, urls)),
    }) };
}

function assetStatus(asset: DecodedPakAsset): ArchiveSlotStatus {
  if (asset.decodeStatus !== undefined) {
    if (!STATES.has(asset.decodeStatus)) throw new Error('素材槽位状态无效');
    if (asset.failureCode && (asset.decodeStatus === 'empty' || asset.decodeStatus === 'indexed-unverified')) {
      throw new Error('素材槽位状态与失败原因不一致');
    }
    return asset.decodeStatus;
  }
  return asset.failureCode ? 'corrupt' : asset.isBlank ? 'empty' : 'indexed-unverified';
}

function directSegment(result: DecodedPakResult, urls: ArchiveAssetCatalogUrls): ArchiveAssetCatalogDirectSegment {
  const { archiveId, indexGeneration, slotCount } = result;
  if (!archiveId || !/^[a-f0-9]{64}$/.test(archiveId)
    || !indexGeneration || !/^[a-f0-9]{32}$/.test(indexGeneration)
    || !Number.isSafeInteger(slotCount) || slotCount < 0 || slotCount > 1_000_000
    || !Array.isArray(result.assets) || result.assets.length !== slotCount
    || !Number.isSafeInteger(result.willIdx) || result.willIdx < 0) {
    throw new Error('素材目录标识或槽位数量无效');
  }
  const source: ArchiveAssetSource = result.format === 'JPK' ? 'jpk'
    : result.format === 'WIL' ? 'wil' : result.format === 'WZL' ? 'wzl' : 'pak';
  const records: ArchiveAssetCatalogRecord[] = [];
  for (let id = 0; id < slotCount; id++) {
    const asset = result.assets[id];
    // Tuple transport cannot represent reordered IDs, arbitrary names, mixed generations
    // or per-image paths. Refuse those inputs instead of silently dropping their identity.
    if (!asset || asset.localIdx !== id || asset.imageIdx !== id || asset.name !== String(id).padStart(6, '0')
      || asset.path !== '' || asset.pakName !== result.pakName || asset.pakPath !== result.pakPath
      || asset.willIdx !== result.willIdx || asset.source !== source
      || asset.archiveId !== archiveId || asset.indexGeneration !== indexGeneration) {
      throw new Error(`素材目录槽位 ${id} 的身份不一致`);
    }
    const status = assetStatus(asset);
    if (typeof asset.isBlank !== 'boolean' || (status === 'empty') !== asset.isBlank
      || (asset.failureCode !== undefined && (typeof asset.failureCode !== 'string' || !asset.failureCode))) {
      throw new Error(`素材目录槽位 ${id} 的状态不一致`);
    }
    if (status === 'empty') {
      if (asset.width !== 1 || asset.height !== 1 || asset.offsetX !== 0 || asset.offsetY !== 0 || asset.failureCode) {
        throw new Error(`素材目录空槽 ${id} 的默认元数据不一致`);
      }
      continue;
    }
    if (!Number.isInteger(asset.width) || asset.width < 1 || asset.width > 65535
      || !Number.isInteger(asset.height) || asset.height < 1 || asset.height > 65535
      || !Number.isInteger(asset.offsetX) || asset.offsetX < -2147483648 || asset.offsetX > 2147483647
      || !Number.isInteger(asset.offsetY) || asset.offsetY < -2147483648 || asset.offsetY > 2147483647) {
      throw new Error(`素材目录槽位 ${id} 的尺寸或偏移无效`);
    }
    const record: ArchiveAssetCatalogRecord = [id, asset.width, asset.height, asset.offsetX, asset.offsetY, status];
    if (asset.failureCode) record.push(asset.failureCode);
    records.push(record);
  }
  const urlTemplate = urls.directTemplate(archiveId);
  if (typeof urlTemplate !== 'string' || urlTemplate.split('{id}').length !== 2) throw new Error('素材资源 URL 模板无效');
  return { kind: 'direct', pakName: result.pakName, pakPath: result.pakPath, willIdx: result.willIdx,
    source, archiveId, indexGeneration, profileId: result.profileId, slotCount, urlTemplate, records };
}

function legacyFile(asset: DecodedPakAsset, profileId: string | undefined, urls: ArchiveAssetCatalogUrls): ArchiveAssetCatalogFile {
  const status = assetStatus(asset);
  const unavailable = status === 'empty' || status === 'corrupt' || status === 'unsupported';
  // Explicit public fields only. Never transport cache manifests, parser state, keys or passwords.
  return { name: asset.name, path: asset.path, pakName: asset.pakName, pakPath: asset.pakPath,
    willIdx: asset.willIdx, localIdx: asset.localIdx, imageIdx: asset.imageIdx,
    width: asset.width, height: asset.height, offsetX: asset.offsetX, offsetY: asset.offsetY,
    isBlank: asset.isBlank, decodeStatus: status, failureCode: asset.failureCode, source: asset.source,
    archiveId: asset.archiveId, indexGeneration: asset.indexGeneration, profileId,
    url: unavailable ? '' : urls.fileUrl(asset) };
}
