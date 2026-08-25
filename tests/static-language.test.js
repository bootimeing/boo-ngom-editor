const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function byId(entries, id) {
  const value = entries.find(entry => entry.id === id);
  assert.ok(value, `missing static language entry ${id}`);
  return value;
}

function verifySayParameterCatalog(entries, engine, helpers) {
  const index = helpers.buildSayMarkupIndex(entries);
  let verifiedEntries = 0;
  for (const entry of entries) {
    if (!/^<&?[A-Za-z_]/.test(entry.label)) continue;
    const markers = new Map();
    const sample = entry.snippet.replace(/\$\{(\d+):([^}]+)\}/g, (_value, rawIndex) => {
      const parameterIndex = Number(rawIndex);
      const marker = `BOO参数${parameterIndex}值`;
      markers.set(parameterIndex, marker);
      return marker;
    });
    const token = helpers.findSayMarkupTokens(sample, index)[0];
    assert.ok(token, `${engine} ${entry.id} must resolve its SAY markup token`);
    assert.equal(token.entry.id, entry.id, `${engine} ${entry.id} selected the wrong SAY variant`);
    const meanings = helpers.sayMarkupParameterMeanings(entry);
    for (const [parameterIndex, marker] of markers) {
      const parameter = helpers.findSayMarkupParameterAt(sample, sample.indexOf(marker), index);
      assert.ok(parameter, `${engine} ${entry.id} parameter ${parameterIndex} must support hover`);
      assert.equal(parameter.index, parameterIndex, `${engine} ${entry.id} parameter index mismatch`);
      assert.ok(meanings.includes(parameter.meaning), `${engine} ${entry.id} parameter meaning is missing`);
    }
    verifiedEntries++;
  }
  return verifiedEntries;
}

function verifyKeyedSayParameterCatalog(entries, engine, helpers) {
  const index = helpers.buildSayMarkupIndex(entries);
  let verifiedParameters = 0;
  for (const entry of entries) {
    const token = helpers.sayMarkupTokenFromLabel(entry.label);
    if (!token || !entry.parameters?.some(parameter => parameter.key)) continue;
    for (const parameter of entry.parameters) {
      if (!parameter.key) continue;
      const marker = `BOO${verifiedParameters}值`;
      const sample = `${token}|${parameter.key}=${marker}>`;
      const span = helpers.findSayMarkupParameterAt(sample, sample.indexOf(marker), index);
      assert.ok(span, `${engine} ${entry.id}.${parameter.key} must support parameter hover`);
      assert.equal(span.meaning, parameter.description, `${engine} ${entry.id}.${parameter.key} meaning mismatch`);
      for (const alias of parameter.aliases || []) {
        const aliasSample = `${token}|${alias}=${marker}>`;
        assert.equal(
          helpers.findSayMarkupParameterAt(aliasSample, aliasSample.indexOf(marker), index)?.meaning,
          parameter.description,
          `${engine} ${entry.id}.${alias} alias meaning mismatch`
        );
      }
      verifiedParameters++;
    }
  }
  return verifiedParameters;
}

function main() {
  const { activeStaticLanguageEntries } = require('../out/utils/static-language');
  const {
    buildSayMarkupIndex,
    findSayMarkupParameterAt,
    findSayMarkupTokenAt,
    findSayMarkupTokens,
    sayMarkupTokenFromLabel,
    sayMarkupParameterMeanings,
  } = require('../out/utils/say-markup');
  const data = readJson('data/static-language.json');
  const gomSay = activeStaticLanguageEntries(data.saySnippets, 'GOM');
  const geeSay = activeStaticLanguageEntries(data.saySnippets, 'GEE');
  const pc996Say = activeStaticLanguageEntries(data.saySnippets, '996PC');
  const gomMap = activeStaticLanguageEntries(data.mapInfoParams, 'GOM');
  const geeMap = activeStaticLanguageEntries(data.mapInfoParams, 'GEE');
  const pc996Map = activeStaticLanguageEntries(data.mapInfoParams, '996PC');

  assert.equal(data.schemaVersion, 1);
  assert.equal(data.revision, '2026-08-24');
  assert.equal(data.saySnippets.length, 66);
  assert.equal(data.mapInfoParams.length, 106);
  assert.equal(gomSay.length, 27);
  assert.equal(geeSay.length, 33);
  assert.equal(pc996Say.length, 41);
  assert.equal(gomMap.length, 77);
  assert.equal(geeMap.length, 85);
  assert.equal(pc996Map.length, 75);

  for (const entries of [data.saySnippets, data.mapInfoParams]) {
    const ids = entries.map(entry => entry.id);
    assert.equal(new Set(ids).size, ids.length, 'static language ids must be unique');
    for (const entry of entries) {
      for (const value of Object.values(entry.engineVariants)) {
        assert.ok(value.label);
        assert.ok(value.description);
        assert.ok(value.source?.page);
        assert.ok(['2026-07-23', '2026-07-26', '2026-08-24'].includes(value.source.revision));
      }
    }
  }
  for (const entry of data.saySnippets) {
    for (const value of Object.values(entry.engineVariants)) assert.ok(value.snippet);
  }

  for (const entries of [gomSay, geeSay, pc996Say]) {
    assert.equal(entries.some(entry => entry.id === 'human-variable'), false);
    assert.equal(entries.some(entry => entry.id === 'guild-variable'), false);
  }
  assert.match(byId(gomSay, 'imgex-absolute').snippet, /WIL序号.*默认图片.*移入图片.*按下图片/);
  assert.match(byId(gomSay, 'image-number').snippet, /开始图片.*数字值.*字符间隔.*方向/);
  assert.equal(
    byId(gomSay, 'item-box').label,
    '<ITEMBOX:N:F:M:X:Y:W:H:S:T>'
  );
  assert.equal(
    byId(pc996Say, 'item-show').label,
    '<ITEMSHOW:D:F:X:Y:B>'
  );
  assert.doesNotMatch(byId(pc996Say, 'input-text').label, /<&/);
  assert.match(
    byId(pc996Say, 'playimg-relative-996pc').snippet,
    /绘制模式.*播放次数.*修复模式/
  );
  assert.equal(byId(gomSay, 'monster-preview').label, '<MONSTER:APPR:RACE:动作:方向:X:Y>');
  assert.equal(byId(geeSay, 'monster-preview').label, '<MONSTER:RaceImg:Appr:显示方式:方向:X:Y>');
  assert.equal(byId(pc996Say, 'newui-button-996pc').label.startsWith('<Button|'), true);
  assert.equal(gomSay.some(entry => entry.id === 'newui-button-996pc'), false);
  assert.equal(geeSay.some(entry => entry.id === 'newui-button-996pc'), false);

  const gomMarkup = buildSayMarkupIndex(gomSay);
  const markupLine = '欢迎<&text:测试:10:20{FCOLOR=251}/@下一页><IMG:1:2:3:4>';
  const markupTokens = findSayMarkupTokens(markupLine, gomMarkup);
  assert.deepEqual(markupTokens.map(item => item.text), ['<&text', '<IMG']);
  assert.equal(markupTokens[0].entry.id, 'text-absolute-link');
  assert.deepEqual(
    sayMarkupParameterMeanings(markupTokens[0].entry),
    ['内容', 'X', 'Y', '文字颜色', '标签']
  );
  assert.equal(
    findSayMarkupTokenAt(markupLine, markupLine.indexOf('text') + 2, gomMarkup)?.entry.id,
    'text-absolute-link'
  );
  const contentParameter = findSayMarkupParameterAt(
    markupLine,
    markupLine.indexOf('测试'),
    gomMarkup
  );
  assert.deepEqual(
    contentParameter && {
      index: contentParameter.index,
      meaning: contentParameter.meaning,
      text: markupLine.slice(contentParameter.start, contentParameter.end),
    },
    { index: 1, meaning: '内容', text: '测试' }
  );
  const xParameter = findSayMarkupParameterAt(markupLine, markupLine.indexOf('10'), gomMarkup);
  assert.equal(xParameter?.index, 2);
  assert.equal(xParameter?.meaning, 'X');
  const colorParameter = findSayMarkupParameterAt(markupLine, markupLine.indexOf('251'), gomMarkup);
  assert.equal(colorParameter?.index, 4);
  assert.equal(colorParameter?.meaning, '文字颜色');
  const labelParameter = findSayMarkupParameterAt(markupLine, markupLine.indexOf('下一页'), gomMarkup);
  assert.equal(labelParameter?.index, 5);
  assert.equal(labelParameter?.meaning, '标签');
  assert.equal(
    findSayMarkupParameterAt(markupLine, markupLine.indexOf('text') + 2, gomMarkup),
    undefined,
    'the SAY command name must keep the full command hover'
  );

  const pipeLine = '<IMG:1:2:3:4|鼠标备注>';
  const pipeParameter = findSayMarkupParameterAt(pipeLine, pipeLine.indexOf('鼠标备注'), gomMarkup);
  assert.equal(pipeParameter?.index, 5);
  assert.equal(pipeParameter?.meaning, '悬停备注');
  const nestedLine = '<&IMG:7:110:<$STR(N$X)>:20>';
  const nestedParameter = findSayMarkupParameterAt(nestedLine, nestedLine.indexOf('<$STR'), gomMarkup);
  assert.equal(nestedParameter?.index, 3);
  assert.equal(nestedParameter?.meaning, 'X');
  assert.equal(nestedParameter?.text, '<$STR(N$X)>');
  assert.deepEqual(findSayMarkupTokens('; <&TEXT:不应高亮>', gomMarkup), []);
  const shortListView = '<ListView:~#L1:0:0:250:150:1>';
  assert.equal(
    findSayMarkupParameterAt(shortListView, shortListView.indexOf('250'), gomMarkup)?.meaning,
    '容器宽度'
  );
  assert.equal(
    findSayMarkupParameterAt(shortListView, shortListView.lastIndexOf(':1') + 1, gomMarkup)?.meaning,
    '子控件间隔'
  );

  const pc996Markup = buildSayMarkupIndex(pc996Say);
  assert.equal(findSayMarkupTokens('<&TEXT:不属于996PC>', pc996Markup).length, 0);
  assert.equal(findSayMarkupTokens('<TEXT:996PC:1:2>', pc996Markup).length, 1);
  const newTextLine = '<Text|color=251|text=新界面|y=20|x=10|link=@下一页>';
  const newTextToken = findSayMarkupTokens(newTextLine, pc996Markup)[0];
  assert.equal(newTextToken.entry.id, 'newui-text-996pc');
  const newTextX = findSayMarkupParameterAt(
    newTextLine,
    newTextLine.indexOf('x=10') + 1,
    pc996Markup
  );
  assert.equal(newTextX?.meaning, '坐标X');
  assert.equal(newTextX?.text, 'x=10');
  const newTextValue = findSayMarkupParameterAt(
    newTextLine,
    newTextLine.indexOf('新界面'),
    pc996Markup
  );
  assert.equal(newTextValue?.meaning, '显示文字');
  const nestedNewText = '<Text|text={<$STR(S$标题)>/FCOLOR=251}|x=10|y=20>';
  assert.equal(
    findSayMarkupParameterAt(nestedNewText, nestedNewText.indexOf('S$标题'), pc996Markup)?.meaning,
    '显示文字'
  );
  const sayHelpers = {
    buildSayMarkupIndex,
    findSayMarkupParameterAt,
    findSayMarkupTokens,
    sayMarkupTokenFromLabel,
    sayMarkupParameterMeanings,
  };
  assert.equal(verifySayParameterCatalog(gomSay, 'GOM', sayHelpers), 24);
  assert.equal(verifySayParameterCatalog(geeSay, 'GEE', sayHelpers), 30);
  assert.equal(verifySayParameterCatalog(pc996Say, '996PC', sayHelpers), 38);
  assert.ok(
    verifyKeyedSayParameterCatalog(pc996Say, '996PC', sayHelpers) >= 250,
    'every documented 996PC key-value interface parameter must support hover'
  );
  for (const removed of [
    'item-show-ex',
    'group-text',
    'tips',
    'npc-image',
    'use-button',
    'scatter-text',
  ]) {
    assert.equal(data.saySnippets.some(entry => entry.id === removed), false);
  }

  assert.equal(gomMap.some(entry => entry.id === 'DECGAMEPOINT'), false);
  assert.equal(geeMap.some(entry => entry.id === 'DECGAMEPOINT'), true);
  assert.equal(gomMap.some(entry => entry.id === 'NOHORSE'), false);
  assert.equal(geeMap.some(entry => entry.id === 'NOHORSE'), true);
  assert.equal(gomMap.some(entry => entry.id === 'FIGHT5'), true);
  assert.equal(geeMap.some(entry => entry.id === 'FIGHT5'), false);
  assert.match(byId(gomMap, 'CUSTOMEFFECT').label, /掉血范围/);
  assert.equal(byId(geeMap, 'CUSTOMEFFECT').label, 'CustomEffect(参数)');
  assert.equal(byId(gomMap, 'REVIVAL').label, 'REVIVAL(X:N)');
  assert.equal(byId(geeMap, 'REVIVAL').label, 'REVIVAL(X/N)');
  assert.doesNotMatch(byId(gomMap, 'FIGHT').description, /犯法地图，爆装备/);
  assert.doesNotMatch(byId(geeMap, 'FIGHT').description, /犯法地图，爆装备/);
  assert.equal(byId(pc996Map, 'TIMEMAP').label, 'TimeMap(3|5|1|@计时地图返回)');
  assert.equal(byId(pc996Map, 'MAXPLAYER').label, 'maxplayer(3)');
  assert.equal(byId(pc996Map, 'FLAME').label, 'FLAME(45:82:50|43:84:50)');

  console.log('static-language.test.js: PASS');
}

main();
