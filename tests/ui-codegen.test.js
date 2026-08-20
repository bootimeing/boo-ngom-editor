const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, name, endMarker) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist in editor.html`);
  const marker = source.indexOf(endMarker, start);
  assert.ok(marker > start, `${name} end marker must exist`);
  return source.slice(start, marker).trim();
}

function renderForEngine(functionSource, engine) {
  const context = {
    currentEngine: engine,
    ENGINE_CONFIG: {
      gom: { supportsCodeGeneration: true },
      lingfeng: { supportsCodeGeneration: true },
      '996pc': { supportsCodeGeneration: true },
    },
    dialogConfig: {
      imgIdx: 0,
      allowMove: 1,
      position: 4,
      offsetX: 3,
      offsetY: -5,
      showCloseBtn: 1,
      closeBtnX: 8,
      closeBtnY: 9,
      independentWin: 1,
    },
    quickImports: { progressBar: null },
    elements: [
      { isImgTag: true, assetIdx: 12, willIdx: 39, x: 0, y: 0 },
      {
        isText: true,
        textContent: '测试文字',
        textColor: 250,
        textScript: '文字触发',
        textFont: '宋体',
        textSize: 12,
        x: 10,
        y: 20,
      },
      {
        isButton: true,
        willIdx: 39,
        buttonImages: [80, 81, 82],
        buttonScript: '按钮触发',
        buttonSendId: 7,
        x: 30,
        y: 40,
      },
      {
        isEffect: true,
        willIdx: 39,
        effectStartIdx: 100,
        effectFrameCount: 8,
        effectSpeed: 60,
        x: 50,
        y: 60,
      },
      { isImgTag: true, assetIdx: 120, willIdx: 39, x: 70, y: 80 },
    ],
  };
  context.engCfg = () => context.ENGINE_CONFIG[context.currentEngine];
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nglobalThis.output = generateCodeSilent('39');`, context);
  return context.output;
}

function main() {
  const editor = fs.readFileSync(
    path.join(__dirname, '..', 'media', 'editor.html'),
    'utf8'
  );
  const pad3 = editor.match(/function pad3\(n\)\{[^\r\n]+\}/)?.[0];
  assert.ok(pad3, 'pad3 must exist in editor.html');
  const generate = extractFunction(
    editor,
    'generateCodeSilent',
    '// 代码 → 画布同步'
  );
  const functionSource = `${pad3}\n${generate}`;
  const gom = renderForEngine(functionSource, 'gom');
  const pc996 = renderForEngine(functionSource, '996pc');
  const gee = renderForEngine(functionSource, 'lingfeng');

  assert.equal(pc996, gom, '996PC UI code must serialize exactly like GOM');
  assert.match(
    pc996,
    /OPENMERCHANTBIGDLG 39 12 1 4 3 -5 1 8 9\n#say/
  );
  assert.match(pc996, /<&imgex:39:80:81:82:030:040:7\/@按钮触发>/);
  assert.match(pc996, /<&PlayImg:39:100:8:60:050:060>/);
  assert.match(pc996, /<&img:120:39:070:080>/);
  assert.notEqual(gee, gom, 'the GEE-only independent-window and PlayImg parameters must remain isolated');
  assert.match(gee, /OPENMERCHANTBIGDLG 39 12 1 4 3 -5 1 8 9 1\n#say/);
  assert.match(gee, /<&PlayImg:39:100:8:60:050:060:0>/);

  console.log('ui-codegen.test.js: PASS');
}

main();
