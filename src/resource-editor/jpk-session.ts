import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { JpkBlock, ParsedJpkArchive, alignedStride, deriveJpkRc4State, parseJpkFileWithState,
  rc4Crypt, readJpkPayload, renderJpkRgba } from '../utils/jpk-reader';
import { encodePng, loadParser } from '../utils/pak-reader';
import { ImportedResourceImage, readResourceImage, validateResourceImage } from './image-codec';

const MAX_HISTORY = 100, MAX_EDIT_BYTES = 128 * 1024 * 1024, MAX_SELECTION = 10000, MAX_SLOTS = 999999;
export class JpkSessionError extends Error {
  constructor(readonly code: string, readonly published = false) {
    super(`JPK 编辑操作失败（${code}）`); this.name = 'JpkSessionError';
  }
}
const fail = (code: string): never => { throw new JpkSessionError(code); };
const digest = (bytes: Uint8Array | Uint8ClampedArray) => crypto.createHash('sha256')
  .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');
function hashFile(file: string) {
  const fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), bytes = Buffer.alloc(1024 * 1024);
  try { for (;;) { const n = fs.readSync(fd, bytes, 0, bytes.length, null); if (!n) break; hash.update(bytes.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function readAt(fd: number, size: number, offset: number) {
  const result = Buffer.alloc(size); let done = 0;
  while (done < size) { const n = fs.readSync(fd, result, done, size - done, offset + done); if (!n) fail('SOURCE_TRUNCATED'); done += n; }
  return result;
}
function writeAt(fd: number, bytes: Buffer, offset: number) {
  let done = 0;
  while (done < bytes.length) { const n = fs.writeSync(fd, bytes, done, bytes.length - done, offset + done); if (!n) fail('WRITE_FAILED'); done += n; }
}
const offsetValue = (value: number) => {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) fail('OFFSET_RANGE'); return value;
};
function sameStat(a: fs.Stats, b: fs.Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
interface BaseFrame { block: JpkBlock; header: Buffer; recordHash: string; rgbaHash: string }
interface EditFrame { header: Buffer; base?: BaseFrame; payload?: Buffer; rgba?: Uint8ClampedArray }
interface State { edits: Map<number, EditFrame | null>; slotCount: number }
export interface JpkSessionOpenOptions { extensionPath: string; sourcePath: string; password?: string; rc4State?: Uint8Array }
export interface JpkSessionInfo {
  profileId: string; sourcePath: string; sourceSha256: string; slotCount: number; imageCount: number;
  dirty: boolean; revision: number; canUndo: boolean; canRedo: boolean;
  capabilities: { canReplace: true; canFill: true; canAppend: true; canClear: true; canOffsets: true; canSaveAs: true };
}
export interface JpkSessionSlot {
  index: number; status: 'empty' | 'decoded'; width?: number; height?: number; offsetX?: number; offsetY?: number;
  pixelFormat?: string; compression?: string; alpha?: string; modified?: boolean;
}

/** Dedicated-worker core. Independent TS implementation; no external GM writer or VM asset dependency. */
export class JpkEditSession {
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
  private sourceHash = '';
  private sourceStat!: fs.Stats;
  private archive!: ParsedJpkArchive;
  private header!: Buffer;
  private base = new Map<number, BaseFrame>();
  private state: State = { edits: new Map(), slotCount: 0 };
  private readonly key: Uint8Array;
  private readonly palette: Uint8Array;
  private undoStates: State[] = [];
  private redoStates: State[] = [];
  private revision = 0;
  private closed = false;
  private count = 0;

  private constructor(options: JpkSessionOpenOptions) {
    if (typeof options.sourcePath !== 'string' || !options.sourcePath.trim()) fail('INVALID_SOURCE');
    if (options.rc4State && options.password !== undefined) fail('CONFLICTING_CREDENTIALS');
    if (!options.rc4State && typeof options.password !== 'string') fail('MISSING_CREDENTIALS');
    if (options.rc4State && (!(options.rc4State instanceof Uint8Array) || options.rc4State.length !== 256)) fail('INVALID_RC4_STATE');
    this.key = options.rc4State ? Uint8Array.from(options.rc4State) : deriveJpkRc4State(options.password!);
    rc4Crypt(new Uint8Array(), this.key);
    this.palette = Uint8Array.from(loadParser(options.extensionPath).A8_PALETTE_BGRA);
    if (this.palette.length !== 1024) fail('MISSING_PALETTE');
    this.source = fs.realpathSync(options.sourcePath);
    this.loadSource();
  }
  static open(options: JpkSessionOpenOptions): JpkEditSession { return new JpkEditSession(options); }

  private loadSource() {
    const before = fs.statSync(this.source), sha = hashFile(this.source);
    const archive = parseJpkFileWithState(this.source, this.key);
    if (archive.trailerSize || archive.skippedMalformedIndices.length) fail('READONLY_JPK_PROFILE');
    const sorted = [...archive.blocks].sort((a, b) => a.headerOffset - b.headerOffset);
    const base = new Map<number, BaseFrame>(), fd = fs.openSync(this.source, 'r'); let cursor = 80;
    let globalHeader: Buffer;
    try {
      globalHeader = rc4Crypt(readAt(fd, 80, 0), this.key);
      for (const block of sorted) {
        // Bound simultaneous ciphertext/plaintext/RGBA allocations during admission and verification.
        if (block.payloadSize * 3 + block.rawSize * 2 + block.width * block.height * 8 > MAX_EDIT_BYTES) fail('IMAGE_MEMORY_LIMIT');
        const header = readAt(fd, 20, block.headerOffset);
        if (block.headerOffset !== cursor || ![8, 16, 24, 32].includes(header[0]) || header[1] > 1 || header[16] > 1
          || !block.width || !block.height) fail('READONLY_JPK_PROFILE');
        const record = readAt(fd, 20 + block.payloadSize, block.headerOffset);
        const rgba = renderJpkRgba(readJpkPayload(fd, block, this.key), block, this.palette);
        base.set(block.logicalIndex, { block, header, recordHash: digest(record), rgbaHash: digest(rgba) });
        cursor = block.payloadOffset + block.payloadSize;
      }
      if (cursor !== archive.indexOffset) fail('READONLY_JPK_PROFILE');
    } finally { fs.closeSync(fd); }
    if (!sameStat(before, fs.statSync(this.source)) || sha !== hashFile(this.source)) fail('SOURCE_CHANGED');
    this.sourceHash = sha; this.sourceStat = before; this.archive = archive; this.base = base; this.header = globalHeader;
    this.state = { edits: new Map(), slotCount: archive.slotCount }; this.count = base.size;
    this.undoStates = []; this.redoStates = [];
  }
  private assertCurrent(full = false) {
    if (this.closed) fail('SESSION_CLOSED');
    let current: fs.Stats;
    try { current = fs.statSync(this.source); } catch { return fail('SOURCE_CHANGED'); }
    if (!sameStat(this.sourceStat, current) || full && hashFile(this.source) !== this.sourceHash) fail('SOURCE_CHANGED');
  }
  private id(index: number, state = this.state) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= state.slotCount) fail('INVALID_INDEX');
    return index;
  }
  private frame(index: number, state = this.state): EditFrame | undefined {
    if (state.edits.has(index)) return state.edits.get(index) || undefined;
    const base = this.base.get(index); return base ? { header: base.header, base } : undefined;
  }
  private rgba(frame: EditFrame) {
    if (frame.rgba) return frame.rgba;
    const fd = fs.openSync(this.source, 'r');
    try { return renderJpkRgba(readJpkPayload(fd, frame.base!.block, this.key), frame.base!.block, this.palette); }
    finally { fs.closeSync(fd); }
  }
  private indices(indices: number[]) {
    if (!Array.isArray(indices) || !indices.length || indices.length > MAX_SELECTION) fail('SELECTION_LIMIT');
    return [...new Set(indices.map(id => this.id(id)))];
  }
  private commit(next: State) {
    if (this.batching) { this.assertCurrent(); this.state = next; this.recount(); return this.info(); }
    this.assertCurrent();
    const nextHistory = [...this.undoStates.slice(-(MAX_HISTORY - 1)), this.state];
    const buffers = new Set<Uint8Array | Uint8ClampedArray>(); let bytes = 0, entries = 0;
    // Immutable frames are shared across snapshots; count each actual allocation once.
    for (const state of [...nextHistory, next]) {
      entries += state.edits.size;
      for (const frame of state.edits.values()) if (frame) for (const buffer of [frame.header, frame.payload, frame.rgba]) {
        if (buffer && !buffers.has(buffer)) { buffers.add(buffer); bytes += buffer.byteLength; }
      }
    }
    if (bytes + entries * 96 > MAX_EDIT_BYTES) fail('EDIT_MEMORY_LIMIT');
    this.undoStates = nextHistory; this.redoStates = []; this.state = next; this.revision++;
    this.recount(); return this.info();
  }
  private recount() {
    this.count = this.base.size;
    for (const [id, edit] of this.state.edits) {
      if (this.base.has(id) && !edit) this.count--;
      else if (!this.base.has(id) && edit) this.count++;
    }
  }
  info(): JpkSessionInfo {
    if (this.closed) fail('SESSION_CLOSED');
    return { profileId: `jpk-${this.archive.variant}`, sourcePath: this.source, sourceSha256: this.sourceHash,
      slotCount: this.state.slotCount, imageCount: this.count, dirty: this.state.edits.size > 0 || this.state.slotCount !== this.archive.slotCount,
      revision: this.revision, canUndo: !!this.undoStates.length, canRedo: !!this.redoStates.length,
      capabilities: { canReplace: true, canFill: true, canAppend: true, canClear: true, canOffsets: true, canSaveAs: true } };
  }
  listSlots(start: number, limit = 100): JpkSessionSlot[] {
    this.assertCurrent();
    if (!Number.isInteger(start) || start < 0 || start > this.state.slotCount || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_PAGE');
    const slots: JpkSessionSlot[] = [];
    for (let id = start; id < Math.min(start + limit, this.state.slotCount); id++) {
      const frame = this.frame(id), header = frame?.header;
      slots.push(header ? { index: id, status: 'decoded', width: header.readUInt16LE(2), height: header.readUInt16LE(4),
        offsetX: header.readInt16LE(6), offsetY: header.readInt16LE(8), pixelFormat: `${header[0]} bit`,
        compression: header[1] ? 'zlib' : 'raw', alpha: header[16] ? '独立 A8' : header[0] === 8 ? '调色板 A8' : '不透明',
        modified: this.state.edits.has(id) } : { index: id, status: 'empty', modified: this.state.edits.has(id) });
    }
    return slots;
  }
  previewPng(index: number): Buffer {
    this.assertCurrent(); const frame = this.frame(this.id(index)); if (!frame) return fail('EMPTY_SLOT');
    const bytes = encodePng(frame.header.readUInt16LE(2), frame.header.readUInt16LE(4), this.rgba(frame));
    this.assertCurrent(); return bytes;
  }
  importImage(options: { mode: 'replace' | 'fill' | 'append'; index?: number; imagePath?: string; image?: ImportedResourceImage; x?: number; y?: number }) {
    this.assertCurrent();
    if (!options || !['replace', 'fill', 'append'].includes(options.mode)) fail('INVALID_OPERATION');
    const index = options.mode === 'append' ? this.state.slotCount : this.id(options.index!);
    if (index >= MAX_SLOTS) fail('SLOT_LIMIT');
    if (options.mode === 'append' && options.index !== undefined && options.index !== index) fail('INVALID_INDEX');
    const old = this.frame(index);
    if (options.mode === 'replace' ? !old : !!old) fail('SLOT_MODE_MISMATCH');
    const image = validateResourceImage(options.image || readResourceImage(options.imagePath!));
    if (image.width <= 2 && image.height <= 2) fail('JPK_DIMENSIONS');
    const header = old ? Buffer.from(old.header) : Buffer.alloc(20);
    if (!old) { header[0] = 32; header[1] = 1; header[16] = 1; }
    header.writeUInt16LE(image.width, 2); header.writeUInt16LE(image.height, 4);
    if (options.x !== undefined) header.writeInt16LE(offsetValue(options.x), 6);
    if (options.y !== undefined) header.writeInt16LE(offsetValue(options.y), 8);
    const raw = this.encodeImage(image, header);
    const payload = rc4Crypt(header[1] ? zlib.deflateSync(raw) : raw, this.key);
    header.writeUInt32LE(payload.length, 12);
    const edits = new Map(this.state.edits); edits.set(index, { header, payload, rgba: image.rgba });
    return this.commit({ edits, slotCount: this.state.slotCount + (options.mode === 'append' ? 1 : 0) });
  }
  private encodeImage(image: ImportedResourceImage, header: Buffer): Buffer {
    const { width, height, rgba } = image, type = header[0], hasAlpha = !!header[16];
    const stride = alignedStride(width, type), alphaStride = alignedStride(width, 8), alphaOffset = stride * height;
    const raw = Buffer.alloc(alphaOffset + (hasAlpha ? alphaStride * height : 0));
    const palette = new Map<string, number>();
    if (type === 8) for (let p = 0; p < 256; p++) {
      const k = [this.palette[p * 4 + 2], this.palette[p * 4 + 1], this.palette[p * 4], ...(hasAlpha ? [] : [this.palette[p * 4 + 3]])].join(',');
      if (!palette.has(k)) palette.set(k, p);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = (height - 1 - y) * stride + x * type / 8;
      const r = rgba[src], g = rgba[src + 1], b = rgba[src + 2], a = rgba[src + 3];
      if (!hasAlpha && type !== 8 && a !== 255) fail('PIXEL_NOT_REPRESENTABLE');
      if (type === 8) {
        const entry = palette.get([r, g, b, ...(hasAlpha ? [] : [a])].join(','));
        if (entry === undefined) fail('PIXEL_NOT_REPRESENTABLE'); raw[dst] = entry!;
      } else if (type === 16) {
        const rr = r >> 3, gg = g >> 2, bb = b >> 3;
        if (((rr << 3) | (rr >> 2)) !== r || ((gg << 2) | (gg >> 4)) !== g || ((bb << 3) | (bb >> 2)) !== b) fail('PIXEL_NOT_REPRESENTABLE');
        raw.writeUInt16LE((rr << 11) | (gg << 5) | bb, dst);
      } else { raw[dst] = b; raw[dst + 1] = g; raw[dst + 2] = r; }
      if (hasAlpha) raw[alphaOffset + (height - 1 - y) * alphaStride + x] = a;
    }
    return raw;
  }
  clear(indices: number[]) {
    this.assertCurrent(); const edits = new Map(this.state.edits); let changed = false;
    for (const id of this.indices(indices)) if (this.frame(id)) { edits.set(id, null); changed = true; }
    return changed ? this.commit({ ...this.state, edits }) : this.info();
  }
  offsets(indices: number[], x: number, y: number, relative = false) {
    this.assertCurrent(); offsetValue(x); offsetValue(y); if (typeof relative !== 'boolean') fail('INVALID_OPERATION');
    const edits = new Map(this.state.edits); let changed = false;
    for (const id of this.indices(indices)) {
      const old = this.frame(id); if (!old) continue;
      const nx = offsetValue(relative ? old.header.readInt16LE(6) + x : x);
      const ny = offsetValue(relative ? old.header.readInt16LE(8) + y : y);
      if (nx === old.header.readInt16LE(6) && ny === old.header.readInt16LE(8)) continue;
      const header = Buffer.from(old.header); header.writeInt16LE(nx, 6); header.writeInt16LE(ny, 8);
      edits.set(id, { ...old, header }); changed = true;
    }
    return changed ? this.commit({ ...this.state, edits }) : this.info();
  }
  undo() {
    this.assertCurrent(); const previous = this.undoStates.pop();
    if (previous) { this.redoStates.push(this.state); this.state = previous; this.revision++; this.recount(); }
    return this.info();
  }
  redo() {
    this.assertCurrent(); const next = this.redoStates.pop();
    if (next) { this.undoStates.push(this.state); this.state = next; this.revision++; this.recount(); }
    return this.info();
  }
  private verify(file: string) {
    const parsed = parseJpkFileWithState(file, this.key);
    if (parsed.slotCount !== this.state.slotCount || parsed.blocks.length !== this.count || parsed.trailerSize
      || parsed.skippedMalformedIndices.length || parsed.title !== this.archive.title) fail('VERIFY_STRUCTURE');
    const fd = fs.openSync(file, 'r'); let verifiedImages = 0, unchangedRecords = 0;
    try {
      const actualHeader = rc4Crypt(readAt(fd, 80, 0), this.key), expectedHeader = Buffer.from(this.header);
      expectedHeader.writeUInt32LE(parsed.slotCount, 0x30); expectedHeader.writeUInt32LE(parsed.indexOffset, 0x34);
      if (!actualHeader.equals(expectedHeader)) fail('VERIFY_HEADER');
      for (const block of parsed.blocks) {
        const expected = this.frame(block.logicalIndex); if (!expected) fail('VERIFY_SLOT');
        const header = readAt(fd, 20, block.headerOffset);
        if (!header.equals(expected!.header)) fail('VERIFY_METADATA');
        const rgba = renderJpkRgba(readJpkPayload(fd, block, this.key), block, this.palette);
        if (digest(rgba) !== (expected!.rgba ? digest(expected!.rgba) : expected!.base!.rgbaHash)) fail('VERIFY_RGBA');
        if (!this.state.edits.has(block.logicalIndex)) {
          if (digest(readAt(fd, 20 + block.payloadSize, block.headerOffset)) !== this.base.get(block.logicalIndex)!.recordHash) fail('VERIFY_UNCHANGED_BYTES');
          unchangedRecords++;
        }
        verifiedImages++;
      }
      const index = readAt(fd, parsed.slotCount * 4, parsed.indexOffset);
      for (let id = 0; id < parsed.slotCount; id++) if (!!index.readUInt32LE(id * 4) !== !!this.frame(id)) fail('VERIFY_EMPTY_SLOT');
    } finally { fs.closeSync(fd); }
    return { verifiedImages, unchangedRecords, slotCount: parsed.slotCount, emptySlots: parsed.slotCount - verifiedImages, reopened: true };
  }
  saveAs(targetPath: string) {
    this.assertCurrent(true);
    if (typeof targetPath !== 'string' || !targetPath.trim() || path.extname(targetPath).toLowerCase() !== '.jpk') fail('INVALID_TARGET');
    const requested = path.resolve(targetPath), parent = fs.realpathSync(path.dirname(requested));
    const target = path.join(parent, path.basename(requested));
    if (target.toLowerCase() === this.source.toLowerCase()) fail('SOURCE_OVERWRITE_DISABLED');
    try { fs.lstatSync(target); fail('TARGET_EXISTS'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const sourceBefore = this.sourceHash, temporary = path.join(parent, `.boo-jpk-${crypto.randomBytes(16).toString('hex')}.tmp`);
    let created = false, published = false, fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx'); created = true;
      const sourceFd = fs.openSync(this.source, 'r'), index = Buffer.alloc(this.state.slotCount * 4); let cursor = 80;
      try {
        writeAt(fd, Buffer.alloc(80), 0);
        for (let id = 0; id < this.state.slotCount; id++) {
          const frame = this.frame(id); if (!frame) continue;
          const payload = frame.payload || readAt(sourceFd, frame.base!.block.payloadSize, frame.base!.block.payloadOffset);
          if (cursor + 20 + payload.length > 0xffffffff) fail('ARCHIVE_SIZE_LIMIT');
          index.writeUInt32LE(cursor, id * 4); writeAt(fd, frame.header, cursor); writeAt(fd, payload, cursor + 20);
          cursor += 20 + payload.length;
        }
        const header = Buffer.from(this.header); header.writeUInt32LE(this.state.slotCount, 0x30); header.writeUInt32LE(cursor, 0x34);
        writeAt(fd, index, cursor); writeAt(fd, rc4Crypt(header, this.key), 0); fs.fsyncSync(fd);
      } finally { fs.closeSync(sourceFd); }
      fs.closeSync(fd); fd = undefined;
      const verification = this.verify(temporary), targetHash = hashFile(temporary);
      this.assertCurrent(true);
      // Atomic create-if-absent. Filesystems without hard links remain unsupported for safe save-as.
      try { fs.linkSync(temporary, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('TARGET_EXISTS');
        return fail('ATOMIC_PUBLICATION_UNAVAILABLE');
      }
      published = true;
      // Removing the staging hard link changes ctime. Do this before adopting the target's baseline.
      fs.unlinkSync(temporary); created = false;
      this.assertCurrent(true);
      if (hashFile(target) !== targetHash) fail('TARGET_CHANGED');
      this.verify(target);
      const sourceAfter = hashFile(this.source);
      if (sourceBefore !== sourceAfter) fail('SOURCE_CHANGED');
      const oldSource = this.source;
      this.source = target;
      try { this.loadSource(); } catch (error) { this.source = oldSource; throw error; }
      this.revision++;
      return { sourceSha256Before: sourceBefore, sourceSha256After: sourceAfter, targetSha256: targetHash,
        verification, session: this.info() };
    } catch (error) {
      if (published) throw new JpkSessionError('PUBLISHED_REVALIDATION_FAILED', true);
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (created) {
        // Only remove the exact private temporary file this invocation exclusively created.
        try { fs.unlinkSync(temporary); } catch { /* Never remove a published target to hide a cleanup failure. */ }
      }
    }
  }
  close() {
    this.closed = true; this.key.fill(0); this.base.clear(); this.state.edits.clear(); this.undoStates = []; this.redoStates = [];
  }
}
