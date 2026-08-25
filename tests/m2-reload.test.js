const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nativeSource = fs.readFileSync(
  path.join(root, 'tools', 'M2Reloader', 'native', 'M2Reloader.cpp'),
  'utf8'
);

assert.match(
  nativeSource,
  /SendMessageTimeoutW\s*\(/,
  'M2Reloader must wait for M2 to finish handling WM_COMMAND'
);
assert.doesNotMatch(
  nativeSource,
  /PostMessageW\s*\([^;]*kWmCommand/,
  'fire-and-forget WM_COMMAND can pile up while the M2 main thread is reloading'
);

const { CoalescingReloadQueue } = require('../out/utils/reload-queue');

async function nextTurn() {
  await new Promise(resolve => setImmediate(resolve));
}

async function testSameTurnRequestsAreMerged() {
  const calls = [];
  const queue = new CoalescingReloadQueue(async (targetPath, items) => {
    calls.push({ targetPath, items: [...items] });
    return 'OK';
  }, { settleMs: 0 });

  const first = queue.enqueue('D:\\MirServer\\Mir200\\M2Server.exe', ['所有NPC']);
  const second = queue.enqueue('D:\\MirServer\\Mir200\\M2Server.exe', ['怪物爆率']);
  assert.deepEqual(await Promise.all([first, second]), ['OK', 'OK']);
  assert.deepEqual(calls, [{
    targetPath: 'D:\\MirServer\\Mir200\\M2Server.exe',
    items: ['所有NPC', '怪物爆率']
  }]);
}

async function testBusyRequestsBecomeOneTrailingReload() {
  const calls = [];
  let finishFirst;
  const firstGate = new Promise(resolve => { finishFirst = resolve; });
  const queue = new CoalescingReloadQueue(async (targetPath, items) => {
    calls.push({ targetPath, items: [...items] });
    if (calls.length === 1) await firstGate;
    return `OK_${calls.length}`;
  }, { settleMs: 0 });

  const first = queue.enqueue('m2', ['所有NPC']);
  await nextTurn();
  assert.equal(calls.length, 1);

  const second = queue.enqueue('m2', ['QFunction 功能脚本']);
  const third = queue.enqueue('m2', ['Robot 机器人脚本', 'QFunction 功能脚本']);
  finishFirst();

  assert.equal(await first, 'OK_1');
  assert.deepEqual(await Promise.all([second, third]), ['OK_2', 'OK_2']);
  assert.deepEqual(calls, [
    { targetPath: 'm2', items: ['所有NPC'] },
    { targetPath: 'm2', items: ['QFunction 功能脚本', 'Robot 机器人脚本'] }
  ]);
}

async function testRecoveryWindowIsObserved() {
  let now = 10_000;
  const sleeps = [];
  const queue = new CoalescingReloadQueue(async () => 'OK', {
    settleMs: 750,
    now: () => now,
    sleep: async ms => {
      sleeps.push(ms);
      now += ms;
    }
  });

  await queue.enqueue('m2', ['所有NPC']);
  await queue.enqueue('m2', ['所有NPC']);
  assert.deepEqual(sleeps, [750]);
}

(async () => {
  await testSameTurnRequestsAreMerged();
  await testBusyRequestsBecomeOneTrailingReload();
  await testRecoveryWindowIsObserved();
  console.log('M2 reload queue tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
