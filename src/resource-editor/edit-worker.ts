import { parentPort } from 'worker_threads';
import * as path from 'path';
import { JpkEditSession } from './jpk-session';
import { GomEditSession } from './gom-session';
import { PairEditSession } from './pair-session';
import { applyResourceBatch, copyResourceFrames, prepareResourceBatch, ResourceBatchPlan, ResourceBatchRequest } from './batch';

let session: JpkEditSession | GomEditSession | PairEditSession | undefined;
let batchPlan: ResourceBatchPlan | undefined;
const mutations = new Set(['importImage', 'clear', 'offsets', 'undo', 'redo', 'saveAs', 'prepareBatch', 'applyBatch', 'copy']);
parentPort?.on('message', (message: { id: number; method: string; params: Record<string, unknown> }) => {
  const { id, method, params } = message;
  if (!Number.isSafeInteger(id) || id < 1 || !params || typeof params !== 'object') return;
  try {
    let result: unknown;
    const check = () => {
      if (params.cancel instanceof SharedArrayBuffer && Atomics.load(new Int32Array(params.cancel), 0)) throw new Error('CANCELLED');
    };
    if (method === 'open') {
      if (session) throw new Error('SESSION_ALREADY_OPEN');
      if (typeof params.extensionPath !== 'string' || typeof params.sourcePath !== 'string' || typeof params.password !== 'string') throw new Error('INVALID_PARAMS');
      const options = { extensionPath: params.extensionPath, sourcePath: params.sourcePath, password: params.password };
      const extension = path.extname(options.sourcePath).toLowerCase();
      if (!['.jpk', '.pak', '.wil', '.wzl'].includes(extension)) throw new Error('READONLY_ARCHIVE_PROFILE');
      // The core independently verifies the signature/layout. An extension is never sufficient admission.
      session = extension === '.jpk' ? JpkEditSession.open(options) : extension === '.pak' ? GomEditSession.open(options) : PairEditSession.open(options);
      result = session.info();
    } else {
      if (!session) throw new Error('SESSION_CLOSED');
      if (mutations.has(method) && params.revision !== session.info().revision) throw new Error('STALE_REVISION');
      switch (method) {
        case 'prepareBatch':
          batchPlan = undefined;
          batchPlan = prepareResourceBatch(session, params.request as ResourceBatchRequest, check);
          result = { rows: batchPlan.rows, revision: batchPlan.revision }; break;
        case 'applyBatch': {
          const plan = batchPlan; batchPlan = undefined;
          if (!plan) throw new Error('BATCH_EXPIRED');
          result = applyResourceBatch(session, plan, false, check); break;
        }
        case 'cancelBatch': batchPlan = undefined; result = true; break;
        case 'copy': result = copyResourceFrames(session, params.ids as number[]); break;
        case 'info': result = session.info(); break;
        case 'listSlots': result = session.listSlots(params.start as number, params.limit as number); break;
        case 'preview': result = session.previewPng(params.index as number); break;
        case 'importImage':
          session.importImage({ mode: params.mode as 'replace' | 'fill' | 'append',
            ...(params.index === null ? {} : { index: params.index as number }), imagePath: params.imagePath as string });
          result = session.info(); break;
        case 'clear': session.clear([params.index as number]); result = session.info(); break;
        case 'offsets': session.offsets([params.index as number], params.x as number, params.y as number); result = session.info(); break;
        case 'undo': session.undo(); result = session.info(); break;
        case 'redo': session.redo(); result = session.info(); break;
        case 'saveAs': result = session.saveAs(params.targetPath as string); break;
        default: throw new Error('INVALID_OPERATION');
      }
    }
    parentPort!.postMessage({ id, result });
  } catch (error) {
    const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
    // Neither operating-system paths nor raw decoder/password errors cross this boundary.
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(raw) ? raw : 'EDIT_FAILED';
    parentPort!.postMessage({ id, errorCode: code });
  }
});
