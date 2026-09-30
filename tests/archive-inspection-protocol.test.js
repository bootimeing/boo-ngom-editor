// Exercises the production host switch branch with a minimal VS Code transport double.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/extension.ts'), 'utf8');
const branch = source.match(/case 'inspectArchiveSlots':\s*\{([\s\S]*?)\n\s*case 'openPakFiles':/);
assert.ok(branch, 'production inspect host handler must be present');
const javascript = ts.transpileModule(`async function handle(message) { switch(message.type) { case 'inspectArchiveSlots': {${branch[1]} } }`,
  { compilerOptions:{ target:ts.ScriptTarget.ES2022 } }).outputText;
async function main() {
  const sent = [], calls = [];
  const archiveId = 'a'.repeat(64), indexGeneration = 'b'.repeat(32);
  const opened = { archiveId,indexGeneration,pakPath:'D:/fixtures/test.pak',storageMode:'direct' };
  const normalizePakPath = value => path.resolve(value).toLowerCase();
  const panel = { webview:{ postMessage:message=>{sent.push(message); return true;} } };
  const sandbox = { currentPanel:panel, context:{}, loadedPakResults:new Map([[normalizePakPath(opened.pakPath),opened]]),
    normalizePakPath, getArchiveIndexRoot:()=>'/isolated/index', inspectArchiveSlots:(...args)=>{calls.push(args);return [{logicalIndex:3,status:'decoded'}];} };
  vm.createContext(sandbox); vm.runInContext(javascript,sandbox);
  const message = { type:'inspectArchiveSlots', command:'inspectArchiveSlots', requestId:7, assetGeneration:9, archiveId,indexGeneration,indices:[3] };
  await sandbox.handle(message);
  assert.equal(calls.length,1); assert.deepEqual(calls[0],['/isolated/index',archiveId,indexGeneration,[3]]);
  assert.equal(sent.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),{ type:'archiveSlotsInspected',command:'archiveSlotsInspected',requestId:7,
    assetGeneration:9,archiveId,indexGeneration,slots:[{logicalIndex:3,status:'decoded'}] });
  for (const invalid of [{archiveId:'c'.repeat(64)},{indexGeneration:'d'.repeat(32)},{requestId:NaN},{assetGeneration:1.2},{indices:'3'}]) {
    await sandbox.handle({...message,...invalid});
  }
  assert.equal(calls.length,1,'unopened/incorrect identity and malformed transport requests never access caches');
  assert.equal(sent.length,1);
  sandbox.inspectArchiveSlots = ()=>{throw Error('secret path must not leak');};
  await sandbox.handle(message);
  assert.equal(sent.length,2); assert.ok(sent[1].error); assert.equal(JSON.stringify(sent[1]).includes('secret path'),false);
  assert.equal(sent[1].assetGeneration,9); assert.equal(sent[1].indexGeneration,indexGeneration);
  console.log('archive-inspection-protocol.test.js: PASS (production host branch, current opened package, frontend-compatible identity echo, rejection and redacted errors; mocked VS Code transport)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
