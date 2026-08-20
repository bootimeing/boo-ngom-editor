const fs = require('node:fs');

const retryableErrors = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function wait(milliseconds) {
  Atomics.wait(sleepBuffer, 0, 0, milliseconds);
}

function removeTemporaryDirectory(directory) {
  const deadline = Date.now() + 15000;
  let lastError;

  do {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (!retryableErrors.has(error?.code)) throw error;
      lastError = error;
      wait(250);
    }
  } while (Date.now() < deadline);

  throw lastError;
}

module.exports = { removeTemporaryDirectory };
