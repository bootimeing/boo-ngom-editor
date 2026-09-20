const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { runtimePreviewOutputIndexes: indexes, runtimePreviewOutputFamilyIndexes: families,
  runtimePreviewImplicitOutputs: implicit } = require(path.join(runtime, 'out/ui-dialog/preview-command-outputs'));
const { discoverPreviewInputs } = require(path.join(runtime, 'out/ui-dialog/preview-inputs'));

function discovered(script, engine = 'GOM', values = {}) {
  return discoverPreviewInputs(`[@main]\n${script}`, values, engine).map(input => input.name).sort();
}

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    assert.deepEqual(indexes('GetDBMonsterFieldValue', engine), [2]);
    assert.deepEqual(indexes('GetBindMoney', engine), [1]);
    assert.deepEqual(indexes('GETRANDOMLINETEXT', engine), [1]);
    assert.deepEqual(indexes('GETSTRINGPOSEX', engine), [2, 3]);
    for (const pure of ['EQUAL', 'LARGE', 'SMALL', 'CHECKLEVEL', 'CHECKGAMEGOLD', 'RETURN', 'SENDMSG', 'UNKNOWNPLUGIN']) {
      assert.equal(indexes(pure, engine), undefined, `${engine} ${pure} cannot invalidate arbitrary inputs`);
    }
  }
  for (const engine of ['GOM', '996PC']) {
    assert.deepEqual(indexes('GETITEMNAMEBYMAKEINDEX', engine), [1]);
    assert.deepEqual(indexes('CALCPER', engine), [2]);
    assert.deepEqual(implicit('ADDMIRRORMAP', engine), ['D99']);
    assert.deepEqual(implicit('MIRRORMAPTIME', engine), ['D99']);
  }
  assert.equal(indexes('GETITEMNAMEBYMAKEINDEX', 'GEE'), undefined);
  assert.equal(indexes('CALCPER', 'GEE'), undefined);
  assert.deepEqual(indexes('CALCPERCENT', 'GEE'), [2]);
  assert.equal(indexes('CALCPERCENT', 'GOM'), undefined);
  assert.deepEqual(indexes('PERCENT', 'GOM'), [0]);
  assert.deepEqual(indexes('PERCENT', '996PC'), [0]);
  assert.equal(indexes('PERCENT', 'GEE'), undefined, 'GEE requires its own PERCENT evidence');
  assert.deepEqual(indexes('GETDBIDXITEMFIELDVALUE', '996PC'), [2]);
  assert.equal(indexes('GETDBIDXITEMFIELDVALUE', 'GOM'), undefined);
  assert.deepEqual(indexes('HUMVARRANK', '996PC'), [1]);
  assert.equal(indexes('HUMVARRANK', 'GOM'), undefined);
  assert.equal(indexes('SORTHUMVAR', '996PC'), undefined, 'ranking output prefixes are not direct output variables');
  assert.deepEqual(families('SORTHUMVAR', '996PC'), [1, 2]);
  assert.equal(families('SORTHUMVAR', 'GOM'), undefined);
  assert.equal(families('SORTHUMVAR', 'GEE'), undefined);
  assert.equal(implicit('CHECKNAMELISTPOSITION', '996PC'), undefined);
  assert.deepEqual(implicit('CHECKNAMELISTPOSITION', 'GOM'), ['P0']);
  assert.deepEqual(implicit('CHECKNAMELISTPOSITION', 'GEE'), ['P0']);
  assert.equal(implicit('ADDMIRRORMAP', 'GEE'), undefined);
  assert.equal(implicit('MIRRORMAPTIME', 'GEE'), undefined);
  assert.deepEqual(indexes('FINDMONPOINT', 'GOM'), [2, 3, 4]);
  assert.deepEqual(indexes('FINDMONPOINT', 'GEE'), [2, 3]);
  assert.equal(indexes('FINDMONPOINT', '996PC'), undefined);
  for (const engine of ['GOM', 'GEE', '996PC']) {
    assert.deepEqual(discovered('#ACT\nGETBINDMONEY U101 N$结果', engine), ['N$结果'],
      `${engine} output-only discovery must not mistake a character name for a variable`);
    assert.deepEqual(discovered('#ACT\nGETDBMONSTERFIELDVALUE U101 NAME S$结果', engine), ['S$结果']);
    assert.deepEqual(discovered('#ACT\nREADCONFIGFILEITEM U101 U102 U103 N$结果', engine), ['N$结果']);
    assert.deepEqual(discovered('#ACT\nSETSTRINGBLANK S$结果', engine), ['S$结果']);
    assert.deepEqual(discovered('#ACT\nGETLISTSTRING path.txt 0 N$一 S$二', engine), ['N$一', 'S$二'],
      'variable-length output discovery must survive registry consolidation');
  }
  assert.deepEqual(discovered('#ACT\nGETDBIDXITEMFIELDVALUE 1 NAME S$结果', '996PC'), ['S$结果']);
  assert.deepEqual(discovered('#ACT\nGETDBIDXITEMFIELDVALUE 1 NAME S$结果', 'GOM'), []);
  assert.deepEqual(discovered('#ACT\nCALCPERCENT 50 100 N$结果', 'GEE'), ['N$结果']);
  assert.deepEqual(discovered('#ACT\nCALCPERCENT 50 100 N$结果', 'GOM'), []);
  assert.deepEqual(discovered('#ACT\nPERCENT N$结果 50 100', 'GOM'), ['N$结果']);
  assert.deepEqual(discovered('#ACT\nPERCENT N$结果 50 100', '996PC'), ['N$结果']);
  assert.deepEqual(discovered('#ACT\nPERCENT N$结果 50 100', 'GEE'), []);
  assert.deepEqual(discovered('#IF\nNOT CHECKCACHEGETSTRINGPOSEX 目录 搜索 S$文本 N$位置', '996PC'), ['N$位置', 'S$文本']);
  assert.deepEqual(discovered('#IF\nNOT CHECKCACHEGETSTRINGPOSEX 目录 搜索 S$文本 N$位置', 'GOM'), []);
  for (const engine of ['GOM', '996PC']) {
    assert.deepEqual(discovered('#ACT\nADDMIRRORMAP 3 临时地图 60 1\nMIRRORMAPTIME 临时地图 60', engine), ['D99']);
  }
  assert.deepEqual(discovered('#ACT\nADDMIRRORMAP 3 临时地图 60 1\nMIRRORMAPTIME 临时地图 60', 'GEE'), []);
  assert.deepEqual(discovered('#IF\nCHECKNAMELISTPOSITION 名单 角色名 =', 'GOM'), ['P0']);
  assert.deepEqual(discovered('#IF\nCHECKNAMELISTPOSITION 名单 角色名 =', '996PC'), []);
  assert.deepEqual(discovered('#ACT\nSORTHUMVAR HUMAN(积分) S$名字 N$分数 999999999999', '996PC'), [],
    'ranking prefixes do not create direct variables or unbounded numbered controls');
  assert.deepEqual(discovered('#ACT\nSORTHUMVAR HUMAN(积分) S$名字 N$分数 999999999999\n#SAY\n<$STR(S$名字1)> <$STR(N$分数2)>', '996PC'), ['N$分数2', 'S$名字1']);
  assert.deepEqual(discovered('#ACT\nGETBINDMONEY 人物 N$结果<$STR(N0)>', 'GOM', { N0: '7' }), ['N$结果7', 'N0']);
  console.log('preview-command-outputs.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run };
