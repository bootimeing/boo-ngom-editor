import { parentPort } from 'worker_threads';
import { loadArchiveSummary, readArchiveImagePng, ReadArchiveImageOptions } from './archive-index';
import { ArchiveImageDataError, readArchiveStatus } from './archive-status';
import { getArchiveDiagnostic } from './archive-errors';

interface WorkerRequest {
  id: number;
  options: ReadArchiveImageOptions;
}

if (!parentPort) throw new Error('素材解码 Worker 缺少父线程');

parentPort.on('message', (request: WorkerRequest) => {
  void readArchiveImagePng(request.options).then(data => {
    const { options } = request;
    const bytes = options.verificationOnly
      ? Uint8Array.from([readArchiveStatus(options.indexRoot, loadArchiveSummary(options.indexRoot, options.archiveId), options.imageIndex)])
      : Uint8Array.from(data);
    parentPort!.postMessage({ id: request.id, data: bytes }, [bytes.buffer]);
  }).catch(error => {
    parentPort!.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      slotCode: error instanceof ArchiveImageDataError ? error.slotCode : undefined,
      diagnostic: getArchiveDiagnostic(error),
    });
  });
});
