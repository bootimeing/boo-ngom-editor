// Optional read-only probe of the user's named server. Never part of portable CI.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(root, 'out/utils/script-data-resolver'));
const { parse, visible } = require('./preview-inputs-integration.test');

async function main() {
  const file = process.env.BOO_GEE_EQUIPMENT_SOURCE;
  const db = process.env.BOO_GEE_EQUIPMENT_DB;
  assert.ok(file && db, 'Explicit BOO_GEE_EQUIPMENT_SOURCE and BOO_GEE_EQUIPMENT_DB are required');
  const pattern = process.env.BOO_GEE_EQUIPMENT_PATTERN || '戒指';
  const item = process.env.BOO_GEE_EQUIPMENT_ITEM || '传送戒指[限时]';
  assert.ok(!/[<>$"\r\n\x00]/.test(pattern) && !/\s/.test(pattern), 'probe requires a literal one-token pattern');
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const before = [file, db].map(hash), resolver = new ScriptDataResolver();
  try {
    let start = performance.now();
    await resolver.prepareFor(file, 'GEE');
    const prepareMs = performance.now() - start, options = resolver.optionsFor(file, 'GEE');
    start = performance.now();
    const candidates = options.resolvePreviewEquipmentMatches(pattern);
    const coldMs = performance.now() - start;
    start = performance.now();
    for (let i = 0; i < 100; i++) options.resolvePreviewEquipmentMatches(pattern);
    const warmMeanMs = (performance.now() - start) / 100;
    assert.ok(candidates?.includes(item), 'real catalog missing the selected example');
    const source = `[@main]\n#IF\nCHECKITEMW ${pattern} 2 1\n#SAY\n<TEXT:已满足两件:20:20>\n#ELSESAY\n<TEXT:未满足两件:20:20>`;
    const identity = `WORN(${item.replace(/[a-z]/g, char => char.toUpperCase())})`;
    const model = parse(source, { [identity]: '2' }, 'GEE', { dataOptions: options });
    assert.equal(visible(model), '已满足两件');
    assert.equal(model.previewInputs.filter(input => input.scenario !== 'equipment-layout').length, candidates.length);
    console.log(JSON.stringify({ file, db, sha256: before, candidateCount: candidates.length,
      modelInputs: model.previewInputs.length, visible: visible(model), prepareMs, coldMs, warmMeanMs }, null, 2));
  } finally {
    resolver.dispose();
    assert.deepEqual([file, db].map(hash), before, 'real source/database bytes must remain unchanged');
  }
  console.log('preview-gee-equipment-real.test.js: PASS read-only DB/catalog/model; not native VS Code or client pixels');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
