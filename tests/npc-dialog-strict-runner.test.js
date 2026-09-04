const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  CHILD_TIMEOUT_MS,
  MAX_TIMER_DELAY_MS,
  resolveChildTimeoutMs,
  runStrictChild,
} = require('./npc-dialog-strict-suite');

function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = 0;
  child.unrefCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    if (options.killError) throw options.killError;
    return options.killReturned;
  };
  child.unref = () => {
    child.unrefCalls += 1;
  };
  if (options.close) {
    queueMicrotask(() => child.emit('close', options.close.status, options.close.signal));
  }
  return child;
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  assert.equal(resolveChildTimeoutMs({}), CHILD_TIMEOUT_MS);
  assert.equal(resolveChildTimeoutMs({ BOO_NPC_DIALOG_STRICT_TIMEOUT_MS: '321' }), 321);
  for (const invalid of ['', '0', '-1', '1.5', ' 5', '5 ', 'nope', String(MAX_TIMER_DELAY_MS + 1)]) {
    assert.throws(
      () => resolveChildTimeoutMs({ BOO_NPC_DIALOG_STRICT_TIMEOUT_MS: invalid }),
      /BOO_NPC_DIALOG_STRICT_TIMEOUT_MS must be a positive integer/u,
    );
  }

  let child;
  let result = await runStrictChild('never-closes.test.js', {}, {
    timeoutMs: 5,
    killGraceMs: 5,
    spawnChild: () => {
      child = fakeChild({ killReturned: false });
      return child;
    },
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.hardSettled, true);
  assert.equal(result.killReturned, false);
  assert.equal(result.killError, undefined);
  assert.equal(child.killCalls, 1);
  assert.equal(child.unrefCalls, 1);

  const killError = new Error('simulated kill failure');
  result = await runStrictChild('kill-throws.test.js', {}, {
    timeoutMs: 5,
    killGraceMs: 5,
    spawnChild: () => fakeChild({ killError }),
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.hardSettled, true);
  assert.equal(result.killError, killError);

  child = undefined;
  result = await runStrictChild('normal-close.test.js', {}, {
    timeoutMs: 20,
    killGraceMs: 5,
    spawnChild: () => {
      child = fakeChild({ close: { status: 0, signal: null } });
      return child;
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.hardSettled, false);
  await wait(30);
  assert.equal(child.killCalls, 0, 'normal close did not clear the child timeout');

  console.log('npc-dialog-strict-runner.test.js: PASS');
}

main().catch(error => {
  console.error(`npc-dialog-strict-runner.test.js: FAIL (${error?.stack || error})`);
  process.exitCode = 1;
});
