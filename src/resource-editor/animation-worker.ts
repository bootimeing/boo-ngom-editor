import { parentPort, workerData } from 'worker_threads';
import { encodeResourceApng } from './animation';
try { parentPort!.postMessage({ bytes: encodeResourceApng(workerData.frames, workerData.fps) }); }
catch (error) { parentPort!.postMessage({ error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ANIMATION_FAILED' }); }
