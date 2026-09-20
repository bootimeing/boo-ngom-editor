const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { buildPreviewScriptProgram } = require(path.join(runtime, 'out/ui-dialog/preview-script-program'));
const { parseNpcDialogScriptProgram, dialogProgramCoordinateAuthority, dialogProgramSourcesCurrent } = require(path.join(runtime, 'out/ui-dialog/preview-script-model'));
const { buildDialogProgramCoordinateEdits } = require(path.join(runtime, 'out/ui-dialog/preview-script-edits'));
const { applyTextReplacements } = require(path.join(runtime, 'out/ui-dialog/source-patcher'));
const { buildDialogStatementCatalog } = require(path.join(runtime, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(runtime, 'out/ui-dialog/offsets'));
const language = require(path.join(runtime, 'data/static-language.json'));
function source(name, text) { return { uri: 'file:///D:/fixture/' + name, fileName:name,
  filePath:'D:\\fixture\\' + name, text, documentVersion:4 }; }
function build(text, files = {}, engine = 'GOM') {
  const reads = [];
  const result = buildPreviewScriptProgram(source('npc.txt', text), engine, (raw, purpose = 'questdiary-txt') => {
    reads.push([raw, purpose]);
    const file = files[purpose + ':' + raw] ?? files[raw];
    return file ? { status:'found', source:typeof file === 'string' ? source(purpose + '/' + raw, file) : file, candidateFilePaths:[] }
      : { status:'missing', message:'fixture missing', candidateFilePaths:['D:\\fixture\\' + purpose + '\\' + raw] };
  });
  return {...result, reads};
}
function checkMap(program) {
  let end = 0;
  for (const part of program.segments) {
    assert.equal(part.start, end); end = part.end;
    if (!part.rewritten) assert.equal(program.text.slice(part.start, part.end), part.source.text.slice(part.sourceStart, part.sourceEnd));
    if (part.constantExpansion) assert.equal(part.source.text.slice(part.sourceStart, part.sourceEnd), part.constantExpansion.expression);
  }
  assert.equal(end, program.text.length);
}
function run() {
  for (const engine of ['GOM', 'GEE']) {
    const p = build('#INCLUDE 常量.ini\r\n[@main]\r\n#ACT\r\nMOV N0 ($数量)\r\n#SAY\r\n<TEXT:10:20:($标题)>\r\n<IMG:($数量):0:10:20>\r\n',
      {'常量.ini':'#DEFINE $标题 欢迎 光临\r\n#Define $数量 80\r\n'}, engine);
    assert.match(p.text, /MOV N0 80/); assert.match(p.text, /<TEXT:10:20:欢迎 光临>/);
    assert.match(p.text, /<IMG:80:0:10:20>/);
    assert.deepEqual(p.reads, [['常量.ini','defines-ini']]);
    assert.equal(p.sources.size, 1); checkMap(p);
    const expansion = p.segments.find(part => part.constantExpansion?.name === '标题').constantExpansion;
    assert.equal(expansion.status, 'resolved'); assert.equal(expansion.definition.source.documentVersion, 4);
    assert.equal(expansion.definition.source.text.slice(expansion.definition.valueStart, expansion.definition.valueEnd), '欢迎 光临');
  }
  const newer = build('[@Main]\n#IF\n#ACT\n#INCLUDE 配置.ini\n#SAY\n$(标题)\n$(后置)\n[@常量]\n#CALL [\\定义.ini] @定义\n', {
    'defines-ini:配置.ini':'#DEFINE $(标题) 996标题',
    'questdiary-constants-ini:\\定义.ini':'[@定义]\n{\n#DEFINE $(后置) 后置已加载\n}\n[@其他]\n{\n#DEFINE $(泄漏) 不应导入\n}',
  }, '996PC');
  assert.match(newer.text, /996标题/); assert.match(newer.text, /后置已加载/);
  assert.ok(!newer.text.includes('不应导入')); assert.ok(!newer.text.includes('GOTO @定义'));
  assert.equal(newer.sources.size, 2); checkMap(newer);
  const wrongEngine = build('#INCLUDE 配置.ini\n[@main]\n#SAY\n($A) $(A)', {'配置.ini':'#DEFINE $(A) wrong'}, 'GOM');
  assert.ok(!wrongEngine.text.includes('wrong')); assert.match(wrongEngine.warnings.join('\n'), /语法|未支持/);
  const comments = build('#INCLUDE c.ini\n[@main]\n#SAY\n($A) ($B) ($C)', {
    'c.ini':'// comment\n\\\\ comment\n; comment\n#DEFINE $A 80 ;tail\n#DEFINE $B 90 //tail\n#DEFINE $C hello world \\\\tail',
  });
  assert.match(comments.text, /80 90 hello world/); checkMap(comments);
  const unsafe = build('#INCLUDE c.ini\n[@main]\n#SAY\n($Missing) ($A) ($B) ($C) ($D)', {
    'c.ini':'#DEFINE $A <IMG:1:0:0:0>\n#DEFINE $B ($C)\n#DEFINE $C <$STR(N0)>\n#DEFINE $D @执行',
  });
  assert.match(unsafe.warnings.join('\n'), /未定义/); assert.match(unsafe.warnings.join('\n'), /未支持/);
  assert.ok(!unsafe.text.includes('<IMG:1')); assert.match(unsafe.text, /\(\$A\)/);
  const conflict = build('#INCLUDE a.ini\n#INCLUDE b.ini\n[@main]\n#SAY\n($A) ($Name)', {
    'a.ini':'#DEFINE $A first\n#DEFINE $Name capital', 'b.ini':'#DEFINE $A second\n#DEFINE $name lowercase',
  });
  assert.match(conflict.text, /\(\$A\)/); assert.match(conflict.text, /\(\$Name\)/);
  assert.match(conflict.warnings.join('\n'), /歧义/);
  const same = build('#INCLUDE a.ini\n#INCLUDE a.ini\n[@main]\n#SAY\n($A)', {'a.ini':'#DEFINE $A same'});
  assert.equal(same.reads.length, 1); assert.match(same.text, /same/);
  const nonConstants = build('[@main]\n#CALL [x.ini] @d\n#SAY\n$(A)', {'questdiary-constants-ini:x.ini':'[@d]\n{\n#DEFINE $(A) bad\n#ACT\nMOV N0 9\n}'}, '996PC');
  assert.ok(!nonConstants.text.includes('bad')); assert.match(nonConstants.warnings.join('\n'), /DEFINE|常量/);
  const unsupportedIni = build('[@main]\n#CALL [x.ini] @d', {'x.ini':'[@d]\n{\n#DEFINE $A 1\n}'}, 'GOM');
  assert.equal(unsupportedIni.reads.length, 0); assert.match(unsupportedIni.warnings.join('\n'), /INI|ini/);
  const conditional = build('[@main]\n#IF\nEQUAL N0 1\n#ACT\n#INCLUDE a.ini\n#SAY\n$(A)', {'a.ini':'#DEFINE $(A) conditional'}, '996PC');
  assert.equal(conditional.reads.length, 0); assert.match(conditional.warnings.join('\n'), /条件/);
  const noAuthority = build('#INCLUDE a.ini\n[@main]\n#ACT\nGOTO @($A)\n#CALL [($A).txt] @x\nMOV ($A) 8\nSENDMSG 5 ($A)\n#SAY\n<按钮/@($A)>\n<按钮/@go(($A))>\n<图片($A)/@go>\n', {'a.ini':'#DEFINE $A hello'});
  assert.match(noAuthority.text, /GOTO @\(\$A\)/); assert.match(noAuthority.text, /MOV \(\$A\) 8/);
  assert.match(noAuthority.text, /SENDMSG 5 \(\$A\)/); assert.match(noAuthority.text, /<按钮\/@\(\$A\)>/);
  assert.match(noAuthority.text, /<按钮\/@go\(\(\$A\)\)>/); assert.match(noAuthority.text, /<图片hello\/@go>/);
  const keyed = build('#INCLUDE k.ini\n[@main]\n#SAY\n<Button|link=@go|text=$(Title)|dblink=$(Target)|submitinput=$(Number)|x=$(Number)|y=20>',
    {'k.ini':'#DEFINE $(Title) 按钮标题\n#DEFINE $(Target) go\n#DEFINE $(Number) 10'}, '996PC');
  assert.match(keyed.text, /text=按钮标题/); assert.match(keyed.text, /dblink=\$\(Target\)/);
  assert.match(keyed.text, /submitinput=\$\(Number\)/); assert.match(keyed.text, /x=10\|y=20/);
  const recursiveInclude = build('#INCLUDE a.ini\n[@main]\n#SAY\n($A)', {'a.ini':'#INCLUDE a.ini\n#DEFINE $A 1'});
  assert.equal(recursiveInclude.reads.length, 1); assert.match(recursiveInclude.warnings.join('\n'), /嵌套|递归|未支持/);
  assert.match(recursiveInclude.text, /\(\$A\)/, 'an unproved recursive include does not partially bless its declarations');
  const originalSource = source('Defines/shared.ini', '#DEFINE $A first');
  const identityConflict = build('#INCLUDE a.ini\n#INCLUDE b.ini\n[@main]\n#SAY\n($A)', {
    'a.ini':originalSource,'b.ini':{...originalSource,text:'#DEFINE $A changed',documentVersion:5},
  });
  assert.match(identityConflict.text, /\(\$A\)/, 'late source identity conflict revokes prior constant');
  const structuralLiteral = build('#INCLUDE a.ini\n[@main]\n#SAY\n<TEXT:($A):10:20>', {'a.ini':'#DEFINE $A forged:90:100'});
  assert.ok(!structuralLiteral.text.includes('forged:90:100'), 'constant content cannot introduce positional fields');
  const externalConstants = build('[@main]\n#ACT\n#CALL [external.txt] @ext\n#SAY\n($A)', {
    'external.txt':'#INCLUDE ext.ini\n[@ext]\n{\n#SAY\n<TEXT:($A):10:20>\n}', 'ext.ini':'#DEFINE $A imported title',
  });
  assert.match(externalConstants.text, /<TEXT:imported title:10:20>/);
  assert.equal(externalConstants.reads.filter(([,purpose])=>purpose==='defines-ini').length, 1);
  const failedLabel = build('[@main]\n#ACT\n#CALL [external.txt] @absent\n#SAY\n($A)', {
    'external.txt':'#INCLUDE ext.ini\n[@ext]\n{\n#SAY\nhi\n}', 'ext.ini':'#DEFINE $A forbidden',
  });
  assert.ok(!failedLabel.reads.some(([,purpose])=>purpose==='defines-ini'));
  assert.match(failedLabel.text, /\(\$A\)/);
  const capped = build('#INCLUDE cap.ini\n[@main]\n#SAY\n'+'($A) '.repeat(32770), {'cap.ini':'#DEFINE $A 1'});
  assert.match(capped.warnings.join('\n'), /32768/); assert.equal((capped.text.match(/\(\$A\)/g)||[]).length, 2);
  const oversized = build('#INCLUDE huge.ini\n[@main]\n#SAY\n'+'($A)\n'.repeat(1200), {'huge.ini':'#DEFINE $A '+'x'.repeat(8192)});
  assert.ok(Buffer.byteLength(oversized.text,'utf8')<=8*1024*1024); assert.match(oversized.warnings.join('\n'), /大小上限/);
  const primary = source('model.txt', '#INCLUDE model.ini\n[@main]\n#ACT\nMOV N0 ($N)\nINC N0 ($N)\n#SAY\n<TEXT:($caption):10:20>\n<TEXT:coord:($N):30>\n<TEXT:total=<$STR(N0)>:50:60>\n<IMG:($N):0:70:80>');
  const definition = source('Defines/model.ini', '#DEFINE $caption 这是已确认标题\n#DEFINE $N 80');
  const resolver = (raw, purpose) => { assert.equal(raw, 'model.ini'); assert.equal(purpose, 'defines-ini'); return {status:'found',source:definition,candidateFilePaths:[definition.filePath]}; };
  const model = parseNpcDialogScriptProgram(primary, {...primary,engine:'GOM',engineLabel:'GOM',cursorOffset:primary.text.indexOf('[@main]'),
    offsets:workspaceNpcDialogOffsets(0,0),catalog:buildDialogStatementCatalog(language,'GOM'),previewValues:{}}, {status:'missing',candidateFilePaths:[]}, resolver);
  const elements = [...new Map(model.scenes.flatMap(scene=>scene.elements).map(element=>[element.id,element])).values()];
  const caption = elements.find(element=>element.text==='这是已确认标题');
  assert.ok(caption?.editable, 'a macro caption must not disable unchanged numeric x/y');
  assert.equal(caption.sourceRange.original, '<TEXT:($caption):10:20>');
  assert.equal(caption.x.span.original, '10'); assert.equal(caption.y.span.original, '20');
  assert.equal(caption.x.displayValue, 6); assert.equal(caption.y.displayValue, 16);
  assert.equal(caption.sourceRange.start, primary.text.indexOf('<TEXT:($caption)'));
  const plans = buildDialogProgramCoordinateEdits(primary.text, model, [{elementId:caption.id,x:16,y:36}]);
  assert.equal(plans.length, 1); assert.equal(plans[0].source.uri, primary.uri);
  assert.equal(applyTextReplacements(primary.text, plans[0].replacements), primary.text.replace(':10:20>', ':20:40>'));
  const coordinate = elements.find(element=>element.text==='coord');
  assert.equal(coordinate.x.displayValue, 76); assert.equal(coordinate.editable, false);
  assert.equal(coordinate.x.span.original, '($N)');
  assert.ok(!dialogProgramCoordinateAuthority(model).targets[coordinate.id]);
  assert.throws(()=>buildDialogProgramCoordinateEdits(primary.text, model, [{elementId:coordinate.id,x:16,y:36}]), /能力/);
  assert.ok(elements.some(element=>element.text==='total=160'), 'source-proved MOV and arithmetic values reach the real display path');
  assert.ok(elements.some(element=>element.assetRef?.imageIndex===80), 'direct constant resource number retains source proof');
  assert.ok(dialogProgramSourcesCurrent(model, resolver));
  assert.equal(dialogProgramSourcesCurrent(model, (raw,purpose)=>({...resolver(raw,purpose),source:{...definition,text:definition.text+'\n'}})), false);
  console.log('preview-script-constants PASS: engine spelling, literal values, typed roots, load-time INI CALL, conflicts, safety, spans');
}
if (require.main === module) run();
module.exports = { run };
