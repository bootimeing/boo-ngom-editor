const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./temp-cleanup');

// Portable rendering/dataflow excerpt from the user's GBK rebirth NPC. No
// reward, RENEWLEVEL, TAKE, CALL or persistence commands are executed here.
const source = [
  '[@main]', '#IF', '#ACT', 'CSVOpenCache ..\\QuestDiary\\03游戏名单\\表格数据\\转生系统.csv',
  '#IF', '#ACT', 'mov n$最大转生等级 3', 'mov n$当前转生等级 <$relevel>',
  '#IF', '#ACT', 'openmerchantbigdlg 1 10 1 4 0 -50 1 509 40',
  'formulation <$转生系统(<$str(n$当前转生等级)>,4)>/10000 n$转生金币',
  '#IF', 'small <$str(n$当前转生等级)> <$str(n$最大转生等级)>', '#SAY',
  '<&text:<$转生系统(<$str(n$当前转生等级)>,0)>转　→　<$转生系统(<$str(n$当前转生等级)>,1)>转:145:94{fcolor=250}>',
  '<&text:对怪切割+<$转生系统(<$str(n$当前转生等级)>,6)>:347:116{fcolor=147}>',
  '<&text:对人真伤+<$转生系统(<$str(n$当前转生等级)>,7)>:347:137{fcolor=147}>',
  '<&text:神力倍攻+<$转生系统(<$str(n$当前转生等级)>,8)>%:347:158{fcolor=147}>',
  '<&text:对怪切割+<$转生系统(<$str(n$当前转生等级)>,9)>:450:116{fcolor=147}>',
  '<&text:对人真伤+<$转生系统(<$str(n$当前转生等级)>,10)>:450:137{fcolor=147}>',
  '<&text:神力倍攻+<$转生系统(<$str(n$当前转生等级)>,11)>%:450:158{fcolor=147}>',
  '<&text:等级需求：<$转生系统(<$str(n$当前转生等级)>,2)>级:365:226{fcolor=150}>',
  '<&text:金币需求：金币*<$str(n$转生金币)>万:365:245{fcolor=150}>',
  '<&text:材料需求：转生石*<$转生系统(<$str(n$当前转生等级)>,3)>:365:264{fcolor=150}>',
  '#ELSESAY',
  '<&text:<$转生系统(<$str(n$当前转生等级)>,0)>转:175:94{fcolor=250}>',
  '<&text:对怪切割+<$转生系统(<$str(n$当前转生等级)>,6)>:400:116{fcolor=147}>',
  '<&text:对人真伤+<$转生系统(<$str(n$当前转生等级)>,7)>:400:137{fcolor=147}>',
  '<&text:神力倍攻+<$转生系统(<$str(n$当前转生等级)>,8)>%:400:158{fcolor=147}>',
  '<&text:等级需求：无法提升:365:226{fcolor=150}>',
  '<&text:金币需求：无法提升:365:245{fcolor=150}>',
  '<&text:材料需求：无法提升:365:264{fcolor=150}>',
].join('\r\n');
const csv = [
  ';当前等,下等,所需条件,转生石,金币,特殊属性,当前对怪切割,当前对人真伤,当前神力倍攻,对怪切割,对人真伤,神力倍攻',
  '0,1,50,5,50000,,0,0,0,50,30,1',
  '1,2,60,10,100000,,50,30,1,100,60,2',
  '2,3,65,20,200000,,100,60,2,150,90,3',
  '3,4,70,30,300000,,150,90,3,200,120,4',
].join('\r\n');
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-rebirth-csv-'));
  const file = path.join(temp, 'Mir200/Envir/Market_Def/1大陆/主城/07转生系统-西岐.txt');
  const table = path.join(temp, 'Mir200/Envir/QuestDiary/03游戏名单/表格数据/转生系统.csv');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(path.dirname(table), { recursive: true });
  const sourceBytes = iconv.encode(source, 'gbk'), tableBytes = iconv.encode(csv, 'gbk');
  fs.writeFileSync(file, sourceBytes); fs.writeFileSync(table, tableBytes);
  return { temp, file, table, source, sourceBytes, tableBytes,
    unchanged() { assert.deepEqual(fs.readFileSync(file), sourceBytes); assert.deepEqual(fs.readFileSync(table), tableBytes); },
    dispose() { assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith('boo-rebirth-csv-')); removeTemporaryDirectory(temp); },
  };
}
const expectedOne = ['1转　→　2转', '对怪切割+50', '对人真伤+30', '神力倍攻+1%',
  '对怪切割+100', '对人真伤+60', '神力倍攻+2%', '等级需求：60级', '金币需求：金币*10万', '材料需求：转生石*10'];
module.exports = { fixture, source, csv, expectedOne };
