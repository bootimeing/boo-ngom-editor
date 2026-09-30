import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as iconv from 'iconv-lite';
import { createSeed, decryptFeedback, parseGomFile, ParsedGomArchive } from '../utils/gom-reader';
import { applyGomColorKeyTransparency, encodePng, GeePakApi, loadParser, PakBlock } from '../utils/pak-reader';
import { ImportedResourceImage, readResourceImage, validateResourceImage } from './image-codec';
import type { EditInfo } from './edit-client';
import type { JpkSessionSlot } from './jpk-session';

const SIGNATURE = Buffer.from([10, ...Buffer.from('GAMEOFMIR2'), 0, 0]);
const FIXED_KEY = Buffer.from('d0740a42ee869c94', 'hex');
const MAX_BYTES = 128 * 1024 * 1024, MAX_SLOTS = 999999;
export class GomSessionError extends Error {
  constructor(readonly code: string, readonly published = false) { super(`PAK 编辑操作失败（${code}）`); this.name = 'GomSessionError'; }
}
const fail = (code: string): never => { throw new GomSessionError(code); };
const sha = (bytes: Uint8Array | Uint8ClampedArray) => crypto.createHash('sha256')
  .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');
function hashFile(file: string) {
  const fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); } }
  finally { fs.closeSync(fd); } return hash.digest('hex');
}
function readAt(fd: number, length: number, offset: number) {
  const out = Buffer.alloc(length); let done = 0;
  while (done < length) { const n = fs.readSync(fd, out, done, length - done, offset + done); if (!n) fail('SOURCE_TRUNCATED'); done += n; }
  return out;
}
function writeAt(fd: number, bytes: Buffer, offset: number) {
  let done = 0;
  while (done < bytes.length) { const n = fs.writeSync(fd, bytes, done, bytes.length - done, offset + done); if (!n) fail('WRITE_FAILED'); done += n; }
}
function des(key: Buffer, bytes: Buffer) {
  const cipher = crypto.createCipheriv('des-ede3', Buffer.concat([key, key, key]), null); cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
/** Exact inverse of the production reader's 20-byte feedback transform, including its short final block. */
function encryptFeedback(plain: Buffer, key: Buffer) {
  let feedback = createSeed(key, 0x8f), cursor = 0; const out = Buffer.alloc(plain.length);
  while (cursor + 20 <= plain.length) {
    const stage = Buffer.from(plain.subarray(cursor, cursor + 20));
    for (let i = 0; i < 20; i++) stage[i] ^= feedback[i];
    feedback = Buffer.concat([des(key, stage.subarray(0, 8)), stage.subarray(8)]);
    feedback.copy(out, cursor); cursor += 20;
  }
  const stream = Buffer.concat([des(key, feedback.subarray(0, 8)), feedback.subarray(8)]);
  for (let i = cursor; i < plain.length; i++) out[i] = plain[i] ^ stream[i - cursor];
  return out;
}
const offset = (value: number) => { if (!Number.isInteger(value) || value < -32768 || value > 32767) fail('OFFSET_RANGE'); return value; };
const sameStat = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
interface Frame { header: Buffer; block?: PakBlock; payload?: Buffer; rgba?: Uint8ClampedArray; rgbaHash: string; recordHash?: string }
interface State { count: number; edits: Map<number, Frame | null> }
type PhysicalPart = { kind: 'slot'; index: number }
  | { kind: 'unindexed'; offset: number; length: number; hash: string };
export interface GomOpenOptions { extensionPath: string; sourcePath: string; password: string }

/** GAMEOFMIR2 v2 with fully verified records, including preserved unindexed image records. */
export class GomEditSession {
  private batching = false;
  /** One history entry, even on preview/failure. Input decoding is bounded by batch.ts. */
  atomic(action: () => void, dryRun = false) {
    this.assertCurrent();
    if (this.batching) fail('INVALID_OPERATION');
    const original = this.state, undo = this.undoStates, redo = this.redoStates, revision = this.revision;
    this.batching = true;
    try {
      action();
      const next = this.state;
      this.state = original;
      this.batching = false;
      if (next !== original) this.commit(next);
      if (dryRun) { this.state = original; this.undoStates = undo; this.redoStates = redo; this.revision = revision; this.recount(); }
      return this.info();
    } catch (error) {
      this.state = original; this.undoStates = undo; this.redoStates = redo; this.revision = revision; this.recount(); throw error;
    } finally { this.batching = false; }
  }
  private source: string;
  private password: string;
  private key: Buffer;
  private mask: Buffer;
  private parser: GeePakApi;
  private sourceHash = '';
  private sourceStat!: fs.Stats;
  private header!: Buffer;
  private archive!: ParsedGomArchive;
  private base = new Map<number, Frame>();
  private layout: PhysicalPart[] = [];
  private state: State = { count: 0, edits: new Map() };
  private undoStates: State[] = [];
  private redoStates: State[] = [];
  private revision = 0;
  private imageCount = 0;
  private closed = false;
  private constructor(options: GomOpenOptions) {
    if (typeof options.sourcePath !== 'string' || !options.sourcePath.trim()) fail('INVALID_SOURCE');
    if (typeof options.password !== 'string') fail('MISSING_CREDENTIALS');
    this.source = fs.realpathSync(options.sourcePath); this.password = options.password;
    this.key = crypto.createHash('sha1').update(iconv.encode(this.password, 'cp936')).digest().subarray(0, 8);
    const seed = createSeed(this.key, 0x8f);
    this.mask = Buffer.concat([des(this.key, seed.subarray(0, 8)), seed.subarray(8, 16)]);
    this.parser = loadParser(options.extensionPath); this.loadSource();
  }
  static open(options: GomOpenOptions) { return new GomEditSession(options); }
  private xorHeader(header: Buffer) {
    const result = Buffer.from(header); for (let i = 0; i < result.length; i++) result[i] ^= this.mask[i]; return result;
  }
  private rgbaAt(fd: number, block: PakBlock) {
    const stored = readAt(fd, block.payloadSize, block.payloadOffset);
    let raw: Buffer = stored;
    if (block.compressedSize) {
      const result = zlib.inflateSync(stored, { maxOutputLength: block.rawSize, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (result.engine.bytesWritten !== stored.length) fail('INVALID_COMPRESSION'); raw = result.buffer;
    }
    if (raw.length !== block.rawSize) fail('INVALID_COMPRESSION');
    return applyGomColorKeyTransparency(this.parser.toRgba(raw, block), block.imageType, block.flags);
  }
  /** Accept only complete decodable image records, never arbitrary padding or guessed IDs. */
  private unindexedRecords(fd: number, start: number, end: number): PhysicalPart[] {
    const records: PhysicalPart[] = [];
    for (let cursor = start; cursor < end;) {
      if (records.length >= MAX_SLOTS) fail('READONLY_GOM_PROFILE');
      if (end - cursor < 16) fail('READONLY_GOM_PROFILE');
      const header = this.xorHeader(readAt(fd, 16, cursor));
      const imageType = header[0], flags = header[3], width = header.readUInt16LE(4), height = header.readUInt16LE(6);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) fail('READONLY_GOM_PROFILE');
      let rawSize: number, format: string;
      try { rawSize = this.parser.rawImageSize(imageType, flags, width, height); format = this.parser.formatName(imageType, flags); }
      catch { return fail('READONLY_GOM_PROFILE'); }
      const compressedSize = header.readUInt32LE(12), payloadSize = compressedSize || rawSize, payloadOffset = cursor + 16;
      if (payloadSize <= 0 || payloadOffset + payloadSize > end) fail('READONLY_GOM_PROFILE');
      if (payloadSize * 3 + rawSize * 2 + width * height * 8 > MAX_BYTES) fail('IMAGE_MEMORY_LIMIT');
      const block: PakBlock = { logicalIndex: -1, imageType, flags, width, height, rawSize, compressedSize,
        payloadSize, payloadOffset, format, x: header.readInt16LE(8), y: header.readInt16LE(10) };
      this.rgbaAt(fd, block);
      const length = 16 + payloadSize;
      records.push({ kind: 'unindexed', offset: cursor, length, hash: sha(readAt(fd, length, cursor)) });
      cursor += length;
    }
    return records;
  }
  private *outputLayout(): Generator<PhysicalPart> {
    for (const part of this.layout) if (part.kind === 'unindexed' || this.frame(part.index)) yield part;
    // Filled/added slots have no original physical record. Keep their logical IDs unchanged.
    for (let id = 0; id < this.state.count; id++) if (!this.base.has(id) && this.frame(id)) yield { kind: 'slot', index: id };
  }
  private loadSource() {
    const before = fs.statSync(this.source), hash = hashFile(this.source), fd = fs.openSync(this.source, 'r');
    let archive: ParsedGomArchive, header: Buffer; const base = new Map<number, Frame>(), layout: PhysicalPart[] = [];
    try {
      if (!readAt(fd, 13, 0).equals(SIGNATURE)) fail('READONLY_GOM_PROFILE');
      archive = parseGomFile(this.source, this.password, this.parser);
      if (archive.family !== 'GM GAMEOFMIR2' || archive.skippedMalformedIndices.length) fail('READONLY_GOM_PROFILE');
      header = decryptFeedback(readAt(fd, 256, 13), FIXED_KEY, createSeed(FIXED_KEY, 0x8f));
      let cursor = 269 + archive.slotCount * 4;
      for (const block of [...archive.blocks].sort((a, b) => a.payloadOffset - b.payloadOffset)) {
        if (block.payloadOffset - 16 < cursor) fail('READONLY_GOM_PROFILE');
        for (const part of this.unindexedRecords(fd, cursor, block.payloadOffset - 16)) layout.push(part);
        cursor = block.payloadOffset - 16;
        if (block.payloadSize * 3 + block.rawSize * 2 + block.width * block.height * 8 > MAX_BYTES) fail('IMAGE_MEMORY_LIMIT');
        const record = readAt(fd, 16 + block.payloadSize, cursor);
        base.set(block.logicalIndex, { header: this.xorHeader(record.subarray(0, 16)), block,
          recordHash: sha(record), rgbaHash: sha(this.rgbaAt(fd, block)) });
        layout.push({ kind: 'slot', index: block.logicalIndex });
        cursor = block.payloadOffset + block.payloadSize;
      }
      for (const part of this.unindexedRecords(fd, cursor, before.size)) layout.push(part);
    } finally { fs.closeSync(fd); }
    if (!sameStat(before, fs.statSync(this.source)) || hash !== hashFile(this.source)) fail('SOURCE_CHANGED');
    this.sourceStat = before; this.sourceHash = hash; this.archive = archive; this.header = header; this.base = base; this.layout = layout;
    this.state = { count: archive.slotCount, edits: new Map() }; this.imageCount = base.size; this.undoStates = []; this.redoStates = [];
  }
  private assertCurrent(full = false) {
    if (this.closed) fail('SESSION_CLOSED');
    let current: fs.Stats; try { current = fs.statSync(this.source); } catch { return fail('SOURCE_CHANGED'); }
    if (!sameStat(this.sourceStat, current) || full && this.sourceHash !== hashFile(this.source)) fail('SOURCE_CHANGED');
  }
  private id(index: number) { if (!Number.isSafeInteger(index) || index < 0 || index >= this.state.count) fail('INVALID_INDEX'); return index; }
  private indices(indices: number[]) {
    if (!Array.isArray(indices) || !indices.length || indices.length > 10000) fail('SELECTION_LIMIT');
    return [...new Set(indices.map(id => this.id(id)))];
  }
  private frame(index: number) { return this.state.edits.has(index) ? this.state.edits.get(index) || undefined : this.base.get(index); }
  private rgba(frame: Frame) {
    if (frame.rgba) return frame.rgba;
    const fd = fs.openSync(this.source, 'r'); try { return this.rgbaAt(fd, frame.block!); } finally { fs.closeSync(fd); }
  }
  private recount() {
    this.imageCount = this.base.size;
    for (const [id, frame] of this.state.edits) {
      if (this.base.has(id) && !frame) this.imageCount--;
      if (!this.base.has(id) && frame) this.imageCount++;
    }
  }
  private commit(next: State) {
    if (this.batching) { this.assertCurrent(); this.state = next; this.recount(); return this.info(); }
    this.assertCurrent(); const history = [...this.undoStates.slice(-99), this.state];
    const buffers = new Set<Uint8Array | Uint8ClampedArray>(); let bytes = 0, entries = 0;
    for (const state of [...history, next]) {
      entries += state.edits.size;
      for (const frame of state.edits.values()) if (frame) for (const buffer of [frame.header, frame.payload, frame.rgba]) {
        if (buffer && !buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
      }
    }
    if (bytes + entries * 160 > MAX_BYTES) fail('EDIT_MEMORY_LIMIT');
    this.undoStates = history; this.redoStates = []; this.state = next; this.revision++; this.recount(); return this.info();
  }
  info(): EditInfo {
    if (this.closed) fail('SESSION_CLOSED');
    return { profileId: 'gom-gameofmir2-v2', sourcePath: this.source, sourceSha256: this.sourceHash,
      slotCount: this.state.count, imageCount: this.imageCount, dirty: !!this.state.edits.size || this.state.count !== this.archive.slotCount,
      revision: this.revision, canUndo: !!this.undoStates.length, canRedo: !!this.redoStates.length,
      capabilities: { canReplace: true, canFill: true, canAppend: true, canClear: true, canOffsets: true, canSaveAs: true } };
  }
  listSlots(start: number, limit = 100): JpkSessionSlot[] {
    this.assertCurrent();
    if (!Number.isInteger(start) || start < 0 || start > this.state.count || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_PAGE');
    const rows: JpkSessionSlot[] = [];
    for (let index = start; index < Math.min(this.state.count, start + limit); index++) {
      const h = this.frame(index)?.header, modified = this.state.edits.has(index);
      rows.push(h ? { index, status: 'decoded', width: h.readUInt16LE(4), height: h.readUInt16LE(6),
        offsetX: h.readInt16LE(8), offsetY: h.readInt16LE(10), pixelFormat: this.parser.formatName(h[0], h[3]),
        compression: h.readUInt32LE(12) ? 'zlib' : 'raw', alpha: h[3] ? 'A8' : h[0] === 3 ? '调色板 A8' : '黑色透明', modified }
        : { index, status: 'empty', modified });
    } return rows;
  }
  previewPng(index: number) {
    this.assertCurrent(); const frame = this.frame(this.id(index)); if (!frame) return fail('EMPTY_SLOT');
    const png = encodePng(frame.header.readUInt16LE(4), frame.header.readUInt16LE(6), this.rgba(frame)); this.assertCurrent(); return png;
  }
  private encode(image: ImportedResourceImage, header: Buffer) {
    const { width, height, rgba } = image, type = header[0], flags = header[3];
    const raw = Buffer.alloc(this.parser.rawImageSize(type, flags, width, height)), palette = this.parser.A8_PALETTE_BGRA;
    const stride = type === 3 ? (width + 3) & ~3 : type === 5 ? (width * 2 + 3) & ~3 : type === 6 ? (width * 3 + 3) & ~3 : width * 4;
    const colors = new Map<string, number>();
    if (type === 3) for (let i = 0; i < 256; i++) {
      const key = [palette[i * 4 + 2], palette[i * 4 + 1], palette[i * 4], palette[i * 4 + 3]].join(',');
      if (!colors.has(key)) colors.set(key, i);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      const dst = (height - y - 1) * stride + x * (type === 3 ? 1 : type === 5 ? 2 : type === 6 ? 3 : 4);
      if (type === 3) {
        const entry = colors.get([r, g, b, a].join(',')); if (entry === undefined) fail('PIXEL_NOT_REPRESENTABLE'); raw[dst] = entry!;
      } else {
        if (!flags && a !== (r === 0 && g === 0 && b === 0 ? 0 : 255)) fail('PIXEL_NOT_REPRESENTABLE');
        if (type === 5) {
          const rr = r >> 3, gg = g >> 2, bb = b >> 3;
          if (((rr << 3) | (rr >> 2)) !== r || ((gg << 2) | (gg >> 4)) !== g || ((bb << 3) | (bb >> 2)) !== b) fail('PIXEL_NOT_REPRESENTABLE');
          raw.writeUInt16LE((rr << 11) | (gg << 5) | bb, dst);
        } else { raw[dst] = b; raw[dst + 1] = g; raw[dst + 2] = r; if (type === 7 && flags) raw[dst + 3] = a; }
        if (type === 6 && flags) raw[stride * height + (height - y - 1) * ((width + 3) & ~3) + x] = a;
      }
    } return raw;
  }
  importImage(options: { mode: 'replace' | 'fill' | 'append'; index?: number; imagePath?: string; image?: ImportedResourceImage; x?: number; y?: number }) {
    this.assertCurrent(); if (!options || !['replace', 'fill', 'append'].includes(options.mode)) fail('INVALID_OPERATION');
    const index = options.mode === 'append' ? this.state.count : this.id(options.index!);
    if (index >= MAX_SLOTS) fail('SLOT_LIMIT');
    if (options.mode === 'append' && options.index !== undefined && options.index !== index) fail('INVALID_INDEX');
    const old = this.frame(index); if (options.mode === 'replace' ? !old : !!old) fail('SLOT_MODE_MISMATCH');
    const image = validateResourceImage(options.image || readResourceImage(options.imagePath!)), header = old ? Buffer.from(old.header) : Buffer.alloc(16);
    if (!old) { header[0] = 7; header[3] = 1; }
    header.writeUInt16LE(image.width, 4); header.writeUInt16LE(image.height, 6);
    if (options.x !== undefined) header.writeInt16LE(offset(options.x), 8);
    if (options.y !== undefined) header.writeInt16LE(offset(options.y), 10);
    const raw = this.encode(image, header), compressed = !old || !!old.header.readUInt32LE(12);
    const payload = compressed ? zlib.deflateSync(raw) : raw; header.writeUInt32LE(compressed ? payload.length : 0, 12);
    const edits = new Map(this.state.edits); edits.set(index, { header, payload, rgba: image.rgba, rgbaHash: sha(image.rgba) });
    return this.commit({ count: this.state.count + (options.mode === 'append' ? 1 : 0), edits });
  }
  offsets(indices: number[], x: number, y: number, relative = false) {
    this.assertCurrent(); offset(x); offset(y); if (typeof relative !== 'boolean') fail('INVALID_OPERATION');
    const edits = new Map(this.state.edits); let changed = false;
    for (const id of this.indices(indices)) {
      const old = this.frame(id); if (!old) continue;
      const nx = offset(relative ? old.header.readInt16LE(8) + x : x), ny = offset(relative ? old.header.readInt16LE(10) + y : y);
      if (old.header.readInt16LE(8) === nx && old.header.readInt16LE(10) === ny) continue;
      const header = Buffer.from(old.header); header.writeInt16LE(nx, 8); header.writeInt16LE(ny, 10); edits.set(id, { ...old, header }); changed = true;
    } return changed ? this.commit({ ...this.state, edits }) : this.info();
  }
  clear(indices: number[]) {
    this.assertCurrent(); const edits = new Map(this.state.edits); let changed = false;
    for (const id of this.indices(indices)) if (this.frame(id)) { edits.set(id, null); changed = true; }
    return changed ? this.commit({ ...this.state, edits }) : this.info();
  }
  undo() { this.assertCurrent(); const previous = this.undoStates.pop(); if (previous) { this.redoStates.push(this.state); this.state = previous; this.revision++; this.recount(); } return this.info(); }
  redo() { this.assertCurrent(); const next = this.redoStates.pop(); if (next) { this.undoStates.push(this.state); this.state = next; this.revision++; this.recount(); } return this.info(); }
  private verify(file: string) {
    const archive = parseGomFile(file, this.password, this.parser);
    if (archive.family !== this.archive.family || archive.slotCount !== this.state.count || archive.skippedMalformedIndices.length || archive.blocks.length !== this.imageCount) fail('VERIFY_STRUCTURE');
    const fd = fs.openSync(file, 'r'); let verifiedImages = 0, unchangedRecords = 0, cursor = 269 + this.state.count * 4;
    let preservedUnindexedRecords = 0, preservedUnindexedBytes = 0;
    try {
      const expectedHeader = Buffer.from(this.header); expectedHeader.writeUInt32LE(this.state.count, 46);
      if (!readAt(fd, 13, 0).equals(SIGNATURE) || !decryptFeedback(readAt(fd, 256, 13), FIXED_KEY, createSeed(FIXED_KEY, 143)).equals(expectedHeader)) fail('VERIFY_HEADER');
      const actualIds = new Set<number>();
      const byId = new Map(archive.blocks.map(block => [block.logicalIndex, block]));
      for (const part of this.outputLayout()) {
        if (part.kind === 'unindexed') {
          if (sha(readAt(fd, part.length, cursor)) !== part.hash) fail('VERIFY_UNINDEXED_BYTES');
          cursor += part.length; preservedUnindexedRecords++; preservedUnindexedBytes += part.length; continue;
        }
        const block = byId.get(part.index), expected = this.frame(part.index);
        if (!block || !expected || block.payloadOffset - 16 !== cursor) return fail('VERIFY_SLOT');
        const record = readAt(fd, block.payloadSize + 16, cursor);
        if (!this.xorHeader(record.subarray(0, 16)).equals(expected!.header)) fail('VERIFY_METADATA');
        if (sha(this.rgbaAt(fd, block)) !== expected!.rgbaHash) fail('VERIFY_RGBA');
        if (!this.state.edits.has(block.logicalIndex)) {
          if (sha(record) !== expected!.recordHash) fail('VERIFY_UNCHANGED_BYTES'); unchangedRecords++;
        }
        actualIds.add(block.logicalIndex); cursor += 16 + block.payloadSize; verifiedImages++;
      }
      for (let id = 0; id < this.state.count; id++) if (actualIds.has(id) !== !!this.frame(id)) fail('VERIFY_EMPTY_SLOT');
      if (cursor !== fs.fstatSync(fd).size) fail('VERIFY_STRUCTURE');
    } finally { fs.closeSync(fd); }
    return { verifiedImages, unchangedRecords, slotCount: this.state.count, emptySlots: this.state.count - verifiedImages,
      preservedUnindexedRecords, preservedUnindexedBytes, reopened: true };
  }
  saveAs(targetPath: string) {
    this.assertCurrent(true);
    if (typeof targetPath !== 'string' || !targetPath.trim() || path.extname(targetPath).toLowerCase() !== '.pak') fail('INVALID_TARGET');
    const requested = path.resolve(targetPath), parent = fs.realpathSync(path.dirname(requested)), target = path.join(parent, path.basename(requested));
    if (target.toLowerCase() === this.source.toLowerCase()) fail('SOURCE_OVERWRITE_DISABLED');
    try { fs.lstatSync(target); fail('TARGET_EXISTS'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const before = this.sourceHash, temporary = path.join(parent, `.boo-gom-${crypto.randomBytes(16).toString('hex')}.tmp`);
    let fd: number | undefined, created = false, published = false;
    try {
      fd = fs.openSync(temporary, 'wx'); created = true; const sourceFd = fs.openSync(this.source, 'r');
      try {
        const index = Buffer.alloc(this.state.count * 4); let cursor = 269 + index.length;
        for (const part of this.outputLayout()) {
          if (part.kind === 'unindexed') {
            if (cursor + part.length > 0xffffffff) fail('ARCHIVE_SIZE_LIMIT');
            const bytes = readAt(sourceFd, part.length, part.offset);
            if (sha(bytes) !== part.hash) fail('SOURCE_CHANGED');
            writeAt(fd, bytes, cursor); cursor += part.length; continue;
          }
          const id = part.index, frame = this.frame(id)!;
          const payload = frame.payload || readAt(sourceFd, frame.block!.payloadSize, frame.block!.payloadOffset);
          if (cursor + payload.length + 16 > 0xffffffff) fail('ARCHIVE_SIZE_LIMIT');
          index.writeUInt32LE(cursor, id * 4); writeAt(fd, this.xorHeader(frame.header), cursor); writeAt(fd, payload, cursor + 16); cursor += 16 + payload.length;
        }
        const header = Buffer.from(this.header); header.writeUInt32LE(this.state.count, 46);
        writeAt(fd, SIGNATURE, 0); writeAt(fd, encryptFeedback(header, FIXED_KEY), 13); writeAt(fd, encryptFeedback(index, this.key), 269); fs.fsyncSync(fd);
      } finally { fs.closeSync(sourceFd); }
      fs.closeSync(fd); fd = undefined;
      const verification = this.verify(temporary), targetHash = hashFile(temporary); this.assertCurrent(true);
      try { fs.linkSync(temporary, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('TARGET_EXISTS'); return fail('ATOMIC_PUBLICATION_UNAVAILABLE'); }
      published = true; fs.unlinkSync(temporary); created = false;
      this.assertCurrent(true); if (hashFile(target) !== targetHash) fail('TARGET_CHANGED'); this.verify(target);
      const after = hashFile(this.source); if (before !== after) fail('SOURCE_CHANGED');
      const oldSource = this.source; this.source = target; try { this.loadSource(); } catch (error) { this.source = oldSource; throw error; }
      this.revision++; return { sourceSha256Before: before, sourceSha256After: after, targetSha256: targetHash, verification, session: this.info() };
    } catch (error) { if (published) throw new GomSessionError('PUBLISHED_REVALIDATION_FAILED', true); throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); if (created) { try { fs.unlinkSync(temporary); } catch { /* Preserve published files. */ } } }
  }
  close() { this.closed = true; this.password = ''; this.key.fill(0); this.mask.fill(0); this.base.clear(); this.layout = []; this.state.edits.clear(); this.undoStates = []; this.redoStates = []; }
}
