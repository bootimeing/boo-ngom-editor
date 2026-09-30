import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { parseWilWzlArchive, ParsedWilWzlArchive, readWilWzlImagePng } from '../utils/wil-wzl-reader';
import { loadParser, encodePng, PakBlock } from '../utils/pak-reader';
import { decodeResourcePng, ImportedResourceImage, readResourceImage, validateResourceImage } from './image-codec';
import type { EditInfo } from './edit-client';
import type { ResourceEditorSlot } from './model';

const MAX_BYTES = 128 * 1024 * 1024, MAX_SLOTS = 1_000_000;
export class PairEditError extends Error {
  constructor(readonly code: string, readonly published = false) { super(`资源组编辑失败（${code}）`); this.name = 'PairEditError'; }
}
const fail = (code: string): never => { throw new PairEditError(code); };
const sha = (data: Uint8Array | Uint8ClampedArray) => crypto.createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
function hashFile(file: string) {
  const fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); } }
  finally { fs.closeSync(fd); } return hash.digest('hex');
}
function readAt(fd: number, length: number, offset: number) {
  const buffer = Buffer.alloc(length); let n = 0;
  while (n < length) { const count = fs.readSync(fd, buffer, n, length - n, offset + n); if (!count) fail('SOURCE_TRUNCATED'); n += count; } return buffer;
}
function writeAt(fd: number, buffer: Buffer, offset: number) {
  let n = 0; while (n < buffer.length) { const count = fs.writeSync(fd, buffer, n, buffer.length - n, offset + n); if (!count) fail('WRITE_FAILED'); n += count; }
}
const sameStat = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const xy = (v: number) => { if (!Number.isInteger(v) || v < -32768 || v > 32767) fail('OFFSET_RANGE'); return v; };
const aligned = (n: number) => (n + 3) & ~3;
interface Frame { header: Buffer; block?: PakBlock; payload?: Buffer; rgba?: Uint8ClampedArray; rgbaHash: string; recordHash?: string; type: number; flags: number; aligned: boolean }
interface State { count: number; edits: Map<number, Frame | null> }

/** Paired archives publish only into a new directory. The original two filenames are never replaced. */
export class PairEditSession {
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
  private companion = '';
  private hashes: [string, string] = ['', ''];
  private stats!: [fs.Stats, fs.Stats];
  private archive!: ParsedWilWzlArchive;
  private prefix!: Buffer;
  private indexHeader!: Buffer;
  private palette: Uint8Array;
  private readonly defaultPalette: Uint8Array;
  private base = new Map<number, Frame>();
  private state: State = { count: 0, edits: new Map() };
  private undoStates: State[] = [];
  private redoStates: State[] = [];
  private revision = 0;
  private imageCount = 0;
  private closed = false;
  private constructor(options: { extensionPath: string; sourcePath: string }) {
    if (typeof options.sourcePath !== 'string' || !options.sourcePath.trim()) fail('INVALID_SOURCE');
    if (process.platform !== 'win32') fail('PAIR_WINDOWS_ONLY');
    this.source = fs.realpathSync(options.sourcePath); this.defaultPalette = Uint8Array.from(loadParser(options.extensionPath).A8_PALETTE_BGRA);
    this.palette = this.defaultPalette; this.loadSource();
  }
  static open(options: { extensionPath: string; sourcePath: string }) { return new PairEditSession(options); }
  private get wil() { return this.archive.format === 'WIL'; }
  private get whOffset() { return this.wil ? 0 : 4; }
  private loadSource() {
    const dataStat = fs.statSync(this.source), dataHash = hashFile(this.source);
    // Bound index admission before the tolerant reader allocates its offset array.
    const stem = path.basename(this.source, path.extname(this.source)), suffix = path.extname(this.source).toLowerCase() === '.wil' ? '.wix' : '.wzx';
    const matches = fs.readdirSync(path.dirname(this.source)).filter(n => n.toLowerCase() === (stem + suffix).toLowerCase());
    if (matches.length !== 1) fail('READONLY_PAIR_PROFILE');
    const companion = fs.realpathSync(path.join(path.dirname(this.source), matches[0])), indexStat = fs.statSync(companion);
    if (indexStat.size < 48 || indexStat.size > 48 + MAX_SLOTS * 4) fail('READONLY_PAIR_PROFILE');
    const indexHash = hashFile(companion), index = fs.readFileSync(companion), count = index.readUInt32LE(44);
    if (count > MAX_SLOTS || index.length !== 48 + count * 4) fail('READONLY_PAIR_PROFILE');
    const archive = parseWilWzlArchive(this.source), wil = archive.format === 'WIL', headerSize = wil ? 8 : 16;
    if (archive.rejectedSlots.length || fs.realpathSync(archive.companionPath) !== companion) fail('READONLY_PAIR_PROFILE');
    const fd = fs.openSync(this.source, 'r'), base = new Map<number, Frame>(); let prefix: Buffer;
    const palette = archive.wilPaletteBgra ? Buffer.from(archive.wilPaletteBgra, 'base64') : this.defaultPalette;
    try {
      const global = readAt(fd, wil ? 56 : 48, 0); if (global.readUInt32LE(44) !== count) fail('READONLY_PAIR_PROFILE');
      const physical = [...archive.blocks].sort((a, b) => a.payloadOffset - b.payloadOffset);
      let prefixSize: number;
      if (wil) {
        const size = global.readUInt32LE(52); if (size !== 0 && size !== 1024 || archive.wilColorCount === 256 && size !== 1024) fail('READONLY_PAIR_PROFILE');
        prefixSize = 56 + size;
      } else { prefixSize = physical.length ? physical[0].payloadOffset - 16 : dataStat.size; if (prefixSize !== 48 && prefixSize !== 64) fail('READONLY_PAIR_PROFILE'); }
      prefix = readAt(fd, prefixSize, 0); let cursor = prefixSize;
      for (const block of physical) {
        if (block.width > 4096 || block.height > 4096 || block.width * block.height > 4194304
          || block.payloadSize * 3 + block.rawSize * 2 + block.width * block.height * 8 > MAX_BYTES) fail('IMAGE_MEMORY_LIMIT');
        if (block.payloadOffset - headerSize !== cursor || index.readUInt32LE(48 + block.logicalIndex * 4) !== cursor) fail('READONLY_PAIR_PROFILE');
        const type = block.imageType, flags = block.flags;
        if (!wil && (![3, 5, 6, 8].includes(type) || ![0, 1, ...(type === 5 ? [9] : [])].includes(flags))) fail('READONLY_PAIR_PROFILE');
        const record = readAt(fd, headerSize + block.payloadSize, cursor);
        const png = readWilWzlImagePng(fd, block, archive, this.defaultPalette), rgba = decodeResourcePng(png).rgba;
        let rawLength = block.payloadSize;
        if (block.compressedSize) rawLength = zlib.inflateSync(record.subarray(headerSize), { maxOutputLength: block.rawSize }).length;
        const bpp = type === 3 ? 1 : type === 5 ? 2 : 3, alpha = type === 5 && flags === 9 ? Math.ceil(block.width / 2) * block.height : 0;
        const rowAligned = type === 8 || rawLength - alpha === aligned(block.width * bpp) * block.height;
        if (type !== 8 && !rowAligned && rawLength - alpha !== block.width * block.height * bpp) fail('READONLY_PAIR_PROFILE');
        // Buffer.from(smallSlice) uses a shared slab; intervening PNG allocations can strand
        // an 8 KiB slab per 16-byte header. Keep admission metadata in an unpooled allocation.
        const frameHeader = Buffer.alloc(headerSize); record.copy(frameHeader, 0, 0, headerSize);
        base.set(block.logicalIndex, { header: frameHeader, block, type, flags, aligned: rowAligned,
          rgbaHash: sha(rgba), recordHash: sha(record) }); cursor += record.length;
      }
      if (cursor !== dataStat.size) fail('READONLY_PAIR_PROFILE');
      for (let id = 0; id < count; id++) if (!!index.readUInt32LE(48 + id * 4) !== base.has(id)) fail('READONLY_PAIR_PROFILE');
    } finally { fs.closeSync(fd); }
    if (!sameStat(dataStat, fs.statSync(this.source)) || !sameStat(indexStat, fs.statSync(companion))
      || hashFile(this.source) !== dataHash || hashFile(companion) !== indexHash) fail('SOURCE_CHANGED');
    this.companion = companion; this.hashes = [dataHash, indexHash]; this.stats = [dataStat, indexStat]; this.archive = archive;
    this.prefix = prefix; this.indexHeader = Buffer.from(index.subarray(0, 48)); this.base = base; this.palette = palette;
    this.state = { count, edits: new Map() }; this.imageCount = base.size; this.undoStates = []; this.redoStates = [];
  }
  private assertCurrent(full = false) {
    if (this.closed) fail('SESSION_CLOSED');
    for (const [i, file] of [this.source, this.companion].entries()) {
      let stat: fs.Stats; try { stat = fs.statSync(file); } catch { return fail('SOURCE_CHANGED'); }
      if (!sameStat(this.stats[i], stat) || full && hashFile(file) !== this.hashes[i]) fail('SOURCE_CHANGED');
    }
  }
  private id(id: number) { if (!Number.isInteger(id) || id < 0 || id >= this.state.count) fail('INVALID_INDEX'); return id; }
  private frame(id: number) { return this.state.edits.has(id) ? this.state.edits.get(id) || undefined : this.base.get(id); }
  private ids(ids: number[]) { if (!Array.isArray(ids) || !ids.length || ids.length > 10000) fail('SELECTION_LIMIT'); return [...new Set(ids.map(id => this.id(id)))]; }
  private rgba(frame: Frame) {
    if (frame.rgba) return frame.rgba;
    const fd = fs.openSync(this.source, 'r'); try { return decodeResourcePng(readWilWzlImagePng(fd, frame.block!, this.archive, this.defaultPalette)).rgba; } finally { fs.closeSync(fd); }
  }
  private recount() { this.imageCount = this.base.size; for (const [id, f] of this.state.edits) { if (this.base.has(id) && !f) this.imageCount--; if (!this.base.has(id) && f) this.imageCount++; } }
  private commit(next: State) {
    if (this.batching) { this.assertCurrent(); this.state = next; this.recount(); return this.info(); }
    this.assertCurrent(); const history = [...this.undoStates.slice(-99), this.state], buffers = new Set<Uint8Array | Uint8ClampedArray>(); let bytes = 0, entries = 0;
    for (const state of [...history, next]) { entries += state.edits.size; for (const frame of state.edits.values()) if (frame) for (const buffer of [frame.header, frame.payload, frame.rgba]) {
      if (buffer && !buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
    } }
    if (bytes + entries * 160 > MAX_BYTES) fail('EDIT_MEMORY_LIMIT');
    this.undoStates = history; this.redoStates = []; this.state = next; this.revision++; this.recount(); return this.info();
  }
  info(): EditInfo {
    if (this.closed) fail('SESSION_CLOSED');
    return { profileId: this.wil ? 'wil-strict-v1' : 'wzl-strict-v1', sourcePath: this.source, sourceSha256: this.hashes[0], sourceCompanionSha256: this.hashes[1], saveMode: 'directory',
      slotCount: this.state.count, imageCount: this.imageCount, dirty: !!this.state.edits.size || this.state.count !== this.archive.slotCount, revision: this.revision,
      canUndo: !!this.undoStates.length, canRedo: !!this.redoStates.length, capabilities: { canReplace: true, canFill: true, canAppend: true, canClear: true, canOffsets: true, canSaveAs: true } };
  }
  listSlots(start: number, limit = 100): ResourceEditorSlot[] {
    this.assertCurrent(); if (!Number.isInteger(start) || start < 0 || start > this.state.count || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_PAGE');
    const rows: ResourceEditorSlot[] = [], at = this.whOffset;
    for (let index = start; index < Math.min(start + limit, this.state.count); index++) {
      const f = this.frame(index), h = f?.header, modified = this.state.edits.has(index);
      rows.push(h ? { index, status: 'decoded', width: h.readUInt16LE(at), height: h.readUInt16LE(at + 2), offsetX: h.readInt16LE(at + 4), offsetY: h.readInt16LE(at + 6),
        pixelFormat: `${this.archive.format}-${f!.type}`, compression: !this.wil && f!.type === 8 ? 'PNG' : !this.wil && h.readUInt32LE(12) ? 'zlib' : 'raw',
        alpha: f!.type === 8 ? 'RGBA' : f!.flags === 9 ? 'A4' : '黑色透明', modified } : { index, status: 'empty', modified });
    } return rows;
  }
  previewPng(index: number) {
    this.assertCurrent(); const f = this.frame(this.id(index)); if (!f) return fail('EMPTY_SLOT');
    const bytes = encodePng(f.header.readUInt16LE(this.whOffset), f.header.readUInt16LE(this.whOffset + 2), this.rgba(f)); this.assertCurrent(); return bytes;
  }
  private encode(image: ImportedResourceImage, frame: Frame) {
    const { width, height, rgba } = image, { type, flags } = frame;
    if (type === 8) return encodePng(width, height, rgba);
    const bpp = type === 3 ? 1 : type === 5 ? 2 : 3, stride = frame.aligned ? aligned(width * bpp) : width * bpp;
    const aStride = Math.ceil(width / 2), raw = Buffer.alloc(stride * height + (flags === 9 ? aStride * height : 0)), colors = new Map<string, number>();
    if (type === 3) for (let n = 0; n < 256; n++) {
      const p = this.palette, r = p[n * 4 + 2], g = p[n * 4 + 1], b = p[n * 4], key = [r, g, b, (r | g | b) === 0 ? 0 : p[n * 4 + 3] || 255].join(',');
      if (!colors.has(key)) colors.set(key, n);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3], dst = (height - y - 1) * stride + x * bpp;
      if (type === 3) { const n = colors.get([r, g, b, a].join(',')); if (n === undefined) fail('PIXEL_NOT_REPRESENTABLE'); raw[dst] = n!; }
      else {
        if (flags !== 9 && a !== ((r | g | b) === 0 ? 0 : 255)) fail('PIXEL_NOT_REPRESENTABLE');
        if (type === 5) {
          const rr = r >> 3, gg = g >> 2, bb = b >> 3;
          if (((rr << 3) | (rr >> 2)) !== r || ((gg << 2) | (gg >> 4)) !== g || ((bb << 3) | (bb >> 2)) !== b) fail('PIXEL_NOT_REPRESENTABLE');
          raw.writeUInt16LE(rr << 11 | gg << 5 | bb, dst);
          if (flags === 9) { if (a % 17) fail('PIXEL_NOT_REPRESENTABLE'); raw[stride * height + (height - y - 1) * aStride + Math.floor(x / 2)] |= x % 2 ? a / 17 : (a / 17) << 4; }
        } else raw.set([b, g, r], dst);
      }
    } return raw;
  }
  importImage(options: { mode: 'replace' | 'fill' | 'append'; index?: number; imagePath?: string; image?: ImportedResourceImage; x?: number; y?: number }) {
    this.assertCurrent(); if (!options || !['replace', 'fill', 'append'].includes(options.mode)) fail('INVALID_OPERATION');
    const id = options.mode === 'append' ? this.state.count : this.id(options.index!); if (id >= MAX_SLOTS) fail('SLOT_LIMIT');
    if (options.mode === 'append' && options.index !== undefined && options.index !== id) fail('INVALID_INDEX');
    const old = this.frame(id); if (options.mode === 'replace' ? !old : !!old) fail('SLOT_MODE_MISMATCH');
    const image = validateResourceImage(options.image || readResourceImage(options.imagePath!)), header = old ? Buffer.from(old.header) : Buffer.alloc(this.wil ? 8 : 16), at = this.whOffset;
    const type = old?.type ?? (this.wil ? this.archive.wilColorCount === 256 ? 3 : this.archive.wilColorCount === 65536 ? 5 : 6 : 8), flags = old?.flags ?? 0;
    if (!old && !this.wil) { header[0] = type; header[1] = flags; }
    header.writeUInt16LE(image.width, at); header.writeUInt16LE(image.height, at + 2);
    if (options.x !== undefined) header.writeInt16LE(xy(options.x), at + 4); if (options.y !== undefined) header.writeInt16LE(xy(options.y), at + 6);
    const frame: Frame = { header, type, flags, aligned: old?.aligned ?? true, rgba: image.rgba, rgbaHash: sha(image.rgba) };
    const raw = this.encode(image, frame), compressed = !this.wil && type !== 8 && !!header.readUInt32LE(12);
    frame.payload = compressed ? zlib.deflateSync(raw) : raw;
    if (!this.wil) header.writeUInt32LE(type === 8 || compressed ? frame.payload.length : 0, 12);
    const edits = new Map(this.state.edits); edits.set(id, frame); return this.commit({ count: this.state.count + (options.mode === 'append' ? 1 : 0), edits });
  }
  offsets(indices: number[], x: number, y: number, relative = false) {
    this.assertCurrent(); xy(x); xy(y); if (typeof relative !== 'boolean') fail('INVALID_OPERATION');
    const edits = new Map(this.state.edits), at = this.whOffset; let changed = false;
    for (const id of this.ids(indices)) { const old = this.frame(id); if (!old) continue;
      const nx = xy(relative ? old.header.readInt16LE(at + 4) + x : x), ny = xy(relative ? old.header.readInt16LE(at + 6) + y : y);
      if (nx === old.header.readInt16LE(at + 4) && ny === old.header.readInt16LE(at + 6)) continue;
      const header = Buffer.from(old.header); header.writeInt16LE(nx, at + 4); header.writeInt16LE(ny, at + 6); edits.set(id, { ...old, header }); changed = true;
    } return changed ? this.commit({ ...this.state, edits }) : this.info();
  }
  clear(indices: number[]) { this.assertCurrent(); const edits = new Map(this.state.edits); let changed = false; for (const id of this.ids(indices)) if (this.frame(id)) { edits.set(id, null); changed = true; } return changed ? this.commit({ ...this.state, edits }) : this.info(); }
  undo() { this.assertCurrent(); const next = this.undoStates.pop(); if (next) { this.redoStates.push(this.state); this.state = next; this.revision++; this.recount(); } return this.info(); }
  redo() { this.assertCurrent(); const next = this.redoStates.pop(); if (next) { this.undoStates.push(this.state); this.state = next; this.revision++; this.recount(); } return this.info(); }
  private verify(file: string) {
    const parsed = parseWilWzlArchive(file), index = fs.readFileSync(parsed.companionPath), fd = fs.openSync(file, 'r'); let unchangedRecords = 0;
    try {
      if (parsed.format !== this.archive.format || parsed.slotCount !== this.state.count || parsed.blocks.length !== this.imageCount || parsed.rejectedSlots.length) fail('VERIFY_STRUCTURE');
      const prefix = Buffer.from(this.prefix), ih = Buffer.from(this.indexHeader); prefix.writeUInt32LE(this.state.count, 44); ih.writeUInt32LE(this.state.count, 44);
      if (!readAt(fd, prefix.length, 0).equals(prefix) || index.length !== 48 + this.state.count * 4 || !index.subarray(0, 48).equals(ih)) fail('VERIFY_HEADER');
      let cursor = prefix.length;
      for (const block of parsed.blocks) {
        const expected = this.frame(block.logicalIndex); if (!expected || block.payloadOffset - expected.header.length !== cursor) fail('VERIFY_SLOT');
        const record = readAt(fd, expected!.header.length + block.payloadSize, cursor);
        if (!record.subarray(0, expected!.header.length).equals(expected!.header)) fail('VERIFY_METADATA');
        if (sha(decodeResourcePng(readWilWzlImagePng(fd, block, parsed, this.defaultPalette)).rgba) !== expected!.rgbaHash) fail('VERIFY_RGBA');
        if (!this.state.edits.has(block.logicalIndex)) { if (sha(record) !== expected!.recordHash) fail('VERIFY_UNCHANGED_BYTES'); unchangedRecords++; }
        cursor += record.length;
      }
      if (cursor !== fs.fstatSync(fd).size) fail('VERIFY_STRUCTURE');
      for (let id = 0; id < this.state.count; id++) if (!!index.readUInt32LE(48 + id * 4) !== !!this.frame(id)) fail('VERIFY_EMPTY_SLOT');
    } finally { fs.closeSync(fd); }
    return { verifiedImages: parsed.blocks.length, unchangedRecords, slotCount: this.state.count, emptySlots: this.state.count - parsed.blocks.length, reopened: true, publication: 'new-directory' };
  }
  saveAs(targetDirectory: string) {
    this.assertCurrent(true); if (typeof targetDirectory !== 'string' || !targetDirectory.trim()) fail('INVALID_TARGET');
    if (process.platform !== 'win32') fail('PAIR_WINDOWS_ONLY');
    const requested = path.resolve(targetDirectory), parent = fs.realpathSync(path.dirname(requested)), target = path.join(parent, path.basename(requested));
    const absent = () => { try { fs.lstatSync(target); fail('TARGET_EXISTS'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }; absent();
    const stage = fs.mkdtempSync(path.join(parent, '.boo-pair-')), names = [path.basename(this.source), path.basename(this.companion)];
    const staged = names.map(name => path.join(stage, name)); let published = false;
    const before = [...this.hashes];
    try {
      const sourceFd = fs.openSync(this.source, 'r'); let dataFd: number | undefined, indexFd: number | undefined;
      try {
        dataFd = fs.openSync(staged[0], 'wx'); indexFd = fs.openSync(staged[1], 'wx');
        const prefix = Buffer.from(this.prefix), index = Buffer.alloc(48 + this.state.count * 4); this.indexHeader.copy(index);
        prefix.writeUInt32LE(this.state.count, 44); index.writeUInt32LE(this.state.count, 44); writeAt(dataFd, prefix, 0); let cursor = prefix.length;
        for (let id = 0; id < this.state.count; id++) {
          const frame = this.frame(id); if (!frame) continue; const payload = frame.payload || readAt(sourceFd, frame.block!.payloadSize, frame.block!.payloadOffset);
          if (cursor + frame.header.length + payload.length > 0xffffffff) fail('ARCHIVE_SIZE_LIMIT');
          index.writeUInt32LE(cursor, 48 + id * 4); writeAt(dataFd, frame.header, cursor); writeAt(dataFd, payload, cursor + frame.header.length); cursor += frame.header.length + payload.length;
        }
        writeAt(indexFd, index, 0); fs.fsyncSync(dataFd); fs.fsyncSync(indexFd);
      } finally { fs.closeSync(sourceFd); if (dataFd !== undefined) fs.closeSync(dataFd); if (indexFd !== undefined) fs.closeSync(indexFd); }
      const verification = this.verify(staged[0]), hashes = staged.map(hashFile); this.assertCurrent(true); absent();
      // Windows directory rename rejects even an existing empty directory. One same-parent rename
      // publishes both members; this guarantee is intentionally not assumed on POSIX.
      try { fs.renameSync(stage, target); } catch (error) { absent(); throw error; }
      published = true; const targets = names.map(name => path.join(target, name));
      this.assertCurrent(true); if (targets.some((file, i) => hashFile(file) !== hashes[i])) fail('TARGET_CHANGED'); this.verify(targets[0]);
      const after = [hashFile(this.source), hashFile(this.companion)]; if (after.some((hash, i) => hash !== before[i])) fail('SOURCE_CHANGED');
      const old = this.source; this.source = targets[0]; try { this.loadSource(); } catch (error) { this.source = old; throw error; }
      this.revision++; return { sourceSha256Before: before[0], sourceSha256After: after[0], targetSha256: hashes[0],
        verification: { ...verification, sourceCompanionSha256Before: before[1], sourceCompanionSha256After: after[1], targetCompanionSha256: hashes[1] }, session: this.info() };
    } catch (error) { if (published) throw new PairEditError('PUBLISHED_REVALIDATION_FAILED', true); throw error; }
    finally { if (!published) { for (const file of staged) { try { fs.unlinkSync(file); } catch { /* Exact private outputs only. */ } } try { fs.rmdirSync(stage); } catch { /* Preserve unexpected contents; never recurse. */ } } }
  }
  close() { this.closed = true; this.base.clear(); this.state.edits.clear(); this.undoStates = []; this.redoStates = []; }
}
