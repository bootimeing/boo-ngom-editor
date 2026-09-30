import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseGomFile } from './gom-reader';
import { parseHxmFile } from './hxm-reader';
import { parsePack4File } from './pack4-reader';
import { detectPakFileFormat, loadParser, PakBlock } from './pak-reader';
import { parseGeeFile, requestGee2FileProfile, requestGeeFileProfile } from './archive-index';
import { pakStructureContract } from './pak-structure-contracts';
import { PakPhysicalStructure } from './pak-structure-types';

export interface InspectPakStructureOptions {
  extensionPath: string;
  pakPath: string;
  password: string;
  /** A caller must explicitly provide a bridge starter; inspection never launches a process itself. */
  ensureBridge?: () => Promise<void>;
  maxReportSlots?: number;
}

interface ByteRegion { offset: number; length: number; role: string; logicalIndex?: number }
interface StructureIssue { code: string; logicalIndex?: number; offset?: number }
interface SlotTrace {
  id: number;
  state: 'empty' | 'indexed-unverified' | 'rejected-block';
  indexEntry: { containerFileOffset: number; decodedOffset: number; length: number };
  image?: {
    headerFileOffset: number; headerLength: number;
    payloadFileOffset: number; payloadLength: number;
    values: { [field: string]: number | null };
  };
}

/** Pure read-only inspection: uses production parsers, never scans for guessed image blocks,
 * creates no cache, and exports neither keys nor whole decrypted headers/index buffers.
 */
export async function inspectPakStructure(options: InspectPakStructureOptions) {
  const maxSlots = options.maxReportSlots ?? 20_000;
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 100_000) {
    throw new Error('结构报告槽位上限必须为 1..100000');
  }
  const file = path.resolve(options.pakPath);
  const before = fs.statSync(file);
  if (!before.isFile()) throw new Error('结构检查目标不是普通文件');
  const sourceSha256 = await hashFile(file);
  const detected = detectPakFileFormat(file);
  const parser = loadParser(options.extensionPath);
  let metadata: PakPhysicalStructure;
  let blocks: PakBlock[];
  let count: number;
  let declaredHeaderSize: number;
  let usedBridge = false;
  if (detected === 'HXM' || detected === 'PACK4' || detected === 'GOM') {
    const parsed = detected === 'HXM' ? parseHxmFile(file, options.password)
      : detected === 'PACK4' ? parsePack4File(file, options.password)
        : parseGomFile(file, options.password, parser);
    metadata = parsed.structure;
    blocks = parsed.blocks;
    count = parsed.slotCount;
    declaredHeaderSize = metadata.headerSize;
  } else if (detected === 'GEE' || detected === 'GEE2') {
    let parsed;
    if (detected === 'GEE2') {
      if (!options.ensureBridge) throw new Error('GEEPAK2 结构检查需要显式提供离线引擎');
      await options.ensureBridge();
      usedBridge = true;
      parsed = parseGeeFile(parser, file, before.size, options.password,
        await requestGee2FileProfile(file, before.size, options.password));
    } else {
      try { parsed = parseGeeFile(parser, file, before.size, options.password); }
      catch (_error) {
        if (!options.ensureBridge) throw new Error('GEE 本地结构未匹配，需要显式提供离线引擎后继续核验；未判定为密码错误');
        await options.ensureBridge();
        usedBridge = true;
        parsed = parseGeeFile(parser, file, before.size, options.password,
          await requestGeeFileProfile(file, options.password));
      }
    }
    count = parsed.header.count;
    blocks = parsed.blocks;
    declaredHeaderSize = parsed.header.headerSize;
    metadata = { profileId: detected === 'GEE2' ? 'gee2-v2' : `gee3-${parsed.header.family}-v2`,
      headerSize: 266, globalHeaderOffset: 10, indexOffset: parsed.header.indexOffset,
      indexSize: count * 4, indexDecodedPrefix: 0,
      indexEncoding: detected === 'GEE2' ? 'gee2-profile-transform' : 'gee3-periodic-transform',
      imageHeaderSize: 16, version: parsed.header.version };
  } else {
    throw new Error('未知 PAK 结构：未尝试扫描、猜测或格式转换');
  }
  if (count > maxSlots) throw new Error(`结构报告超过槽位上限 ${count}/${maxSlots}，未截断或伪报完整`);
  const contract = pakStructureContract(metadata.profileId);
  const byId = new Map(blocks.map(block => [block.logicalIndex, block]));
  const rejected = new Map((metadata.rejectedBlocks || []).map(block => [block.logicalIndex, block.headerOffset]));
  const issues: StructureIssue[] = (metadata.rejectedBlocks || []).map(block =>
    ({ code: block.reasonCode, logicalIndex: block.logicalIndex, offset: block.headerOffset }));
  const regions: ByteRegion[] = [
    { offset: 0, length: metadata.headerSize, role: 'header' },
    { offset: metadata.indexOffset, length: metadata.indexSize, role: 'encoded-index' },
  ];
  const slots: SlotTrace[] = [];
  const recordSize = metadata.indexRecordSize ?? 4;
  const hxmV0 = metadata.profileId === 'hxm2-lz-v0';
  for (let id = 0; id < count; id++) {
    const block = byId.get(id);
    const slot: SlotTrace = { id, state: rejected.has(id) ? 'rejected-block' : block ? 'indexed-unverified' : 'empty',
      indexEntry: { containerFileOffset: metadata.indexOffset,
        decodedOffset: metadata.indexDecodedPrefix + id * recordSize, length: recordSize } };
    if (block) {
      const headerOffset = block.payloadOffset - metadata.imageHeaderSize;
      slot.image = { headerFileOffset: headerOffset, headerLength: metadata.imageHeaderSize,
        payloadFileOffset: block.payloadOffset, payloadLength: block.payloadSize,
        values: { width: block.width, height: block.height,
          x: contract.offsetsDecoded ? block.x ?? null : null,
          y: contract.offsetsDecoded ? block.y ?? null : null,
          imageType: block.imageType, flags: block.flags, compressedSize: block.compressedSize,
          rawSize: block.rawSize, payloadSize: block.payloadSize,
          ...(hxmV0 ? { compressionMode: block.flags, indexDataSize: 12 + block.payloadSize } : {}) } };
      regions.push({ offset: headerOffset, length: metadata.imageHeaderSize + block.payloadSize,
        role: 'image-header-and-payload', logicalIndex: id });
    } else if (rejected.has(id)) {
      regions.push({ offset: rejected.get(id)!, length: metadata.imageHeaderSize,
        role: 'rejected-image-header', logicalIndex: id });
    }
    slots.push(slot);
  }
  const gaps: ByteRegion[] = [];
  let end = 0;
  for (const region of regions.sort((a, b) => a.offset - b.offset)) {
    if (!Number.isSafeInteger(region.offset) || !Number.isSafeInteger(region.length)
      || region.offset < 0 || region.length < 0 || region.offset + region.length > before.size) {
      issues.push({ code: 'region-out-of-bounds', logicalIndex: region.logicalIndex, offset: region.offset });
      continue;
    }
    if (!region.length) continue;
    if (region.offset < end) issues.push({ code: 'overlapping-regions',
      logicalIndex: region.logicalIndex, offset: region.offset });
    if (region.offset > end) gaps.push({ offset: end, length: region.offset - end, role: 'unclassified-bytes' });
    end = Math.max(end, region.offset + region.length);
  }
  if (end < before.size) gaps.push({ offset: end, length: before.size - end, role: 'unclassified-bytes' });
  const afterHash = await hashFile(file);
  const after = fs.statSync(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || sourceSha256 !== afterHash) {
    throw new Error('源文件在结构检查期间变化，报告已拒绝');
  }
  const readerFiles = ['out/utils/pak-structure.js', 'out/utils/pak-structure-contracts.js',
    'out/utils/pak-reader.js', 'media/geepak3_exact.js',
    ...(detected === 'HXM' ? ['out/utils/hxm-reader.js', 'out/utils/gom-reader.js']
      : detected === 'GOM' ? ['out/utils/gom-reader.js']
        : detected === 'PACK4' ? ['out/utils/pack4-reader.js'] : ['out/utils/archive-index.js'])];
  const readerEvidence = await Promise.all(readerFiles.map(async relativePath => ({
    relativePath, sha256: await hashFile(path.join(options.extensionPath, relativePath)),
  })));
  return { schemaVersion: 1, inspectorRevision: 'pak-structure-v1', readerEvidence,
    bridgeEvidence: usedBridge ? 'external profile response used; bridge binary identity not attested by this inspector' : 'not-used',
    fileName: path.basename(file), sourceSize: before.size, sourceSha256, sourceUnchanged: true,
    detected, profileId: metadata.profileId, contract,
    verification: { structure: issues.length ? 'issues-found' : 'accepted-by-bounded-contract',
      pixels: 'not-run', clientRendering: 'not-run', unknownFields: 'not-interpreted' },
    physical: metadata,
    globalValues: { declaredHeaderSize, slotCount: count, version: metadata.version,
      indexOffset: metadata.indexOffset, indexSize: metadata.indexSize,
      bitCount: metadata.bitCount, versionReservedBytes: metadata.versionReservedBytes },
    globalFieldLocation: 'relative to decoded global header; physical container starts at physical.globalHeaderOffset',
    imageFieldLocation: 'relative to decoded image header; physical container starts at slot.image.headerFileOffset',
    indexLocation: 'decodedOffset is within the decrypted/decompressed index, NOT an absolute file offset',
    derivedFields: ['rawSize', ...(detected === 'PACK4' ? ['indexOffset = fileSize - indexSize',
      'flags is an internal encryption marker, not an archive alpha flag', 'compressedSize = 0 for accepted raw layout']
      : hxmV0 ? ['payloadSize = indexDataSize - 12', 'imageType is mapped from global bitCount, not the first image-header byte',
        'flags is the V0 compression mode, not an alpha flag', 'compressedSize = payloadSize for RLE/zlib; zero for other modes']
        : ['payloadSize = compressedSize || rawSize'])],
    totals: { slots: count, empty: slots.filter(slot => slot.state === 'empty').length,
      indexedUnverified: blocks.length, rejected: rejected.size },
    issues, unclassifiedRegions: gaps, slots,
  };
}

async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
