const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const iconv = require('iconv-lite');
const { parse, visible } = require('./preview-inputs-integration.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(root, 'out/utils/script-data-resolver'));
const { applyPreviewInputValue, evaluatePreviewCondition, discoverPreviewInputs, validPreviewValue } = require(path.join(root, 'out/ui-dialog/preview-inputs'));
// Legacy scalar controls remain unchanged beside the separately tested layout editor.
const simpleInputs = model => model.previewInputs.filter(input => input.scenario !== 'equipment-layout');
const quantitySource = [
  '[@main]', '#IF', 'CHECKITEMW 戒指甲 2 0', '#SAY', '<TEXT:双件达标:20:20>', '#ELSESAY', '<TEXT:不足双件:20:20>',
  '#IF', 'CHECKITEMW 戒指甲 1', '#SAY', '<TEXT:至少一件:20:50>',
  '#IF', 'NOT CHECKITEMW 戒指甲 2', '#SAY', '<TEXT:双件未达标:20:80>',
  '#IF', 'CHECKITEMW 戒指甲 0', '#SAY', '<TEXT:确实穿戴:20:110>',
].join('\n');
const caseSource = [
  '[@main]', '#IF', 'CHECKITEMW Blade 2', '#SAY', '<TEXT:大写双件:20:20>',
  '#IF', 'CHECKITEMW bLaDe 1', '#SAY', '<TEXT:混写单件:20:50>',
  '#IF', 'NOT CHECKITEMW blade 2 0', '#SAY', '<TEXT:未满双件:20:80>',
  '#IF', 'CHECKITEMW AXE', '#SAY', '<TEXT:另一武器:20:110>',
].join('\n');
const partialSource = [
  '[@main]', '#IF', 'CHECKITEMW 戒指 2 1', '#SAY', '<TEXT:部分匹配达标:20:20>', '#ELSESAY', '<TEXT:部分匹配不足:20:20>',
  '#IF', 'CHECKITEMW 戒指甲', '#SAY', '<TEXT:甲已穿戴:20:50>',
  '#IF', 'NOT CHECKITEMW 戒指 2 1', '#SAY', '<TEXT:反向成立:20:80>',
].join('\n');
const dynamicQuantitySource = [
  '[@main]', '#ACT', 'GOTO @获取数量',
  '#IF', 'CHECKITEMW 戒指甲 <$STR(N$需要)>', '#SAY', '<TEXT:变量数量达标:20:20>', '#ELSESAY', '<TEXT:变量数量不足:20:20>',
  '#IF', 'NOT CHECKITEMW 戒指甲 <$STR(N$需要)>', '#SAY', '<TEXT:变量反向成立:20:50>',
  '[@获取数量]', '#ACT', 'MOV N$需要 U101', 'INC N$需要 1',
].join('\n');
const heroSource = [
  '[@main]', '#IF', 'CHECKITEMW 金刚', '#SAY', '<TEXT:玩家金刚:20:20>',
  '#IF', 'H.CHECKITEMW 金刚', '#SAY', '<TEXT:英雄金刚:20:50>',
  '#IF', 'HERO.CHECKITEMW 泰阿', '#SAY', '<TEXT:英雄泰阿:20:80>',
  '#IF', 'NOT H.CHECKITEMW 金刚', '#SAY', '<TEXT:英雄未穿金刚:20:110>',
].join('\n');
const bareMovSource = [
  '[@main]', '#ACT', 'GOTO @复制变量', '#SAY',
  '<TEXT:裸数量=<$STR(N$副本)>:20:20>', '<TEXT:裸文字=<$STR(S$副本)>:20:50>',
  '[@复制变量]', '#ACT', 'MOV N$结果 U101', 'MOV N$副本 N$结果',
  'MOV S$结果 A201', 'MOV S$副本 S$结果',
].join('\n');
const thresholdBoundarySource = [
  '[@main]', '#IF(0)', 'CHECK [101] 1', 'CHECK [102] 1', '#SAY', '<TEXT:零阈值通过:20:20>', '#ELSESAY', '<TEXT:零阈值未通过:20:20>',
  '#IF(3)', 'CHECK [101] 1', 'CHECK [102] 1', '#SAY', '<TEXT:超阈值通过:20:50>', '#ELSESAY', '<TEXT:超阈值未通过:20:50>',
  '#IF(2)', '#OR', 'CHECK [101] 1', 'CHECK [102] 1', '#SAY', '<TEXT:或条件通过:20:80>', '#ELSESAY', '<TEXT:或条件未通过:20:80>',
].join('\n');
const dynamicModeSource = [
  '[@main]', '#ACT', 'GOTO @匹配模式',
  '#IF', 'CHECKITEMW 戒指 2 <$STR(N$模式)>', '#SAY', '<TEXT:模式匹配成功:20:20>', '#ELSESAY', '<TEXT:模式匹配不足:20:20>',
  '#IF', 'NOT CHECKITEMW 戒指 2 U102', '#SAY', '<TEXT:模式反向成立:20:50>',
  '[@匹配模式]', '#ACT', 'MOV N$模式 U102',
].join('\n');
const source = [
  '[@main]', '#ACT', 'GOTO @获取数据', '#SAY', '<TEXT:数量=<$STR(N$结果)>:20:20>',
  '#IF', 'EQUAL A201', '#SAY', '<TEXT:暂无玩家:20:50>', '#ELSESAY', '<TEXT:玩家=<$STR(A201)>:20:50>',
  '#IF(1)', 'CHECKITEMW 金刚 1 0', 'CHECKITEMW 泰阿', '#SAY', '<TEXT:已穿戴武器:20:80>', '#ELSESAY', '<TEXT:未穿戴武器:20:80>',
  '#IF', 'NOT CHECKITEMW 金刚 1', '#SAY', '<TEXT:未穿金刚:20:110>',
  '#IF', 'CHECKITEMW 戒指甲', 'CHECKITEMW 戒指乙', '#SAY', '<TEXT:双戒指:20:140>',
  '[@获取数据]', '#ACT', 'MOV N$结果 <$STR(G201)>', 'INC N$结果 2',
  '[@未点击的业务]', '#ACT', 'INC G202 1',
].join('\n');

async function fixture(extraItems = []) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gee-inputs-'));
  const resolver = new ScriptDataResolver();
  try {
    const file = path.join(temp, 'Mir200/Envir/Market_Def/神器.txt');
    const ini = path.join(temp, 'Mir200/GlobalVal.ini'), db = path.join(temp, 'MUD2/db/items.db');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.writeFileSync(file, iconv.encode(source, 'gbk'));
    fs.writeFileSync(ini, iconv.encode('[Setup]\r\nGlobalVal201=40\r\nGlobalStrVal201=\r\nGlobalVal202=999\r\n', 'gbk'));
    const SQL = await require(require.resolve('sql.js', { paths: [root] }))(), d = new SQL.Database();
    d.run('CREATE TABLE StdItems (Idx INTEGER,Name TEXT,StdMode INTEGER)');
    [['金刚', 5], ['泰阿', 6], ['戒指甲', 22], ['戒指乙', 23], ['盾牌', 12], ['GOM盾牌', 48],
      ['宝石94', 94], ['多部位7', 7], ['多部位25', 25], ['多部位28', 28], ['时装', 66], ['灵玉', 90], ['Blade', 5], ['Axe', 6]]
      .concat(extraItems).forEach(([name, mode], i) => d.run('INSERT INTO StdItems VALUES(?,?,?)', [i, name, mode]));
    fs.writeFileSync(db, Buffer.from(d.export())); d.close();
    await resolver.prepareFor(file, 'GEE');
    const options = resolver.optionsFor(file, 'GEE');
    return { temp, resolver, file, ini, db, options,
      model: (values = {}, script = source) => parse(script, values, 'GEE', { dataOptions: options }),
      cleanup: () => { resolver.dispose(); removeTemporaryDirectory(temp); } };
  } catch (e) { resolver.dispose(); removeTemporaryDirectory(temp); throw e; }
}

async function main() {
  const f = await fixture();
  try {
    const before = [f.file, f.ini, f.db].map(x => fs.readFileSync(x));
    const modeExact=f.model({},dynamicModeSource);
    assert.deepEqual(simpleInputs(modeExact).map(x=>x.name).sort(),['U102','WORN(戒指)']);
    const modePartial=f.model({U102:'1','WORN(戒指甲)':'2'},dynamicModeSource);
    assert.ok(visible(modePartial).includes('模式匹配成功')&&!visible(modePartial).includes('模式反向成立'),visible(modePartial));
    assert.deepEqual(simpleInputs(modePartial).map(x=>x.name).sort(),['U102','WORN(戒指乙)','WORN(戒指甲)'].sort());
    assert.ok(!visible(f.model({U102:'0','WORN(戒指甲)':'2'},dynamicModeSource)).includes('模式匹配成功'));
    assert.ok(visible(f.model({U102:'-1','WORN(戒指甲)':'2'},dynamicModeSource)).includes('模式匹配成功'));
    for (const invalid of ['1.5','2147483648','NaN','预览文字']) {
      assert.equal(evaluatePreviewCondition('NOT CHECKITEMW 戒指 2 U102', n=>n==='U102'?invalid:'2','GEE',f.options),undefined);
    }
    for (const engine of ['GOM','996PC']) {
      assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 2 U102',()=> '1',engine,f.options),undefined);
    }
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 1 +0',()=> '1','GEE',f.options),true);
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 2 U102',n=>n==='U102'?'1':'2','GEE'),undefined,'partial still requires a complete database');
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 2 U102',n=>n==='U102'?'0':'2','GEE'),true,'exact mode must not require a partial-match database');
    const heroMode=dynamicModeSource.replaceAll('CHECKITEMW','H.CHECKITEMW');
    assert.ok(visible(f.model({U102:'1','HERO(PRESENT)':'1','H.WORN(戒指甲)':'2'},heroMode)).includes('模式匹配成功'));
    assert.ok(!visible(f.model({U102:'1','HERO(PRESENT)':'1','WORN(戒指甲)':'2'},heroMode)).includes('模式匹配成功'));
    const missingHeroEffects={};
    assert.equal(evaluatePreviewCondition('NOT H.CHECKITEMW 戒指 2 U102',n=>n==='HERO(PRESENT)'?'0':'bad','GEE',f.options,missingHeroEffects),true);
    assert.equal(missingHeroEffects.heroAbsent,true,'missing hero terminates before invalid parameter use');
    assert.equal(evaluatePreviewCondition('NOT H.CHECKITEMW 戒指 2 U102',n=>n==='HERO(PRESENT)'?'1':'bad','GEE',f.options),undefined);
    const modeSnapshots='[@main]\n#ACT\nMOV U102 0\n#IF\nCHECKITEMW 戒指 2 U102\n#SAY\n<TEXT:前全名:20:20>\n#ACT\nMOV U102 1\n#IF\nCHECKITEMW 戒指 2 U102\n#SAY\n<TEXT:后部分:20:50>';
    const modeSnapshotModel=f.model({'WORN(戒指)':'2'},modeSnapshots);
    assert.ok(visible(modeSnapshotModel).includes('前全名')&&!visible(modeSnapshotModel).includes('后部分'));
    assert.ok(!modeSnapshotModel.previewInputs.some(x=>x.name==='U102'),'source-owned mode must not expose ineffective inputs');
    for (const [a,b] of [[0,0],[1,0],[0,1],[1,1]]) {
      const m=f.model({'[101]':String(a),'[102]':String(b)},thresholdBoundarySource), shown=visible(m);
      assert.equal(shown.includes('零阈值通过'),!!(a&&b),shown);
      assert.equal(shown.includes('超阈值通过'),!!(a&&b),shown);
      assert.equal(shown.includes('或条件通过'),!!(a||b),shown);
      assert.ok(m.conditionGroups.every(g=>g.requiredCount===undefined),'normalized group must not advertise an ignored threshold');
      assert.ok(m.scenes.every(s=>s.requiredCount===undefined),'scene text must match effective AND/OR semantics');
    }
    const bare = f.model({ U101: '42', A201: '测试文字' }, bareMovSource);
    assert.ok(visible(bare).includes('裸数量=42') && visible(bare).includes('裸文字=测试文字'), visible(bare));
    assert.deepEqual(bare.previewInputs.map(x => x.name).sort(), ['A201', 'U101']);
    assert.ok(visible(f.model({}, bareMovSource)).includes('裸数量=0'));
    const replaced = bareMovSource.replace('MOV N$副本 N$结果', 'MOV N$副本 N$结果\nMOV N$副本 7');
    assert.ok(visible(f.model({ U101: '42' }, replaced)).includes('裸数量=7'));
    assert.ok(!f.model({ U101: '42' }, replaced).previewInputs.some(x => x.name === 'U101'));
    for (const literal of ['U101', '<$STR(U101)>', '<TEXT:伪造:10:10>/@attack|tip', '甲:乙;丙']) {
      const copied = f.model({ U101: '42', A201: literal }, bareMovSource);
      assert.ok(visible(copied).includes('裸文字=' + literal), visible(copied));
      assert.equal(copied.pages.flatMap(p => p.elements).filter(e => e.kind === 'text').length, 2);
    }
    const staticCopy = '[@main]\n#ACT\nMOV U101 42\nMOV N$结果 u101\n#SAY\n<TEXT:静态=<$STR(N$结果)>:20:20>';
    assert.ok(visible(f.model({}, staticCopy)).includes('静态=42'));
    assert.equal(f.model({}, staticCopy).previewInputs.length, 0);
    assert.ok(visible(parse(staticCopy, {}, 'GEE', { previewValues: undefined })).includes('静态=42'));
    const sourceMarkup = '[@main]\n#ACT\nMOV S$原文 <TEXT:源码标签:20:20>\nMOV S$副本 S$原文\n#SAY\n<$STR(S$副本)>';
    assert.ok(visible(f.model({}, sourceMarkup)).includes('源码标签'));
    const localDefault = parse(bareMovSource, {}, 'GEE');
    assert.ok(visible(localDefault).includes('裸文字=预览文字'));
    const snapshotsCopy = staticCopy + '\n#ACT\nMOV U101 7\nMOV N$结果 U101\n#SAY\n<TEXT:之后=<$STR(N$结果)>:20:50>';
    assert.ok(visible(f.model({}, snapshotsCopy)).includes('静态=42') && visible(f.model({}, snapshotsCopy)).includes('之后=7'));
    for (const engine of ['GOM', '996PC']) {
      const isolated = parse('[@main]\n#ACT\nMOV S$副本 A201\n#SAY\n<TEXT:值=<$STR(S$副本)>:20:20>', { A201: '隔离' }, engine);
      assert.ok(!visible(isolated).includes('值=隔离'), 'do not silently extend GEE bare-copy semantics to ' + engine);
    }
    const idxSource = '[@main]\n#ACT\nGETDBITEMFIELDVALUE 戒指甲 IDX N$原IDX\nMOV N$副本 N$原IDX\n#SAY\n<TEXT:IDX=<$STR(N$副本)>:20:20>\n<&ITEMSHOW:<$STR(N$副本)>:1:20:50:48>';
    const idxOptions = { dataOptions: { resolveDatabaseField: () => ({ value: '935', complete: true }) } };
    const directIdx = parse(idxSource.replace('MOV N$副本 N$原IDX', '').replaceAll('N$副本', 'N$原IDX'), {}, 'GEE', idxOptions);
    const copiedIdx = parse(idxSource, {}, 'GEE', idxOptions);
    assert.equal(directIdx.pages.flatMap(p=>p.elements).find(e=>e.itemPreview)?.itemPreview.itemIndex, 935);
    assert.ok(visible(copiedIdx).includes('IDX=935'));
    assert.equal(copiedIdx.pages.flatMap(p=>p.elements).find(e=>e.itemPreview)?.itemPreview.itemIndex, undefined);
    assert.equal(copiedIdx.pages.flatMap(p=>p.resolvedVariables).find(v=>v.name==='N$副本')?.staticValueSource, undefined);
    const runtimeOverwrite = idxSource.replace('MOV N$副本 N$原IDX', 'MOV N$原IDX U101\nMOV N$副本 N$原IDX');
    const runtimeIdx = parse(runtimeOverwrite, { U101: '9' }, 'GEE', idxOptions);
    assert.ok(visible(runtimeIdx).includes('IDX=9'));
    assert.equal(runtimeIdx.pages.flatMap(p=>p.elements).find(e=>e.itemPreview)?.itemPreview.itemIndex, undefined);
    assert.deepEqual(f.options.resolvePreviewGlobalValues(), { G201: '40', A201: '', G202: '999' });
    const initial = f.model();
    assert.ok(visible(initial).includes('数量=42') && visible(initial).includes('暂无玩家'));
    assert.deepEqual(simpleInputs(initial).map(x => x.name).sort(), ['A201', 'G201', 'WORN(金刚)', 'WORN(泰阿)', 'WORN(戒指甲)', 'WORN(戒指乙)'].sort());
    assert.equal(initial.previewInputs.find(x => x.name === 'A201').kind, 'text');
    assert.equal(initial.previewInputs.find(x => x.name === 'G201').value, '40');
    const changed = f.model({ A201: '临时玩家', G201: '100', 'WORN(金刚)': '1' });
    assert.ok(visible(changed).includes('数量=102') && visible(changed).includes('玩家=临时玩家') && visible(changed).includes('已穿戴武器'));
    assert.ok(!visible(changed).includes('未穿金刚'));
    assert.equal(changed.conditionGroups[1].requiredCount, 1);
    const thresholdSource = '[@main]\n#IF(2)\nCHECKITEMW 金刚\nCHECKITEMW 戒指甲\n#ACT\nMOV G201 88\n#SAY\n<TEXT:达标=<$STR(G201)>:20:20>\n#ELSESAY\n<TEXT:未达标:20:20>';
    assert.ok(visible(f.model({ 'WORN(金刚)': '1' }, thresholdSource)).includes('未达标'));
    assert.ok(visible(f.model({ 'WORN(金刚)': '1', 'WORN(戒指甲)': '1' }, thresholdSource)).includes('达标=88'));
    const slots = f.options.resolvePreviewEquipmentSlot;
    assert.deepEqual(slots('金刚'), { key: 'GEE:1', label: '武器' });
    assert.equal(slots('泰阿').key, slots('金刚').key);
    assert.equal(slots('盾牌').key, 'GEE:16');
    assert.equal(slots('GOM盾牌'), undefined);
    assert.equal(slots('宝石94').key, 'GEE:12');
    assert.equal(slots('时装').key, 'GEE:18');
    assert.equal(slots('灵玉').key, 'GEE:17');
    for (const name of ['戒指甲', '戒指乙', '多部位7', '多部位25', '多部位28']) assert.equal(slots(name), undefined, name);
    let values = { 'WORN(金刚)': '1' };
    values = applyPreviewInputValue(initial.previewInputs, values, initial.previewInputs.find(x => x.name === 'WORN(泰阿)'), '1', slots);
    assert.equal(values['WORN(金刚)'], '0');
    assert.ok(visible(f.model({ 'WORN(戒指甲)': '1', 'WORN(戒指乙)': '1' })).includes('双戒指'));
    assert.ok(visible(f.model()).includes('数量=42'));
    assert.ok(visible(f.model({ G201: '0', A201: '' })).includes('数量=2'));
    assert.ok(visible(f.model({ A201: '本地' }, source.replace('INC N$结果 2', 'INC N$结果 2\nMOV A201 源码值'))).includes('玩家=源码值'));
    assert.deepEqual(f.resolver.optionsFor(f.file, '996PC').resolvePreviewGlobalValues(), {});
    const quantity = f.model({}, quantitySource);
    const caseModel = f.model({ 'WORN(Blade)': '2' }, caseSource);
    assert.equal(simpleInputs(caseModel).length, 2, 'ASCII case aliases must not create duplicate inputs');
    const blade = caseModel.previewInputs.find(x => x.name === 'WORN(BLADE)');
    assert.equal(blade.kind, 'number'); assert.equal(blade.equipmentName, 'Blade');
    assert.equal(blade.equipmentSlot?.key, 'GEE:1', 'folded identity must not break database slot lookup');
    assert.equal(f.options.resolveDatabaseField({ itemName: 'BLADE', field: 'StdMode' }), undefined, 'equipment folding must not broaden generic database authority');
    assert.ok(visible(caseModel).includes('大写双件') && visible(caseModel).includes('混写单件'));
    assert.ok(!visible(caseModel).includes('未满双件'));
    const conflict = f.model({ 'WORN(BLADE)': '2', 'WORN(blade)': '0' }, caseSource);
    assert.ok(visible(conflict).includes('未满双件') && !visible(conflict).includes('混写单件'), 'last restored alias wins');
    const cleared = applyPreviewInputValue(caseModel.previewInputs, { 'WORN(Blade)': '2', 'WORN(bLaDe)': '3' }, blade, null, f.options.resolvePreviewEquipmentSlot);
    assert.deepEqual(cleared, {}, 'reset must remove aliases, not resurrect old values');
    const hiddenPeer = applyPreviewInputValue([blade], { 'WORN(axe)': '1' }, blade, '2', f.options.resolvePreviewEquipmentSlot);
    assert.equal(hiddenPeer['WORN(AXE)'], '0'); assert.equal(hiddenPeer['WORN(BLADE)'], '2');
    const gomCase = discoverPreviewInputs('#IF\nCHECKITEMW Blade\nCHECKITEMW blade', {}, 'GOM');
    assert.equal(gomCase.length, 2, 'do not extend GEE evidence into GOM');
    const partial = f.model({}, partialSource);
    assert.deepEqual(simpleInputs(partial).map(x => [x.name, x.kind]), [['WORN(戒指甲)', 'number'], ['WORN(戒指乙)', 'number']], 'partial check must expose actual matching items');
    const twoDifferent = f.model({ 'WORN(戒指甲)': '1', 'WORN(戒指乙)': '1' }, partialSource);
    assert.ok(visible(twoDifferent).includes('部分匹配达标') && visible(twoDifferent).includes('甲已穿戴'));
    assert.ok(!visible(twoDifferent).includes('反向成立'));
    assert.ok(visible(f.model({ 'WORN(戒指乙)': '2' }, partialSource)).includes('部分匹配达标'));
    assert.ok(!visible(f.model({ 'WORN(戒指乙)': '2' }, partialSource)).includes('甲已穿戴'));
    assert.equal(simpleInputs(f.model({ 'WORN(戒指甲)': '2' }, partialSource)).length, 2, 'successful threshold must retain later candidate dependencies');
    assert.equal(evaluatePreviewCondition('CHECKITEMW Bla 1 1', name => name === 'WORN(BLADE)' ? '1' : '0', 'GEE', f.options), true);
    assert.equal(evaluatePreviewCondition('CHECKITEMW bla 1 1', () => '1', 'GEE', f.options), false, 'partial Pos is case-sensitive');
    assert.equal(evaluatePreviewCondition('NOT CHECKITEMW Bla 1 1', () => '1', 'GEE'), undefined, 'missing database stays unknown under NOT');
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 2 1', () => 'NaN', 'GEE', f.options), undefined);
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 2 1', () => '1', 'GOM', f.options), undefined);
    const dynamic = f.model({ U101: '1', 'WORN(戒指甲)': '2' }, dynamicQuantitySource);
    assert.ok(visible(f.model({ U101: '1', 'WORN(戒指甲)': '2' }, dynamicQuantitySource.replace('MOV N$需要 U101', 'MOV N$需要 <$STR(U101)>'))).includes('变量数量达标'));
    assert.ok(visible(dynamic).includes('变量数量达标') && !visible(dynamic).includes('变量反向成立'));
    assert.deepEqual(simpleInputs(dynamic).map(x => [x.name, x.kind]).sort(), [['U101', 'number'], ['WORN(戒指甲)', 'number']].sort());
    assert.ok(visible(f.model({ U101: '2', 'WORN(戒指甲)': '2' }, dynamicQuantitySource)).includes('变量数量不足'));
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 U101', name => name === 'U101' ? '3' : '2', 'GEE'), false);
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指 <$STR(U101)> 1', name => name === 'U101' ? '3' : '2', 'GEE', f.options), true);
    for (const value of ['2.5', '2147483648', 'NaN', '预览文字']) {
      assert.equal(evaluatePreviewCondition('NOT CHECKITEMW 戒指甲 <$STR(U101)>', name => name === 'U101' ? value : '2', 'GEE'), undefined);
    }
    const snapshots = '[@main]\n#ACT\nMOV U101 1\n#IF\nCHECKITEMW 戒指甲 U101\n#SAY\n<TEXT:前达标:20:20>\n#ACT\nMOV U101 3\n#IF\nCHECKITEMW 戒指甲 U101\n#SAY\n<TEXT:后达标:20:40>\n#ELSESAY\n<TEXT:后不足:20:40>';
    const snapshotText = visible(f.model({ U101: '99', 'WORN(戒指甲)': '2' }, snapshots));
    assert.ok(snapshotText.includes('前达标') && snapshotText.includes('后不足') && !snapshotText.includes('后达标'));
    const hero = f.model({ 'HERO(PRESENT)': '1', 'WORN(金刚)': '1', 'H.WORN(泰阿)': '1' }, heroSource);
    assert.deepEqual(simpleInputs(hero).map(x=>x.name).sort(), ['HERO(PRESENT)', 'WORN(金刚)', 'H.WORN(金刚)', 'H.WORN(泰阿)'].sort());
    assert.ok(visible(hero).includes('玩家金刚') && visible(hero).includes('英雄泰阿') && !visible(hero).includes('英雄金刚'));
    const heroBlade = hero.previewInputs.find(x=>x.name==='H.WORN(金刚)');
    assert.equal(heroBlade.equipmentSlot.key,'H:GEE:1');
    let heroValues = applyPreviewInputValue(hero.previewInputs, { 'HERO(PRESENT)': '1', 'WORN(泰阿)': '1', 'H.WORN(泰阿)': '1' }, heroBlade, '1', slots);
    assert.equal(heroValues['WORN(泰阿)'], '1'); assert.equal(heroValues['H.WORN(泰阿)'], '0');
    const absent = f.model({ ...heroValues, 'HERO(PRESENT)': '0' }, heroSource);
    assert.ok(!visible(absent).includes('英雄金刚') && visible(absent).includes('英雄未穿金刚'));
    const group = (header, conditions) => `[@main]\n${header}\n${conditions.join('\n')}\n#SAY\n<TEXT:组成立:20:20>\n#ELSESAY\n<TEXT:组未成立:20:20>`;
    // Missing hero terminates the group; a threshold counts only preceding true predicates.
    assert.ok(visible(f.model({}, group('#IF', ['NOT H.CHECKITEMW 金刚', 'CHECK [101] 1']))).includes('组成立'));
    assert.ok(visible(f.model({}, group('#IF', ['CHECK [101] 1', 'NOT H.CHECKITEMW 金刚']))).includes('组未成立'));
    assert.ok(visible(f.model({}, group('#IF(1)', ['NOT H.CHECKITEMW 金刚', 'CHECK [101] 0']))).includes('组未成立'));
    assert.ok(visible(f.model({}, group('#IF(1)', ['CHECK [101] 0', 'H.CHECKITEMW 金刚']))).includes('组成立'));
    assert.ok(visible(f.model({}, group('#IF\n#OR', ['H.CHECKITEMW 金刚', 'CHECK [101] 0']))).includes('组未成立'));
    assert.ok(visible(f.model({}, group('#IF\n#OR', ['CHECK [101] 0', 'H.CHECKITEMW 金刚']))).includes('组成立'));
    assert.ok(visible(f.model({}, group('#IF(2)', ['NOT H.CHECKITEMW 金刚', 'CHECK [101] 1']))).includes('组成立'), 'threshold equal to group size uses ordinary AND in reference engine');
    const heroDynamic = dynamicQuantitySource.replaceAll('CHECKITEMW', 'H.CHECKITEMW');
    assert.ok(visible(f.model({ 'HERO(PRESENT)': '1', 'H.WORN(戒指甲)': '2', U101: '1' }, heroDynamic)).includes('变量数量达标'));
    assert.ok(visible(f.model({ 'HERO(PRESENT)': '1', 'H.WORN(戒指甲)': '2', U101: '2' }, heroDynamic)).includes('变量数量不足'));
    for (const engine of ['GOM','996PC']) assert.equal(evaluatePreviewCondition('H.CHECKITEMW 金刚', ()=>'1', engine),undefined);
    assert.equal(evaluatePreviewCondition('NOT H.CHECKITEMW 金刚', name=>name==='HERO(PRESENT)'?'bad':'1','GEE'),undefined);
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 -1', ()=>'1','GEE'),true);
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 -1', ()=>'0','GEE'),false);
    const hiddenHeroPeer=applyPreviewInputValue([heroBlade], {'H.WORN(泰阿)':'1','WORN(泰阿)':'1'},heroBlade,'1',slots);
    assert.equal(hiddenHeroPeer['H.WORN(泰阿)'],'0');assert.equal(hiddenHeroPeer['WORN(泰阿)'],'1');
    const heroPartial = partialSource.replaceAll('CHECKITEMW', 'H.CHECKITEMW');
    assert.ok(visible(f.model({ 'HERO(PRESENT)': '1', 'H.WORN(戒指甲)': '1', 'H.WORN(戒指乙)': '1' }, heroPartial)).includes('部分匹配达标'));
    assert.ok(!visible(f.model({ 'HERO(PRESENT)': '1', 'WORN(戒指甲)': '2' }, heroPartial)).includes('部分匹配达标'));
    assert.deepEqual(simpleInputs(quantity).map(x => [x.name, x.kind]), [['WORN(戒指甲)', 'number']]);
    const countInput = simpleInputs(quantity)[0];
    for (const value of ['-1', '1.5', 'NaN', 'Infinity', '2147483648', '1e2']) assert.equal(validPreviewValue(countInput, value), false);
    for (const value of ['0', '1', '2', '3', '2147483647']) assert.equal(validPreviewValue(countInput, value), true);
    for (const count of [0, 1, 2, 3]) {
      const text = visible(f.model({ 'WORN(戒指甲)': String(count) }, quantitySource));
      assert.equal(text.includes('双件达标'), count >= 2);
      assert.equal(text.includes('双件未达标'), count < 2);
      assert.equal(text.includes('至少一件'), count >= 1);
      assert.equal(text.includes('确实穿戴'), count >= 1, 'zero threshold still requires an existing item');
    }
    for (const script of ['#IF\nCHECKITEMW 戒指甲 2\nCHECKITEMW 戒指甲', '#IF\nCHECKITEMW 戒指甲\nCHECKITEMW 戒指甲 2']) {
      const inputs = discoverPreviewInputs(script, { 'WORN(戒指甲)': '2' }, 'GEE').filter(input => input.scenario !== 'equipment-layout');
      assert.equal(inputs.length, 1); assert.equal(inputs[0].kind, 'number'); assert.equal(inputs[0].value, '2');
    }
    const weapons = discoverPreviewInputs('#IF\nCHECKITEMW 金刚 2\nCHECKITEMW 泰阿 2', {}, 'GEE', f.options);
    const peerValues = applyPreviewInputValue(weapons, { 'WORN(金刚)': '2', 'WORN(戒指甲)': '2' }, weapons.find(x => x.name === 'WORN(泰阿)'), '3', slots);
    assert.equal(peerValues['WORN(金刚)'], '0'); assert.equal(peerValues['WORN(戒指甲)'], '2');
    const weaponSource = '[@main]\n#IF\nCHECKITEMW 金刚 2\n#SAY\n<TEXT:金刚达标:20:20>\n#IF\nCHECKITEMW 泰阿 2\n#SAY\n<TEXT:泰阿达标:20:40>';
    const normalizedWeapons = f.model({ 'WORN(金刚)': '2', 'WORN(泰阿)': '3' }, weaponSource);
    assert.ok(!visible(normalizedWeapons).includes('金刚达标') && visible(normalizedWeapons).includes('泰阿达标'));
    assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 2', () => '3', 'GEE'), true);
    assert.equal(evaluatePreviewCondition('NOT CHECKITEMW 戒指甲 2', () => 'NaN', 'GEE'), undefined);
    for (const engine of ['GOM', '996PC']) assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指甲 2', () => '3', engine), undefined);
    for (const condition of ['CHECKITEMW 金刚 1 1', 'H.H.CHECKITEMW 金刚 1', 'CHECKITEMW 金刚 2.5', 'CHECKITEMW 金刚 runtime']) {
      assert.equal(evaluatePreviewCondition(condition, () => '1', 'GEE'), undefined, 'unimplemented overload must remain unknown');
    }
    const partSource = '[@main]\n#IF\nCHECKITEMW [NECKLACE]\n#SAY\n<TEXT:项链部位:20:20>\n#IF\nCHECKITEMW [RING]\n#SAY\n<TEXT:戒指部位:20:50>\n#IF\nH.CHECKITEMW [HELMET]\n#SAY\n<TEXT:英雄头盔:20:80>';
    const partInputs = discoverPreviewInputs(partSource, {}, 'GEE');
    assert.deepEqual(partInputs.filter(input => input.scenario !== 'equipment-layout').map(x => x.name).sort(), ['HERO(PRESENT)', 'H.WORN([HELMET])', 'WORN([NECKLACE])', 'WORN([RING])'].sort());
    assert.equal(partInputs.find(x => x.name === 'WORN([NECKLACE])').equipmentSlot.key, 'GEE:3');
    assert.equal(partInputs.find(x => x.name === 'WORN([RING])').equipmentSlot, undefined, 'paired ring slots must not be made single-choice');
    assert.equal(partInputs.find(x => x.name === 'H.WORN([HELMET])').equipmentSlot.key, 'H:GEE:4');
    assert.equal(evaluatePreviewCondition('CHECKITEMW [NECKLACE]', n => n === 'WORN([NECKLACE])' ? '1' : '0', 'GEE'), true);
    assert.equal(evaluatePreviewCondition('NOT CHECKITEMW [RING]', n => n === 'WORN([RING])' ? '1' : '0', 'GEE'), false);
    const gomBracket = discoverPreviewInputs('#IF\nCHECKITEMW [NECKLACE]', {}, 'GOM')[0];
    assert.ok(gomBracket && !gomBracket.equipmentPart, 'GXX slot selector metadata must not leak to GOM item-name parsing');
    let partValues = applyPreviewInputValue(partInputs, { 'WORN(金刚)': '1' }, partInputs.find(x => x.name === 'WORN([NECKLACE])'), '1', f.options.resolvePreviewEquipmentSlot);
    assert.equal(partValues['WORN([NECKLACE])'], '1');
    assert.equal(partValues['WORN(金刚)'], '1', 'different slot state must remain independent');
    const dynamicNameSource = '[@main]\n#IF\nCHECKITEMW <$STR(S$名称)>\n#SAY\n<TEXT:动态装备满足:20:20>\n#ELSESAY\n<TEXT:动态装备未满足:20:20>';
    const dynamicName = f.model({}, dynamicNameSource);
    assert.deepEqual(simpleInputs(dynamicName).map(x => x.name).sort(), ['S$名称', 'WORN_DYNAMIC(<$STR(S$名称)>)'].sort());
    assert.equal(dynamicName.previewInputs.find(x => x.name === 'WORN_DYNAMIC(<$STR(S$名称)>)').equipmentDynamic, true);
    assert.ok(visible(dynamicName).includes('动态装备未满足'));
    const dynamicNameOn = f.model({ 'S$名称': '金刚', 'WORN_DYNAMIC(<$STR(S$名称)>)': '1' }, dynamicNameSource);
    assert.ok(visible(dynamicNameOn).includes('动态装备满足'));
    assert.equal(evaluatePreviewCondition('CHECKITEMW <$STR(S$名称)>', n => n === 'WORN_DYNAMIC(<$STR(S$名称)>)' ? '1' : '金刚', 'GEE'), true);
    assert.ok(!discoverPreviewInputs('#IF\nCHECKITEMW <$STR(S$名称)>', {}, 'GOM').some(x => x.name.startsWith('WORN_DYNAMIC(')), 'dynamic GEE name surface must not leak to GOM');
    [f.file, f.ini, f.db].forEach((x, i) => assert.deepEqual(fs.readFileSync(x), before[i]));
    fs.writeFileSync(f.ini, iconv.encode('[Setup]\nGlobalVal0=0\nGlobalVal999=2147483647\nGlobalStrVal999=中文边界\nGlobalVal1000=1\n', 'gbk'));
    assert.deepEqual(f.options.resolvePreviewGlobalValues(), { G0: '0', G999: '2147483647', A999: '中文边界' });
    fs.writeFileSync(f.ini, '[Setup]\nGlobalVal201=7\nGlobalVal0201=8\nGlobalStrVal201=');
    assert.equal(f.options.resolvePreviewGlobalValues().G201, undefined);
    fs.unlinkSync(f.ini); assert.deepEqual(f.options.resolvePreviewGlobalValues(), {});
    const bounded = await fixture([['CaseDup', 5], ['casedup', 6], ['传送戒指[限时]', 22], ...Array.from({length:129}, (_, i) => [`大量物品${i}`, 22])]);
    try {
      assert.equal(bounded.options.resolvePreviewEquipmentSlot('CASEDUP'), undefined, 'case-insensitive ambiguous DB rows cannot grant unique slot');
      assert.equal(bounded.options.resolvePreviewEquipmentMatches('Case'), undefined, 'partial cannot split a folded full-name identity');
      assert.equal(bounded.options.resolvePreviewEquipmentMatches('大量'), undefined, 'never truncate the complete candidate set');
      assert.deepEqual(new Set(bounded.options.resolvePreviewEquipmentMatches('戒指')), new Set(['戒指甲', '戒指乙', '传送戒指[限时]']));
      assert.ok(visible(bounded.model({ 'WORN(传送戒指[限时])': '1' }, '[@main]\n#IF\nCHECKITEMW 传送戒指[限时]\n#SAY\n<TEXT:限时装备:20:20>')).includes('限时装备'));
      assert.equal(evaluatePreviewCondition('CHECKITEMW 戒指[限时] 1 1', () => '1', 'GEE', bounded.options), true);
      const broken = path.join(path.dirname(bounded.db), 'broken.db');
      fs.writeFileSync(broken, 'invalid database fixture');
      await bounded.resolver.prepareFor(bounded.file, 'GEE');
      assert.equal(bounded.options.resolvePreviewEquipmentMatches('戒指'), undefined, 'one unreadable eligible DB makes the catalog incomplete');
      assert.equal(evaluatePreviewCondition('NOT CHECKITEMW 戒指 1 1', () => '0', 'GEE', bounded.options), undefined);
      fs.unlinkSync(broken);
      const SQL = await require(require.resolve('sql.js', { paths: [root] }))(), update = new SQL.Database(fs.readFileSync(bounded.db));
      update.run('INSERT INTO StdItems VALUES(99999,?,22)', ['戒指丙']);
      fs.writeFileSync(bounded.db, Buffer.from(update.export())); update.close();
      await bounded.resolver.prepareFor(bounded.file, 'GEE');
      assert.deepEqual(new Set(bounded.options.resolvePreviewEquipmentMatches('戒指')), new Set(['戒指甲', '戒指乙', '戒指丙', '传送戒指[限时]']), 'catalog cache must follow new DB content');
      assert.equal(bounded.resolver.optionsFor(bounded.file, 'GOM').resolvePreviewEquipmentMatches('戒指'), undefined);
    } finally { bounded.cleanup(); }
    console.log('preview-gee-inputs.test.js: PASS persisted globals/GOTO/inputs/reset, shared predicates, unique vs paired slots, isolation and no writes');
  } finally { f.cleanup(); }
}
module.exports = { fixture, source, quantitySource, caseSource, partialSource, dynamicQuantitySource, heroSource, bareMovSource, thresholdBoundarySource, dynamicModeSource,
  partSource: '[@main]\n#IF\nCHECKITEMW [NECKLACE]\n#SAY\n<TEXT:项链部位:20:20>\n#IF\nCHECKITEMW [RING]\n#SAY\n<TEXT:戒指部位:20:50>\n#IF\nH.CHECKITEMW [HELMET]\n#SAY\n<TEXT:英雄头盔:20:80>' };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
