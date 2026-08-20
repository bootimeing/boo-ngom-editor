import { parentPort } from 'worker_threads';
import { readArchiveImagePng, ReadArchiveImageOptions } from './archive-index';

interface WorkerRequest {
  id: number;
  options: ReadArchiveImageOptions;
}

if (!parentPort) throw new Error('素材解码 Worker 缺少父线程');

parentPort.on('message', (request: WorkerRequest) => {
  void readArchiveImagePng(request.options).then(data => {
    const bytes = Uint8Array.from(data);
    parentPort!.postMessage({ id: request.id, data: bytes }, [bytes.buffer]);
  }).catch(error => {
    parentPort!.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
