import {
  ArchiveIndexSummary, ReadArchiveImageOptions, assertArchiveReadCurrent, loadArchiveAssetTable, loadArchiveSummary,
} from './archive-index';
import { ArchiveImageWorkerPool, ArchiveWorkerDecodeError } from './archive-image-worker-pool';
import { archiveReadReason, archiveReadState, hashArchiveFile, readArchiveStatuses } from './archive-status';
import { ArchiveSlotStatus } from './archive-types';

export interface ArchiveVerificationReport {
  state: 'running' | 'cancelled' | 'complete';
  archiveId: string;
  indexGeneration: string;
  profileId?: string;
  sourceSha256: string;
  companionSha256?: string;
  counts: Record<ArchiveSlotStatus, number>;
  total: number;
  completed: number;
  decodedThisRun: number;
  elapsedMs: number;
  failures: Array<{ id: number; reason: string }>;
  failuresTruncated: boolean;
}

export interface VerifyArchiveOptions extends Omit<ReadArchiveImageOptions, 'imageIndex'> {
  signal?: AbortSignal;
  onProgress?: (report: ArchiveVerificationReport) => void;
}

export async function verifyArchive(options: VerifyArchiveOptions): Promise<ArchiveVerificationReport> {
  const summary = loadArchiveSummary(options.indexRoot, options.archiveId);
  assertArchiveReadCurrent(options.indexRoot, summary);
  const started = Date.now();
  const table = loadArchiveAssetTable(options.indexRoot, options.archiveId);
  const statuses = readArchiveStatuses(options.indexRoot, summary);
  const report: ArchiveVerificationReport = {
    state: 'running', archiveId: summary.archiveId, indexGeneration: summary.indexGeneration,
    profileId: summary.profileId, sourceSha256: summary.sourceSha256, companionSha256: summary.companionSha256,
    total: summary.slotCount, completed: 0, decodedThisRun: 0, elapsedMs: 0,
    counts: { empty: 0, 'indexed-unverified': 0, decoded: 0, recovered: 0, unsupported: 0, corrupt: 0 },
    failures: [], failuresTruncated: false,
  };
  const rejected = new Map(summary.rejectedSlots?.map(slot => [slot.logicalIndex, slot]));
  const cancel = () => { report.state = 'cancelled'; };
  const addFailure = (id: number, reason: string) => {
    if (report.failures.length < 1000) report.failures.push({ id, reason });
    else report.failuresTruncated = true;
  };
  const notify = () => {
    report.completed = report.total - report.counts['indexed-unverified'];
    report.elapsedMs = Date.now() - started;
    options.onProgress?.({ ...report, counts: { ...report.counts }, failures: [...report.failures] });
  };
  for (let id = 0; id < report.total; id++) {
    const known = rejected.get(id);
    const state = known?.status || (table.blank[id] ? 'empty' : archiveReadState(statuses[id]));
    report.counts[state]++;
    if (state === 'corrupt' || state === 'unsupported') addFailure(id, known?.reasonCode || archiveReadReason(statuses[id])!);
    if (id % 8192 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  // Dedicated worker: cancellation does not kill image requests belonging to other consumers.
  const workers = new ArchiveImageWorkerPool(1);
  const abort = () => { void workers.dispose(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await assertContentCurrent(options.indexRoot, summary, options.signal);
    notify();
    let lastProgress = 0;
    for (let id = 0; id < report.total; id++) {
      if (options.signal?.aborted) { report.state = 'cancelled'; break; }
      if (!table.blank[id] && !rejected.has(id) && !statuses[id]) {
        let code: number;
        try {
          const response = await workers.read({ imageIndex: id,
            indexGeneration: summary.indexGeneration, verificationOnly: true,
            // Do not send callbacks or AbortSignal to worker_threads.
            extensionPath: options.extensionPath, indexRoot: options.indexRoot, archiveId: options.archiveId,
          });
          code = response[0];
        } catch (error) {
          if (options.signal?.aborted) { cancel(); break; }
          if (!(error instanceof ArchiveWorkerDecodeError) || !error.slotCode) throw error;
          code = error.slotCode;
        }
        assertArchiveReadCurrent(options.indexRoot, summary);
        if (!Number.isInteger(code) || code < 1 || code > 5) throw new Error('素材验证 Worker 返回无效状态');
        statuses[id] = code;
        report.counts['indexed-unverified']--;
        report.counts[archiveReadState(code)]++;
        report.decodedThisRun++;
        if (code >= 3) addFailure(id, archiveReadReason(code)!);
      }
      if (Date.now() - lastProgress >= 100) { notify(); lastProgress = Date.now(); }
      if (id % 1024 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (report.state !== 'cancelled' && !options.signal?.aborted) {
      await assertContentCurrent(options.indexRoot, summary, options.signal);
      if (report.counts['indexed-unverified'] !== 0) throw new Error('素材验证尚有未完成槽位');
      report.state = 'complete';
    } else { report.state = 'cancelled'; }
  } catch (error) {
    if (!options.signal?.aborted) throw error;
    cancel();
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await workers.dispose();
  }
  notify();
  return report;
}

async function assertContentCurrent(indexRoot: string, summary: ArchiveIndexSummary, signal?: AbortSignal): Promise<void> {
  assertArchiveReadCurrent(indexRoot, summary);
  if (await hashArchiveFile(summary.pakPath, signal) !== summary.sourceSha256
    || (summary.companionPath && await hashArchiveFile(summary.companionPath, signal) !== summary.companionSha256)) {
    throw new Error('源素材包内容已发生变化，请重载后验证');
  }
  assertArchiveReadCurrent(indexRoot, summary);
}
