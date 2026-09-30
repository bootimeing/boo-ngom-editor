const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { parseResourceEditorMessage: parse, parseResourceExportSelection: select, resourceEditorPageStart: page } = require(path.join(root, 'out/resource-editor/model'));
const sid = 'session', did = 'document-123';
const msg = (type, extra = {}) => ({ type, sessionId: sid, documentId: did, requestId: 1, ...extra });
const read = value => parse(value, sid, did, 256);
assert.deepEqual(read({ type: 'ready', documentId: did }), { type: 'ready', documentId: did });
assert.equal(read(msg('jump', { index: 0 })).index, 0);
assert.equal(read(msg('page', { start: 255 })).start, 200);
assert.equal(page(0, 0), 0);
assert.equal(page(999999, 1000000), 999900);
assert.deepEqual(read(msg('export', { selection: { kind: 'ids', ids: [255, 1, 0] } })).selection.ids, [0, 1, 255]);
assert.deepEqual(select({ kind: 'all' }, 0), { kind: 'all' });
assert.deepEqual(select({ kind: 'range', start: 0, end: 999999 }, 1000000), { kind: 'range', start: 0, end: 999999 });
for (const value of [null, [], {}, true, { type: 'ready', documentId: 'short' }, { type: 'ready', documentId: did, path: 'C:/x' },
  msg('jump', { index: -1 }), msg('jump', { index: 256 }), msg('jump', { index: '0' }), msg('jump', { index: NaN }),
  msg('jump', { index: 0, password: 'secret' }), msg('page', { start: 0, path: '../x' }),
  msg('inspect', { index: 1, sessionId: 'stale' }), msg('inspect', { index: 1, documentId: 'stale-doc' }),
  msg('inspect', { index: 1, requestId: 0 }), msg('inspect', { index: 1, requestId: true }),
  msg('inspect', { index: 1, requestId: Infinity }), msg('write'), msg('saveAs'), msg('setOffset'),
  msg('export', { selection: { kind: 'range', start: 5, end: 4 } }),
  msg('export', { selection: { kind: 'ids', ids: [] } }), msg('export', { selection: { kind: 'ids', ids: [0, 0] } }),
  msg('export', { selection: { kind: 'all', path: 'C:/x' } })]) assert.throws(() => read(value), undefined, JSON.stringify(value));
assert.throws(() => select({ kind: 'ids', ids: Array.from({ length: 10001 }, (_, i) => i) }, 1000000));
assert.throws(() => page(1, 0));
for (const type of ['undo', 'redo', 'saveAs', 'endEdit']) {
  assert.equal(read(msg(type, { revision: 0 })).type, type);
  for (const revision of [-1, 0.5, true, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => read(msg(type, { revision })));
  }
  for (const extra of [{ path: 'C:/x' }, { password: 'secret' }, { capabilities: {} }]) {
    assert.throws(() => read(msg(type, { revision: 0, ...extra })));
  }
}
assert.equal(read(msg('beginEdit')).type, 'beginEdit');
assert.throws(() => read(msg('beginEdit', { revision: 0 })));
for (const mode of ['replace', 'fill']) {
  assert.equal(read(msg('importImage', { mode, index: 255, revision: 1 })).index, 255);
  assert.throws(() => read(msg('importImage', { mode, index: null, revision: 1 })));
}
assert.equal(read(msg('importImage', { mode: 'append', index: null, revision: 1 })).index, null);
assert.throws(() => read(msg('importImage', { mode: 'append', index: 0, revision: 1 })));
assert.throws(() => read(msg('importImage', { mode: 'insert', index: 0, revision: 1 })));
assert.throws(() => read(msg('importImage', { mode: 'append', index: null, revision: 1, imagePath: 'C:/x.png' })));
assert.equal(read(msg('clearSlot', { index: 0, revision: 0 })).index, 0);
assert.throws(() => read(msg('clearSlot', { index: 256, revision: 0 })));
for (const coordinate of [-32768, 0, 32767]) {
  assert.equal(read(msg('setOffsets', { index: 0, revision: 0, x: coordinate, y: coordinate })).x, coordinate);
}
for (const coordinate of [-32769, 32768, 0.5, true, '0', null, Infinity]) {
  for (const axis of ['x', 'y']) assert.throws(() => read(msg('setOffsets', { index: 0, revision: 0, x: 0, y: 0, [axis]: coordinate })));
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(read(msg('batchTools',{ids:[2,0],index:0,revision:0})).ids,[0,2]);
assert.throws(()=>read(msg('batchTools',{ids:[0,0],index:0,revision:0})));
assert.throws(()=>read(msg('batchTools',{ids:[0],index:0,revision:0,path:'C:/private'})));
assert.deepEqual(read(msg('exportAnimation',{ids:[2,0],fps:60,revision:0})).ids,[2,0]);
for(const fps of [0,61,1.5,'10',true])assert.throws(()=>read(msg('exportAnimation',{ids:[0],fps,revision:0})));
assert.throws(()=>read(msg('createJpk')), 'removed new-pack protocol is rejected');
for(const type of ['animation','reference']){
 assert.equal(read(msg(type)).type,type);
 assert.throws(()=>read(msg(type,{path:'C:/private'})));
}
assert.ok(manifest.activationEvents.includes('onCommand:boo.resourceEditor.open'));
assert.ok(manifest.contributes.commands.some(c => c.command === 'boo.resourceEditor.open'));
console.log('resource-editor-model.test.js: PASS (strict protocol, document/session identity, stable IDs, bounded selection and command contribution)');
