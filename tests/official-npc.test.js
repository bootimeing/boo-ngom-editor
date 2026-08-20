const assert = require('node:assert/strict');
const path = require('node:path');

function main() {
  const {
    resolveOfficialNpcAnimationPlan,
    selectOfficialNpcArchiveFile,
  } = require('../out/utils/official-npc');

  const expectedPlans = [
    ['GOM', 0, 'npc', 10],
    ['GOM', 15, 'npc', 920],
    ['GOM', 43, 'npc', 2640],
    ['GOM', 54, 'npc', 4490],
    ['GOM', 81, 'npc', 3960],
    ['GOM', 100, 'npc2', 10],
    ['GOM', 109, 'npc2', 640],
    ['GOM', 211, 'npc2', 810],
    ['GOM', 225, 'npc2', 1060],
    ['GOM', 226, 'npc3', 20],
    ['GOM', 236, 'npc3', 410],
    ['GOM', 245, 'npc3', 1010],
    ['GOM', 246, 'npc4', 40],
    ['GOM', 252, 'npc4', 580],
    ['GOM', 258, 'npc4', 1200],
    ['GOM', 264, 'npc4', 1900],
    ['GOM', 272, 'npc4', 2860],
    ['GEE', 273, 'npc4', 2950],
  ];
  for (const [engine, appearance, archiveName, startIndex] of expectedPlans) {
    const plan = resolveOfficialNpcAnimationPlan(appearance, engine);
    assert.equal(plan?.archiveName, archiveName, `${engine} appearance ${appearance} archive`);
    assert.equal(plan?.startIndex, startIndex, `${engine} appearance ${appearance} start`);
    assert.equal(plan?.frameWindow, appearance === 225 ? 1 : 10);
  }
  assert.equal(resolveOfficialNpcAnimationPlan(71, 'GOM')?.frameWindow, 4);
  assert.equal(resolveOfficialNpcAnimationPlan(75, 'GOM')?.frameWindow, 4);
  assert.equal(resolveOfficialNpcAnimationPlan(209, 'GOM')?.frameWindow, 4);
  for (const unsupported of [44, 53, 69, 93, 108, 134, 208, 274, 999, 10000]) {
    assert.equal(resolveOfficialNpcAnimationPlan(unsupported, 'GOM'), undefined);
  }
  assert.equal(resolveOfficialNpcAnimationPlan(273, 'GOM'), undefined);
  assert.equal(resolveOfficialNpcAnimationPlan(273, '996PC'), undefined);
  assert.equal(
    Array.from({ length: 10000 }, (_, appearance) => (
      resolveOfficialNpcAnimationPlan(appearance, 'GOM') ? appearance : undefined
    )).filter(appearance => appearance !== undefined).length,
    164,
    'GOM/996PC must cover every official appearance included by their help table'
  );
  assert.equal(
    Array.from({ length: 10000 }, (_, appearance) => (
      resolveOfficialNpcAnimationPlan(appearance, 'GEE') ? appearance : undefined
    )).filter(appearance => appearance !== undefined).length,
    165,
    'GEE includes the same official table plus appearance 273'
  );

  const clientRoot = path.resolve('D:/Client');
  const patchRoot = path.join(clientRoot, 'CustomPatch');
  const patchData = path.join(patchRoot, 'Data');
  const clientData = path.join(clientRoot, 'Data');
  const pak = path.join(patchData, 'NPC2.PAK');
  const wzl = path.join(clientData, 'npc2.wzl');
  const wil = path.join(clientData, 'npc2.wil');
  assert.equal(
    selectOfficialNpcArchiveFile('npc2', [wzl, pak, wil], [patchData, clientData], [patchRoot], 'GOM'),
    pak,
    'a custom PAK must override classic client resources'
  );
  assert.equal(
    selectOfficialNpcArchiveFile('npc2', [wil, wzl], [patchData, clientData], [patchRoot], 'GOM'),
    wzl,
    'WZL is preferred over WIL when no packaged override exists'
  );
  assert.equal(
    selectOfficialNpcArchiveFile(
      'npc2',
      [path.join(patchData, 'npc2.wzl'), wil],
      [patchData, clientData],
      [patchRoot],
      'GOM'
    ),
    wil,
    'classic fallback must come from the client, not a custom patch directory'
  );
  const jpk = path.join(patchData, 'npc2.jpk');
  assert.equal(
    selectOfficialNpcArchiveFile('npc2', [pak, jpk, wzl], [patchData, clientData], [patchRoot], '996PC'),
    jpk,
    '996PC prefers its native JPK override'
  );

  console.log('official-npc.test.js: PASS');
}

main();
