import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  ArchiveIndexSummary, assertArchiveReadCurrent, inspectArchiveSlots, loadArchiveSummary,
} from '../utils/archive-index';
import { ArchiveImageWorkerPool, ArchiveWorkerDecodeError } from '../utils/archive-image-worker-pool';
import { getArchiveDiagnostic } from '../utils/archive-errors';
import { ArchiveImageDataError, hashArchiveFile } from '../utils/archive-status';
import { crc32 } from '../utils/pak-reader';

export type ArchiveExportSelection = { kind: 'all' } | { kind: 'range'; start: number; end: number }
  | { kind: 'ids'; ids: number[] };
export interface ArchiveExportProgress {
  completed: number; total: number; exported: number; failed: number; empty: number;
}
export interface ArchiveExportResult extends ArchiveExportProgress {
  directory: string; state: 'complete' | 'partial' | 'cancelled'; manifestPath: string;
}
export interface ExportArchiveImagesOptions {
  extensionPath: string; indexRoot: string; archiveId: string; indexGeneration: string;
  destinationParent: string; selection: ArchiveExportSelection; signal?: AbortSignal;
  onProgress?: (progress: ArchiveExportProgress) => void;
  readPng?: (imageIndex: number) => Promise<Uint8Array>;
}

class ExportFailure extends Error {
  constructor(readonly reasonCode: string) { super(`素材导出未完成（${reasonCode}）`); }
}
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BATCH_SIZE = 100;

function selectionPlan(selection: ArchiveExportSelection, slotCount: number) {
  const validId = (value: number) => Number.isSafeInteger(value) && value >= 0 && value < slotCount;
  if (!selection || !['all', 'range', 'ids'].includes(selection.kind)) throw new ExportFailure('invalid-selection');
  if (selection.kind === 'ids') {
    if (!Array.isArray(selection.ids) || !selection.ids.length || selection.ids.length > 10000 || !selection.ids.every(validId)) {
      throw new ExportFailure('invalid-selection');
    }
    const ids = [...new Set(selection.ids)].sort((a, b) => a - b);
    return { descriptor: { kind: 'ids', ids }, total: ids.length, at: (ordinal: number) => ids[ordinal] };
  }
  const start = selection.kind === 'all' ? 0 : selection.start;
  const end = selection.kind === 'all' ? slotCount - 1 : selection.end;
  if (selection.kind !== 'all' && (!validId(start) || !validId(end) || end < start)) {
    throw new ExportFailure('invalid-selection');
  }
  return { descriptor: { kind: selection.kind, start, end }, total: Math.max(0, end - start + 1),
    at: (ordinal: number) => start + ordinal };
}

async function fingerprints(summary: ArchiveIndexSummary, signal?: AbortSignal) {
  return { sourceSha256: await hashArchiveFile(summary.pakPath, signal),
    companionSha256: summary.companionPath ? await hashArchiveFile(summary.companionPath, signal) : null };
}

async function publishPng(pending: string, target: string, expectedHash: string) {
  try { await fs.promises.link(pending, target); }
  catch (error) {
    // FAT/exFAT and some network filesystems do not provide hard links. EXCL preserves no-clobber.
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    await fs.promises.copyFile(pending, target, fs.constants.COPYFILE_EXCL);
    const copied = await fs.promises.open(target, 'r+');
    try { await copied.sync(); } finally { await copied.close(); }
    if (await hashArchiveFile(target) !== expectedHash) throw new ExportFailure('png-publication-failed');
  }
  await fs.promises.unlink(pending);
}

/** Only accept the image producer's complete PNG, never its 1x1 empty/error fallback. */
function validatePng(bytes: Uint8Array, width: number, height: number): Buffer {
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (png.length < 45 || png.length > 256 * 1024 * 1024 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new ExportFailure('invalid-png');
  }
  let at = 8, imageData = false, header = false;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at), end = at + 12 + length;
    if (end > png.length || crc32(png.subarray(at + 4, end - 4)) !== png.readUInt32BE(end - 4)) {
      throw new ExportFailure('invalid-png');
    }
    const kind = png.toString('ascii', at + 4, at + 8);
    if (!header) {
      if (kind !== 'IHDR' || length !== 13 || png.readUInt32BE(at + 8) !== width
        || png.readUInt32BE(at + 12) !== height) throw new ExportFailure('invalid-png');
      header = true;
    } else if (kind === 'IHDR') throw new ExportFailure('invalid-png');
    if (kind === 'IDAT' && length > 0) imageData = true;
    if (kind === 'IEND') {
      if (length !== 0 || end !== png.length || !imageData) throw new ExportFailure('invalid-png');
      return png;
    }
    at = end;
  }
  throw new ExportFailure('invalid-png');
}

function failureCode(error: unknown): string {
  if (error instanceof ExportFailure) return error.reasonCode;
  const diagnostic = getArchiveDiagnostic(error);
  return diagnostic.reasonCode === 'source-changed' ? 'source-changed' : 'read-or-write-failed';
}

/** Explicit user export, not an automatic full-PNG cache. No archive is ever written. */
export async function exportArchiveImages(options: ExportArchiveImagesOptions): Promise<ArchiveExportResult> {
  let summary: ArchiveIndexSummary;
  let before: Awaited<ReturnType<typeof fingerprints>>;
  try {
    if (options.signal?.aborted) throw new ExportFailure('cancelled');
    if (!/^[a-f0-9]{64}$/.test(options.archiveId) || !/^[a-f0-9]{32}$/.test(options.indexGeneration)) {
      throw new ExportFailure('invalid-archive');
    }
    summary = loadArchiveSummary(options.indexRoot, options.archiveId);
    if (summary.indexGeneration !== options.indexGeneration) throw new ExportFailure('source-changed');
    assertArchiveReadCurrent(options.indexRoot, summary);
    before = await fingerprints(summary, options.signal);
    if (before.sourceSha256 !== summary.sourceSha256
      || before.companionSha256 !== (summary.companionSha256 || null)) throw new ExportFailure('source-changed');
    assertArchiveReadCurrent(options.indexRoot, summary);
    if (options.signal?.aborted) throw new ExportFailure('cancelled');
  } catch (error) { throw new ExportFailure(options.signal?.aborted ? 'cancelled' : failureCode(error)); }
  const plan = selectionPlan(options.selection, summary.slotCount);
  let directory: string;
  try {
    const parent = await fs.promises.realpath(options.destinationParent);
    if (!(await fs.promises.stat(parent)).isDirectory()) throw new ExportFailure('invalid-destination');
    directory = await fs.promises.mkdtemp(path.join(parent, 'boo-export-'));
  } catch { throw new ExportFailure('invalid-destination'); }
  const manifestPath = path.join(directory, 'manifest.json');
  const progress: ArchiveExportProgress = { completed: 0, total: plan.total, exported: 0, failed: 0, empty: 0 };
  const workers = options.readPng ? undefined : new ArchiveImageWorkerPool(1);
  const abort = () => { void workers?.dispose(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  let lastProgress = 0;
  const notify = (force = false) => {
    if (!force && Date.now() - lastProgress < 100) return;
    lastProgress = Date.now();
    try { options.onProgress?.({ ...progress }); } catch { /* Advisory UI callbacks must not corrupt output. */ }
  };
  let handle: fs.promises.FileHandle | undefined;
  let firstEntry = true, manifestHealthy = true, fatalReason: string | null = null;
  let after: Awaited<ReturnType<typeof fingerprints>> | null = null;
  let sourceUnchanged = false;
  const append = async (value: string) => {
    const buffer = Buffer.from(value, 'utf8');
    let offset = 0;
    try {
      while (offset < buffer.length) {
        const written = await handle!.write(buffer, offset, buffer.length - offset, null);
        if (!written.bytesWritten) throw new ExportFailure('manifest-write-failed');
        offset += written.bytesWritten;
      }
    } catch (error) { manifestHealthy = false; throw error; }
  };
  try {
    handle = await fs.promises.open(manifestPath, 'wx');
    const profileId = getArchiveDiagnostic({ diagnostic: { profileId: summary.profileId } }).profileId || null;
    await append(JSON.stringify({ schema: 'boo.archive-export.v1', format: summary.format, profileId,
      selection: plan.descriptor, total: plan.total, sourceSha256Before: before.sourceSha256,
      companionSha256Before: before.companionSha256, entries: [] }).slice(0, -2));
    // The header currently ends in '['. Entries and the outcome are streamed, not accumulated.
    notify(true);
    try {
      for (let cursor = 0; cursor < plan.total && !options.signal?.aborted; cursor += BATCH_SIZE) {
        const ids: number[] = [];
        for (let i = cursor; i < Math.min(cursor + BATCH_SIZE, plan.total); i++) ids.push(plan.at(i));
        const slots = inspectArchiveSlots(options.indexRoot, options.archiveId, options.indexGeneration, ids);
        for (const slot of slots) {
          if (options.signal?.aborted) break;
          const metadata = slot.metadata;
          const row = { id: slot.logicalIndex, status: slot.status as string, sourceStatus: slot.status as string,
            width: metadata?.width ?? null, height: metadata?.height ?? null,
            x: metadata?.offsetX ?? null, y: metadata?.offsetY ?? null,
            pixelFormat: metadata?.pixelFormat ?? null, compression: metadata?.compression ?? null,
            alpha: metadata?.alpha ?? null,
            file: null as string | null, pngSha256: null as string | null, reasonCode: null as string | null };
          if (slot.status === 'empty') progress.empty++;
          else if (slot.status === 'corrupt' || slot.status === 'unsupported' || !metadata) {
            const diagnostic = getArchiveDiagnostic({ diagnostic: { reasonCode: slot.reasonCode } });
            row.reasonCode = diagnostic.reasonCode !== 'unknown' ? diagnostic.reasonCode
              : slot.status === 'unsupported' ? 'unsupported-image-layout' : 'invalid-image-block';
            progress.failed++;
          } else {
            try {
              const bytes = options.readPng ? await options.readPng(slot.logicalIndex) : await workers!.read({
                extensionPath: options.extensionPath, indexRoot: options.indexRoot, archiveId: options.archiveId,
                indexGeneration: options.indexGeneration, imageIndex: slot.logicalIndex,
              });
              if (options.signal?.aborted) break;
              assertArchiveReadCurrent(options.indexRoot, summary);
              const png = validatePng(bytes, metadata.width, metadata.height);
              const currentSlot = inspectArchiveSlots(options.indexRoot, options.archiveId, options.indexGeneration, [slot.logicalIndex])[0];
              row.sourceStatus = currentSlot.status;
              if (currentSlot.status === 'corrupt' || currentSlot.status === 'unsupported' || currentSlot.status === 'empty') {
                throw new ExportFailure('invalid-png');
              }
              const file = `${String(slot.logicalIndex).padStart(6, '0')}.png`;
              // An incomplete PNG must never acquire a success filename or manifest entry.
              const pending = path.join(directory, `${file}.incomplete`);
              const output = await fs.promises.open(pending, 'wx');
              try { await output.writeFile(png); await output.sync(); } finally { await output.close(); }
              const pngHash = crypto.createHash('sha256').update(png).digest('hex');
              await publishPng(pending, path.join(directory, file), pngHash);
              row.file = file; row.pngSha256 = pngHash;
              row.status = 'exported'; progress.exported++;
            } catch (error) {
              if (options.signal?.aborted) break;
              assertArchiveReadCurrent(options.indexRoot, summary);
              if (error instanceof ExportFailure && error.reasonCode === 'invalid-png'
                || error instanceof ArchiveImageDataError
                || error instanceof ArchiveWorkerDecodeError && !!error.slotCode) {
                row.status = 'failed'; row.reasonCode = error instanceof ExportFailure ? error.reasonCode : 'image-decode-failed';
                progress.failed++;
              } else throw error;
            }
          }
          await append(`${firstEntry ? '' : ','}\n${JSON.stringify(row)}`);
          firstEntry = false; progress.completed++;
          notify();
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    } catch (error) { fatalReason = failureCode(error); }
    if (!manifestHealthy) throw new ExportFailure('manifest-write-failed');
    // Even cancellation records actual end hashes. Do not reuse the aborted signal for this audit.
    try {
      after = await fingerprints(summary);
      assertArchiveReadCurrent(options.indexRoot, summary);
      sourceUnchanged = before.sourceSha256 === after.sourceSha256 && before.companionSha256 === after.companionSha256;
      if (!sourceUnchanged) fatalReason = 'source-changed';
    } catch (error) { fatalReason = failureCode(error); }
    const state: ArchiveExportResult['state'] = options.signal?.aborted ? 'cancelled'
      : fatalReason || progress.failed || progress.completed !== progress.total ? 'partial' : 'complete';
    await append(`\n],${JSON.stringify({ state, ...progress, unprocessed: progress.total - progress.completed,
      sourceSha256After: after?.sourceSha256 ?? null, companionSha256After: after?.companionSha256 ?? null,
      sourceUnchanged, reasonCode: fatalReason }).slice(1)}`);
    await handle.sync();
    await handle.close();
    await workers?.dispose();
    notify(true);
    return { directory, manifestPath, state, ...progress };
  } catch { throw new ExportFailure('manifest-write-failed'); }
  finally {
    options.signal?.removeEventListener('abort', abort);
    // A cleanup failure must not replace the original, sanitized I/O failure.
    await Promise.allSettled([workers?.dispose(), handle?.close()]);
  }
}
