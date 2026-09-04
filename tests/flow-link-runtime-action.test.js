const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');

/**
 * Red-test contract for documented legacy `/@` actions.
 *
 * The three tokenless entries (`text-link`, `text-link-params`, and
 * `text-color`) exist in static-language.json, but historically never entered
 * the dialog statement catalog because their snippets start with user text,
 * not an English statement token. Merely receiving a `flow-text` element is
 * not coverage: it discards the click target and script parameters.
 *
 * Runtime actions are deliberately local-only. A click may expose an auditable
 * summary, but must never execute an engine label. Parenthesized arguments map
 * in source order to SCRIPTPARAM1..N, as shown by all three engine manuals.
 */

function parse(engine, sayLines, actLines = []) {
  const source = [
    '[@main]',
    ...(actLines.length > 0 ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/flow-link-${engine}.txt`,
    fileName: `flow-link-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\flow-link-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
  return { source, model, elements: model.pages[0].elements };
}

function exact(elements, statementId, message) {
  const matches = elements.filter(element => element.statementId === statementId);
  assert.equal(matches.length, 1, `${message}: expected exactly one ${statementId}, got ${matches.length}`);
  return matches[0];
}

function assertClickAction(element, expectedLink, expectedParameters, message) {
  const action = element.runtimeActionPreview;
  assert.ok(action, `${message}: missing typed runtimeActionPreview`);
  assert.equal(action.trigger, 'click', `${message}: the documented gesture is a click`);
  assert.equal(action.localOnly, true, `${message}: runtime action must be local-only`);
  assert.equal(action.link, expectedLink, `${message}: click label mismatch`);
  if (expectedParameters === undefined) {
    assert.equal(action.parameters, undefined, `${message}: unexpected script parameters`);
  } else {
    assert.deepEqual(action.parameters, expectedParameters,
      `${message}: SCRIPTPARAM source order must be retained`);
  }
}

function assertTokenlessFlowStatements() {
  const entries = new Map(staticLanguage.saySnippets.map(entry => [entry.id, entry]));
  for (const id of ['text-link', 'text-link-params', 'text-color']) {
    const entry = entries.get(id);
    assert.ok(entry, `missing static-language entry ${id}`);
    for (const engine of ['GOM', 'GEE', '996PC']) {
      assert.ok(entry.engineVariants?.[engine], `${id} is not documented for ${engine}`);
    }
  }

  const fixtures = [
    { engine: 'GOM', colorIndex: 251, color: '#ffff00' },
    { engine: 'GEE', colorIndex: 251, color: '#ffff00' },
    { engine: '996PC', colorIndex: 250, color: '#00ff00' },
  ];
  for (const fixture of fixtures) {
    const { elements } = parse(fixture.engine, [
      `<${fixture.engine}普通链接/@${fixture.engine.toLowerCase()}Plain>`,
      `<${fixture.engine}带参数/@${fixture.engine.toLowerCase()}Buy(20,麻痹戒指)>`,
      `<${fixture.engine}彩色文字/FCOLOR=${fixture.colorIndex}>`,
    ]);

    const plain = exact(elements, 'text-link', fixture.engine);
    const parameterized = exact(elements, 'text-link-params', fixture.engine);
    const colored = exact(elements, 'text-color', fixture.engine);

    assert.equal(plain.text, `${fixture.engine}普通链接`);
    assert.equal(parameterized.text, `${fixture.engine}带参数`);
    assert.equal(colored.text, `${fixture.engine}彩色文字`);
    assert.equal(colored.textPreview?.lines?.[0]?.[0]?.color, fixture.color,
      `${fixture.engine} text-color must retain the indexed color in its visible run`);
    assert.equal(colored.runtimeActionPreview, undefined,
      `${fixture.engine} text-color must not invent a click action`);

    assertClickAction(plain, `@${fixture.engine.toLowerCase()}Plain`, undefined,
      `${fixture.engine} text-link`);
    assertClickAction(parameterized, `@${fixture.engine.toLowerCase()}Buy`, ['20', '麻痹戒指'],
      `${fixture.engine} text-link-params`);

    for (const element of [plain, parameterized, colored]) {
      assert.notEqual(element.statementId, 'flow-text',
        `${fixture.engine} ${element.raw} must not receive false-positive flow-text coverage`);
    }
  }
}

function assertLegacyControlLinks() {
  const cases = [
    // GOM/GEE absolute text and item-family controls already expose a documented
    // label parameter, but previously had no executable-boundary model.
    ['GOM', 'text-absolute-link', '<&TEXT:绝对文字:10:20{FCOLOR=251}/@gomAbs>', '@gomAbs'],
    ['GEE', 'text-absolute-link', '<&TEXT:绝对文字:10:20{FCOLOR=251}/@geeAbs>', '@geeAbs'],
    ['GOM', 'user-item-preview', '<UserItem:0:30:40:1:0:0:0:40:0:0/@gomEquip>', '@gomEquip'],
    ['GEE', 'item-show', '<&ITEMSHOW:1927:2:10:20:1:0:0:1/@geeItem>', '@geeItem'],
    ['GEE', 'user-item-preview', '<UserItem:0:30:40:1:0/@geeEquip>', '@geeEquip'],
    ['GEE', 'hero-user-item-preview', '<HeroUserItem:1:35:45:1:0/@geeHero>', '@geeHero'],
    ['GEE', 'makeindex-item-preview', '<MakeIndexItem:12345:2:40:50:1:0:0:1/@geeMake>', '@geeMake'],
    ['GEE', 'state-item-preview', '<StateItem:88:80:90:1|状态提示/@geeState>', '@geeState'],
    ['GEE', 'dnitems-preview', '<DnItems:99:100:110:0|掉落提示/@geeDn>', '@geeDn'],

    // The current GOM/GEE help also documents clickable IMG/IMGEX spellings.
    ['GOM', 'img-relative', '<IMG:1185:1:10:20/@gomImg>', '@gomImg'],
    ['GOM', 'imgex-absolute-relative-compat', '<IMGEX:0:1600:1601:1602:30:40/@gomImgEx>', '@gomImgEx'],
    ['GEE', 'img-relative', '<IMG:1185:1:10:20/@geeImg>', '@geeImg'],
    ['GEE', 'imgex-absolute-relative-compat', '<IMGEX:0:1600:1601:1602:30:40/@geeImgEx>', '@geeImgEx'],

    // 996PC legacy controls use relative coordinates and all three manuals call
    // @Label the script label triggered by clicking the control.
    ['996PC', 'img-relative', '<IMG:1:2:10:20/@pcImg>', '@pcImg'],
    ['996PC', 'text-absolute', '<TEXT:旧文字:30:40{FCOLOR=250}/@pcText>', '@pcText'],
    ['996PC', 'imgex-relative-996pc', '<IMGEX:0:120:121:122:50:60/@pcImgEx>', '@pcImgEx'],
  ];

  for (const [engine, statementId, markup, link] of cases) {
    const { elements } = parse(engine, [markup]);
    const element = exact(elements, statementId, `${engine} ${markup}`);
    assertClickAction(element, link, undefined, `${engine} ${statementId}`);
  }
}

function assertResolvedAndUnknownFlowActionSourceSafety() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const { elements } = parse(engine, [
      '<动态链接/@<$STR(S$FLOW_LINK)>(20,<$STR(S$FLOW_PARAM)>)>',
    ], [
      `MOV S$FLOW_LINK ${engine}被借用标签`,
      `MOV S$FLOW_PARAM ${engine}被借用参数`,
    ]);
    const element = exact(elements, 'text-link-params', `${engine} dynamic text-link-params`);
    const action = element.runtimeActionPreview;
    assert.ok(action, `${engine} source-bound link must retain a typed local action`);
    assert.equal(action.trigger, 'click');
    assert.equal(action.localOnly, true);
    assert.equal(action.link, `@${engine}被借用标签`,
      `${engine} direct constant MOV is statically proven on the selected path`);
    assert.deepEqual(action.parameters, ['20', `${engine}被借用参数`]);
    assert.equal(Boolean(action.dynamicFields?.includes('link')), false);
    assert.equal(Boolean(action.dynamicFields?.includes('link-parameters')), false);
    assert.match(element.raw, /<\$STR\(S\$FLOW_LINK\)>/,
      `${engine} source link expression was replaced by a MOV preview value`);
    assert.match(element.raw, /<\$STR\(S\$FLOW_PARAM\)>/,
      `${engine} source parameter expression was replaced by a MOV preview value`);

    const unknown = parse(engine, [
      '<未知链接/@<$STR(S$FLOW_LINK)>(20,<$STR(S$FLOW_PARAM)>)>',
    ]);
    const unknownElement = exact(
      unknown.elements,
      'text-link-params',
      `${engine} unknown text-link-params`
    );
    const unknownAction = unknownElement.runtimeActionPreview;
    assert.ok(unknownAction);
    assert.equal(unknownAction.localOnly, true);
    assert.equal(unknownAction.link, undefined,
      `${engine} incomplete link must remain disabled`);
    assert.deepEqual(unknownAction.parameters, ['20', '<$STR(S$FLOW_PARAM)>']);
    assert.ok(unknownAction.dynamicFields?.includes('link'));
    assert.ok(unknownAction.dynamicFields?.includes('link-parameters'));
    assert.match(unknownElement.warning || '', /动态|运行时/);
  }
}

assertTokenlessFlowStatements();
assertLegacyControlLinks();
assertResolvedAndUnknownFlowActionSourceSafety();

console.log('flow-link-runtime-action.test.js: PASS');
