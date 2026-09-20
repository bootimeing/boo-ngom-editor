// Explicit opt-in, read-only user fixtures; not portable CI or pixel acceptance.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), iconv = require('iconv-lite');
const { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(runtime, 'out/utils/script-data-resolver'));
async function main() {
  const root = process.env.BOO_REAL_SWORD_SERVER;
  assert.ok(root, 'Explicit BOO_REAL_SWORD_SERVER is required');
  const engine = JSON.parse(fs.readFileSync(path.join(root, '.vscode/settings.json'), 'utf8'))['boo.engine'];
  assert.equal(engine, 'GOM', 'this named real fixture was checked against its GOM workspace profile');
  const dir = path.join(root, 'Mir200/Envir/Market_Def/1大陆/主城');
  const files = [path.join(dir, '00追梦神器-西岐.txt'), path.join(dir, '00上古神剑-西岐.txt'), path.join(root, 'Mir200/GlobalVal.ini')];
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashes = files.map(digest), resolver = new ScriptDataResolver(), evidence = [];
  const elements = model => model.pages.flatMap(p => p.elements);
  try {
    for (const [index, file] of files.slice(0, 2).entries()) {
      const source = iconv.decode(fs.readFileSync(file), 'gbk');
      await resolver.prepareFor(file, engine);
      const options = { filePath: file, fileName: path.basename(file), uri: pathToFileURL(file).href, dataOptions: resolver.optionsFor(file, engine) };
      const model = values => parse(source, values, engine, options);
      const initial = model({}), inputs = initial.previewInputs.map(i => i.name);
      if (index === 0) {
        assert.deepEqual(inputs, Array.from({ length: 15 }, (_, i) => `A${201 + i}`));
        assert.equal(elements(initial).filter(e => e.kind === 'item').length, 5);
        const defaults = options.dataOptions.resolvePreviewGlobalValues();
        for (const input of initial.previewInputs) assert.equal(input.value, defaults[input.name]);
        const changed = model({ A201: '本地验收玩家' });
        assert.ok(JSON.stringify(elements(changed)).includes('本地验收玩家'));
        assert.deepEqual(elements(model({})), elements(initial), 'reset must restore disk defaults');
      } else {
        assert.deepEqual(inputs.slice().sort(), ['承影', '金刚', '泰阿', '莫邪', '干将', '蚩尤'].map(n => `WORN(${n})`).sort());
        assert.ok(elements(initial).some(e => e.text === '88灵玉'));
        assert.ok(elements(initial).some(e => e.itemPreview?.itemIndex === 1927));
        const changed = model({ 'WORN(承影)': '1' });
        assert.ok(elements(changed).some(e => e.text === '188灵玉'));
        assert.ok(elements(changed).some(e => e.itemPreview?.itemIndex === 1928));
        assert.deepEqual(changed.previewInputs.map(i => i.name), inputs, 'derived/helper variables must stay private');
        assert.deepEqual(elements(model({})), elements(initial));
      }
      evidence.push({ file, sha256: hashes[index], inputs, elements: elements(initial).length });
    }
  } finally {
    resolver.dispose(); assert.deepEqual(files.map(digest), hashes, 'source scripts and global INI must stay byte-identical');
  }
  console.log(JSON.stringify({ engine, evidence, iniSha256: hashes[2], sourceUnchanged: true, layer: 'real file + resolver + parser; not hydrated pixels' }, null, 2));
  console.log('preview-user-sword-real.test.js: PASS defaults, GOTO, equipment transition, reset and unchanged sources');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
