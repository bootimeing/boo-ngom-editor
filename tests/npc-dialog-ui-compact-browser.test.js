const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { parse } = require('./preview-inputs.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));

function browserCandidate(base, ...parts) {
  return base ? path.join(base, ...parts) : undefined;
}

function findChromiumBrowsers() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
    browserCandidate(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    browserCandidate(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    browserCandidate(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    browserCandidate(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-Item -LiteralPath $env:BOO_COMPACT_BROWSER).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, BOO_COMPACT_BROWSER: executable },
    });
    const value = String(result.stdout || '').trim().split(/\r?\n/u, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  return String(result.stdout || result.stderr || '').trim().split(/\r?\n/u, 1)[0] || '<unknown>';
}

function diagnostic(candidate, result) {
  const status = result.status === null ? '<null>' : String(result.status);
  const body = /<body\b/iu.test(result.stdout || '');
  const pageStatus = String(result.stdout || '').match(/data-compact-ui-test="([^"]*)"/u)?.[1];
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/gu, '\\n') || '<empty>';
  return `${candidate}: status=${status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, body=${body}, `
    + `page=${pageStatus || '<none>'}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

function bodyAttribute(output, name) {
  const body = String(output || '').match(/<body\b([^>]*)>/iu);
  if (!body) return undefined;
  return body[1].match(new RegExp(`data-${name}="([^"]*)"`, 'u'))?.[1];
}

function buildModels() {
  const unconditional = parse([
    '[@main]',
    '#SAY',
    '<TEXT:\u9ed8\u8ba4\u5185\u5bb9:10:10>',
  ].join('\n'));

  const conditional = parse([
    '[@main]',
    '#IF',
    'CHECK [101] 1',
    '#SAY',
    '<TEXT:\u5f00\u542f:10:10>',
    '#ELSESAY',
    '<TEXT:\u5173\u95ed:10:10>',
  ].join('\n'));
  conditional.previewInputs.push(
    {
      name: 'U101',
      kind: 'number',
      description: 'GOM U \u7f16\u53f7\u6570\u503c\u53d8\u91cf\uff1b\u81ea\u52a8\u65f6\u6e90\u7801\u53ef\u786e\u5b9a\u503c\u4f18\u5148\uff0c\u672a\u77e5\u65f6\u7528 0',
    },
    {
      name: 'S$\u540d\u5b57',
      kind: 'text',
      description: 'GOM S$ \u547d\u540d\u6587\u5b57\u53d8\u91cf\uff1b\u81ea\u52a8\u65f6\u6e90\u7801\u53ef\u786e\u5b9a\u503c\u4f18\u5148\uff0c\u672a\u77e5\u65f6\u7528\u9884\u89c8\u6587\u5b57',
    },
  );
  conditional.warnings = [
    '\u517c\u5bb9\u6027\u8bf4\u660e\uff1a\u8fd9\u662f\u5b8c\u6574\u8bca\u65ad\u6587\u5b57\uff0c\u9ed8\u8ba4\u754c\u9762\u4e0d\u5e94\u5e38\u9a7b\u5c55\u793a\u3002',
  ];
  conditional.pages[0].warnings = [
    '\u573a\u666f\u8bca\u65ad\uff1a\u5f00\u542f\u201c\u663e\u793a\u8bca\u65ad\u201d\u540e\u4ecd\u5fc5\u987b\u80fd\u67e5\u5230\u8fd9\u6761\u8be6\u60c5\u3002',
  ];
  conditional.pages[0].unsupportedStatements = ['<UNSUPPORTEDUI:1:2:3>'];
  const conditionFamilies = JSON.parse(JSON.stringify(conditional));
  conditionFamilies.conditionGroups[0].conditions = [
    'NOT CHECK [101] 0',
    'LARGE U101 5',
    'CHECKJOB warrior',
    'CHECKNAMELIST ..\\QuestDiary\\名单.txt',
    'CHECKVARINLIST L$名单 张三',
    'CHECKCUSTOM <$STR(S$未知)> abc',
  ];
  conditionFamilies.conditionGroups[0].operators = Array(6).fill('AND');
  return { unconditional, conditional, conditionFamilies };
}

function main() {
  const browsers = findChromiumBrowsers();
  if (browsers.length === 0) {
    if (process.env.BOO_REQUIRE_REAL_BROWSER === '1') {
      throw new Error('BOO_REQUIRE_REAL_BROWSER=1, but no Edge or Chrome executable was found');
    }
    console.log('npc-dialog-ui-compact-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-npc-compact-ui-'));
  try {
    const models = buildModels();
    const harness = path.join(temporary, 'compact-ui.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
    const mock = `<script>
window.__compactModels = ${JSON.stringify(models).replace(/</gu, '\\u003c')};
window.__compactMessages = [];
window.__compactDeliver = function (model, revision) {
  window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'model', model: model, previewRevision: revision,
    preserveDrafts: revision > 1, geeOffsetHelp: ''
  }}));
};
window.acquireVsCodeApi = function () {
  return { postMessage: function (message) {
    window.__compactMessages.push(message);
    if (message.type === 'ready') {
      setTimeout(function () { window.__compactDeliver(window.__compactModels.unconditional, 1); }, 0);
    }
  }};
};
window.addEventListener('error', function (event) {
  document.body.dataset.compactUiError = event.error && event.error.stack
    ? event.error.stack : String(event.message || 'unknown error');
});
</script>`;
    html = html.replace(renderer, () => mock + renderer);
    const scenario = `<script>
(function () {
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function check(value, message) { if (!value) throw new Error(message); }
  function visible(node) {
    if (!node) return false;
    var style = getComputedStyle(node);
    var rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  }
  function sectionFor(id) { return document.getElementById(id); }
  function directHeading(selector) {
    var node = document.querySelector(selector);
    return node ? node.textContent.trim() : '';
  }
  async function run() {
    for (var attempt = 0; attempt < 80; attempt++) {
      if (document.getElementById('sceneTitle').textContent.indexOf('@main') >= 0) break;
      await wait(40);
    }
    if (document.body.dataset.compactUiError) throw new Error(document.body.dataset.compactUiError);

    var previewSection = sectionFor('previewInputSection');
    var diagnosticSections = [sectionFor('sceneWarningsSection'), sectionFor('unsupportedSection')];
    var inspectorPane = document.querySelector('.inspector-pane');
    check(previewSection && sectionFor('conditionSection') && sectionFor('variableSection')
      && sectionFor('changeSection') && diagnosticSections.every(Boolean),
      'compact UI section IDs are missing');
    check(!visible(previewSection), 'empty condition/variable editor still occupies the left pane');
    check(!visible(sectionFor('conditionSection')), 'unconditional page still shows an empty/default condition block');
    check(!visible(sectionFor('variableSection')), 'empty script-variable block still occupies the left pane');
    check(!visible(sectionFor('changeSection')), 'empty coordinate-change block still occupies the left pane');
    check(!visible(document.getElementById('offsetBar')) && !document.body.classList.contains('has-offsets'),
      'read-only non-GEE text offsets still occupy the default layout');
    check(diagnosticSections.length >= 2 && diagnosticSections.every(function (node) { return !visible(node); }),
      'right-side diagnostics are visible before the explicit diagnostics toggle');
    check(!visible(inspectorPane), 'empty Inspector still reserves canvas width');
    check(document.getElementById('sceneTitle').textContent.indexOf('\u9ed8\u8ba4\u754c\u9762') < 0,
      'canvas heading repeats the default-page explanation');
    check(document.getElementById('emptyInspector').textContent.indexOf('\u6309\u4f4f\u9f20\u6807\u62d6\u52a8') < 0,
      'empty Inspector still contains the long mouse/keyboard tutorial');
    check(document.getElementById('canvasDiagnosticsToggle').title.indexOf('\u9ed8\u8ba4\u9690\u85cf\u753b\u5e03\u4e0a\u7684\u957f\u7bc7\u8bca\u65ad') < 0,
      'diagnostics toggle still embeds a long explanation in its native title');

    var staleSearch = document.getElementById('previewInputSearch');
    staleSearch.value = 'stale-filter';
    window.__compactDeliver(window.__compactModels.conditional, 2);
    await wait(100);
    previewSection = sectionFor('previewInputSection');
    check(visible(previewSection), 'non-empty condition/variable editor was hidden');
    check(directHeading('.preview-input-section > strong') === '\u6761\u4ef6\u4e0e\u53d8\u91cf',
      'left editor heading is not the compact \u201c\u6761\u4ef6\u4e0e\u53d8\u91cf\u201d label');
    var tutorial = document.querySelector('.preview-input-section > small');
    check(!visible(tutorial), 'left editor tutorial still occupies default layout space');

    var rows = Array.from(document.querySelectorAll('.preview-input-row'));
    check(rows.length === 3, 'expected one shared flag, one number, and one text input');
    check(staleSearch.hidden && staleSearch.value === '',
      'hidden search retained a stale filter that can conceal compact-page inputs');
    var expectedTypes = { '[101]': '\u5f00\u5173', 'U101': '\u6570\u5b57', 'S$\u540d\u5b57': '\u6587\u5b57' };
    rows.forEach(function (row) {
      var type = row.querySelector('.preview-input-type');
      var description = row.querySelector('.preview-input-description');
      var state = row.querySelector('.preview-input-state');
      var control = row.querySelector('[data-preview-name]');
      var automatic = row.querySelector('.preview-input-reset');
      check(type && type.textContent.trim() === expectedTypes[row.dataset.name],
        'verbose or inconsistent type label for ' + row.dataset.name + ': ' + (type && type.textContent));
      check(!visible(description), 'variable-family explanation is visible for ' + row.dataset.name);
      check(!visible(state), 'normal automatic/source state is visible for ' + row.dataset.name);
      check(control && visible(control), 'input control is not visible for ' + row.dataset.name);
      check(automatic && automatic.getAttribute('aria-pressed') === 'true'
        && automatic.classList.contains('active'),
        'Auto is not distinguishable from an explicit empty/off value for ' + row.dataset.name);
      var controlBox = control.getBoundingClientRect();
      var hit = document.elementFromPoint(
        controlBox.left + controlBox.width / 2,
        controlBox.top + controlBox.height / 2
      );
      check(hit === control || control.contains(hit), 'input control is covered for ' + row.dataset.name);
    });
    check(previewSection.getBoundingClientRect().height <= 300,
      'three compact inputs still consume more than 300px of vertical space');
    check(visible(sectionFor('conditionSection')), 'real condition block was hidden');
    check(document.getElementById('conditionText').textContent.trim() === '[101] = \u5f00',
      'condition is not rendered as a compact expression');
    check(document.getElementById('sceneTitle').textContent.indexOf('\u4e2a\u6761\u4ef6') < 0
      && document.getElementById('sceneTitle').textContent.indexOf('\u4e2a\u6ee1\u8db3') < 0,
      'canvas heading repeats condition counters already available in the left pane');
    check(!visible(sectionFor('variableSection')), 'empty resolved-variable block became visible');
    check(!visible(sectionFor('changeSection')), 'empty coordinate-change block became visible');
    check(!visible(document.getElementById('statusBanner')),
      'ordinary compatibility diagnostics are promoted to a persistent top banner');
    check(diagnosticSections.every(function (node) { return !visible(node); }),
      'diagnostic detail became visible without opting in');
    var toolbarBox = document.querySelector('.toolbar').getBoundingClientRect();
    check(document.documentElement.scrollWidth <= window.innerWidth + 1
      && document.body.scrollWidth <= window.innerWidth + 1,
      'compact editor creates a document-level horizontal scrollbar');
    check(toolbarBox.left >= -1 && toolbarBox.right <= window.innerWidth + 1,
      'toolbar actions overflow the narrow native preview window');
    if (new URLSearchParams(location.search).get('snapshot') === 'default') {
      document.body.dataset.compactUiTest = 'PASS';
      return;
    }

    var toggle = document.getElementById('canvasDiagnosticsToggle');
    check(toggle.getAttribute('aria-pressed') === 'false', 'diagnostics toggle is not off by default');
    toggle.click();
    await wait(40);
    check(toggle.getAttribute('aria-pressed') === 'true', 'diagnostics toggle did not turn on');
    check(document.body.classList.contains('show-diagnostics'),
      'diagnostics toggle did not expose the shared body diagnostics state');
    check(visible(inspectorPane), 'details did not restore the Inspector/diagnostics pane');
    check(visible(document.getElementById('offsetBar')) && document.body.classList.contains('has-offsets'),
      'read-only non-GEE text offsets are not available in details mode');
    check(document.getElementById('offsetX').disabled && document.getElementById('offsetY').disabled,
      'non-GEE text offsets became editable in details mode');
    check(diagnosticSections.every(visible), 'right-side diagnostic sections are not restored by the toggle');
    check(document.getElementById('sceneWarnings').textContent.indexOf('\u5b8c\u6574\u8bca\u65ad\u6587\u5b57') >= 0
      && document.getElementById('sceneWarnings').textContent.indexOf('\u573a\u666f\u8bca\u65ad') >= 0,
      'full model/scene diagnostics cannot be inspected after opting in');
    check(document.getElementById('unsupportedList').textContent.indexOf('UNSUPPORTEDUI') >= 0,
      'unsupported source detail cannot be inspected after opting in');
    check(document.getElementById('conditionText').textContent.indexOf('CHECK [101] 1') >= 0,
      'full source condition cannot be inspected after opting in');
    toggle.click();
    await wait(20);
    check(!document.body.classList.contains('show-diagnostics'),
      'shared body diagnostics state remained on after closing details');
    check(!visible(document.getElementById('offsetBar')) && !document.body.classList.contains('has-offsets'),
      'read-only non-GEE text offsets still occupy layout after closing details');
    check(diagnosticSections.every(function (node) { return !visible(node); }),
      'diagnostic sections remained visible after turning diagnostics off');
    check(!visible(inspectorPane), 'empty Inspector did not collapse after closing details');
    check(document.getElementById('conditionText').textContent.trim() === '[101] = \u5f00',
      'condition did not return to compact form after closing details');

    var explicit = JSON.parse(JSON.stringify(window.__compactModels.conditional));
    explicit.previewInputs.forEach(function (item) {
      item.value = item.kind === 'flag' ? '0' : '';
    });
    window.__compactDeliver(explicit, 3);
    await wait(60);
    Array.from(document.querySelectorAll('.preview-input-row')).forEach(function (row) {
      var automatic = row.querySelector('.preview-input-reset');
      check(automatic.getAttribute('aria-pressed') === 'false'
        && !automatic.classList.contains('active'),
        'explicit empty/off value still looks automatic for ' + row.dataset.name);
    });
    window.__compactDeliver(window.__compactModels.conditional, 4);
    await wait(60);

    window.__compactDeliver(window.__compactModels.conditionFamilies, 5);
    await wait(60);
    var compactFamilies = document.getElementById('conditionText').textContent;
    for (var expected of ['[101] = 开', 'U101 > 5', '职业 = 战士', '名单.txt = 在内', 'L$名单 含 张三', 'CHECKCUSTOM …']) {
      check(compactFamilies.indexOf(expected) >= 0, 'condition family was not compacted: ' + expected);
    }
    check(compactFamilies.indexOf('<$') < 0 && compactFamilies.indexOf('$STR(') < 0,
      'dynamic source expression leaked into compact condition text');
    window.__compactDeliver(window.__compactModels.conditional, 6);
    await wait(60);

    var number = Array.from(document.querySelectorAll('[data-preview-name]')).find(function (input) {
      return input.dataset.previewName === 'U101';
    });
    number.value = '1e3';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(20);
    var numberRow = number.closest('.preview-input-row');
    var errorState = numberRow.querySelector('.preview-input-state');
    check(number.getAttribute('aria-invalid') === 'true', 'invalid number was not marked invalid');
    check(visible(errorState) && errorState.textContent.indexOf('\u5341\u8fdb\u5236\u6570\u5b57') >= 0,
      'input validation error was hidden together with normal explanatory state');

    var canvasElement = document.querySelector('#dialogCanvas [data-element-id]');
    canvasElement.click();
    await wait(20);
    check(visible(inspectorPane), 'selecting a canvas element did not restore its compact Inspector');

    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'conflict', message: '\u6e90\u7801\u51b2\u7a81\uff1a\u8bf7\u5148\u91cd\u65b0\u8f7d\u5165'
    }}));
    await wait(20);
    var banner = document.getElementById('statusBanner');
    check(visible(banner) && banner.textContent.indexOf('\u6e90\u7801\u51b2\u7a81') >= 0,
      'blocking source conflict is not visible');
    check(!banner.classList.contains('info'), 'blocking source conflict uses the informational style');
    check(document.getElementById('applyButton').disabled && document.getElementById('saveButton').disabled,
      'blocking source conflict did not disable writes');

    document.body.dataset.compactUiTest = 'PASS';
  }
  run().catch(function (error) {
    document.body.dataset.compactUiTest = 'FAIL';
    document.body.dataset.compactUiError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', () => `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const sizes = [[1026, 769], [980, 720]];
    const selectedRuns = [];
    const browserVersions = new Map();
    for (const [sizeIndex, [width, height]] of sizes.entries()) {
      const attempts = [];
      let selected;
      for (const [browserIndex, candidate] of browsers.entries()) {
        const result = spawnSync(candidate, [
          '--headless=new',
          '--disable-gpu',
          '--disable-extensions',
          '--no-first-run',
          '--allow-file-access-from-files',
          `--user-data-dir=${path.join(temporary, `profile-${sizeIndex}-${browserIndex}`)}`,
          `--window-size=${width},${height}`,
          '--virtual-time-budget=5000',
          '--dump-dom',
          pathToFileURL(harness).href,
        ], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 12 * 1024 * 1024,
        });
        attempts.push({ candidate, result });
        if (!result.error && result.status === 0 && /<body\b/iu.test(result.stdout || '')) {
          selected = { candidate, result };
          break;
        }
      }
      if (!selected) {
        throw new Error(`No installed Chromium browser returned a DOM at ${width}x${height}:\n${attempts.map(
          ({ candidate, result }) => diagnostic(candidate, result)
        ).join('\n')}`);
      }
      for (const attempt of attempts) {
        if (attempt.result === selected.result) continue;
        console.warn(
          `npc-dialog-ui-compact-browser.test.js: browser candidate failed at ${width}x${height}: `
          + diagnostic(attempt.candidate, attempt.result),
        );
      }
      assert.equal(
        bodyAttribute(selected.result.stdout, 'compact-ui-test'),
        'PASS',
        bodyAttribute(selected.result.stdout, 'compact-ui-error')
          || `${width}x${height}: ${diagnostic(selected.candidate, selected.result)}`,
      );
      if (!browserVersions.has(selected.candidate)) {
        browserVersions.set(selected.candidate, browserVersion(selected.candidate));
      }
      assert.notEqual(
        browserVersions.get(selected.candidate),
        '<unknown>',
        `Could not determine browser version: ${selected.candidate}`,
      );
      selectedRuns.push({ width, height, browser: selected.candidate });
    }

    const screenshotRoot = process.env.BOO_COMPACT_UI_BROWSER_OUT
      ? path.resolve(process.env.BOO_COMPACT_UI_BROWSER_OUT)
      : undefined;
    if (screenshotRoot) {
      fs.mkdirSync(screenshotRoot, { recursive: true });
      for (const [index, run] of selectedRuns.entries()) {
        const screenshotPath = path.join(
          screenshotRoot,
          `npc-dialog-compact-default-${run.width}x${run.height}.png`,
        );
        const screenshot = spawnSync(run.browser, [
          '--headless=new',
          '--disable-gpu',
          '--disable-extensions',
          '--no-first-run',
          '--allow-file-access-from-files',
          `--user-data-dir=${path.join(temporary, `screenshot-profile-${index}`)}`,
          `--window-size=${run.width},${run.height}`,
          '--virtual-time-budget=5000',
          `--screenshot=${screenshotPath}`,
          '--dump-dom',
          `${pathToFileURL(harness).href}?snapshot=default`,
        ], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 12 * 1024 * 1024,
        });
        assert.equal(
          bodyAttribute(screenshot.stdout, 'compact-ui-test'),
          'PASS',
          bodyAttribute(screenshot.stdout, 'compact-ui-error') || diagnostic(run.browser, screenshot),
        );
        assert.ok(fs.statSync(screenshotPath).size > 0, `Screenshot is empty: ${screenshotPath}`);
      }
    }
    console.log(
      `npc-dialog-ui-compact-browser.test.js: PASS (${selectedRuns.map(run => (
        `${run.width}x${run.height}, browser=${run.browser}, version=${browserVersions.get(run.browser)}`
      )).join('; ')})`,
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
