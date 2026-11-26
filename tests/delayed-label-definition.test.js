const assert = require('node:assert/strict');
const path = require('node:path');
const { activateWithStub, makeDocument, TestPosition } = require('./helpers/assistant-host');

let cases = 0;

async function main() {
  const host = activateWithStub();
  const definition = host.providers.Definition;
  assert.equal(typeof definition?.provideDefinition, 'function', 'activateAssistant must register the production DefinitionProvider');
  async function check(name, body) { await body(); cases++; console.log(`delayed-label-definition: PASS - ${name}`); }
  async function jump(document, line, character) { return definition.provideDefinition(document, new TestPosition(line, character), { isCancellationRequested: false }); }
  const target = '延迟_回调-结束';
  try {
    await check('DELAYGOTO and DELAYCALL navigate from @ and every Chinese/static label character', async () => {
      for (const engine of ['GOM', 'GEE']) {
        host.setEngine(engine);
        for (const raw of [`DELAYGOTO 1000 @${target}`, `delaycall 1000 @${target}`, `#ACT(DELAYGOTO 1000 @${target})`, `#ELSEACT DelayCall 1000 @${target}`]) {
          const document = makeDocument(`[@main]\r\n#ACT\r\n${raw}\r\n\uFEFF  [@${target}]\r\n#ACT\r\n`);
          const start = raw.indexOf('@');
          for (const character of [start, start + 1, start + target.length]) {
            const location = await jump(document, 2, character);
            assert.ok(location, `${engine}: ${raw} at ${character} must navigate`);
            assert.equal(location.uri.toString(), document.uri.toString());
            assert.deepEqual(location.range.start, new TestPosition(3, 3));
          }
          assert.equal(await jump(document, 2, raw.toUpperCase().indexOf('DELAY')), null, 'command token does not become a label link');
          assert.equal(await jump(document, 2, raw.indexOf('1000')), null, 'delay duration does not become a label link');
          assert.equal(await jump(document, 2, start - 1), null, 'space before @ is not a target');
          assert.equal(await jump(document, 2, start + target.length + 1), null, 'target span end is half-open');
        }
      }
    });
    await check('per-document engine wins and 996PC supports verified DELAYCALL but not DELAYGOTO', async () => {
      host.setEngine('996PC');
      const document = makeDocument(`[@main]\n#ACT\nDELAYGOTO 1000 @${target}\n[@${target}]`);
      document.uri.engine = 'GOM';
      assert.ok(await jump(document, 2, document.lineAt(2).text.indexOf('@')));
      document.uri.engine = '996PC';
      assert.equal(await jump(document, 2, document.lineAt(2).text.indexOf('@')), null);
      document.replace(`[@main]\n#ACT\nDELAYCALL 1000 @${target}\n[@${target}]`);
      assert.ok(await jump(document, 2, document.lineAt(2).text.indexOf('@')));
    });
    await check('comments, display text, conditions, dynamic labels and lookalike commands do not navigate', async () => {
      host.setEngine('GOM');
      for (const raw of [
        `; DELAYGOTO 1000 @${target}`, `// DELAYGOTO 1000 @${target}`,
        `SENDMSG 6 示例 DELAYGOTO 1000 @${target}`, `MyDELAYGOTO 1000 @${target}`, `DELAYGOTOEX 1000 @${target}`,
        `#SAY DELAYGOTO 1000 @${target}`, `#IF(DELAYGOTO 1000 @${target})`, `#OR(DELAYCALL 1000 @${target})`,
        `DELAYGOTO 1000 @<$STR(S$目标)>`,
      ]) {
        const document = makeDocument(`[@main]\n#ACT\n${raw}\n[@${target}]\n[@<$STR(S$目标)>]`);
        assert.equal(await jump(document, 2, raw.indexOf('@')), null, raw);
      }
      for (const block of ['#SAY', '#ELSESAY', '#IF', '#OR']) {
        const document = makeDocument(`[@main]\n${block}\nDELAYGOTO 1000 @${target}\n[@${target}]`);
        assert.equal(await jump(document, 2, document.lineAt(2).text.indexOf('@')), null, block);
      }
    });
    await check('unsaved same-document labels are authoritative and removed labels stop resolving', async () => {
      const document = makeDocument(`[@main]\n#ACT\nDELAYGOTO 1000 @${target}\n[@磁盘旧标签]`);
      assert.equal(await jump(document, 2, document.lineAt(2).text.indexOf('@')), null);
      document.replace(`[@main]\n#ACT\nDELAYGOTO 1000 @${target}\n\n  [@${target}]`);
      assert.deepEqual((await jump(document, 2, document.lineAt(2).text.indexOf('@'))).range.start, new TestPosition(4, 2));
      document.replace(`[@main]\n#ACT\nDELAYGOTO 1000 @${target}\n[@已删除]`);
      assert.equal(await jump(document, 2, document.lineAt(2).text.indexOf('@')), null);
      assert.deepEqual(host.sideEffects, [], 'same-file queries never read disk, open documents, or write');
    });
    await check('case-insensitive target lookup skips commented and ordinary-text fake definitions', async () => {
      const document = makeDocument([
        '[@main]', '#ACT', 'DELAYGOTO 1000 @mixed_回调',
        '; [@MIXED_回调]', '// [@MIXED_回调]', 'SENDMSG 6 示例 [@MIXED_回调]', '  [@MIXED_回调]',
      ].join('\r\n'));
      const location = await jump(document, 2, document.lineAt(2).text.indexOf('@'));
      assert.ok(location);
      assert.deepEqual(location.range.start, new TestPosition(6, 2));
    });
    await check('registered References and CodeLens include delayed references but ignore SAY/condition text', async () => {
      const document = makeDocument([
        `[@${target}]`, '#ACT', `DELAYGOTO 1000 @${target}`, `DELAYCALL 2000 @${target}`,
        '#SAY', `DELAYGOTO 1000 @${target}`, '#IF', `DELAYCALL 1000 @${target}`,
      ].join('\r\n'));
      const references = host.providers.Reference.provideReferences(document, new TestPosition(0, 3), {}, {});
      assert.deepEqual(references.map(item => item.range.start.line).sort((a, b) => a - b), [0, 2, 3]);
      const lenses = host.providers.CodeLens.provideCodeLenses(document);
      assert.equal(lenses.length, 1);
      assert.equal(lenses[0].command.title, '2 处引用');
    });
    await check('registered save diagnostics report unresolved delayed labels only in executable contexts', async () => {
      const document = makeDocument([
        '[@main]', '#ACT', 'DELAYGOTO 1000 @确实缺失', '#SAY', 'DELAYCALL 1000 @显示文字',
        '#IF', 'DELAYGOTO 1000 @条件文字', '#ACT', `DELAYCALL 1000 @${target}`, `[@${target}]`,
      ].join('\r\n'));
      for (const callback of host.events.onDidSaveTextDocument || []) await callback(document);
      const issues = (host.diagnostics.get(document.uri.toString()) || []).filter(item => item.message.includes('引用了未定义的标签'));
      assert.deepEqual(issues.map(item => ({ message: item.message, line: item.range.start.line })), [
        { message: '引用了未定义的标签 @确实缺失', line: 2 },
      ]);
    });
    await check('manual callbacks share definition, references and missing-label diagnostics', async () => {
      const cases = {
        GOM: ['PLAYDICE 1 @接受 30 50 0','SENDDELAYMSG 信息 30 250 0 @接受'],
        GEE: ['HttpGet https://example.invalid @接受 S100','HttpPost https://example.invalid body text @接受 S100',
          'SendCenterMsg 180 251 文字 0 30 @接受 0 25 88','SENDDELAYMSG 消息 30 250 0 @接受'],
        '996PC': ['LoopBagItems @接受 N1 S1 N2','<Button|link=@接受>','<Button|dblink=@接受>',
          '<传参/@接受#装备=布衣(男)#数量=2>'],
      };
      for (const [engine, calls] of Object.entries(cases)) {
        host.setEngine(engine);
        for (const call of calls) {
          const doc = makeDocument(['[@main]',call.startsWith('<')?'#SAY':'#ACT',call,'; [@接受]','[@接受]'].join('\n'));
          const loc = await jump(doc,2,call.indexOf('@接受')+1);
          assert.equal(loc?.range.start.line,4,engine + ' ' + call);
          const refs = await host.providers.Reference.provideReferences(doc,new TestPosition(4,2),{}, {});
          assert.deepEqual(refs.map(x=>x.range.start.line).sort(),[2,4]);
          doc.replace(doc.getText().replace(/\n\[@接受\]$/,''));
          for (const handler of host.events.onDidSaveTextDocument) await handler(doc);
          assert.ok(host.diagnostics.get(doc.uri.toString())?.some(d=>d.message.includes('未定义的标签 @接受')),call);
        }
      }
    });
    await check('cross-file callbacks stay inside the source Envir, including a same-name local definition', async () => {
      const root = path.join(__dirname,'fixtures','服B','Mir200','Envir');
      const a = makeDocument('[@DlgButtonClick1000]',path.join(__dirname,'fixtures','服A','Mir200','Envir','Market_Def','QFunction-0.txt'));
      const qf = makeDocument('; [@DlgButtonClick1000]\n[@DlgButtonClick1000]\n[@选择]\n[@到期]',path.join(root,'Market_Def','QFunction-0.txt'));
      const qm = makeDocument('[@OnTimerMS0]',path.join(root,'MapQuest_Def','QManage.txt'));
      const ev = makeDocument('[@刷新]',path.join(root,'MapQuest_Def','QMapEvent-0.txt'));
      host.workspace.textDocuments = [a,qf,qm,ev];
      const probes = [
        ['GEE','Market_Def/npc.txt','#ACT\nADDDLG 11 1 440 1 10:20 30:40 22 >倒计时：<COUNTDOWN:10:3:251:0:0/@1000>\n[@1000]','@1000',qf,1],
        ['GOM','Market_Def/npc.txt','#ACT\nSELECTBAGITEM 选择 ItemIdx 31|42 提示\n[@选择]','选择',qf,2],
        ['GOM','MapInfo.txt','[0 比奇] TIMEMAP(0|30|1|@到期)','@到期',qf,3],
        ['GOM','MonGen.txt','3 333 333 蜈蚣 6 1 2 0 0 * 0 * 0 0 0 1 0 1@刷新:60,30,10','@刷新',ev,0],
        ['996PC','Market_Def/npc.txt','#ACT\nSETONTIMERMS 0 300','0 300',qm,0],
      ];
      for (const [engine,file,body,key,targetDoc,line] of probes) {
        host.setEngine(engine);
        const doc = makeDocument(body,path.join(root,file)), pos = doc.positionAt(body.indexOf(key));
        const loc = await jump(doc,pos.line,pos.character);
        assert.equal(loc?.uri.fsPath,targetDoc.fileName,key);
        assert.equal(loc.range.start.line,line,key);
        const refs = await host.providers.Reference.provideReferences(doc,pos,{}, {});
        assert.ok(refs.some(ref=>ref.uri.fsPath===doc.fileName && ref.range.start.line===pos.line));
        assert.ok(refs.some(ref=>ref.uri.fsPath===targetDoc.fileName && ref.range.start.line===line));
        assert.ok(refs.every(ref=>ref.uri.fsPath!==a.fileName));
      }
      host.setEngine('GEE');
      const missing = makeDocument('#SAY\n<COUNTDOWN:10:3:251:0:0/@1000>', path.join(root,'Market_Def','npc.txt'));
      assert.equal(await jump(missing,1,missing.lineAt(1).text.indexOf('@1000')),null);
    });
    console.log(`delayed-label-definition.test.js: PASS (${cases} cases; production registration, VS Code API stub)`);
  } finally { host.dispose(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
