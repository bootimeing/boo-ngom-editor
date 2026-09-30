import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ArchiveIndexSummary } from './archive-index';
import type { ArchiveSlotStatus } from './archive-types';

// One positional byte per logical slot: independent workers never rewrite each other's results.
// A new index generation gets a different file; old tasks cannot publish into its ledger.
const HEADER_SIZE = 64;
const MAGIC = Buffer.from('BOOSLOT1');
export type ArchiveReadCode = 0 | 1 | 2 | 3 | 4 | 5;
const states: ArchiveSlotStatus[] = ['indexed-unverified', 'decoded', 'recovered', 'corrupt', 'unsupported', 'corrupt'];
const reasons = [undefined, undefined, 'checksum-recovered', 'decompression-failed', 'unsupported-pixel-layout', 'image-decode-failed'];

export class ArchiveImageDataError extends Error {
  constructor(message: string, public readonly slotCode: ArchiveReadCode) {
    super(message);
    this.name = 'ArchiveImageDataError';
  }
}

export function archiveReadState(code: number): ArchiveSlotStatus { return states[code]; }
export function archiveReadReason(code: number): string | undefined { return reasons[code]; }

function header(summary: ArchiveIndexSummary): Buffer {
  const result = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(result);
  Buffer.from(summary.indexGeneration, 'hex').copy(result, 8);
  result.writeUInt32LE(summary.slotCount, 24);
  crypto.createHash('sha256').update([
    summary.archiveId, summary.decoderRevision, summary.sourceSha256,
    summary.companionSha256 || '', summary.indexSha256,
  ].join('|')).digest().copy(result, 28);
  return result;
}

export function archiveStatusPath(indexRoot: string, summary: ArchiveIndexSummary): string {
  return path.join(indexRoot, summary.archiveId, `slots-${summary.indexGeneration}.bin`);
}

function validate(handle: number, summary: ArchiveIndexSummary): void {
  const bytes = Buffer.alloc(HEADER_SIZE);
  if (fs.fstatSync(handle).size !== HEADER_SIZE + summary.slotCount
    || fs.readSync(handle, bytes, 0, HEADER_SIZE, 0) !== HEADER_SIZE || !bytes.equals(header(summary))) {
    throw new Error('素材验证状态文件损坏，请重载此资源包');
  }
}

export function readArchiveStatuses(indexRoot: string, summary: ArchiveIndexSummary): Buffer {
  const file = archiveStatusPath(indexRoot, summary);
  let handle: number;
  try { handle = fs.openSync(file, 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(summary.slotCount);
    throw error;
  }
  try {
    validate(handle, summary);
    const bytes = Buffer.alloc(summary.slotCount);
    if (fs.readSync(handle, bytes, 0, bytes.length, HEADER_SIZE) !== bytes.length
      || bytes.some(code => code > 5)) throw new Error('素材验证状态记录无效，请重载此资源包');
    return bytes;
  } finally { fs.closeSync(handle); }
}

export function readArchiveStatus(indexRoot: string, summary: ArchiveIndexSummary, id: number): number {
  const handle = fs.openSync(archiveStatusPath(indexRoot, summary), 'r');
  try {
    validate(handle, summary);
    const byte = Buffer.alloc(1);
    if (id < 0 || id >= summary.slotCount || fs.readSync(handle, byte, 0, 1, HEADER_SIZE + id) !== 1 || byte[0] > 5) {
      throw new Error('素材验证状态记录无效，请重载此资源包');
    }
    return byte[0];
  } finally { fs.closeSync(handle); }
}

/** Read only requested ledger bytes; visible-page polling must never allocate a whole package. */
export function readArchiveStatusWindow(indexRoot: string, summary: ArchiveIndexSummary, indices: number[]): number[] {
  if (indices.length > 400 || indices.some(id => !Number.isInteger(id) || id < 0 || id >= summary.slotCount)) {
    throw new Error('素材详情请求超出范围');
  }
  let handle: number;
  try { handle = fs.openSync(archiveStatusPath(indexRoot, summary), 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return indices.map(() => 0);
    throw error;
  }
  try {
    validate(handle, summary);
    const byte = Buffer.alloc(1);
    return indices.map(id => {
      if (fs.readSync(handle, byte, 0, 1, HEADER_SIZE + id) !== 1 || byte[0] > 5) {
        throw new Error('素材验证状态记录无效，请重载此资源包');
      }
      return byte[0];
    });
  } finally { fs.closeSync(handle); }
}

export function writeArchiveStatus(indexRoot: string, summary: ArchiveIndexSummary, id: number, code: ArchiveReadCode): void {
  if (!Number.isInteger(id) || id < 0 || id >= summary.slotCount || code < 1 || code > 5) {
    throw new Error('素材验证状态序号或结果无效');
  }
  const file = archiveStatusPath(indexRoot, summary);
  if (!fs.existsSync(file)) {
    const temporary = `${file}.tmp-${crypto.randomBytes(12).toString('hex')}`;
    try {
      const handle = fs.openSync(temporary, 'wx');
      try {
        fs.writeSync(handle, header(summary));
        fs.ftruncateSync(handle, HEADER_SIZE + summary.slotCount);
        fs.fsyncSync(handle);
      } finally { fs.closeSync(handle); }
      // Atomic create-if-absent: nobody can observe an incomplete initial ledger.
      try { fs.linkSync(temporary, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  const handle = fs.openSync(file, 'r+');
  try {
    validate(handle, summary);
    if (fs.writeSync(handle, Buffer.from([code]), 0, 1, HEADER_SIZE + id) !== 1) {
      throw new Error('无法保存素材验证状态');
    }
  } finally { fs.closeSync(handle); }
}

export async function hashArchiveFile(file: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('素材验证已取消');
  const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  const abort = () => stream.destroy(new Error('素材验证已取消'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const hash = crypto.createHash('sha256');
    for await (const bytes of stream) hash.update(bytes);
    return hash.digest('hex');
  } finally { signal?.removeEventListener('abort', abort); stream.destroy(); }
}
