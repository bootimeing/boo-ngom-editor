const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function findChromiumBrowsers() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, BOO_BROWSER_VERSION_EXECUTABLE: executable },
    });
    const value = String(result.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0]
    || '<unknown>';
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function parseEngine(engine, sayLines, actLines = []) {
  const source = [
    '[@main]',
    ...(actLines.length > 0 ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/flow-link-browser-${engine}.txt`,
    fileName: `flow-link-browser-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\flow-link-browser-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function findByText(elements, text) {
  return elements.find(element => element.text === text);
}

function findByRaw(elements, marker) {
  return elements.find(element => String(element.raw || '').includes(marker));
}

function buildBrowserModel() {
  const gom = parseEngine('GOM', [
    '<GOM普通链接/@gomPlain>',
    '<GOM带参数/@gomBuy(20,麻痹戒指)>',
    '<GOM彩色文字/FCOLOR=251>',
    '<&TEXT:GOM绝对文字:10:20{FCOLOR=251}/@gomAbs>',
    '<UserItem:0:30:40:1:0:0:0:40:0:0/@gomEquip>',
    '<IMG:1185:1:10:20/@gomImg>',
    '<IMGEX:0:1600:1601:1602:30:40/@gomImgEx>',
    '<&TEXT:GOM可拖链接:254:504{FCOLOR=249}/@gomDrag>',
    '<&TEXT:<$STR(S$RANK_NAME)>|249#点击查看装备:504:504{FCOLOR=249}/@viewEquip(<$STR(S$RANK_NAME)>)>',
  ]);
  const gee = parseEngine('GEE', [
    '<GEE普通链接/@geePlain>',
    '<GEE带参数/@geeBuy(20,麻痹戒指)>',
    '<GEE彩色文字/FCOLOR=251>',
    '<&TEXT:GEE绝对文字:10:20{FCOLOR=251}/@geeAbs>',
    '<&ITEMSHOW:1927:2:10:20:1:0:0:1/@geeItem>',
    '<UserItem:0:30:40:1:0/@geeEquip>',
    '<StateItem:88:80:90:1|状态提示/@geeState>',
    '<DnItems:99:100:110:0|掉落提示/@geeDn>',
  ]);
  const pc = parseEngine('996PC', [
    '<996普通链接/@pcPlain>',
    '<996带参数/@pcBuy(20,麻痹戒指)>',
    '<996彩色文字/FCOLOR=250>',
    '<IMG:1:2:10:20/@pcImg>',
    '<TEXT:996旧文字:30:40{FCOLOR=250}/@pcText>',
    '<IMGEX:0:120:121:122:50:60/@pcImgEx>',
    '<996动态链接/@<$STR(S$FLOW_LINK)>(20,<$STR(S$FLOW_PARAM)>)>',
  ], [
    'MOV S$FLOW_LINK 996被借用标签',
    'MOV S$FLOW_PARAM 996被借用参数',
    'GETLISTSTRING missing-runtime-list.txt 0 S$FLOW_LINK S$FLOW_PARAM',
  ]);

  const gomElements = gom.pages[0].elements;
  const geeElements = gee.pages[0].elements;
  const pcElements = pc.pages[0].elements;
  const groups = [
    [
      ['GOM_FLOW_LINK', findByRaw(gomElements, '/@gomPlain')],
      ['GOM_FLOW_PARAMS', findByRaw(gomElements, '/@gomBuy')],
      ['GOM_FLOW_COLOR', findByRaw(gomElements, 'GOM彩色文字')],
      ['GOM_ABS_TEXT', findByRaw(gomElements, 'GOM绝对文字')],
      ['GOM_USERITEM', findByRaw(gomElements, '/@gomEquip')],
      ['GOM_IMG', findByRaw(gomElements, '/@gomImg>')],
      ['GOM_IMGEX', findByRaw(gomElements, '/@gomImgEx')],
      ['GOM_EDITABLE_LINK', findByRaw(gomElements, '/@gomDrag')],
      ['GOM_DYNAMIC_EDITABLE_LINK', findByRaw(gomElements, '/@viewEquip')],
    ],
    [
      ['GEE_FLOW_LINK', findByRaw(geeElements, '/@geePlain')],
      ['GEE_FLOW_PARAMS', findByRaw(geeElements, '/@geeBuy')],
      ['GEE_FLOW_COLOR', findByRaw(geeElements, 'GEE彩色文字')],
      ['GEE_ABS_TEXT', findByRaw(geeElements, 'GEE绝对文字')],
      ['GEE_ITEMSHOW', findByRaw(geeElements, '/@geeItem')],
      ['GEE_USERITEM', findByRaw(geeElements, '/@geeEquip')],
      ['GEE_STATEITEM', findByRaw(geeElements, '/@geeState')],
      ['GEE_DNITEMS', findByRaw(geeElements, '/@geeDn')],
    ],
    [
      ['PC_FLOW_LINK', findByText(pcElements, '996普通链接')],
      ['PC_FLOW_PARAMS', findByText(pcElements, '996带参数')],
      ['PC_FLOW_COLOR', findByText(pcElements, '996彩色文字')],
      ['PC_IMG', findByRaw(pcElements, '/@pcImg>')],
      ['PC_TEXT', findByRaw(pcElements, '/@pcText')],
      ['PC_IMGEX', findByRaw(pcElements, '/@pcImgEx')],
      ['PC_FLOW_DYNAMIC', findByText(pcElements, '996动态链接')],
    ],
  ];

  const elements = [];
  const preserveSourceCoordinates = new Set([
    'GOM_EDITABLE_LINK',
    'GOM_DYNAMIC_EDITABLE_LINK',
  ]);
  for (let column = 0; column < groups.length; column++) {
    for (let row = 0; row < groups[column].length; row++) {
      const [id, sourceElement] = groups[column][row];
      if (!sourceElement) continue;
      const x = 20 + column * 350;
      const y = 25 + row * 62;
      if (preserveSourceCoordinates.has(id)) {
        elements.push({ ...sourceElement, id });
        continue;
      }
      elements.push({
        ...sourceElement,
        id,
        editable: false,
        x: undefined,
        y: undefined,
        coordinateMode: 'absolute',
        localLayoutX: x,
        localLayoutY: y,
        layoutX: x,
        layoutY: y,
        width: Math.max(170, Number(sourceElement.width) || 0),
        height: Math.max(42, Number(sourceElement.height) || 0),
      });
    }
  }

  const base = pc;
  const scene = { ...base.scenes[0], id: 'FLOW_LINK_BROWSER_SCENE', elements };
  const page = { ...base.pages[0], id: 'FLOW_LINK_BROWSER_PAGE', elements };
  base.scenes = [scene];
  base.pages = [page];
  base.canvasWidth = 1100;
  base.canvasHeight = 650;
  return base;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('flow-link-runtime-action-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-flow-link-browser-'));
  try {
    const harness = path.join(temporary, 'flow-link-runtime-action.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(buildBrowserModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  window.__postedMessages.push(message);
  if (message.type === 'ready') setTimeout(function () {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'model', model: window.__model, previewRevision: 1,
      preserveDrafts: false, geeOffsetHelp: ''
    }}));
  }, 0);
}}; };
</script>`;
    html = html.replace(
      `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`
    );

    const scenario = `<script>
(function () {
  var failures = [];
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function boundary(wrapper) {
    var value = wrapper && wrapper.querySelector('.runtime-action-boundary');
    return value ? value.textContent.trim() : '';
  }
  function summary(wrapper) {
    var value = wrapper && wrapper.querySelector('.runtime-action-summary');
    return value ? value.textContent.trim() : '';
  }
  function visible(target) {
    if (!target) return false;
    var style = getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function fire(target, type, options) {
    target.dispatchEvent(new MouseEvent(type, Object.assign({
      bubbles: true, cancelable: true, button: 0
    }, options || {})));
  }
  function actualTextHit(wrapper) {
    var label = wrapper && wrapper.querySelector('.element-text');
    var rect = (label || wrapper).getBoundingClientRect();
    var x = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    var y = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    return { target: document.elementFromPoint(x, y), x: x, y: y };
  }
  function linkedTextStyle(wrapper) {
    var run = wrapper && wrapper.querySelector('.styled-text-line > span, .element-text');
    if (!run) throw new Error('linked text run did not render');
    var style = getComputedStyle(run);
    return { color: style.color, decoration: style.textDecorationLine || '' };
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function assertLocalClick(id, link, parameters) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' did not render');
    var hit = wrapper.querySelector('.runtime-action-hitarea[data-runtime-trigger="click"]');
    var text = boundary(wrapper);
    if (wrapper.dataset.runtimeActionScope !== 'local'
      || wrapper.dataset.runtimeLink !== link
      || wrapper.dataset.runtimeActionInteractive !== 'true') {
      throw new Error(id + ' is missing typed local-only action metadata');
    }
    if ((!hit || hit.disabled) && !wrapper.classList.contains('text-action-link')) {
      throw new Error(id + ' has no enabled local click target');
    }
    if (!/\u4ec5\u672c\u5730\u9884\u89c8/.test(text) || !/\u4e0d\u6267\u884c/.test(text) || text.indexOf(link) < 0) {
      throw new Error(id + ' action boundary is not visibly local-only: ' + text);
    }
    for (var parameter of parameters || []) {
      if (text.indexOf(parameter) < 0) throw new Error(id + ' hides parameter ' + parameter);
    }
    return { wrapper: wrapper, hit: hit || wrapper };
  }

  async function run() {
    for (var attempt = 0; attempt < 100 && !node('GOM_FLOW_LINK'); attempt++) await wait(10);
    if (!node('GOM_FLOW_LINK')) throw new Error('flow-link fixture did not render');

    await check('long canvas diagnostics are hidden by default and explicitly recoverable', async function () {
      var wrapper = node('GOM_DYNAMIC_EDITABLE_LINK');
      var boundaries = Array.from(wrapper.querySelectorAll('.text-field-boundary, .runtime-action-boundary'));
      if (boundaries.length < 2) throw new Error('typed diagnostic nodes were not retained');
      if (boundaries.some(visible)) throw new Error('long diagnostics cover the default editing canvas');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle does not start disabled');
      }
      toggle.click();
      await wait(10);
      if (toggle.getAttribute('aria-pressed') !== 'true' || !boundaries.every(visible)) {
        throw new Error('explicit diagnostics mode did not reveal retained boundaries');
      }
      toggle.click();
      await wait(10);
      if (toggle.getAttribute('aria-pressed') !== 'false' || boundaries.some(visible)) {
        throw new Error('diagnostics mode did not return to a clean canvas');
      }
    });

    await check('every text slash-at action is visibly yellow and underlined', async function () {
      var ids = [
        'GOM_FLOW_LINK', 'GOM_FLOW_PARAMS', 'GOM_ABS_TEXT',
        'GEE_FLOW_LINK', 'GEE_FLOW_PARAMS', 'GEE_ABS_TEXT',
        'PC_FLOW_LINK', 'PC_FLOW_PARAMS', 'PC_TEXT', 'PC_FLOW_DYNAMIC',
        'GOM_EDITABLE_LINK', 'GOM_DYNAMIC_EDITABLE_LINK'
      ];
      for (var id of ids) {
        var wrapper = node(id);
        if (!wrapper || !wrapper.classList.contains('text-action-link')) {
          throw new Error(id + ' lacks the text-link identity');
        }
        var style = linkedTextStyle(wrapper);
        if (style.color !== 'rgb(255, 242, 0)' && style.color !== 'rgb(255, 255, 0)') {
          throw new Error(id + ' is not yellow: ' + style.color);
        }
        if (!style.decoration.includes('underline')) {
          throw new Error(id + ' is not underlined: ' + style.decoration);
        }
      }
    });

    await check('all three engines draw tokenless link/color statements faithfully', async function () {
      var configs = [
        ['GOM', '#ffff00', 'rgb(255, 255, 0)'],
        ['GEE', '#ffff00', 'rgb(255, 255, 0)'],
        ['PC', '#00ff00', 'rgb(0, 255, 0)'],
      ];
      for (var config of configs) {
        var prefix = config[0];
        var plain = assertLocalClick(prefix + '_FLOW_LINK',
          prefix === 'PC' ? '@pcPlain' : '@' + prefix.toLowerCase() + 'Plain', []);
        var parameterized = assertLocalClick(prefix + '_FLOW_PARAMS',
          prefix === 'PC' ? '@pcBuy' : '@' + prefix.toLowerCase() + 'Buy', ['20', '麻痹戒指']);
        var color = node(prefix + '_FLOW_COLOR');
        var colorRun = color && color.querySelector('.styled-text-line span, .element-text');
        if (!plain.wrapper.textContent.includes(prefix === 'PC' ? '996普通链接' : prefix + '普通链接')) {
          throw new Error(prefix + ' linked text is not visible');
        }
        if (!parameterized.wrapper.textContent.includes(prefix === 'PC' ? '996带参数' : prefix + '带参数')) {
          throw new Error(prefix + ' parameterized text is not visible');
        }
        if (!colorRun || ![config[1], config[2]].includes(colorRun.style.color)) {
          throw new Error(prefix + ' flow color is not visible: ' + (colorRun && colorRun.style.color));
        }
        if (color.querySelector('.runtime-action-hitarea')) {
          throw new Error(prefix + ' color-only text invented a click action');
        }
      }
    });

    await check('existing linked controls expose the same local-only click boundary', async function () {
      var actions = [
        ['GOM_ABS_TEXT', '@gomAbs'], ['GOM_USERITEM', '@gomEquip'],
        ['GOM_IMG', '@gomImg'], ['GOM_IMGEX', '@gomImgEx'],
        ['GEE_ABS_TEXT', '@geeAbs'], ['GEE_ITEMSHOW', '@geeItem'],
        ['GEE_USERITEM', '@geeEquip'], ['GEE_STATEITEM', '@geeState'], ['GEE_DNITEMS', '@geeDn'],
        ['PC_IMG', '@pcImg'], ['PC_TEXT', '@pcText'], ['PC_IMGEX', '@pcImgEx'],
      ];
      var postStart = window.__postedMessages.length;
      var href = location.href;
      for (var action of actions) {
        var value = assertLocalClick(action[0], action[1], []);
        value.hit.click();
        await wait(5);
        var text = summary(node(action[0]));
        if (text.indexOf(action[1]) < 0 || !/\u4ec5\u672c\u5730\u9884\u89c8/.test(text) || !/\u4e0d\u6267\u884c/.test(text)) {
          throw new Error(action[0] + ' local summary is incomplete: ' + text);
        }
      }
      var emitted = window.__postedMessages.slice(postStart);
      if (emitted.length) throw new Error('legacy actions posted extension/server messages: ' + JSON.stringify(emitted));
      if (window.__openedLinks.length || location.href !== href) {
        throw new Error('legacy action navigated or opened an external/server target');
      }
    });

    await check('parameterized click summarizes source-order arguments without server execution', async function () {
      var postStart = window.__postedMessages.length;
      var href = location.href;
      var value = assertLocalClick('GOM_FLOW_PARAMS', '@gomBuy', ['20', '麻痹戒指']);
      value.hit.click();
      await wait(20);
      var text = summary(node('GOM_FLOW_PARAMS'));
      if (text.indexOf('@gomBuy') < 0 || text.indexOf('20') < 0 || text.indexOf('麻痹戒指') < 0) {
        throw new Error('parameterized local summary lost link/parameters: ' + text);
      }
      if (window.__postedMessages.length !== postStart || window.__openedLinks.length || location.href !== href) {
        throw new Error('parameterized local click reached an extension/server/navigation boundary');
      }
    });

    await check('dynamic link and arguments never borrow MOV values', async function () {
      var wrapper = node('PC_FLOW_DYNAMIC');
      var text = boundary(wrapper);
      if (!wrapper || wrapper.dataset.runtimeActionScope !== 'local'
        || wrapper.dataset.runtimeActionInteractive !== 'false') {
        throw new Error('dynamic flow action is not a blocked local-only action');
      }
      if (wrapper.querySelector('.runtime-action-hitarea:not([disabled])')) {
        throw new Error('dynamic flow action retained an executable click target');
      }
      if (!/动态.*不借用|不借用.*动态/.test(text)) {
        throw new Error('dynamic source-safety boundary is not visible: ' + text);
      }
      if (/996被借用标签|996被借用参数/.test(wrapper.textContent)) {
        throw new Error('dynamic DOM exposed a MOV preview value: ' + wrapper.textContent);
      }
      if (text.indexOf('<$STR(S$FLOW_PARAM)>') < 0) {
        throw new Error('dynamic parameter source is not visible and auditable: ' + text);
      }
    });

    await check('actual hit targets select and drag enabled and blocked text links', async function () {
      var postStart = window.__postedMessages.length;
      var href = location.href;
      for (var entry of [
        ['GOM_EDITABLE_LINK', false],
        ['GOM_DYNAMIC_EDITABLE_LINK', true],
      ]) {
        var id = entry[0];
        var blocked = entry[1];
        var wrapper = node(id);
        if (!wrapper || wrapper.classList.contains('locked')) {
          throw new Error(id + ' did not retain static coordinate editability');
        }
        if (blocked && wrapper.querySelector('.runtime-action-hitarea')) {
          throw new Error(id + ' retained a disabled full-element action overlay');
        }
        var beforeLeft = Number.parseFloat(wrapper.style.left);
        var beforeTop = Number.parseFloat(wrapper.style.top);
        var hit = actualTextHit(wrapper);
        if (!hit.target || !wrapper.contains(hit.target)) {
          throw new Error(id + ' elementFromPoint missed the visible linked text');
        }
        if (hit.target.closest('.runtime-action-hitarea')) {
          throw new Error(id + ' real hit is still intercepted by runtime-action-hitarea');
        }
        fire(hit.target, 'mousedown', { clientX: hit.x, clientY: hit.y, buttons: 1 });
        fire(window, 'mousemove', { clientX: hit.x + 24, clientY: hit.y + 12, buttons: 1 });
        fire(window, 'mouseup', { clientX: hit.x + 24, clientY: hit.y + 12, buttons: 0 });
        fire(hit.target, 'click', { clientX: hit.x + 24, clientY: hit.y + 12 });
        await wait(15);
        wrapper = node(id);
        var afterLeft = Number.parseFloat(wrapper.style.left);
        var afterTop = Number.parseFloat(wrapper.style.top);
        if (afterLeft !== beforeLeft + 24 || afterTop !== beforeTop + 12) {
          throw new Error(id + ' drag failed: ' + beforeLeft + ',' + beforeTop
            + ' -> ' + afterLeft + ',' + afterTop);
        }
        if (!wrapper.classList.contains('selected')) {
          throw new Error(id + ' drag did not leave the real element selected');
        }
        if (summary(wrapper)) throw new Error(id + ' drag accidentally triggered its local action');

        var beforeKeyboard = Number(document.getElementById('elementX').value);
        document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', bubbles: true, cancelable: true
        }));
        await wait(5);
        var afterKeyboard = Number(document.getElementById('elementX').value);
        if (afterKeyboard !== beforeKeyboard + 1) {
          throw new Error(id + ' keyboard nudge failed: ' + beforeKeyboard + ' -> ' + afterKeyboard);
        }
      }

      var enabled = node('GOM_EDITABLE_LINK');
      var clickHit = actualTextHit(enabled);
      fire(clickHit.target, 'mousedown', { clientX: clickHit.x, clientY: clickHit.y, buttons: 1 });
      fire(window, 'mouseup', { clientX: clickHit.x, clientY: clickHit.y, buttons: 0 });
      fire(clickHit.target, 'click', { clientX: clickHit.x, clientY: clickHit.y });
      await wait(15);
      if (summary(node('GOM_EDITABLE_LINK')).indexOf('@gomDrag') < 0) {
        throw new Error('a stationary click did not produce the local-only action summary');
      }
      var blockedWrapper = node('GOM_DYNAMIC_EDITABLE_LINK');
      var blockedHit = actualTextHit(blockedWrapper);
      fire(blockedHit.target, 'click', { clientX: blockedHit.x, clientY: blockedHit.y });
      await wait(5);
      if (summary(node('GOM_DYNAMIC_EDITABLE_LINK'))) {
        throw new Error('blocked dynamic action produced a local action result');
      }

      var unexpected = window.__postedMessages.slice(postStart).filter(function (message) {
        return message.type !== 'dirtyChanged';
      });
      if (unexpected.length || window.__openedLinks.length || location.href !== href) {
        throw new Error('selection/drag/click escaped the local canvas boundary: '
          + JSON.stringify(unexpected));
      }
    });

    document.body.dataset.flowLinkDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.flowLinkTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.flowLinkErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.flowLinkTest = 'fail';
    document.body.dataset.flowLinkErrors = '[dom] scenario: '
      + (error && error.stack ? error.stack : String(error));
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1280,820', '--virtual-time-budget=2200', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-flow-link-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }
    if (!selected) {
      return [`[browser] no installed candidate produced a completed DOM:\n${attempts.map(
        ({ candidate, result }) => browserDiagnostic(candidate, result)
      ).join('\n')}`];
    }
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`flow-link-runtime-action-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-flow-link-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`flow-link-runtime-action-browser.test.js: browser=${selected.candidate}`);
    console.log(`flow-link-runtime-action-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`flow-link-runtime-action-browser.test.js: DOM=${domCount}`);
    if (/data-flow-link-test="pass"/.test(selected.result.stdout)) return [];
    const encoded = /data-flow-link-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    return decodeAttribute(encoded).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_FLOW_LINK_TEST_TEMP === '1') {
      console.log(`flow-link-runtime-action-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length) {
    console.error('flow-link-runtime-action-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('flow-link-runtime-action-browser.test.js: PASS');
}

main();
