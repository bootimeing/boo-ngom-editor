const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const {
  parseNpcDialogDocument,
  reflowNpcDialogLayout,
} = require('../out/ui-dialog/source-parser');
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
    const versionResult = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, BOO_BROWSER_VERSION_EXECUTABLE: executable },
    });
    const fileVersion = String(versionResult.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!versionResult.error && versionResult.status === 0 && fileVersion) return fileVersion;
  }
  for (const argument of ['--version', '--product-version']) {
    const versionResult = spawnSync(executable, [argument], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const output = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`
      .trim()
      .split(/\r?\n/, 1)[0];
    if (!versionResult.error && versionResult.status === 0 && output) return output;
  }
  return '<unknown>';
}

function browserAttemptDiagnostic(candidate, attempt) {
  const stderr = String(attempt.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${attempt.status}, signal=${attempt.signal || '<none>'}, `
    + `error=${attempt.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(attempt.stdout || '')}, stderr=${stderr}`;
}

function firstCachedPng() {
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || '',
    'BOO-NGOM-Editor',
    'cache',
    'patch-cache'
  );
  if (!fs.existsSync(cacheRoot)) return undefined;
  const stack = [cacheRoot];
  let visited = 0;
  while (stack.length > 0 && visited < 50000) {
    const current = stack.pop();
    visited++;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && /\.png$/i.test(entry.name)) return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return undefined;
}

function parseModel(source, conditionStates, engine = 'GOM') {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dom-test.txt',
    fileName: 'dom-test.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dom-test.txt',
    documentVersion: 9,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + 7,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
    conditionStates,
  });
}

function prefixFixtureElementIds(elements, prefix) {
  const ids = new Map(elements.map((element, index) => [element.id, `${prefix}-${index}`]));
  for (const element of elements) {
    element.id = ids.get(element.id);
    if (element.parentElementId) element.parentElementId = ids.get(element.parentElementId);
  }
  return elements;
}

function hydrateDomFixture(model, imageUrl) {
  const all = model.scenes.flatMap(scene => scene.elements);
  for (const element of all) {
    if (element.statementId === 'item-show') {
      const background = element.assetLayers.find(layer => layer.role === 'background');
      background.asset = {
        status: 'ready', url: imageUrl, archiveLabel: 'NewopUI.Pak/000047',
        width: 40, height: 40, offsetX: 0, offsetY: 0,
      };
      element.assetLayers.push({
        role: 'item',
        assetRef: { archiveName: 'Items2', imageIndex: 73 },
        asset: {
          status: 'ready', url: imageUrl, archiveLabel: 'Items2.pak/000073',
          width: 34, height: 34, offsetX: 1, offsetY: -1,
        },
      });
    } else if (/^progress-bar(?:-relative-compat)?$/.test(element.statementId)) {
      for (const layer of element.assetLayers || []) {
        const imageIndex = Number(layer.assetRef?.imageIndex) || 0;
        const background = layer.role === 'background';
        layer.asset = {
          status: 'ready',
          url: `${imageUrl}#progress-${layer.role}-${imageIndex}`,
          archiveLabel: `NewopUI.Pak/${String(imageIndex).padStart(6, '0')}`,
          width: background ? 140 : 120,
          height: background ? 22 : 18,
          offsetX: background ? 1 : -2,
          offsetY: background ? -1 : 4,
        };
      }
      if (Number(element.progressPreview?.frameCount) > 0) {
        const startIndex = Number(
          element.assetLayers?.find(layer => layer.role === 'progress')?.assetRef?.imageIndex
        );
        element.animationFrames = Array.from(
          { length: Number(element.progressPreview.frameCount) },
          (_, index) => ({
            status: 'ready', url: `${imageUrl}#progress-frame-${startIndex + index}`,
            archiveLabel: `NewopUI.Pak/${String(startIndex + index).padStart(6, '0')}`,
            width: 120, height: 18, offsetX: -2, offsetY: 4,
          })
        );
      }
    } else if (element.statementId === 'imgex-absolute') {
      element.asset = {
        status: 'ready', url: `${imageUrl}#normal`, archiveLabel: 'NewopUI.Pak/000120',
        width: 40, height: 20, offsetX: 0, offsetY: 0,
      };
      for (const layer of element.assetLayers || []) {
        layer.asset = {
          status: 'ready',
          url: `${imageUrl}#${layer.role}`,
          archiveLabel: `NewopUI.Pak/${layer.role === 'hover' ? '000121' : '000122'}`,
          width: 40, height: 20, offsetX: 0, offsetY: 0,
        };
      }
    } else if (element.statementId === 'playimg-absolute') {
      element.animationPreview.intervalMs = 30;
      element.animationFrames = [0, 1, 2].map(index => ({
        status: 'ready', url: `${imageUrl}#frame${index}`,
        archiveLabel: `NewopUI.Pak/${String(130 + index).padStart(6, '0')}`,
        width: 32, height: 32, offsetX: 0, offsetY: 0,
      }));
    } else if (element.statementId === 'image-countdown') {
      element.asset = {
        status: 'ready', url: `${imageUrl}#image-countdown`,
        archiveLabel: 'NewopUI.Pak/000100',
        width: 16, height: 20, offsetX: 0, offsetY: 0,
      };
      element.imageTextPreview.glyphs.forEach((glyph, index) => {
        glyph.asset = {
          status: 'ready', url: `${imageUrl}#image-countdown-${glyph.assetRef.imageIndex}-${index}`,
          archiveLabel: `NewopUI.Pak/${String(glyph.assetRef.imageIndex).padStart(6, '0')}`,
          width: 16, height: 20, offsetX: 0, offsetY: 0,
        };
      });
      element.imageTextPreview.glyphBank?.forEach((glyph, index) => {
        glyph.asset = {
          status: 'ready', url: `${imageUrl}#image-countdown-${glyph.assetRef.imageIndex}-bank-${index}`,
          archiveLabel: `NewopUI.Pak/${String(glyph.assetRef.imageIndex).padStart(6, '0')}`,
          width: 16, height: 20, offsetX: 0, offsetY: 0,
        };
      });
    } else if (element.statementId === 'image-number') {
      element.asset = {
        status: 'ready', url: `${imageUrl}#image-number`,
        archiveLabel: 'NewopUI.Pak/003170',
        width: 16, height: 20, offsetX: 0, offsetY: 0,
      };
      element.imageTextPreview.glyphs.forEach((glyph, index) => {
        glyph.asset = {
          status: 'ready', url: `${imageUrl}#image-number-${glyph.assetRef.imageIndex}-${index}`,
          archiveLabel: `NewopUI.Pak/${String(glyph.assetRef.imageIndex).padStart(6, '0')}`,
          width: 16, height: 20, offsetX: 0, offsetY: 0,
        };
      });
    } else if (element.statementId === 'img-relative') {
      element.asset = {
        status: 'missing',
        archiveLabel: 'NewopUI.Pak/000010',
        message: '素材未缓存或缓存已失效',
      };
    }
  }

  const defaultScene = model.scenes.find(scene => !scene.conditionGroupId);
  const multiTextElements = prefixFixtureElementIds(parseModel([
    '[@main]',
    '#SAY',
    '<&Layout:~#DOMMT:820:500:195:90>',
    '<MText:#DOMMT~:0:0:70:第一行文字|',
    '第二行文字|',
    '第三行文字',
    '>',
  ].join('\n')).pages[0].elements, 'dom-mtext');
  const layoutFillElements = prefixFixtureElementIds(parseModel([
    '[@main]',
    '#SAY',
    '<Layout|id=DOMFILLED|x=1030|y=500|width=50|height=40|color=58>',
    '<Layout|id=DOMTRANSPARENT|x=1090|y=500|width=50|height=40>',
  ].join('\n'), undefined, '996PC').pages[0].elements, 'dom-layout-fill');
  const panelImageElements = prefixFixtureElementIds(parseModel([
    '[@main]',
    '#SAY',
    ...[0, 1, 2, 3, 4].map(show => (
      `<Img|id=DOMBG${show}${show === 4 ? '|children={DOMBGCHILD}' : ''}|x=999|y=999|width=${show === 4 ? 400 : 40}|height=${show === 4 ? 300 : 30}|wil=NewopUI|pcimg=${120 + show}|bg=1|show=${show}>`
    )),
    '<Layout|id=DOMBGCHILD|x=20|y=30|width=80|height=20|color=58>',
    '<Img|id=DOMDYNAMICSHOW|x=10|y=20|width=40|height=30|wil=NewopUI|pcimg=128|bg=1|show=<$STR(S0)>>',
    '<Img|id=DOMDYNAMICBG|x=20|y=30|width=40|height=30|wil=NewopUI|pcimg=129|bg=<$STR(S1)>|show=4>',
    '<Img|id=DOMNORMALIMG|x=60|y=70|width=40|height=30|wil=NewopUI|pcimg=130|bg=0|show=4>',
    '<Text|id=DOMBGFOREGROUND|x=380|y=290|text=背景上方文字|color=250>',
  ].join('\n'), undefined, '996PC').pages[0].elements, 'dom-panel-image');
  for (const image of panelImageElements.filter(element => (
    element.statementId === 'newui-img-996pc'
  ))) {
    const centered = image.containerElementId === 'DOMBG4';
    image.asset = {
      status: 'ready',
      url: `${imageUrl}#panel-${image.containerElementId}`,
      archiveLabel: `NewopUI.Pak/${String(image.assetRef.imageIndex).padStart(6, '0')}`,
      width: centered ? 400 : 40,
      height: centered ? 300 : 30,
      offsetX: 0,
      offsetY: 0,
    };
  }
  const atlas = parseModel([
    '[@main]',
    '#SAY',
    '<TextAtlas|x=360|y=220|wil=NewopUI|pcimg=2522|iheight=24|iwidth=14|text=0123>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  atlas.id = 'dom-text-atlas';
  atlas.asset = {
    status: 'ready', url: `${imageUrl}#text-atlas`,
    archiveLabel: 'NewopUI.Pak/002522',
    width: 140, height: 24, offsetX: 0, offsetY: 0,
  };
  for (const glyph of atlas.imageTextPreview.glyphs) glyph.asset = atlas.asset;
  const slider = parseModel([
    '[@main]',
    '#SAY',
    '<Slider|x=40|y=280|wil=NewopUI|sliderid=N0|width=400|height=14|maxvalue=10000|defvalue=5000|pcbgimg=298|pcbarimg=299|pcballimg=297>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  slider.id = 'dom-slider';
  for (const layer of slider.assetLayers) {
    const thumb = layer.role === 'thumb';
    layer.asset = {
      status: 'ready', url: `${imageUrl}#slider-${layer.role}`,
      archiveLabel: `NewopUI.Pak/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      width: thumb ? 20 : 400, height: thumb ? 20 : 14, offsetX: 0, offsetY: 0,
    };
  }
  const loadingDocument = parseModel([
    '[@main]',
    '#SAY',
    '<LoadingBar|id=LBSTYLE|x=360|y=700|width=200|height=20|wil=NewopUI|pcloadingbg=500|pcloadingbar=501|startper=25|endper=25|maxper=100|interval=0.05|loadvalue=10|direction=0|size=18|color=250|outline=2|outlinecolor=249|HideText=0|link=@done>',
    '<LoadingBar|id=LBHIDDEN|x=360|y=730|width=200|height=20|wil=NewopUI|pcloadingbg=500|pcloadingbar=501|startper=25|endper=25|maxper=100|interval=0.05|loadvalue=10|direction=1|HideText=1|link=@done>',
    '<LoadingBar|id=LBANIM|x=360|y=760|width=200|height=20|wil=NewopUI|pcloadingbg=500|pcloadingbar=501|startper=10|endper=12|maxper=100|interval=0.02|loadvalue=1|direction=1|HideText=1|link=@done>',
  ].join('\n'), undefined, '996PC');
  const loadingBars = loadingDocument.pages[0].elements.map((loadingBar, index) => {
    loadingBar.id = `dom-loading-${index}`;
    for (const layer of loadingBar.assetLayers) {
      layer.asset = {
        status: 'ready', url: `${imageUrl}#loading-${index}-${layer.role}`,
        archiveLabel: `NewopUI.Pak/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
        width: 200, height: 20, offsetX: 0, offsetY: 0,
      };
    }
    return loadingBar;
  });
  const percentageModel = parseModel([
    '[@main]',
    '#SAY',
    ...[0, 1, 2, 3].map(direction => (
      `<PercentImg|id=P${direction}|x=${40 + direction * 50}|y=330|direction=${direction}|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>`
    )),
  ].join('\n'), undefined, '996PC');
  const percentages = percentageModel.pages[0].elements.map((percentage, index) => {
    percentage.id = `dom-percent-${index}`;
    percentage.assetLayers[0].asset = {
      status: 'ready', url: `${imageUrl}#percent-${index}`,
      archiveLabel: 'NewopUI.Pak/000231',
      width: 40, height: 20, offsetX: 0, offsetY: 0,
    };
    return percentage;
  });
  const checkboxModel = parseModel([
    '[@main]',
    '#SAY',
    '<CheckBox|id=C0|x=260|y=330|checkboxid=N0|wil=NewopUI|pcnimg=192|pcpimg=193|default=0>',
    '<CheckBox|id=C1|x=290|y=330|checkboxid=N1|wil=NewopUI|pcnimg=192|pcpimg=193|default=1>',
  ].join('\n'), undefined, '996PC');
  const checkboxes = checkboxModel.pages[0].elements.map((checkbox, index) => {
    checkbox.id = `dom-checkbox-${index}`;
    checkbox.asset = {
      status: 'ready', url: `${imageUrl}#checkbox-normal-${index}`,
      archiveLabel: 'NewopUI.Pak/000192',
      width: 18, height: 18, offsetX: 0, offsetY: 0,
    };
    checkbox.assetLayers[0].asset = {
      status: 'ready', url: `${imageUrl}#checkbox-selected-${index}`,
      archiveLabel: 'NewopUI.Pak/000193',
      width: 18, height: 18, offsetX: 0, offsetY: 0,
    };
    return checkbox;
  });
  const styledButton = parseModel([
    '[@main]',
    '#SAY',
    '<Button|id=BTN|x=330|y=330|width=80|height=30|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=测试|color=250|size=18|outline=2|outlinecolor=249|grey=1>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  styledButton.id = 'dom-styled-button';
  styledButton.asset = {
    status: 'ready', url: `${imageUrl}#button-normal`,
    archiveLabel: 'NewopUI.Pak/000140',
    width: 80, height: 30, offsetX: 0, offsetY: 0,
  };
  for (const layer of styledButton.assetLayers) {
    layer.asset = {
      status: 'ready', url: `${imageUrl}#button-${layer.role}`,
      archiveLabel: `NewopUI.Pak/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      width: 80, height: 30, offsetX: 0, offsetY: 0,
    };
  }
  const menuModel = parseModel([
    '[@main]',
    '#SAY',
    '<MenuItem|id=M0|x=420|y=330|menuid=S0|itemname=刘德华#张学友#黎明#郭富城|select=张学友|direction=1|fontcolor=250|selectcolor=254|itemhei=30|maxhei=60>',
    '<MenuItem|id=M1|x=420|y=370|menuid=S1|itemname=游戏帮助#装备帮助|select=游戏帮助|direction=0|fontcolor=255|selectcolor=251|itemhei=30>',
  ].join('\n'), undefined, '996PC');
  const menus = menuModel.pages[0].elements.map((menu, index) => {
    menu.id = `dom-menu-${index}`;
    if (index === 0) {
      menu.asset = {
        status: 'ready', url: `${imageUrl}#menu-background`,
        archiveLabel: 'NewopUI.Pak/002000',
        width: 180, height: 30, offsetX: 0, offsetY: 0,
      };
      for (const layer of menu.assetLayers) {
        layer.asset = {
          status: 'ready', url: `${imageUrl}#menu-${layer.role}`,
          archiveLabel: `NewopUI.Pak/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
          width: layer.role === 'arrow' ? 16 : 180,
          height: layer.role === 'arrow' ? 16 : layer.role === 'list-background' ? 120 : 30,
          offsetX: 0, offsetY: 0,
        };
      }
    } else {
      menu.asset = { status: 'missing', message: '菜单底图未缓存' };
      for (const layer of menu.assetLayers) {
        layer.asset = { status: 'missing', message: `${layer.role} 未缓存` };
      }
    }
    return menu;
  });
  const countdowns = parseModel([
    '[@main]',
    '#SAY',
    '<COUNTDOWN|id=DOMC|x=600|y=330|time=90|count=1|showWay=0|size=18|color=250|outline=1|outlinecolor=249>',
    '<TIMETIPS|id=DOMT|x=600|y=360|time=90061|count=1|size=14|color=254>',
  ].join('\n'), undefined, '996PC').pages[0].elements.map((element, index) => {
    element.id = `dom-countdown-${index}`;
    return element;
  });
  const richText = parseModel([
    '[@main]',
    '#SAY',
    '<RText|x=600|y=400|color=70|size=20|text=默认<我是/FCOLOR=250><富文本/FCOLOR=251><996/FCOLOR=253>>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  richText.id = 'dom-rich-text';
  const customColorRichText = parseModel([
    '[@main]',
    '#SAY',
    '<RText|x=600|y=425|color=70|size=20|text=普通<自定义/FCOLOR=1005>>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  customColorRichText.id = 'dom-custom-color-rich-text';
  const plainText996 = parseModel([
    '[@main]',
    '#SAY',
    '<Text|x=600|y=430|text=核心文字|color=250|size=18|outline=2|outlinecolor=249>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  plainText996.id = 'dom-plain-text-996';
  const bgrText996 = parseModel([
    '[@main]',
    '#SAY',
    '<Text|x=850|y=430|text=BGR颜色|color=$8FCF88>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  bgrText996.id = 'dom-bgr-text-996';
  const movingTexts996 = parseModel([
    '[@main]',
    '#SAY',
    '<Text|x=600|y=460|text=120000|simplenum=1|color=250,251|size=18|scrollWidth=140|scrollHeight=24|scrollWay=0|scrollTime=4>',
    '<Text|x=760|y=460|text=纵向滚动|color=255|size=18|scrollWidth=100|scrollHeight=40|scrollWay=1|scrollTime=4>',
  ].join('\n'), undefined, '996PC').pages[0].elements.map((element, index) => {
    element.id = `dom-moving-text-996-${index}`;
    return element;
  });
  const legacyCenteredText = parseModel([
    '[@main]',
    '#SAY',
    '<Text:100200300400|提示信息:*:*30{FCOLOR=253;FSIZE=25;FNAME=宋体;FBOLD=1;SIMPLENUM=1}/@测试>',
  ].join('\n'), undefined, 'GOM').pages[0].elements[0];
  legacyCenteredText.id = 'dom-legacy-centered-text';
  const geeStyledText = parseModel([
    '[@main]',
    '#SAY',
    '<Text:翎风字体|提示:30:20{FCOLOR=250;FSIZE=14;FNAME=黑体;FBOLD=1}/@测试>',
  ].join('\n'), undefined, 'GEE').pages[0].elements[0];
  geeStyledText.id = 'dom-gee-styled-text';
  const styledImage996 = parseModel([
    '[@main]',
    '#SAY',
    '<Img|x=700|y=430|wil=NewopUI|pcimg=108|opacity=128|grey=1>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  styledImage996.id = 'dom-styled-image-996';
  styledImage996.asset = {
    status: 'ready', url: `${imageUrl}#styled-image-996`,
    archiveLabel: 'NewopUI.Pak/000108',
    width: 64, height: 48, offsetX: -3, offsetY: -4,
  };
  const stretchedImage996 = parseModel([
    '[@main]',
    '#SAY',
    '<Img|x=20|y=590|width=120|height=60|wil=NewopUI|pcimg=109>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  stretchedImage996.id = 'dom-stretched-image-996';
  stretchedImage996.asset = {
    status: 'ready', url: `${imageUrl}#stretched-image-996`,
    archiveLabel: 'NewopUI.Pak/000109',
    width: 64, height: 48, offsetX: 0, offsetY: 0,
  };
  const nineSliceImage996 = parseModel([
    '[@main]',
    '#SAY',
    '<Img|x=160|y=590|width=180|height=100|wil=NewopUI|pcimg=110|scale9l=10|scale9r=12|scale9t=8|scale9b=9>',
  ].join('\n'), undefined, '996PC').pages[0].elements[0];
  nineSliceImage996.id = 'dom-nine-slice-image-996';
  nineSliceImage996.asset = {
    status: 'ready', url: `${imageUrl}#nine-slice-image-996`,
    archiveLabel: 'NewopUI.Pak/000110',
    width: 64, height: 48, offsetX: 0, offsetY: 0,
  };
  const costItemDocument = parseModel([
    '[@main]',
    '#SAY',
    '<CostItem|x=360|y=590|itemid=1|itemcount=200000|title=进入扣除|titlecolor=251|color=250|fontsize=18|itemscale=0.5>',
  ].join('\n'), undefined, '996PC');
  let costItem = costItemDocument.pages[0].elements[0];
  costItem.id = 'dom-cost-item-996';
  costItem.assetLayers = [{
    role: 'item',
    assetRef: { archiveName: 'Items', imageIndex: 1 },
    asset: {
      status: 'ready', url: `${imageUrl}#cost-item-996`,
      archiveLabel: 'Items.pak/000001',
      width: 34, height: 36, offsetX: 2, offsetY: -4,
    },
  }];
  reflowNpcDialogLayout(costItemDocument);
  costItem = costItemDocument.pages[0].elements.find(element => (
    element.id === 'dom-cost-item-996'
  ));
  const gomListDocument = parseModel([
    '[@main]',
    '#SAY',
    '<ListView:~#LIST:100:690:100:55:5:1:0:0:0:0:22:76:82:83:84:86:87:88:79:80:81>',
    '<Layout:#LIST~#A:7:0:80:30>',
    '<Layout:#LIST~#B:7:0:80:30>',
    '<Layout:#LIST~#C:7:0:80:30>',
    '<Layout:~#FLOW:240:690:200:80>',
    '<Text:#FLOW~:列表甲:0:0>',
    '<Text:#FLOW~:BB:0:0>',
    '<NewLine:#FLOW~>',
    '<Text:#FLOW~:列表丙:0:0>',
  ].join('\n'), undefined, 'GOM');
  const gomListElements = prefixFixtureElementIds(
    gomListDocument.pages[0].elements,
    'dom-gom-list'
  );
  const gomList = gomListElements.find(element => element.containerElementId === 'LIST');
  for (const layer of gomList.assetLayers || []) {
    const dimensions = layer.role === 'scrollbar'
      ? { width: 12, height: 55 }
      : layer.role.includes('scroll-thumb')
        ? { width: 12, height: 14 }
        : { width: 12, height: 10 };
    layer.asset = {
      status: 'ready', url: `${imageUrl}#gom-list-${layer.role}`,
      archiveLabel: `ui_common.wzl/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      ...dimensions, offsetX: 0, offsetY: 0,
    };
  }
  const pcListDocument = parseModel([
    '[@main]',
    '#SAY',
    '<ListView|id=LV|children={C,B,A}|x=480|y=690|width=70|height=40|direction=2|margin=10|default=2|Slider=1|Sdbg=300|Sdupnimg=301|Sdupmimg=302|Sduppimg=303|Sdnimg=304|Sdmimg=305|Sdpimg=306|Sddwnimg=307|Sddwmimg=308|Sddwpimg=309>',
    '<Layout|id=A|width=40|height=30>',
    '<Layout|id=B|width=40|height=30>',
    '<Layout|id=C|width=40|height=30>',
  ].join('\n'), undefined, '996PC');
  const pcListElements = prefixFixtureElementIds(
    pcListDocument.pages[0].elements,
    'dom-pc-list'
  );
  const pcList = pcListElements.find(element => element.containerElementId === 'LV');
  for (const layer of pcList.assetLayers || []) {
    const dimensions = layer.role === 'scrollbar'
      ? { width: 70, height: 10 }
      : layer.role.includes('scroll-thumb')
        ? { width: 14, height: 10 }
        : { width: 10, height: 10 };
    layer.asset = {
      status: 'ready', url: `${imageUrl}#pc-list-${layer.role}`,
      archiveLabel: `NewopUI.Jpk/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      ...dimensions, offsetX: 0, offsetY: 0,
    };
  }
  const disabledPcListDocument = parseModel([
    '[@main]',
    '#SAY',
    '<ListView|id=LVDISABLED|children={DC,DB,DA}|x=580|y=690|width=70|height=40|direction=2|margin=10|default=2|cantouch=0|Slider=1|Sdbg=400|Sdupnimg=401|Sdupmimg=402|Sduppimg=403|Sdnimg=404|Sdmimg=405|Sdpimg=406|Sddwnimg=407|Sddwmimg=408|Sddwpimg=409>',
    '<Layout|id=DA|width=40|height=30>',
    '<Layout|id=DB|width=40|height=30>',
    '<Layout|id=DC|width=40|height=30>',
  ].join('\n'), undefined, '996PC');
  const disabledPcListElements = prefixFixtureElementIds(
    disabledPcListDocument.pages[0].elements,
    'dom-pc-list-disabled'
  );
  const disabledPcList = disabledPcListElements.find(
    element => element.containerElementId === 'LVDISABLED'
  );
  for (const layer of disabledPcList.assetLayers || []) {
    const dimensions = layer.role === 'scrollbar'
      ? { width: 70, height: 10 }
      : layer.role.includes('scroll-thumb')
        ? { width: 14, height: 10 }
        : { width: 10, height: 10 };
    layer.asset = {
      status: 'ready', url: `${imageUrl}#pc-list-disabled-${layer.role}`,
      archiveLabel: `NewopUI.Jpk/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      ...dimensions, offsetX: 0, offsetY: 0,
    };
  }
  const inputText = parseModel([
    '[@main]',
    '#SAY',
    '<&INPUTTEXT:1:500:440:80:15:-1:249:250:2:12:错误提示:请输入名字:251>',
  ].join('\n'), undefined, 'GOM').pages[0].elements[0];
  inputText.id = 'dom-input-text';
  const inputNumber = parseModel([
    '[@main]',
    '#SAY',
    '<&INPUTNUM:2:600:440:90:16:-1:249:250:-10:100:请输入-10到100:请输入数字:251>',
  ].join('\n'), undefined, 'GOM').pages[0].elements[0];
  inputNumber.id = 'dom-input-number';
  const customInputs = parseModel([
    '[@main]',
    '#SAY',
    '<Input|x=20|y=480|width=145|height=25|size=18|place=请输入|placecolor=251|errortips=输入不对|mincount=3|color=250|maxcount=15|inputid=1|type=0|onlyCh=1|bgtype=1>',
    '<Input|x=180|y=480|width=100|height=20|inputid=2|type=1|bgtype=0>',
    '<Input|x=295|y=480|width=100|height=20|inputid=3|type=2|bgtype=0>',
    '<Input|x=410|y=480|width=100|height=20|inputid=4|type=3|bgtype=0>',
  ].join('\n'), undefined, '996PC').pages[0].elements.map((element, index) => {
    element.id = `dom-custom-input-${index}`;
    return element;
  });
  const inputMemo = parseModel([
    '[@main]',
    '#SAY',
    '<&INPUTMEMO:1:540:520:150:50:-1:249:250:4:50:18:0:提示：这一段文字长度最小值4，最大值50>',
  ].join('\n'), undefined, 'GOM').pages[0].elements[0];
  inputMemo.id = 'dom-input-memo';
  const monsterDocument = parseModel([
    '[@main]',
    '#SAY',
    '<MONSTER:1120:81:3:7:50:400>',
    '<MONSTER:0:156:0:4:200:400>',
  ].join('\n'), undefined, 'GOM');
  const monsters = monsterDocument.pages[0].elements.map((element, index) => {
    element.id = `dom-monster-${index}`;
    return element;
  });
  monsters[0].asset = {
    status: 'ready', url: `${imageUrl}#monster-representative`,
    archiveLabel: 'Mon113.pak/000040',
    width: 90, height: 120, offsetX: -45, offsetY: -110,
  };
  reflowNpcDialogLayout(monsterDocument);
  const geeMonsterDocument = parseModel([
    '[@main]',
    '#SAY',
    '<MONSTER:11:160:11:1:360:400>',
    '<MONSTER:156:0:1:4:500:400>',
  ].join('\n'), undefined, 'GEE');
  const geeMonsters = geeMonsterDocument.pages[0].elements.map((element, index) => {
    element.id = `dom-gee-monster-${index}`;
    return element;
  });
  geeMonsters[0].asset = {
    status: 'ready', url: `${imageUrl}#gee-monster-representative`,
    archiveLabel: 'Mon17.pak/000040',
    width: 84, height: 112, offsetX: -40, offsetY: -102,
  };
  reflowNpcDialogLayout(geeMonsterDocument);
  const uiModelDocument = parseModel([
    '[@main]',
    '#SAY',
    '<UIModel|x=720|y=100|sex=0|headID=344|capID=1188|clothID=2540|weaponID=2523|scale=1.5|hairID=3|notShowMold=true|notShowHair=false|clothEffectID=506#1#0#0>',
    '<UIModel|id=DOMMODELBOUNDARY|x=900|y=100|sex=<$STR(N$SEX)>|scale=0|clothID=<$STR(N$CLOTH)>|weaponID=12.5|hairID=3|notShowMold=true|notShowHair=bad|clothEffectID=506#1#0#0>',
  ].join('\n'), undefined, '996PC');
  const uiModel = uiModelDocument.pages[0].elements[0];
  uiModel.id = 'dom-ui-model';
  const uiModelBoundary = uiModelDocument.pages[0].elements[1];
  uiModelBoundary.id = 'dom-ui-model-boundary';
  const uiModelAssets = [
    { width: 80, height: 120, offsetX: -40, offsetY: -100 },
    { width: 100, height: 100, offsetX: -60, offsetY: -80 },
    { width: 50, height: 40, offsetX: -25, offsetY: -120 },
    { width: 60, height: 30, offsetX: -30, offsetY: -130 },
  ];
  uiModel.modelPreview.layers.forEach((layer, index) => {
    layer.asset = {
      status: 'ready', url: `${imageUrl}#ui-model-${layer.role}`,
      archiveLabel: `${layer.assetRef.archiveName}.Jpk/${String(layer.assetRef.imageIndex).padStart(6, '0')}`,
      ...uiModelAssets[index],
    };
  });
  reflowNpcDialogLayout(uiModelDocument);
  const gridDocument = parseModel([
    '[@main]',
    '#SAY',
    '<BAGITEMS|id=DOMGRID|x=330|y=260|count=8|row=2|iwidth=70|iheight=60>',
    '<BAGITEMS|id=DOMDYNAMICGRID|x=620|y=260|count=1|row=1|iwidth=<$STR(N$W)>|iheight=60>',
  ].join('\n'), undefined, '996PC');
  const grid = gridDocument.pages[0].elements.find(
    element => element.containerElementId === 'DOMGRID'
  );
  const dynamicGrid = gridDocument.pages[0].elements.find(
    element => element.containerElementId === 'DOMDYNAMICGRID'
  );
  grid.id = 'dom-grid';
  dynamicGrid.id = 'dom-grid-dynamic';
  const itemShowDocument = parseModel([
    '[@main]',
    '#SAY',
    '<ItemShow|id=DOMITEMON|x=950|y=330|itemid=1927|itemcount=100|color=250|grey=1|lock=1|bgtype=1>',
    '<ItemShow|id=DOMITEMOFF|x=1000|y=330|itemid=1927|itemcount=1|color=251|grey=0|lock=0|bgtype=0>',
  ].join('\n'), undefined, '996PC');
  const itemShows996 = itemShowDocument.pages[0].elements.map((element, index) => {
    element.id = `dom-itemshow-996-${index}`;
    for (const layer of element.assetLayers || []) {
      layer.asset = {
        status: 'ready', url: `${imageUrl}#itemshow-${index}-${layer.role}`,
        archiveLabel: layer.role === 'background'
          ? 'NewopUI.Pak/000047' : 'Items2.pak/000073',
        width: layer.role === 'background' ? 40 : 34,
        height: layer.role === 'background' ? 40 : 34,
        offsetX: 0, offsetY: 0,
      };
    }
    element.assetLayers = element.assetLayers || [];
    element.assetLayers.push({
      role: 'item',
      assetRef: { archiveName: 'Items2', imageIndex: 73 },
      asset: {
        status: 'ready', url: `${imageUrl}#itemshow-${index}-item`,
        archiveLabel: 'Items2.pak/000073',
        width: 34, height: 34, offsetX: 0, offsetY: 0,
      },
    });
    return element;
  });
  const fallbackInteractive = parseModel([
    '[@main]',
    '#SAY',
    '<&IMGEX:0:120:121:122:760:620/@fallback>',
  ].join('\n'), undefined, 'GOM').pages[0].elements[0];
  fallbackInteractive.id = 'dom-interactive-fallback';
  fallbackInteractive.asset = {
    status: 'missing',
    archiveLabel: 'NewopUI.Pak/000120',
    message: 'normal state intentionally missing',
  };
  for (const layer of fallbackInteractive.assetLayers || []) {
    layer.asset = {
      status: 'ready',
      url: `${imageUrl}#fallback-${layer.role}`,
      archiveLabel: `NewopUI.Pak/${layer.role === 'hover' ? '000121' : '000122'}`,
      width: 40,
      height: 20,
      offsetX: 0,
      offsetY: 0,
    };
  }
  const extras = [
    grid, dynamicGrid, atlas, slider, ...loadingBars, styledButton, richText, customColorRichText,
    plainText996, bgrText996, legacyCenteredText, geeStyledText,
    ...movingTexts996, styledImage996,
    stretchedImage996, nineSliceImage996, costItem,
    ...multiTextElements, ...layoutFillElements, ...panelImageElements,
    ...gomListElements, ...pcListElements, ...disabledPcListElements,
    inputText, inputNumber, uiModel, uiModelBoundary,
    inputMemo, ...customInputs, ...monsters, ...geeMonsters, fallbackInteractive,
    ...menus, ...countdowns, ...percentages, ...checkboxes, ...itemShows996,
  ];
  if (defaultScene) defaultScene.elements.push(...extras);
  for (const scene of model.scenes) {
    if (scene !== defaultScene && !scene.elements.some(element => element.id === grid.id)) {
      scene.elements.push(...extras);
    }
  }
  for (const page of model.pages) {
    if (!page.elements.some(element => element.id === grid.id)) page.elements.push(...extras);
  }
  return model;
}

function buildModels(imageUrl) {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    'MOV S$DOM预览 <&TEXT:<$STR(S$DOM未知文字)>:150:140{FCOLOR=250}>',
    '#SAY',
    '<$STR(S$DOM预览)>',
    '<&text:默认内容|这些是备注^换一行^250#这行字是绿色:20:30{FCOLOR=250}>',
    '<&TEXT::180:30{FCOLOR=250}>',
    '<Layout:~#L1:100:100:180:100:7>',
    '<IMG:#L1~#L2:10:1:5:6>',
    '<&ITEMSHOW:1927:2:220:100:1:0:0:40:0:0:0>',
    '<ProgressBar:220:170:10:100:101:3:60000:2:3:0:100:40:0:250:4:5:%p/%m/%r:进度>',
    '<&PROGRESSBAR:220:200:10:110:111:3:30:6:7:0:100:25:1:250:0:0:%r%:动画进度>',
    '<&PROGRESSBAR:220:230:10:120:121:0:0:1:2:0:100:50:3:250:0:0:%r%:静态边界>',
    '<&IMGEX:10:120:121:122:220:220>',
    '<&PLAYIMG:10:130:3:30:280:220>',
    '<&IMGCOUNTDOWN:30:1:100:10:320:220:0/@done>',
    '<&IMGNUM:3170:1234:-3:520:220:1,2>',
    '普通<绿色/FCOLOR=250><黄色/FCOLOR=251>尾部',
    '<UNCONFIRMEDUI:1:2:3>',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<&TEXT:条件满足:20:60{FCOLOR=251}>',
    '#ELSESAY',
    '<&TEXT:条件不满足:20:60{FCOLOR=253}>',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<&TEXT:第二处条件满足:20:90{FCOLOR=251}>',
    '#ELSESAY',
    '<&TEXT:第二处条件不满足:20:90{FCOLOR=253}>',
  ].join('\n');
  const falseModel = parseModel(source);
  assert.equal(falseModel.conditionGroups.length, 1,
    'equivalent source conditions must share one browser switch');
  const groupId = falseModel.conditionGroups[0].id;
  const trueModel = parseModel(source, { [groupId]: true });
  return {
    groupId,
    falseModel: hydrateDomFixture(falseModel, imageUrl),
    trueModel: hydrateDomFixture(trueModel, imageUrl),
  };
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

function bodyAttribute(output, name) {
  const body = output.match(/<body\b([^>]*)>/i);
  if (!body) return undefined;
  return body[1].match(new RegExp(`data-${name}="([^"]*)"`))?.[1];
}

function main() {
  const browsers = findChromiumBrowsers();
  const requireRealBrowser = process.env.BOO_REQUIRE_REAL_BROWSER === '1';
  if (browsers.length === 0) {
    if (requireRealBrowser) {
      throw new Error('BOO_REQUIRE_REAL_BROWSER=1, but no Edge or Chrome executable was found');
    }
    console.log('npc-dialog-visual-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }
  const cachedPng = firstCachedPng();
  const imageUrl = cachedPng
    ? pathToFileURL(cachedPng).href
    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';
  const models = buildModels(imageUrl);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-npc-dom-browser-'));
  const profile = path.join(temporary, 'profile');
  const harness = path.join(temporary, 'npc-dialog-dom-test.html');
  try {
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__booMessages = [];
window.__models = ${JSON.stringify(models)};
window.addEventListener('error', function (event) {
  document.body.dataset.appError = (event.error && event.error.stack
    ? event.error.stack : (event.message || 'unknown error')) +
    ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno;
});
window.acquireVsCodeApi = function () {
  return { postMessage: function (message) {
    window.__booMessages.push(message);
    if (message.type === 'ready') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model', model: window.__models.falseModel, previewRevision: 1,
          preserveDrafts: false, geeOffsetHelp: ''
        }}));
      }, 0);
    } else if (message.type === 'previewCondition') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model',
          model: message.satisfied ? window.__models.trueModel : window.__models.falseModel,
          previewRevision: message.satisfied ? 2 : 3, preserveDrafts: true, geeOffsetHelp: ''
        }}));
      }, 0);
    } else if (message.type === 'resetPreview') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model', model: window.__models.falseModel, previewRevision: 4,
          preserveDrafts: true, geeOffsetHelp: ''
        }}));
      }, 0);
    }
  }};
};
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function () {
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function px(value) { return Number(String(value || '').replace('px', '')); }
  async function run() {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (document.querySelectorAll('.canvas-element').length >= 8) break;
      await wait(40);
    }
    if (document.body.dataset.appError) throw new Error(document.body.dataset.appError);
    var falseModel = window.__models.falseModel;
    var page = falseModel.pages[0];
    var root = page.elements.find(function (element) { return element.containerElementId === 'L1'; });
    var child = page.elements.find(function (element) { return element.containerElementId === 'L2'; });
    var item = page.elements.find(function (element) { return element.statementId === 'item-show'; });
    var progressBars = page.elements.filter(function (element) {
      return /^progress-bar(?:-relative-compat)?$/.test(element.statementId);
    });
    var progress = progressBars[0];
    var animatedProgress = progressBars[1];
    var staticProgress = progressBars[2];
    var imageCountdown = page.elements.find(function (element) { return element.statementId === 'image-countdown'; });
    var imageNumber = page.elements.find(function (element) { return element.statementId === 'image-number'; });
    var textAtlas = page.elements.find(function (element) { return element.statementId === 'newui-textatlas-996pc'; });
    var slider = page.elements.find(function (element) { return element.statementId === 'newui-slider-996pc'; });
    var loadingStyle = page.elements.find(function (element) { return element.id === 'dom-loading-0'; });
    var loadingHidden = page.elements.find(function (element) { return element.id === 'dom-loading-1'; });
    var loadingAnimated = page.elements.find(function (element) { return element.id === 'dom-loading-2'; });
    var variablePreview = page.elements.find(function (element) { return element.text === '预览文字'; });
    var coloredFlow = page.elements.find(function (element) { return element.text === '普通绿色黄色尾部'; });
    var costItem = page.elements.find(function (element) { return element.id === 'dom-cost-item-996'; });
    var itemShowOn = page.elements.find(function (element) { return element.id === 'dom-itemshow-996-0'; });
    var itemShowOff = page.elements.find(function (element) { return element.id === 'dom-itemshow-996-1'; });
    var verticalList = page.elements.find(function (element) { return element.containerElementId === 'LIST'; });
    var horizontalList = page.elements.find(function (element) { return element.containerElementId === 'LV'; });
    var disabledHorizontalList = page.elements.find(function (element) {
      return element.containerElementId === 'LVDISABLED';
    });
    var flowLayout = page.elements.find(function (element) { return element.containerElementId === 'FLOW'; });
    if (!root || !child || !item || !progress || !animatedProgress || !staticProgress || !imageCountdown || !imageNumber || !textAtlas || !slider || !loadingStyle || !loadingHidden || !loadingAnimated || !variablePreview || !coloredFlow || !costItem || !itemShowOn || !itemShowOff || !verticalList || !horizontalList || !disabledHorizontalList || !flowLayout) throw new Error('fixture elements missing');
    if (!variablePreview.editable || node(variablePreview.id).classList.contains('locked')) {
      throw new Error('variable preview with literal source coordinates remained locked');
    }
    var coloredFlowNode = node(coloredFlow.id);
    var coloredFlowRuns = coloredFlowNode
      ? Array.from(coloredFlowNode.querySelectorAll('.styled-text-line > span')) : [];
    if (!coloredFlowNode
      || coloredFlowNode.textContent !== '普通绿色黄色尾部'
      || coloredFlowNode.textContent.includes('FCOLOR')
      || coloredFlowRuns.map(function (run) { return run.textContent; }).join('|') !== '普通|绿色|黄色|尾部'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(coloredFlowRuns[1] && coloredFlowRuns[1].style.color)
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(coloredFlowRuns[2] && coloredFlowRuns[2].style.color)
      || px(coloredFlowNode.style.width) !== 96) {
      throw new Error('traditional FCOLOR visible runs or geometry missing');
    }
    if (node(item.id).querySelectorAll('.item-frame-image').length !== 1) throw new Error('item frame missing');
    if (node(item.id).querySelectorAll('.item-content-image').length !== 1) throw new Error('item content missing');
    var itemShowOnNode = node(itemShowOn.id);
    var itemShowOffNode = node(itemShowOff.id);
    var itemShowOnImage = itemShowOnNode && itemShowOnNode.querySelector('.item-content-image');
    var itemShowQuantity = itemShowOnNode && itemShowOnNode.querySelector('.item-quantity');
    if (!itemShowOnNode
      || !itemShowOnImage
      || !itemShowOnImage.classList.contains('item-content-gray')
      || getComputedStyle(itemShowOnImage).filter === 'none'
      || !itemShowQuantity
      || itemShowQuantity.textContent !== '100'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(itemShowQuantity.style.color)
      || itemShowOnNode.querySelectorAll('.item-lock-indicator').length !== 1
      || itemShowOnNode.querySelectorAll('.item-frame-image').length !== 1
      || itemShowOnNode.querySelector('.element-placeholder')) {
      throw new Error('996PC ItemShow gray/color/lock/background layers missing');
    }
    if (!itemShowOffNode
      || itemShowOffNode.querySelector('.item-content-gray')
      || itemShowOffNode.querySelector('.item-lock-indicator')
      || itemShowOffNode.querySelector('.item-frame-image')
      || itemShowOffNode.querySelector('.element-placeholder')) {
      throw new Error('996PC ItemShow disabled states were drawn unexpectedly');
    }
    var costItemNode = node(costItem.id);
    var costItemTitle = costItemNode && costItemNode.querySelector('.cost-item-title');
    var costItemQuantity = costItemNode && costItemNode.querySelector('.cost-item-quantity');
    var costItemIcon = costItemNode && costItemNode.querySelector('.cost-item-icon');
    var costItemImage = costItemNode && costItemNode.querySelector('.cost-item-image');
    if (!costItemNode
      || !costItemNode.classList.contains('cost-item-preview')
      || costItemNode.dataset.costItemScale !== '0.5'
      || !costItemTitle
      || costItemTitle.textContent !== '进入扣除'
      || costItemTitle.style.fontSize !== '18px'
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(costItemTitle.style.color)
      || !costItemQuantity
      || costItemQuantity.textContent !== '/200000'
      || costItemQuantity.style.fontSize !== '18px'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(costItemQuantity.style.color)
      || !costItemImage
      || !costItemImage.src.endsWith('#cost-item-996')
      || px(costItemImage.style.width) !== 17
      || px(costItemImage.style.height) !== 18
      || px(costItemImage.style.left) !== 1
      || px(costItemImage.style.top) !== 0
      || !costItemIcon
      || costItemIcon.dataset.assetOffsetX !== '1'
      || costItemIcon.dataset.assetOffsetY !== '-2'
      || px(costItemIcon.style.width) !== 18
      || px(costItemIcon.style.height) !== 18
      || px(costItemNode.style.width) !== 161
      || px(costItemNode.style.height) !== 22
      || costItemNode.querySelector('.item-quantity')
      || costItemNode.querySelector('.item-frame-image')
      || costItemNode.querySelector('.element-placeholder')) {
      throw new Error('996PC CostItem dedicated title/icon/slash-quantity renderer missing: ' + JSON.stringify({
        className: costItemNode && costItemNode.className,
        scale: costItemNode && costItemNode.dataset.costItemScale,
        title: costItemTitle && costItemTitle.textContent,
        titleFontSize: costItemTitle && costItemTitle.style.fontSize,
        titleColor: costItemTitle && costItemTitle.style.color,
        quantity: costItemQuantity && costItemQuantity.textContent,
        quantityFontSize: costItemQuantity && costItemQuantity.style.fontSize,
        quantityColor: costItemQuantity && costItemQuantity.style.color,
        imageSrc: costItemImage && costItemImage.src,
        imageBox: costItemImage && [costItemImage.style.left, costItemImage.style.top,
          costItemImage.style.width, costItemImage.style.height],
        iconOffsets: costItemIcon && [costItemIcon.dataset.assetOffsetX,
          costItemIcon.dataset.assetOffsetY],
        iconBox: costItemIcon && [costItemIcon.style.width, costItemIcon.style.height],
        wrapperBox: costItemNode && [costItemNode.style.width, costItemNode.style.height],
      }));
    }
    var verticalListNode = node(verticalList.id);
    var verticalChildren = ['A', 'B', 'C'].map(function (id) {
      return page.elements.find(function (element) {
        return element.containerElementId === id
          && element.parentElementId === verticalList.id;
      });
    });
    var verticalNodes = verticalChildren.map(function (element) { return node(element.id); });
    if (!verticalListNode
      || verticalListNode.dataset.listDirection !== 'vertical'
      || verticalListNode.dataset.listGap !== '5'
      || verticalListNode.dataset.listDefaultIndex !== '1'
      || verticalListNode.dataset.listScrollOffset !== '35'
      || verticalListNode.dataset.listContentWidth !== '87'
      || verticalListNode.dataset.listContentHeight !== '100'
      || verticalNodes.map(function (childNode) { return px(childNode.style.top); }).join(',') !== '655,690,725'
      || verticalNodes[0].dataset.listClip !== 'outside'
      || verticalNodes[1].dataset.listClip !== 'inside'
      || verticalNodes[2].dataset.listClip !== 'partial'
      || verticalNodes[2].dataset.listClipBottom !== '10'
      || !verticalNodes[2].style.clipPath.includes('10px')) {
      throw new Error('GOM ListView vertical layout, initial index, or viewport clipping missing');
    }
    var horizontalListNode = node(horizontalList.id);
    var horizontalChildren = ['C', 'B', 'A'].map(function (id) {
      return page.elements.find(function (element) {
        return element.containerElementId === id
          && element.parentElementId === horizontalList.id;
      });
    });
    var horizontalNodes = horizontalChildren.map(function (element) { return node(element.id); });
    if (!horizontalListNode
      || horizontalListNode.dataset.listDirection !== 'horizontal'
      || horizontalListNode.dataset.listGap !== '10'
      || horizontalListNode.dataset.listDefaultIndex !== '1'
      || horizontalListNode.dataset.listScrollOffset !== '50'
      || horizontalListNode.dataset.listContentWidth !== '140'
      || horizontalListNode.dataset.listContentHeight !== '30'
      || horizontalNodes.map(function (childNode) { return px(childNode.style.left); }).join(',') !== '430,480,530'
      || horizontalNodes[0].dataset.listClip !== 'outside'
      || horizontalNodes[1].dataset.listClip !== 'inside'
      || horizontalNodes[2].dataset.listClip !== 'partial'
      || horizontalNodes[2].dataset.listClipRight !== '20'
      || !horizontalNodes[2].style.clipPath.includes('20px')) {
      throw new Error('996PC ListView declared order, margin, default index, or clipping missing');
    }
    var expectedListParts = ['scrollbar', 'scroll-start', 'scroll-thumb', 'scroll-end'];
    var verticalScrollParts = expectedListParts.map(function (part) {
      return verticalListNode.querySelector('.container-' + part + '-image');
    });
    var horizontalScrollParts = expectedListParts.map(function (part) {
      return horizontalListNode.querySelector('.container-' + part + '-image');
    });
    if (verticalListNode.dataset.listScrollbarMode !== 'custom'
      || horizontalListNode.dataset.listScrollbarMode !== 'custom'
      || verticalScrollParts.some(function (part) { return !part; })
      || horizontalScrollParts.some(function (part) { return !part; })
      || verticalScrollParts.some(function (part) { return !part.src.includes('#gom-list-'); })
      || horizontalScrollParts.some(function (part) { return !part.src.includes('#pc-list-'); })
      || verticalListNode.querySelector('.container-scroll-start-image').style.top !== '0px'
      || verticalListNode.querySelector('.container-scroll-end-image').style.bottom !== '0px'
      || horizontalListNode.querySelector('.container-scroll-start-image').style.left !== '0px'
      || horizontalListNode.querySelector('.container-scroll-end-image').style.right !== '0px') {
      throw new Error('ListView four-part normal-state scrollbar rendering missing');
    }
    for (var listFixture of [
      { node: verticalListNode, prefix: '#gom-list-' },
      { node: horizontalListNode, prefix: '#pc-list-' },
    ]) {
      for (var interactivePart of ['scroll-start', 'scroll-thumb', 'scroll-end']) {
        var control = listFixture.node.querySelector('.container-' + interactivePart + '-image');
        control.dispatchEvent(new MouseEvent('mouseenter'));
        if (!control.src.endsWith(listFixture.prefix + interactivePart + '-hover')
          || control.dataset.listScrollState !== 'hover') {
          throw new Error('ListView ' + interactivePart + ' hover asset did not activate');
        }
        control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        if (!control.src.endsWith(listFixture.prefix + interactivePart + '-pressed')
          || control.dataset.listScrollState !== 'pressed') {
          throw new Error('ListView ' + interactivePart + ' pressed asset did not activate');
        }
        control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        if (!control.src.endsWith(listFixture.prefix + interactivePart + '-hover')) {
          throw new Error('ListView ' + interactivePart + ' did not return to hover state');
        }
        control.dispatchEvent(new MouseEvent('mouseleave'));
        if (!control.src.endsWith(listFixture.prefix + interactivePart)
          || control.dataset.listScrollState !== 'normal') {
          throw new Error('ListView ' + interactivePart + ' did not return to normal state');
        }
      }
    }

    var verticalWheelOffsetBefore = Number(verticalListNode.dataset.listScrollOffset);
    var verticalWheelChildTopBefore = px(verticalNodes[1].style.top);
    var verticalWheelThumbTopBefore = px(
      verticalListNode.querySelector('.container-scroll-thumb-image').style.top
    );
    verticalListNode.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: 20
    }));
    await wait(20);
    verticalListNode = node(verticalList.id);
    verticalNodes = verticalChildren.map(function (element) { return node(element.id); });
    var verticalWheelOffsetAfter = Number(verticalListNode.dataset.listScrollOffset);
    var verticalWheelThumbTopAfter = px(
      verticalListNode.querySelector('.container-scroll-thumb-image').style.top
    );
    if (verticalWheelOffsetBefore !== 35
      || verticalWheelOffsetAfter !== 45
      || px(verticalNodes[1].style.top)
        !== verticalWheelChildTopBefore - (verticalWheelOffsetAfter - verticalWheelOffsetBefore)
      || verticalNodes[1].dataset.listClip !== 'partial'
      || verticalNodes[1].dataset.listClipTop !== '10'
      || !verticalNodes[1].style.clipPath.includes('10px')
      || verticalWheelThumbTopAfter <= verticalWheelThumbTopBefore) {
      throw new Error('ListView wheel scrolling did not update offset, child geometry, clipping, and thumb: '
        + JSON.stringify({
          offsetBefore: verticalWheelOffsetBefore,
          offsetAfter: verticalWheelOffsetAfter,
          childTopBefore: verticalWheelChildTopBefore,
          childTopAfter: px(verticalNodes[1].style.top),
          clip: verticalNodes[1].dataset.listClip,
          clipTop: verticalNodes[1].dataset.listClipTop,
          thumbBefore: verticalWheelThumbTopBefore,
          thumbAfter: verticalWheelThumbTopAfter,
        }));
    }

    verticalListNode.querySelector('.container-scroll-start-image').click();
    await wait(20);
    verticalListNode = node(verticalList.id);
    var verticalStartOffset = Number(verticalListNode.dataset.listScrollOffset);
    if (verticalStartOffset !== 10) {
      throw new Error('ListView start arrow did not scroll backward by one child step: '
        + verticalStartOffset);
    }
    verticalListNode.querySelector('.container-scroll-end-image').click();
    await wait(20);
    verticalListNode = node(verticalList.id);
    var verticalEndOffset = Number(verticalListNode.dataset.listScrollOffset);
    if (verticalEndOffset !== 45) {
      throw new Error('ListView end arrow did not scroll forward by one child step: '
        + verticalEndOffset);
    }

    horizontalListNode = node(horizontalList.id);
    horizontalListNode.querySelector('.container-scroll-start-image').click();
    await wait(20);
    horizontalListNode = node(horizontalList.id);
    var horizontalStartOffset = Number(horizontalListNode.dataset.listScrollOffset);
    if (horizontalStartOffset !== 0) {
      throw new Error('horizontal ListView start arrow did not clamp to zero: '
        + horizontalStartOffset);
    }
    horizontalListNode.querySelector('.container-scroll-end-image').click();
    await wait(20);
    horizontalListNode = node(horizontalList.id);
    var horizontalEndOffset = Number(horizontalListNode.dataset.listScrollOffset);
    if (horizontalEndOffset !== 50) {
      throw new Error('horizontal ListView end arrow did not restore one child step: '
        + horizontalEndOffset);
    }
    horizontalListNode.querySelector('.container-scroll-start-image').click();
    await wait(20);
    horizontalListNode = node(horizontalList.id);
    horizontalNodes = horizontalChildren.map(function (element) { return node(element.id); });
    var horizontalThumb = horizontalListNode.querySelector('.container-scroll-thumb-image');
    var horizontalThumbLeftBefore = px(horizontalThumb.style.left);
    var horizontalThumbChildLeftBefore = px(horizontalNodes[1].style.left);
    horizontalThumb.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, clientX: 118, clientY: 100
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: 118, clientY: 100
    }));
    await wait(20);
    horizontalListNode = node(horizontalList.id);
    horizontalNodes = horizontalChildren.map(function (element) { return node(element.id); });
    horizontalThumb = horizontalListNode.querySelector('.container-scroll-thumb-image');
    var horizontalThumbOffset = Number(horizontalListNode.dataset.listScrollOffset);
    var horizontalThumbLeftAfter = px(horizontalThumb.style.left);
    if (Math.abs(horizontalThumbOffset - 35) > 0.01
      || px(horizontalNodes[1].style.left)
        !== horizontalThumbChildLeftBefore - horizontalThumbOffset
      || horizontalThumbLeftAfter <= horizontalThumbLeftBefore) {
      throw new Error('ListView thumb drag did not update offset, child position, and thumb: '
        + JSON.stringify({
          offset: horizontalThumbOffset,
          childBefore: horizontalThumbChildLeftBefore,
          childAfter: px(horizontalNodes[1].style.left),
          thumbBefore: horizontalThumbLeftBefore,
          thumbAfter: horizontalThumbLeftAfter,
        }));
    }

    var disabledListNode = node(disabledHorizontalList.id);
    var disabledChildren = ['DC', 'DB', 'DA'].map(function (id) {
      return page.elements.find(function (element) {
        return element.containerElementId === id
          && element.parentElementId === disabledHorizontalList.id;
      });
    });
    var disabledMiddleNode = node(disabledChildren[1].id);
    var disabledOffsetBefore = Number(disabledListNode.dataset.listScrollOffset);
    var disabledChildLeftBefore = px(disabledMiddleNode.style.left);
    var disabledControls = Array.from(
      disabledListNode.querySelectorAll('.container-scrollbar-control')
    );
    if (disabledListNode.dataset.listTouchEnabled !== 'false'
      || disabledOffsetBefore !== 50
      || disabledControls.length !== 3
      || disabledControls.some(function (control) {
        return !control.classList.contains('list-scroll-disabled');
      })) {
      throw new Error('cantouch=0 ListView did not expose its disabled interaction state');
    }
    disabledListNode.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: 20
    }));
    await wait(20);
    disabledListNode = node(disabledHorizontalList.id);
    disabledListNode.querySelector('.container-scroll-start-image').click();
    await wait(20);
    disabledListNode = node(disabledHorizontalList.id);
    disabledListNode.querySelector('.container-scroll-end-image').click();
    await wait(20);
    disabledListNode = node(disabledHorizontalList.id);
    var disabledThumb = disabledListNode.querySelector('.container-scroll-thumb-image');
    disabledThumb.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, clientX: 130, clientY: 100
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: 130, clientY: 100
    }));
    await wait(20);
    disabledListNode = node(disabledHorizontalList.id);
    disabledMiddleNode = node(disabledChildren[1].id);
    var disabledOffsetAfter = Number(disabledListNode.dataset.listScrollOffset);
    if (disabledOffsetAfter !== disabledOffsetBefore
      || px(disabledMiddleNode.style.left) !== disabledChildLeftBefore) {
      throw new Error('cantouch=0 ListView accepted wheel, arrow, or thumb interaction: '
        + JSON.stringify({
          offsetBefore: disabledOffsetBefore,
          offsetAfter: disabledOffsetAfter,
          childBefore: disabledChildLeftBefore,
          childAfter: px(disabledMiddleNode.style.left),
        }));
    }
    document.body.dataset.listInteractions = [
      'wheel=' + verticalWheelOffsetAfter,
      'arrows=' + verticalStartOffset + '-' + verticalEndOffset,
      'thumb=' + horizontalThumbOffset,
      'cantouch0=' + disabledOffsetAfter,
    ].join(',');
    var flowedTexts = ['列表甲', 'BB', '列表丙'].map(function (text) {
      return page.elements.find(function (element) { return element.text === text; });
    });
    var flowedNodes = flowedTexts.map(function (element) { return node(element.id); });
    var lineBreak = page.elements.find(function (element) {
      return element.statementId === 'container-newline' && element.parentElementId === flowLayout.id;
    });
    var lineBreakNode = lineBreak && node(lineBreak.id);
    if (flowedNodes.map(function (textNode) { return px(textNode.style.left); }).join(',') !== '240,276,240'
      || flowedNodes.map(function (textNode) { return px(textNode.style.top); }).join(',') !== '690,690,710'
      || !lineBreakNode
      || !lineBreakNode.hidden
      || getComputedStyle(lineBreakNode).display !== 'none') {
      throw new Error('container flow layout or invisible NewLine behavior missing');
    }
    var progressNode = node(progress.id);
    var progressBackground = progressNode && progressNode.querySelector('.progress-background-image');
    var progressFill = progressNode && progressNode.querySelector('.progress-fill-image');
    var progressCaption = progressNode && progressNode.querySelector('.progress-caption');
    if (!progressNode
      || !progressBackground
      || !progressFill
      || !progressFill.src.endsWith('#progress-frame-101')
      || progressFill.dataset.progressFrameIndex !== '0'
      || progressNode.dataset.progressFrameCount !== '3'
      || progressNode.dataset.progressFrameInterval !== '60000'
      || px(progressFill.style.left) !== 0
      || px(progressFill.style.top) !== 7
      || !progressFill.style.clipPath.includes('60%')
      || !progressCaption
      || progressCaption.textContent !== '40/100/40'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(progressCaption.style.color)
      || progressCaption.style.transform !== 'translate(4px, 5px)') {
      throw new Error('legacy ProgressBar frames, clipping, caption color, offsets, or %r rendering missing');
    }
    var animatedProgressNode = node(animatedProgress.id);
    var animatedBackground = animatedProgressNode.querySelector('.progress-background-image');
    var animatedFill = animatedProgressNode.querySelector('.progress-fill-image');
    var originalBackgroundSrc = animatedBackground && animatedBackground.src;
    var originalFillSrc = animatedFill && animatedFill.src;
    var originalClipPath = animatedFill && animatedFill.style.clipPath;
    var originalFillLeft = animatedFill && animatedFill.style.left;
    var originalFillTop = animatedFill && animatedFill.style.top;
    for (var frameAttempt = 0; frameAttempt < 50 && animatedFill.src === originalFillSrc; frameAttempt++) {
      await wait(10);
    }
    if (!animatedBackground
      || !animatedFill
      || animatedFill.src === originalFillSrc
      || !/#progress-frame-11[23]$/.test(animatedFill.src)
      || animatedBackground.src !== originalBackgroundSrc
      || animatedFill.style.clipPath !== originalClipPath
      || animatedFill.style.left !== originalFillLeft
      || animatedFill.style.top !== originalFillTop
      || px(animatedFill.style.left) !== 4
      || px(animatedFill.style.top) !== 11
      || !animatedFill.style.clipPath.includes('75%')) {
      throw new Error('legacy ProgressBar C/T did not animate only the clipped P fill frames');
    }
    var staticProgressNode = node(staticProgress.id);
    var staticFill = staticProgressNode && staticProgressNode.querySelector('.progress-fill-image');
    if (!staticFill
      || !staticFill.src.endsWith('#progress-progress-121')
      || staticProgressNode.dataset.progressFrameCount
      || staticProgressNode.dataset.progressFrameReadyCount
      || !staticFill.style.clipPath.startsWith('inset(50%')) {
      throw new Error('legacy ProgressBar C=0/T=0 must remain a static P fill without a frame timer');
    }
    var loadingStyleNode = node(loadingStyle.id);
    var loadingStyleFill = loadingStyleNode.querySelector('.progress-fill-image');
    var loadingStyleCaption = loadingStyleNode.querySelector('.progress-caption');
    if (!loadingStyleFill
      || !loadingStyleFill.style.clipPath.includes('75%')
      || !loadingStyleCaption
      || loadingStyleCaption.textContent !== '25%'
      || loadingStyleCaption.style.fontSize !== '18px'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(loadingStyleCaption.style.color)
      || loadingStyleCaption.style.webkitTextStrokeWidth !== '2px'
      || !['#ff0000', 'rgb(255, 0, 0)'].includes(loadingStyleCaption.style.webkitTextStrokeColor)
      || loadingStyleNode.dataset.progressCurrent !== '25'
      || loadingStyleNode.dataset.progressRunning !== 'false') {
      throw new Error('996PC LoadingBar visible caption style or left-to-right clipping missing');
    }
    var loadingHiddenNode = node(loadingHidden.id);
    var loadingHiddenFill = loadingHiddenNode.querySelector('.progress-fill-image');
    if (loadingHiddenNode.querySelector('.progress-caption')
      || !loadingHiddenFill.style.clipPath.includes('0px 0px 0px 75%')
      || loadingHiddenNode.dataset.progressCurrent !== '25'
      || loadingHiddenNode.dataset.progressRunning !== 'false') {
      throw new Error('996PC LoadingBar HideText or right-to-left clipping missing');
    }
    var loadingAnimatedNode = node(loadingAnimated.id);
    for (var loadingAttempt = 0;
      loadingAttempt < 50 && loadingAnimatedNode.dataset.progressCurrent !== '12';
      loadingAttempt++) {
      await wait(10);
    }
    var loadingAnimatedFill = loadingAnimatedNode.querySelector('.progress-fill-image');
    if (loadingAnimatedNode.dataset.progressStart !== '10'
      || loadingAnimatedNode.dataset.progressCurrent !== '12'
      || loadingAnimatedNode.dataset.progressEnd !== '12'
      || loadingAnimatedNode.dataset.progressMaximum !== '100'
      || loadingAnimatedNode.dataset.progressValueIntervalMs !== '20'
      || loadingAnimatedNode.dataset.progressValueStep !== '1'
      || loadingAnimatedNode.dataset.progressRunning !== 'false'
      || !loadingAnimatedFill.style.clipPath.includes('0px 0px 0px 88%')) {
      throw new Error('996PC LoadingBar interval/loadvalue did not advance and stop at endper');
    }
    var countdownGlyphs = node(imageCountdown.id).querySelectorAll('.image-text-glyph-image');
    if (countdownGlyphs.length !== 8) throw new Error('IMGCOUNTDOWN per-character glyph renderer missing');
    var countdownGlyphIndexes = Array.from(countdownGlyphs).map(function (glyph) {
      return Number(/image-countdown-([0-9]+)-/.exec(glyph.src)?.[1]);
    });
    if (countdownGlyphIndexes.join(',') !== '100,100,110,100,100,110,103,100') {
      throw new Error('IMGCOUNTDOWN glyph asset sequence incorrect: ' + countdownGlyphIndexes.join(','));
    }
    var countdownGlyphLeft = Array.from(countdownGlyphs).map(function (glyph) { return px(glyph.style.left); });
    if (countdownGlyphLeft.join(',') !== '0,26,52,78,104,130,156,182'
      || px(node(imageCountdown.id).style.width) !== 198) {
      throw new Error('IMGCOUNTDOWN glyph spacing or wrapper width incorrect');
    }
    var numberGlyphs = node(imageNumber.id).querySelectorAll('.image-text-glyph-image');
    if (numberGlyphs.length !== 4) throw new Error('IMGNUM per-character glyph renderer missing');
    var numberGlyphIndexes = Array.from(numberGlyphs).map(function (glyph) {
      return Number(/image-number-([0-9]+)-/.exec(glyph.src)?.[1]);
    });
    if (numberGlyphIndexes.join(',') !== '3171,3172,3173,3174') {
      throw new Error('IMGNUM glyph asset sequence incorrect: ' + numberGlyphIndexes.join(','));
    }
    var numberGlyphLeft = Array.from(numberGlyphs).map(function (glyph) { return px(glyph.style.left); });
    if (numberGlyphLeft.join(',') !== '0,13,26,39') {
      throw new Error('IMGNUM negative glyph spacing incorrect: ' + numberGlyphLeft.join(','));
    }
    var atlasNode = node(textAtlas.id);
    var atlasCells = atlasNode.querySelectorAll('.image-text-atlas-cell');
    var atlasGlyphs = atlasNode.querySelectorAll('.image-text-glyph-image');
    if (atlasCells.length !== 4 || atlasGlyphs.length !== 4) {
      throw new Error('TextAtlas per-digit crop windows missing');
    }
    var atlasCellLeft = Array.from(atlasCells).map(function (cell) { return px(cell.style.left); });
    var atlasImageLeft = Array.from(atlasGlyphs).map(function (glyph) { return px(glyph.style.left); });
    if (atlasCellLeft.join(',') !== '0,14,28,42'
      || atlasImageLeft.join(',') !== '0,-14,-28,-42'
      || Array.from(atlasCells).some(function (cell) {
        return px(cell.style.width) !== 14 || px(cell.style.height) !== 24 || cell.style.overflow !== 'hidden';
      })
      || px(atlasNode.style.width) !== 56
      || px(atlasNode.style.height) !== 24) {
      throw new Error('TextAtlas crop geometry incorrect: cells=' + atlasCellLeft.join(',')
        + ' images=' + atlasImageLeft.join(',')
        + ' wrapper=' + atlasNode.style.width + 'x' + atlasNode.style.height
        + ' cell0=' + (atlasCells[0] && atlasCells[0].getAttribute('style')));
    }
    if (node(imageCountdown.id).querySelector('.element-text')
      || node(imageNumber.id).querySelector('.element-text')
      || node(textAtlas.id).querySelector('.element-text')) {
      throw new Error('image-backed text control leaked into the plain text renderer');
    }
    var sliderNode = node(slider.id);
    var sliderBackground = sliderNode.querySelector('.progress-background-image');
    var sliderBar = sliderNode.querySelector('.progress-fill-image');
    var sliderThumb = sliderNode.querySelector('.slider-thumb-image');
    if (!sliderBackground || !sliderBar || !sliderThumb) throw new Error('Slider three-layer rendering missing');
    if (!/50%/.test(sliderBar.style.clipPath)) throw new Error('Slider default ratio clipping incorrect');
    if (px(sliderThumb.style.left) !== 190 || px(sliderThumb.style.top) !== -3) throw new Error('Slider thumb position incorrect');
    if (sliderNode.querySelector('.progress-caption')) throw new Error('Slider must not render a percentage caption');
    var percentages = page.elements.filter(function (element) { return element.statementId === 'newui-percentimg-996pc'; });
    var expectedClipPaths = [
      'inset(0px 66.22% 0px 0px)',
      'inset(0px 0px 0px 66.22%)',
      'inset(0px 0px 66.22%)',
      'inset(66.22% 0px 0px)',
    ];
    if (percentages.length !== 4) throw new Error('PercentImg direction fixtures missing');
    percentages.forEach(function (percentage, direction) {
      var percentageNode = node(percentage.id);
      var clipped = percentageNode.querySelector('.progress-fill-image');
      if (!clipped || clipped.style.clipPath !== expectedClipPaths[direction]) {
        throw new Error('PercentImg direction ' + direction + ' clipping incorrect: ' + (clipped && clipped.style.clipPath));
      }
      if (percentageNode.querySelector('.progress-background-image')) throw new Error('PercentImg leaked an uncut background image');
      if (percentageNode.querySelector('.progress-caption')) throw new Error('PercentImg must not render a caption');
    });
    var checkboxes = page.elements.filter(function (element) { return element.statementId === 'newui-checkbox-996pc'; });
    if (checkboxes.length !== 2) throw new Error('CheckBox fixtures missing');
    var uncheckedImage = node(checkboxes[0].id).querySelector('.toggle-asset-image');
    var checkedImage = node(checkboxes[1].id).querySelector('.toggle-asset-image');
    if (!uncheckedImage || !uncheckedImage.src.endsWith('#checkbox-normal-0')) {
      throw new Error('unchecked CheckBox did not render pcnimg');
    }
    if (!checkedImage || !checkedImage.src.endsWith('#checkbox-selected-1')) {
      throw new Error('checked CheckBox did not render pcpimg');
    }
    var styledButton = page.elements.find(function (element) { return element.id === 'dom-styled-button'; });
    var styledButtonNode = styledButton && node(styledButton.id);
    var buttonCaption = styledButtonNode && styledButtonNode.querySelector('.button-caption');
    var buttonImage = styledButtonNode && styledButtonNode.querySelector('.interactive-asset-image');
    if (!buttonCaption || buttonCaption.textContent !== '测试') throw new Error('Button caption missing');
    if (!['#00ff00', 'rgb(0, 255, 0)'].includes(buttonCaption.style.color)) {
      throw new Error('Button caption color incorrect: ' + buttonCaption.style.color);
    }
    if (buttonCaption.style.fontSize !== '18px'
      || buttonCaption.style.webkitTextStrokeWidth !== '2px'
      || !['#ff0000', 'rgb(255, 0, 0)'].includes(buttonCaption.style.webkitTextStrokeColor)) {
      throw new Error('Button caption size or outline incorrect');
    }
    if (!styledButtonNode.classList.contains('gray')
      || getComputedStyle(buttonCaption).pointerEvents !== 'none') {
      throw new Error('Button grey or pointer-event style missing');
    }
    styledButtonNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    if (!buttonImage || !buttonImage.src.endsWith('#button-hover')) throw new Error('styled Button hover state broke');
    styledButtonNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    if (!buttonImage.src.endsWith('#button-pressed')) throw new Error('styled Button pressed state broke');
    styledButtonNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!buttonImage.src.endsWith('#button-normal')) throw new Error('styled Button normal state broke');
    var menus = page.elements.filter(function (element) { return element.statementId === 'newui-menuitem-996pc'; });
    if (menus.length !== 2) throw new Error('MenuItem fixtures missing');
    var menuNode = node(menus[0].id);
    var menuValue = menuNode.querySelector('.menu-selected-value');
    if (!menuNode.classList.contains('kind-menu') || !menuNode.classList.contains('menu-up')) {
      throw new Error('MenuItem direction or kind missing');
    }
    if (!menuNode.querySelector('.menu-background-image')
      || !menuNode.querySelector('.menu-selected-image')
      || !menuNode.querySelector('.menu-arrow-image')) {
      throw new Error('MenuItem documented asset layers missing');
    }
    if (!menuValue || menuValue.textContent !== '张学友'
      || !['#00ffff', 'rgb(0, 255, 255)'].includes(menuValue.style.color)) {
      throw new Error('MenuItem selected value or color incorrect');
    }
    var menuToggle = menuNode.querySelector('.menu-toggle-hitarea');
    if (!menuToggle || menuToggle.getAttribute('aria-expanded') !== 'false') {
      throw new Error('MenuItem expansion toggle missing');
    }
    if (menuNode.querySelector('.menu-option-list')) {
      throw new Error('MenuItem must start in its documented collapsed state');
    }
    menuToggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    menuToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    menuNode = node(menus[0].id);
    var optionList = menuNode.querySelector('.menu-option-list');
    var options = optionList && Array.from(optionList.querySelectorAll('.menu-option'));
    var selectedOption = optionList && optionList.querySelector('.menu-option.selected');
    if (!menuNode.classList.contains('menu-expanded')
      || menuNode.querySelector('.menu-toggle-hitarea')?.getAttribute('aria-expanded') !== 'true'
      || !optionList
      || options.length !== 4
      || options.map(function (option) { return option.textContent; }).join('#') !== '刘德华#张学友#黎明#郭富城') {
      throw new Error('MenuItem did not draw its documented itemname list when expanded');
    }
    if (!optionList.querySelector('.menu-list-background-image')
      || !selectedOption?.querySelector('.menu-list-selected-image')) {
      throw new Error('MenuItem listimg or selectimg layer was not consumed by the expanded list');
    }
    if (selectedOption.textContent !== '张学友'
      || !['#00ffff', 'rgb(0, 255, 255)'].includes(selectedOption.style.color)
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(options[0].style.color)) {
      throw new Error('MenuItem expanded row selection or colors incorrect');
    }
    var menuRect = menuNode.getBoundingClientRect();
    var optionListRect = optionList.getBoundingClientRect();
    var optionRects = options.map(function (option) { return option.getBoundingClientRect(); });
    var optionScroller = optionList.querySelector('.menu-option-scroll');
    if (Math.abs(menuRect.width - 180) > 0.5
      || Math.abs(menuRect.height - 30) > 0.5
      || Math.abs(optionListRect.width - menuRect.width) > 0.5
      || Math.abs(optionListRect.height - 60) > 0.5
      || Math.abs(optionListRect.bottom - menuRect.top) > 0.5
      || optionRects.some(function (rect) { return Math.abs(rect.height - 30) > 0.5; })
      || !optionScroller
      || getComputedStyle(optionScroller).overflowY !== 'auto') {
      throw new Error('MenuItem itemhei/maxhei/upward list geometry incorrect');
    }
    optionScroller.scrollTop = 30;
    var fixedListBackgroundRect = optionList.querySelector('.menu-list-background-image').getBoundingClientRect();
    if (Math.abs(fixedListBackgroundRect.top - optionListRect.top) > 0.5
      || Math.abs(fixedListBackgroundRect.bottom - optionListRect.bottom) > 0.5) {
      throw new Error('MenuItem listimg scrolled away from the maxhei viewport');
    }
    if (menuNode.textContent.includes('物品/装备')) throw new Error('MenuItem leaked item placeholder text');
    var fallbackMenuNode = node(menus[1].id);
    if (!fallbackMenuNode.querySelector('.menu-shell')
      || fallbackMenuNode.querySelector('.menu-fallback-arrow')?.textContent !== '▼'
      || fallbackMenuNode.querySelector('.element-placeholder')) {
      throw new Error('MenuItem CSS fallback missing');
    }
    var fallbackToggle = fallbackMenuNode.querySelector('.menu-toggle-hitarea');
    fallbackToggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    fallbackToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    fallbackMenuNode = node(menus[1].id);
    var fallbackList = fallbackMenuNode.querySelector('.menu-option-list');
    var fallbackScroller = fallbackList && fallbackList.querySelector('.menu-option-scroll');
    var fallbackMenuRect = fallbackMenuNode.getBoundingClientRect();
    var fallbackListRect = fallbackList && fallbackList.getBoundingClientRect();
    if (!fallbackList
      || !fallbackList.classList.contains('menu-list-css-fallback')
      || fallbackList.querySelector('.menu-list-background-image')
      || fallbackList.querySelectorAll('.menu-option').length !== 2
      || Math.abs(fallbackListRect.height - 60) > 0.5
      || Math.abs(fallbackListRect.top - fallbackMenuRect.bottom) > 0.5
      || !fallbackScroller
      || getComputedStyle(fallbackScroller).overflowY !== 'hidden') {
      throw new Error('MenuItem downward CSS fallback list geometry incorrect');
    }
    var countdowns = page.elements.filter(function (element) {
      return element.countdownPreview && !element.imageTextPreview;
    });
    if (countdowns.length !== 2) throw new Error('countdown fixtures missing');
    var countdownText = node(countdowns[0].id).querySelector('.styled-text-preview');
    var timeTipsText = node(countdowns[1].id).querySelector('.styled-text-preview');
    if (!countdownText || countdownText.textContent !== '90秒'
      || countdownText.style.fontSize !== '18px'
      || countdownText.style.webkitTextStrokeWidth !== '1px'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(countdownText.style.color)) {
      throw new Error('COUNTDOWN styled initial text missing');
    }
    if (!timeTipsText || timeTipsText.textContent !== '1天1时1分1秒') {
      throw new Error('TIMETIPS day/hour/minute/second text missing');
    }
    if (node(countdowns[0].id).textContent.includes('<COUNTDOWN')) {
      throw new Error('raw COUNTDOWN markup leaked into canvas');
    }
    var richText = page.elements.find(function (element) { return element.id === 'dom-rich-text'; });
    var richTextNode = richText && node(richText.id);
    var richTextLabel = richTextNode && richTextNode.querySelector('.styled-text-preview');
    var richTextRuns = richTextLabel
      ? Array.from(richTextLabel.querySelectorAll('.styled-text-line > span')) : [];
    var richTextColors = richTextRuns.map(function (run) { return run.style.color; });
    if (!richTextLabel
      || richTextLabel.textContent !== '默认我是富文本996'
      || richTextLabel.style.fontSize !== '20px'
      || richTextRuns.map(function (run) { return run.textContent; }).join('|') !== '默认|我是|富文本|996'
      || !['#ff7700', 'rgb(255, 119, 0)'].includes(richTextColors[0])
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(richTextColors[1])
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(richTextColors[2])
      || !['#ff00ff', 'rgb(255, 0, 255)'].includes(richTextColors[3])) {
      throw new Error('RText inline color runs missing or incorrect');
    }
    if (richTextNode.textContent.includes('FCOLOR') || richTextNode.textContent.includes('<RText')) {
      throw new Error('raw RText markup leaked into canvas');
    }
    var customColorRichText = page.elements.find(function (element) {
      return element.id === 'dom-custom-color-rich-text';
    });
    var customColorRichTextNode = customColorRichText && node(customColorRichText.id);
    var customColorRichTextLabel = customColorRichTextNode
      && customColorRichTextNode.querySelector('.styled-text-preview');
    var customColorRichTextRuns = customColorRichTextLabel
      ? Array.from(customColorRichTextLabel.querySelectorAll('.styled-text-line > span')) : [];
    if (!customColorRichTextLabel
      || customColorRichTextLabel.textContent !== '普通自定义'
      || customColorRichTextRuns.map(function (run) { return run.textContent; }).join('|') !== '普通|自定义'
      || customColorRichTextRuns[1].style.color
      || /FCOLOR|[<>]/.test(customColorRichTextNode.textContent)) {
      throw new Error('unavailable custom RText color leaked markup or invented a visible color');
    }
    var legacyCentered = page.elements.find(function (element) {
      return element.id === 'dom-legacy-centered-text';
    });
    var legacyCenteredNode = legacyCentered && node(legacyCentered.id);
    var legacyCenteredLabel = legacyCenteredNode
      && legacyCenteredNode.querySelector('.styled-text-preview');
    var legacyCenteredRect = legacyCenteredNode && legacyCenteredNode.getBoundingClientRect();
    var canvas = document.getElementById('dialogCanvas');
    var canvasRect = canvas.getBoundingClientRect();
    if (!legacyCenteredNode
      || !legacyCenteredLabel
      || legacyCenteredLabel.textContent !== '1002亿'
      || legacyCenteredLabel.style.fontSize !== '25px'
      || legacyCenteredLabel.style.fontFamily !== '宋体'
      || !['700', 'bold'].includes(legacyCenteredLabel.style.fontWeight)
      || legacyCenteredLabel.style.textAlign !== 'center'
      || legacyCenteredNode.dataset.legacyCenterX !== 'true'
      || legacyCenteredNode.dataset.legacyCenterY !== 'true'
      || legacyCenteredNode.dataset.legacyCenterOffsetY !== '30'
      || Math.abs((legacyCenteredRect.left + legacyCenteredRect.width / 2)
        - (canvasRect.left + canvas.clientLeft + falseModel.canvasWidth / 2)) > 0.75
      || Math.abs((legacyCenteredRect.top + legacyCenteredRect.height / 2)
        - (canvasRect.top + canvas.clientTop + falseModel.canvasHeight / 2 + 30)) > 0.75) {
      throw new Error('traditional GOM Text font, simplenum, or official centered DOM geometry missing: '
        + JSON.stringify({
          text: legacyCenteredLabel && legacyCenteredLabel.textContent,
          fontSize: legacyCenteredLabel && legacyCenteredLabel.style.fontSize,
          fontFamily: legacyCenteredLabel && legacyCenteredLabel.style.fontFamily,
          fontWeight: legacyCenteredLabel && legacyCenteredLabel.style.fontWeight,
          textAlign: legacyCenteredLabel && legacyCenteredLabel.style.textAlign,
          labelWidth: legacyCenteredLabel && legacyCenteredLabel.style.width,
          centerX: legacyCenteredNode && legacyCenteredNode.dataset.legacyCenterX,
          centerY: legacyCenteredNode && legacyCenteredNode.dataset.legacyCenterY,
          offsetX: legacyCenteredNode && legacyCenteredNode.dataset.legacyCenterOffsetX,
          offsetY: legacyCenteredNode && legacyCenteredNode.dataset.legacyCenterOffsetY,
          wrapperStyle: legacyCenteredNode && {
            left: legacyCenteredNode.style.left,
            top: legacyCenteredNode.style.top,
            width: legacyCenteredNode.style.width,
            height: legacyCenteredNode.style.height,
          },
          wrapperRect: legacyCenteredRect && {
            left: legacyCenteredRect.left,
            top: legacyCenteredRect.top,
            width: legacyCenteredRect.width,
            height: legacyCenteredRect.height,
          },
          canvasRect: canvasRect && {
            left: canvasRect.left,
            top: canvasRect.top,
            width: canvasRect.width,
            height: canvasRect.height,
            clientLeft: canvas.clientLeft,
            clientTop: canvas.clientTop,
          },
        }));
    }
    var geeStyled = page.elements.find(function (element) {
      return element.id === 'dom-gee-styled-text';
    });
    var geeStyledNode = geeStyled && node(geeStyled.id);
    var geeStyledLabel = geeStyledNode && geeStyledNode.querySelector('.styled-text-preview');
    if (!geeStyledLabel
      || geeStyledLabel.textContent !== '翎风字体'
      || geeStyledLabel.style.fontSize !== '14px'
      || geeStyledLabel.style.fontFamily !== '黑体'
      || !['700', 'bold'].includes(geeStyledLabel.style.fontWeight)) {
      throw new Error('traditional GEE Text documented font DOM styling missing');
    }
    var multiText = page.elements.find(function (element) {
      return element.statementId === 'container-mtext'
        && element.text === '第一行文字\\n第二行文字\\n第三行文字';
    });
    var multiTextNode = multiText && node(multiText.id);
    var multiTextLabel = multiTextNode && multiTextNode.querySelector('.styled-text-preview');
    var multiTextLines = multiTextLabel
      ? Array.from(multiTextLabel.querySelectorAll('.styled-text-line')) : [];
    if (!multiTextNode
      || !multiTextLabel
      || multiTextLines.map(function (line) { return line.textContent; }).join('|') !== '第一行文字|第二行文字|第三行文字'
      || px(multiTextNode.style.height) !== 60
      || multiTextNode.clientHeight < multiTextLabel.scrollHeight
      || !['#ff7700', 'rgb(255, 119, 0)'].includes(multiTextLabel.style.color)
      || /<MText|FCOLOR|[|]|^>$/.test(multiTextNode.textContent)) {
      throw new Error('official cross-line MText was not drawn as three styled DOM lines');
    }
    var filledLayout = page.elements.find(function (element) {
      return element.containerElementId === 'DOMFILLED';
    });
    var transparentLayout = page.elements.find(function (element) {
      return element.containerElementId === 'DOMTRANSPARENT';
    });
    var filledLayoutNode = filledLayout && node(filledLayout.id);
    var transparentLayoutNode = transparentLayout && node(transparentLayout.id);
    var filledLayoutBackground = filledLayoutNode && getComputedStyle(filledLayoutNode).backgroundColor;
    var transparentLayoutBackground = transparentLayoutNode
      && getComputedStyle(transparentLayoutNode).backgroundColor;
    if (!filledLayoutNode
      || !transparentLayoutNode
      || !['#fb0000', 'rgb(251, 0, 0)'].includes(filledLayoutBackground)
      || !['transparent', 'rgba(0, 0, 0, 0)'].includes(transparentLayoutBackground)
      || filledLayoutNode.style.borderColor
      || filledLayoutNode.querySelector('.element-placeholder')) {
      throw new Error('996PC Layout documented fill or transparent default was not drawn');
    }
    var dialogCanvas = document.getElementById('dialogCanvas');
    var dialogCanvasRect = dialogCanvas.getBoundingClientRect();
    var dialogCanvasInnerLeft = dialogCanvasRect.left + dialogCanvas.clientLeft;
    var dialogCanvasInnerTop = dialogCanvasRect.top + dialogCanvas.clientTop;
    var placementTolerance = 1.1;
    var backgroundNodes = [0, 1, 2, 3, 4].map(function (show) {
      var element = page.elements.find(function (candidate) {
        return candidate.containerElementId === 'DOMBG' + show;
      });
      var elementNode = element && node(element.id);
      if (!elementNode) throw new Error('background Img fixture missing for show=' + show);
      var rect = elementNode.getBoundingClientRect();
      var expectedWidth = show === 4 ? 400 : 40;
      var expectedHeight = show === 4 ? 300 : 30;
      var expectedLeft = element.layoutX;
      var expectedTop = element.layoutY;
      if (!elementNode.classList.contains('dialog-panel-background')
        || !elementNode.classList.contains('locked')
        || elementNode.dataset.imageBackground !== 'true'
        || elementNode.dataset.imageShowPosition !== String(show)
        || getComputedStyle(elementNode).zIndex !== '1'
        || Math.abs(rect.width - expectedWidth) > placementTolerance
        || Math.abs(rect.height - expectedHeight) > placementTolerance
        || !elementNode.querySelector('.dialog-image-preview-image')
        || elementNode.querySelector('.element-placeholder')
        || Math.abs(rect.left - dialogCanvasInnerLeft - expectedLeft) > placementTolerance
        || Math.abs(rect.top - dialogCanvasInnerTop - expectedTop) > placementTolerance) {
        throw new Error('996PC background Img show placement or layer missing for show=' + show);
      }
      return elementNode;
    });
    var backgroundChild = page.elements.find(function (element) {
      return element.containerElementId === 'DOMBGCHILD';
    });
    var backgroundChildNode = backgroundChild && node(backgroundChild.id);
    var centeredBackgroundRect = backgroundNodes[4].getBoundingClientRect();
    var backgroundChildRect = backgroundChildNode && backgroundChildNode.getBoundingClientRect();
    if (!backgroundChildNode
      || backgroundChild.parentElementId !== page.elements.find(function (element) {
        return element.containerElementId === 'DOMBG4';
      }).id
      || getComputedStyle(backgroundChildNode).zIndex !== '10'
      || Math.abs(backgroundChildRect.left - centeredBackgroundRect.left - 20) > placementTolerance
      || Math.abs(backgroundChildRect.top - centeredBackgroundRect.top - 30) > placementTolerance) {
      throw new Error('996PC show-positioned background children did not follow the panel origin');
    }
    backgroundNodes[4].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    if (document.getElementById('sourceX').textContent !== '999'
      || document.getElementById('sourceY').textContent !== '999') {
      throw new Error('show-positioned background inspector replaced source X/Y with visual coordinates');
    }
    var dynamicShow = page.elements.find(function (element) {
      return element.containerElementId === 'DOMDYNAMICSHOW';
    });
    var dynamicBackground = page.elements.find(function (element) {
      return element.containerElementId === 'DOMDYNAMICBG';
    });
    var dynamicShowNode = dynamicShow && node(dynamicShow.id);
    var dynamicBackgroundNode = dynamicBackground && node(dynamicBackground.id);
    if (!dynamicShowNode
      || !dynamicShowNode.classList.contains('dialog-panel-background')
      || !dynamicShowNode.classList.contains('locked')
      || dynamicShowNode.dataset.imageBackground !== 'true'
      || dynamicShowNode.dataset.imageShowPosition !== undefined
      || !dynamicBackgroundNode
      || !dynamicBackgroundNode.classList.contains('locked')
      || dynamicBackgroundNode.classList.contains('dialog-panel-background')
      || dynamicBackgroundNode.dataset.imageBackground !== undefined) {
      throw new Error('dynamic Img bg/show values masqueraded as confirmed static placement');
    }
    var normalImage = page.elements.find(function (element) {
      return element.containerElementId === 'DOMNORMALIMG';
    });
    var foregroundText = page.elements.find(function (element) {
      return element.containerElementId === 'DOMBGFOREGROUND';
    });
    var normalImageNode = normalImage && node(normalImage.id);
    var foregroundTextNode = foregroundText && node(foregroundText.id);
    var normalImageRect = normalImageNode && normalImageNode.getBoundingClientRect();
    if (!normalImageNode
      || !foregroundTextNode
      || normalImageNode.classList.contains('dialog-panel-background')
      || normalImageNode.dataset.imageBackground
      || getComputedStyle(normalImageNode).zIndex !== '10'
      || Number(getComputedStyle(backgroundNodes[4]).zIndex) >= Number(getComputedStyle(foregroundTextNode).zIndex)
      || Math.abs(normalImageRect.left - dialogCanvasInnerLeft - 60) > placementTolerance
      || Math.abs(normalImageRect.top - dialogCanvasInnerTop - 70) > placementTolerance) {
      throw new Error('bg=0 Img regressed or background Img did not stay below foreground controls');
    }
    var plainText996 = page.elements.find(function (element) { return element.id === 'dom-plain-text-996'; });
    var plainText996Node = plainText996 && node(plainText996.id);
    var plainText996Label = plainText996Node
      && plainText996Node.querySelector('.styled-text-preview');
    if (!plainText996Label
      || plainText996Label.textContent !== '核心文字'
      || plainText996Label.style.fontSize !== '18px'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(plainText996Label.style.color)
      || plainText996Label.style.webkitTextStrokeWidth !== '2px'
      || !['#ff0000', 'rgb(255, 0, 0)'].includes(plainText996Label.style.webkitTextStrokeColor)
      || plainText996Label.style.textAlign !== 'left'
      || plainText996Node.querySelector('.element-placeholder')) {
      throw new Error('996PC Text documented static style renderer missing');
    }
    var bgrText996 = page.elements.find(function (element) { return element.id === 'dom-bgr-text-996'; });
    var bgrText996Label = bgrText996 && node(bgrText996.id).querySelector('.styled-text-preview');
    if (!bgrText996Label
      || !['#88cf8f', 'rgb(136, 207, 143)'].includes(bgrText996Label.style.color)) {
      throw new Error('$BBGGRR did not convert to the expected CSS #RRGGBB color');
    }
    var movingTextHorizontal = page.elements.find(function (element) {
      return element.id === 'dom-moving-text-996-0';
    });
    var movingTextVertical = page.elements.find(function (element) {
      return element.id === 'dom-moving-text-996-1';
    });
    var movingTextHorizontalNode = movingTextHorizontal && node(movingTextHorizontal.id);
    var movingTextVerticalNode = movingTextVertical && node(movingTextVertical.id);
    var movingTextHorizontalLabel = movingTextHorizontalNode
      && movingTextHorizontalNode.querySelector('.styled-text-preview');
    var movingTextVerticalLabel = movingTextVerticalNode
      && movingTextVerticalNode.querySelector('.styled-text-preview');
    if (!movingTextHorizontalNode || !movingTextVerticalNode
      || !movingTextHorizontalLabel || !movingTextVerticalLabel
      || movingTextHorizontalLabel.textContent !== '12万'
      || px(movingTextHorizontalNode.style.width) !== 140
      || px(movingTextHorizontalNode.style.height) !== 24
      || movingTextHorizontalNode.style.overflow !== 'hidden'
      || movingTextHorizontalNode.dataset.textScrollDirection !== '0'
      || movingTextHorizontalNode.dataset.textScrollDurationMs !== '4000'
      || movingTextHorizontalNode.dataset.textColors !== '#00ff00,#ffff00'
      || movingTextHorizontalNode.dataset.textColorIntervalMs !== '1000'
      || movingTextHorizontalNode.dataset.textColorIndex !== '0'
      || movingTextHorizontalNode.dataset.textScrollTickMs !== '40'
      || !movingTextHorizontalLabel.classList.contains('text-scroll-content')
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(movingTextHorizontalLabel.style.color)
      || px(movingTextVerticalNode.style.width) !== 100
      || px(movingTextVerticalNode.style.height) !== 40
      || movingTextVerticalNode.dataset.textScrollDirection !== '1'
      || movingTextVerticalNode.dataset.textScrollTickMs !== '40'
      || movingTextVerticalNode.dataset.textColorIntervalMs
      || movingTextVerticalNode.dataset.textColorIndex
      || !movingTextVerticalLabel.classList.contains('text-scroll-content')) {
      throw new Error('996PC Text simplenum, viewport, initial flash color, or scroll metadata missing');
    }
    var movingHorizontalBefore = movingTextHorizontalLabel.getBoundingClientRect().left;
    var movingVerticalBefore = movingTextVerticalLabel.getBoundingClientRect().top;
    await wait(120);
    var movingHorizontalAfter = movingTextHorizontalLabel.getBoundingClientRect().left;
    var movingVerticalAfter = movingTextVerticalLabel.getBoundingClientRect().top;
    if (!(movingHorizontalAfter < movingHorizontalBefore - 0.25)
      || !(movingVerticalAfter < movingVerticalBefore - 0.25)) {
      throw new Error('996PC Text did not actually move in the documented directions: '
        + [movingHorizontalBefore, movingHorizontalAfter, movingVerticalBefore, movingVerticalAfter].join(','));
    }
    await wait(950);
    if (movingTextHorizontalNode.dataset.textColorIndex !== '1'
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(movingTextHorizontalLabel.style.color)) {
      throw new Error('996PC Text did not advance to the second color after the documented 1s interval');
    }
    await wait(1050);
    if (movingTextHorizontalNode.dataset.textColorIndex !== '0'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(movingTextHorizontalLabel.style.color)) {
      throw new Error('996PC Text color animation did not wrap to its deterministic first color');
    }
    var styledImage996 = page.elements.find(function (element) { return element.id === 'dom-styled-image-996'; });
    var styledImage996Node = styledImage996 && node(styledImage996.id);
    var styledImage996Asset = styledImage996Node
      && styledImage996Node.querySelector('.dialog-image-preview-image');
    if (!styledImage996Node
      || !styledImage996Node.classList.contains('dialog-image-preview')
      || styledImage996Node.dataset.imageOpacity !== '128'
      || styledImage996Node.dataset.imageGray !== 'true'
      || !styledImage996Asset
      || !styledImage996Asset.src.endsWith('#styled-image-996')
      || Math.abs(Number(styledImage996Asset.style.opacity) - (128 / 255)) > 0.000001
      || styledImage996Asset.style.filter !== 'grayscale(1)'
      || px(styledImage996Asset.style.left) !== -3
      || px(styledImage996Asset.style.top) !== -4
      || styledImage996Node.querySelector('.element-placeholder')) {
      throw new Error('996PC Img opacity/grey renderer missing');
    }
    var stretchedImage996 = page.elements.find(function (element) { return element.id === 'dom-stretched-image-996'; });
    var stretchedImage996Node = stretchedImage996 && node(stretchedImage996.id);
    var stretchedImage996Asset = stretchedImage996Node
      && stretchedImage996Node.querySelector('.dialog-image-preview-image');
    if (!stretchedImage996Asset
      || px(stretchedImage996Node.style.width) !== 120
      || px(stretchedImage996Node.style.height) !== 60
      || px(stretchedImage996Asset.style.width) !== 120
      || px(stretchedImage996Asset.style.height) !== 60
      || stretchedImage996Node.querySelector('.dialog-image-nine-slice')) {
      throw new Error('996PC Img ordinary width/height scaling missing');
    }
    var nineSliceImage996 = page.elements.find(function (element) { return element.id === 'dom-nine-slice-image-996'; });
    var nineSliceImage996Node = nineSliceImage996 && node(nineSliceImage996.id);
    var nineSlice = nineSliceImage996Node
      && nineSliceImage996Node.querySelector('.dialog-image-nine-slice');
    if (!nineSlice
      || nineSliceImage996Node.dataset.imageScale9 !== '10,12,8,9'
      || px(nineSliceImage996Node.style.width) !== 180
      || px(nineSliceImage996Node.style.height) !== 100
      || px(nineSlice.style.width) !== 180
      || px(nineSlice.style.height) !== 100
      || nineSlice.style.borderImageSlice !== '8 12 9 10 fill'
      || nineSlice.style.borderImageWidth !== '8px 12px 9px 10px'
      || nineSlice.style.borderImageRepeat !== 'stretch'
      || !nineSlice.style.borderImageSource.includes('#nine-slice-image-996')
      || nineSliceImage996Node.querySelector('.dialog-image-preview-image')) {
      throw new Error('996PC Img nine-slice geometry renderer missing: ' + (nineSlice && nineSlice.getAttribute('style')));
    }
    var inputText = page.elements.find(function (element) { return element.id === 'dom-input-text'; });
    var inputTextNode = inputText && node(inputText.id);
    var inputControl = inputTextNode && inputTextNode.querySelector('input.dialog-input-control');
    if (!inputTextNode || !inputControl
      || inputControl.type !== 'text'
      || inputControl.dataset.inputMode !== 'text'
      || inputControl.readOnly
      || inputControl.tabIndex !== 0
      || inputControl.placeholder !== '请输入名字'
      || inputControl.minLength !== 2
      || inputControl.maxLength !== 12
      || px(inputTextNode.style.width) !== 80
      || px(inputTextNode.style.height) !== 15
      || inputTextNode.querySelector('.element-placeholder')) {
      throw new Error('INPUTTEXT real local-preview input renderer missing');
    }
    var inputStyle = getComputedStyle(inputControl);
    var placeholderStyle = getComputedStyle(inputControl, '::placeholder');
    if (inputStyle.pointerEvents !== 'auto'
      || inputStyle.boxSizing !== 'border-box'
      || !['rgba(0, 0, 0, 0)', 'transparent'].includes(inputStyle.backgroundColor)
      || !['#ff0000', 'rgb(255, 0, 0)'].includes(inputStyle.borderTopColor)
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(inputStyle.color)
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(placeholderStyle.color)) {
      throw new Error('INPUTTEXT visual colors or local-interactive CSS incorrect: '
        + inputStyle.cssText + ' placeholder=' + placeholderStyle.color);
    }
    var inputNumber = page.elements.find(function (element) { return element.id === 'dom-input-number'; });
    var inputNumberNode = inputNumber && node(inputNumber.id);
    var numericControl = inputNumberNode && inputNumberNode.querySelector('input.dialog-input-control');
    if (!numericControl
      || numericControl.type !== 'text'
      || numericControl.inputMode !== 'decimal'
      || numericControl.dataset.inputMode !== 'number'
      || numericControl.dataset.minValue !== '-10'
      || numericControl.dataset.maxValue !== '100'
      || numericControl.placeholder !== '请输入数字'
      || numericControl.readOnly
      || numericControl.tabIndex !== 0
      || px(inputNumberNode.style.width) !== 90
      || px(inputNumberNode.style.height) !== 16
      || inputNumberNode.querySelector('.element-placeholder')) {
      throw new Error('INPUTNUM numeric local-preview input renderer missing');
    }
    var customInputs = page.elements.filter(function (element) {
      return /^dom-custom-input-/.test(element.id);
    });
    var customControls = customInputs.map(function (element) {
      return node(element.id).querySelector('input.dialog-input-control');
    });
    if (customControls.length !== 4
      || customControls.some(function (control) { return !control || control.readOnly || control.tabIndex !== 0; })
      || customControls.map(function (control) { return control.dataset.inputMode; }).join(',')
        !== 'text,number,password,absolute-number'
      || customControls.map(function (control) { return control.type; }).join(',')
        !== 'text,text,password,text'
      || customControls[1].inputMode !== 'decimal'
      || customControls[3].inputMode !== 'decimal'
      || customControls[2].value !== '') {
      throw new Error('996PC Input type mapping or local-preview controls missing');
    }
    var customTextNode = node(customInputs[0].id);
    var customTextControl = customControls[0];
    var customTextStyle = getComputedStyle(customTextControl);
    if (customTextControl.placeholder !== '请输入'
      || customTextControl.minLength !== 3
      || customTextControl.maxLength !== 15
      || customTextControl.dataset.onlyChinese !== 'true'
      || !customTextNode.classList.contains('dialog-input-default-frame')
      || px(customTextNode.style.width) !== 145
      || px(customTextNode.style.height) !== 25
      || customTextStyle.fontSize !== '18px'
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(customTextStyle.color)
      || !['#ffff00', 'rgb(255, 255, 0)'].includes(
        getComputedStyle(customTextControl, '::placeholder').color
      )) {
      throw new Error('996PC Input documented styling fields missing');
    }
    if (customControls.slice(1).some(function (control) {
      var style = getComputedStyle(control);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderTopWidth !== '0px';
    })) {
      throw new Error('996PC Input bgtype=0 unexpectedly rendered a background frame');
    }
    if (customInputs.some(function (element) { return node(element.id).querySelector('.element-placeholder'); })) {
      throw new Error('996PC Input still uses the generic placeholder renderer');
    }
    var inputMemo = page.elements.find(function (element) { return element.id === 'dom-input-memo'; });
    var inputMemoNode = inputMemo && node(inputMemo.id);
    var memoControl = inputMemoNode && inputMemoNode.querySelector('textarea.dialog-input-control');
    var memoStyle = memoControl && getComputedStyle(memoControl);
    if (!memoControl
      || memoControl.dataset.inputMode !== 'memo'
      || memoControl.readOnly
      || memoControl.tabIndex !== 0
      || memoControl.value !== ''
      || memoControl.placeholder !== ''
      || memoControl.minLength !== 4
      || memoControl.maxLength !== 50
      || memoControl.wrap !== 'off'
      || memoControl.dataset.autoWrap !== 'false'
      || px(inputMemoNode.style.width) !== 150
      || px(inputMemoNode.style.height) !== 50
      || memoStyle.lineHeight !== '18px'
      || memoStyle.pointerEvents !== 'auto'
      || memoStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
      || !['#ff0000', 'rgb(255, 0, 0)'].includes(memoStyle.borderTopColor)
      || !['#00ff00', 'rgb(0, 255, 0)'].includes(memoStyle.color)
      || inputMemoNode.querySelector('.element-placeholder')) {
      throw new Error('INPUTMEMO real local-preview textarea renderer or documented styling missing');
    }
    var monsters = page.elements.filter(function (element) { return /^dom-monster-/.test(element.id); });
    var monsterNode = monsters[0] && node(monsters[0].id);
    var monsterImage = monsterNode && monsterNode.querySelector('.monster-preview-image');
    if (!monsterNode
      || !monsterNode.classList.contains('dialog-monster-preview')
      || monsterNode.dataset.monsterStatus !== 'static-representative'
      || !monsterImage
      || !monsterImage.src.endsWith('#monster-representative')
      || px(monsterNode.style.width) !== 90
      || px(monsterNode.style.height) !== 120
      || px(monsterImage.style.left) !== -45
      || px(monsterImage.style.top) !== -110
      || monsterNode.querySelector('.element-placeholder')) {
      throw new Error('GOM MONSTER representative frame renderer missing');
    }
    var smartMonsterNode = monsters[1] && node(monsters[1].id);
    var smartMonsterPlaceholder = smartMonsterNode
      && smartMonsterNode.querySelector('.element-placeholder');
    if (!smartMonsterPlaceholder
      || !smartMonsterPlaceholder.textContent.includes('SmartMonster')
      || !smartMonsterPlaceholder.textContent.includes('怪物名')
      || smartMonsterNode.querySelector('.monster-preview-image')) {
      throw new Error('Race=156 MONSTER did not expose its unresolvable SmartMonster boundary');
    }
    var geeMonsters = page.elements.filter(function (element) { return /^dom-gee-monster-/.test(element.id); });
    var geeMonsterNode = geeMonsters[0] && node(geeMonsters[0].id);
    var geeMonsterImage = geeMonsterNode && geeMonsterNode.querySelector('.monster-preview-image');
    if (!geeMonsterNode
      || !geeMonsterNode.classList.contains('dialog-monster-gee')
      || geeMonsterNode.dataset.monsterStatus !== 'static-representative'
      || geeMonsterNode.dataset.monsterRaceImg !== '11'
      || geeMonsterNode.dataset.monsterAppr !== '160'
      || geeMonsterNode.dataset.monsterDisplayMode !== '11'
      || geeMonsterNode.dataset.monsterDirection !== '1'
      || !geeMonsterImage
      || !geeMonsterImage.src.endsWith('#gee-monster-representative')
      || px(geeMonsterNode.style.width) !== 84
      || px(geeMonsterNode.style.height) !== 112
      || px(geeMonsterImage.style.left) !== -40
      || px(geeMonsterImage.style.top) !== -102
      || geeMonsterNode.querySelector('.element-placeholder')) {
      throw new Error('GEE/LFM MONSTER representative frame or parameter-order renderer missing');
    }
    var geeSmartMonsterNode = geeMonsters[1] && node(geeMonsters[1].id);
    var geeSmartMonsterPlaceholder = geeSmartMonsterNode
      && geeSmartMonsterNode.querySelector('.element-placeholder');
    if (!geeSmartMonsterPlaceholder
      || !geeSmartMonsterPlaceholder.textContent.includes('SmartMonster')
      || !geeSmartMonsterPlaceholder.textContent.includes('怪物名')
      || geeSmartMonsterNode.querySelector('.monster-preview-image')) {
      throw new Error('GEE/LFM RaceImg=156 did not expose its named SmartMonster boundary');
    }
    var uiModel = page.elements.find(function (element) { return element.id === 'dom-ui-model'; });
    var uiModelNode = uiModel && node(uiModel.id);
    var uiModelLayers = uiModelNode
      ? Array.from(uiModelNode.querySelectorAll('.dialog-model-layer-image')) : [];
    if (!uiModelNode || !uiModelNode.classList.contains('dialog-model-preview')
      || uiModelLayers.length !== 4
      || uiModelLayers.map(function (layer) { return layer.dataset.modelRole; }).join(',') !== 'cloth,weapon,head,cap'
      || px(uiModelNode.style.left) !== 630
      || px(uiModelNode.style.top) !== -95
      || px(uiModelNode.style.width) !== 150
      || px(uiModelNode.style.height) !== 225) {
      throw new Error('UIModel layered renderer, origin offset, or union bounds missing: '
        + uiModelNode.getAttribute('style'));
    }
    var expectedModelGeometry = [
      [30, 45, 120, 180],
      [0, 75, 150, 150],
      [52.5, 15, 75, 60],
      [45, 0, 90, 45],
    ];
    uiModelLayers.forEach(function (layer, index) {
      var expected = expectedModelGeometry[index];
      var actual = [px(layer.style.left), px(layer.style.top), px(layer.style.width), px(layer.style.height)];
      if (actual.join(',') !== expected.join(',')) {
        throw new Error('UIModel layer geometry incorrect for ' + layer.dataset.modelRole + ': ' + actual.join(','));
      }
    });
    if (uiModelNode.querySelector('.element-placeholder')) {
      throw new Error('UIModel still rendered the generic model placeholder');
    }
    var uiModelBoundaryNote = uiModelNode.querySelector('.dialog-model-boundary');
    if (uiModelNode.dataset.modelCoverage !== 'partial-simulation'
      || uiModelNode.dataset.modelSex !== '0'
      || uiModelNode.dataset.modelScale !== '1.5'
      || uiModelNode.dataset.modelHairId !== '3'
      || uiModelNode.dataset.modelNotShowMold !== 'true'
      || uiModelNode.dataset.modelNotShowHair !== 'false'
      || uiModelNode.dataset.modelEffectConfigs !== '{"cloth":"506#1#0#0"}'
      || !uiModelBoundaryNote
      || !uiModelBoundaryNote.textContent.includes('发型ID 3')
      || !uiModelBoundaryNote.textContent.includes('衣服特效')) {
      throw new Error('UIModel retained fields or partial-simulation boundary are not visible in the DOM');
    }
    var uiModelUnknown = page.elements.find(function (element) {
      return element.id === 'dom-ui-model-boundary';
    });
    var uiModelUnknownNode = uiModelUnknown && node(uiModelUnknown.id);
    var uiModelUnknownNote = uiModelUnknownNode
      && uiModelUnknownNode.querySelector('.dialog-model-boundary');
    if (!uiModelUnknownNode
      || uiModelUnknownNode.dataset.modelDynamicFields !== 'sex,cloth-id'
      || uiModelUnknownNode.dataset.modelInvalidFields !== 'scale,weapon-id,not-show-hair'
      || uiModelUnknownNode.querySelectorAll('.dialog-model-layer-image').length !== 0
      || !uiModelUnknownNode.querySelector('.element-placeholder')
      || !uiModelUnknownNote
      || !uiModelUnknownNote.textContent.includes('动态 sex、cloth-id')
      || !uiModelUnknownNote.textContent.includes('无效 scale、weapon-id、not-show-hair')) {
      throw new Error('UIModel dynamic/invalid source boundary did not remain visible and asset-safe');
    }
    uiModelNode.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: 20, clientY: 20
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: 30, clientY: 25
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: 30, clientY: 25
    }));
    await wait(20);
    uiModelNode = node(uiModel.id);
    if (px(uiModelNode.style.left) !== 640 || px(uiModelNode.style.top) !== -90
      || document.getElementById('sourceX').textContent !== '730'
      || document.getElementById('sourceY').textContent !== '105') {
      throw new Error('UIModel drag mixed the visual min offset into source coordinates: '
        + JSON.stringify({
          left: uiModelNode && uiModelNode.style.left,
          top: uiModelNode && uiModelNode.style.top,
          sourceX: document.getElementById('sourceX').textContent,
          sourceY: document.getElementById('sourceY').textContent,
        }));
    }
    var itemGridNode = node('dom-grid');
    var itemGridPreview = itemGridNode && itemGridNode.querySelector('.item-grid-preview');
    var itemGridCells = itemGridPreview
      ? Array.from(itemGridPreview.querySelectorAll('.item-grid-cell')) : [];
    var itemGridRect = itemGridNode && itemGridNode.getBoundingClientRect();
    var itemGridPreviewRect = itemGridPreview && itemGridPreview.getBoundingClientRect();
    var itemGridCellRects = itemGridCells.map(function (cell) { return cell.getBoundingClientRect(); });
    if (!itemGridNode
      || !itemGridPreview
      || itemGridCells.length !== 8
      || itemGridNode.querySelector('.element-placeholder')
      || Math.abs(itemGridRect.width - 286) > 1.1
      || Math.abs(itemGridRect.height - 122) > 1.1
      || Math.abs(itemGridPreviewRect.width - 286) > 1.1
      || Math.abs(itemGridPreviewRect.height - 122) > 1.1
      || itemGridCellRects.some(function (rect) {
        return Math.abs(rect.width - 70) > 1.1 || Math.abs(rect.height - 60) > 1.1;
      })
      || itemGridCellRects.slice(0, 4).map(function (rect) {
        return Math.round(rect.left - itemGridCellRects[0].left);
      }).join(',') !== '0,72,144,216'
      || Math.round(itemGridCellRects[4].top - itemGridCellRects[0].top) !== 62) {
      throw new Error('996PC item grid did not draw documented iwidth/iheight geometry');
    }
    var dynamicGridNode = node('dom-grid-dynamic');
    var dynamicGridCell = dynamicGridNode && dynamicGridNode.querySelector('.item-grid-cell');
    var dynamicGridRect = dynamicGridNode && dynamicGridNode.getBoundingClientRect();
    var dynamicGridCellRect = dynamicGridCell && dynamicGridCell.getBoundingClientRect();
    if (!dynamicGridNode
      || !dynamicGridCell
      || Math.abs(dynamicGridRect.width - 40) > 1.1
      || Math.abs(dynamicGridRect.height - 60) > 1.1
      || Math.abs(dynamicGridCellRect.width - 40) > 1.1
      || Math.abs(dynamicGridCellRect.height - 60) > 1.1) {
      throw new Error('dynamic item-grid width did not use the safe per-axis preview fallback');
    }
    var interactive = document.querySelector('.interactive-asset-image');
    var interactiveWrapper = interactive && interactive.closest('.canvas-element');
    if (!interactive || !interactiveWrapper) throw new Error('interactive button states missing');
    interactiveWrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    if (!interactive.src.endsWith('#hover')) throw new Error('hover image did not activate');
    interactiveWrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    if (!interactive.src.endsWith('#pressed')) throw new Error('pressed image did not activate');
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    interactiveWrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!interactive.src.endsWith('#normal')) throw new Error('normal image did not restore');
    var fallbackInteractiveNode = node('dom-interactive-fallback');
    var fallbackInteractiveImage = fallbackInteractiveNode
      && fallbackInteractiveNode.querySelector('.interactive-asset-image');
    var fallbackNormalPlaceholder = fallbackInteractiveNode
      && fallbackInteractiveNode.querySelector('.interactive-normal-placeholder');
    if (!fallbackInteractiveImage
      || !fallbackNormalPlaceholder
      || !fallbackInteractiveImage.hidden
      || fallbackNormalPlaceholder.hidden
      || fallbackInteractiveNode.dataset.interactiveState !== 'normal-missing') {
      throw new Error('missing normal state did not retain an explicit placeholder boundary');
    }
    fallbackInteractiveNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    if (fallbackInteractiveImage.hidden
      || !fallbackNormalPlaceholder.hidden
      || !fallbackInteractiveImage.src.endsWith('#fallback-hover')) {
      throw new Error('ready hover state was discarded when the normal image was missing');
    }
    fallbackInteractiveNode.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0
    }));
    if (!fallbackInteractiveImage.src.endsWith('#fallback-pressed')) {
      throw new Error('pressed state did not remain usable when the normal image was missing');
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    fallbackInteractiveNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!fallbackInteractiveImage.hidden
      || fallbackNormalPlaceholder.hidden
      || fallbackInteractiveNode.dataset.interactiveState !== 'normal-missing') {
      throw new Error('interactive fallback did not restore the truthful missing-normal state');
    }
    var animation = document.querySelector('.animation-frame-image');
    if (!animation) throw new Error('animation frame missing');
    var animationStart = animation.src;
    await wait(45);
    if (animation.src === animationStart) throw new Error('animation frame did not advance');
    if (!document.getElementById('unsupportedList').textContent.includes('UNCONFIRMEDUI')) throw new Error('locked statement missing');
    if (document.querySelectorAll('.kind-unknown').length !== 1) throw new Error('unknown statement duplicated');
    if (document.querySelectorAll('.scene-group').length !== 1) throw new Error('equivalent conditions were not coalesced');
    if ((document.getElementById('conditionText').textContent.match(/CHECKGAMEGOLD > 0/g) || []).length !== 1) throw new Error('condition summary duplicated');
    if (!document.getElementById('dialogCanvas').textContent.includes('默认内容')) throw new Error('TEXT content missing');
    if (document.getElementById('dialogCanvas').textContent.toLowerCase().includes('<&text')) throw new Error('TEXT token leaked into canvas');
    var tooltipElement = page.elements.find(function (element) { return element.tooltipPreview; });
    var tooltipOwner = tooltipElement && node(tooltipElement.id);
    if (!tooltipOwner) throw new Error('tooltip fixture missing');
    tooltipOwner.dispatchEvent(new MouseEvent('mouseenter', {
      bubbles: true, clientX: 160, clientY: 140
    }));
    await wait(20);
    var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
    if (!tooltip) throw new Error('custom tooltip did not open');
    if (!tooltip.textContent.includes('这些是备注') || !tooltip.textContent.includes('换一行')) {
      throw new Error('tooltip multiline content missing');
    }
    var coloredTooltipRun = Array.from(tooltip.querySelectorAll('span')).find(function (span) {
      return span.textContent.includes('这行字是绿色');
    });
    if (!coloredTooltipRun || getComputedStyle(coloredTooltipRun).color !== 'rgb(0, 255, 0)') {
      throw new Error('tooltip color segment missing');
    }
    if (px(tooltip.style.left) !== 172 || px(tooltip.style.top) !== 152) {
      throw new Error('tooltip cursor positioning incorrect');
    }
    tooltipOwner.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!tooltip.classList.contains('hidden')) throw new Error('custom tooltip did not close');

    var itemNode = node(item.id);
    if (px(itemNode.style.left) !== 220 || px(itemNode.style.top) !== 100) throw new Error('ITEMSHOW received an unexpected coordinate bias');
    itemNode.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(20);
    if (!document.getElementById('elementParameters').textContent.includes('内观素材')) throw new Error('item parameters missing');
    if (!document.getElementById('assetState').textContent.includes('Items2.pak/000073')) throw new Error('item asset detail missing');

    var rootNode = node(root.id);
    var childNode = node(child.id);
    var rootBefore = { x: px(rootNode.style.left), y: px(rootNode.style.top) };
    var childBefore = { x: px(childNode.style.left), y: px(childNode.style.top) };
    rootNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 110, clientY: 106 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 110 }));
    await wait(30);
    rootNode = node(root.id);
    childNode = node(child.id);
    if (px(rootNode.style.left) !== rootBefore.x + 20 || px(rootNode.style.top) !== rootBefore.y + 10) throw new Error('parent drag incorrect');
    if (px(childNode.style.left) !== childBefore.x + 20 || px(childNode.style.top) !== childBefore.y + 10) throw new Error('child did not follow parent');

    document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true
    }));
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('arrow-key nudge failed');
    document.getElementById('undoButton').click();
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 20) throw new Error('undo failed');
    document.getElementById('redoButton').click();
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('redo failed');

    document.getElementById('zoomIn').click();
    if (document.getElementById('zoomValue').textContent !== '110%') throw new Error('zoom-in failed');
    document.getElementById('zoomReset').click();
    if (document.getElementById('zoomValue').textContent !== '100%') throw new Error('zoom reset failed');

    var trueButton = document.querySelector('.scene-group .branch-button:nth-child(2)');
    trueButton.click();
    await wait(80);
    if (!document.getElementById('dialogCanvas').textContent.includes('条件满足')) throw new Error('satisfied branch missing');
    if (!document.getElementById('dialogCanvas').textContent.includes('第二处条件满足')) throw new Error('second equivalent satisfied branch missing');
    if (document.getElementById('dialogCanvas').textContent.includes('条件不满足')) throw new Error('else branch remained active');
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('draft lost during condition switch');
    document.getElementById('resetPreview').click();
    await wait(80);
    if (!document.getElementById('dialogCanvas').textContent.includes('条件不满足')) throw new Error('default branch reset failed');
    if (!document.getElementById('dialogCanvas').textContent.includes('第二处条件不满足')) throw new Error('second equivalent else branch reset failed');

    node(child.id).dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(20);
    if (document.getElementById('patchButton').classList.contains('hidden')) throw new Error('missing-asset action hidden');
    document.getElementById('patchButton').click();
    document.getElementById('locateButton').click();
    document.getElementById('applyButton').click();
    document.getElementById('saveButton').click();
    await wait(20);

    var messages = window.__booMessages;
    var dirtyMessages = messages.filter(function (message) { return message.type === 'dirtyChanged'; });
    var apply = messages.find(function (message) { return message.type === 'apply'; });
    var save = messages.find(function (message) { return message.type === 'save'; });
    var rootChange = apply && apply.changes.find(function (change) { return change.elementId === root.id; });
    if (dirtyMessages.length !== 1 || dirtyMessages[0].dirty !== true) throw new Error('dirty notifications were spammed');
    if (!rootChange || rootChange.x !== rootBefore.x + 21 || rootChange.y !== rootBefore.y + 10) throw new Error('apply coordinates incorrect');
    if (!save || !save.changes.length) throw new Error('save message missing changes');
    if (!messages.some(function (message) { return message.type === 'openPatchManager'; })) throw new Error('patch manager message missing');
    if (!messages.some(function (message) { return message.type === 'locate'; })) throw new Error('locate message missing');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'conflict', message: '源码冲突测试' } }));
    await wait(20);
    if (!document.getElementById('applyButton').disabled || !document.getElementById('saveButton').disabled) throw new Error('conflict did not disable writes');
    if (!document.getElementById('statusBanner').textContent.includes('源码冲突测试')) throw new Error('conflict banner missing');

    document.body.dataset.testStatus = 'pass';
    document.body.dataset.realCache = ${JSON.stringify(Boolean(cachedPng))};
    document.body.dataset.elementCount = String(document.querySelectorAll('.canvas-element').length);
    document.body.dataset.messageTypes = messages.map(function (message) { return message.type; }).join(',');
  }
  run().catch(function (error) {
    document.body.dataset.testStatus = 'fail';
    document.body.dataset.testError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    let browser;
    let result;
    const attempts = [];
    for (const candidate of browsers) {
      const candidateProfile = path.join(profile, String(attempts.length));
      const attempt = spawnSync(candidate, [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--allow-file-access-from-files', `--user-data-dir=${candidateProfile}`,
        '--window-size=1440,900', '--virtual-time-budget=12000', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
      attempts.push({ candidate, attempt });
      if (!attempt.error && attempt.status === 0 && /<body\b/i.test(attempt.stdout || '')) {
        browser = candidate;
        result = attempt;
        break;
      }
    }
    if (!result) {
      const diagnostic = attempts.map(({ candidate, attempt }) => (
        browserAttemptDiagnostic(candidate, attempt)
      )).join('\n');
      throw new Error(`No installed Chromium browser returned a DOM:\n${diagnostic}`);
    }
    for (const { candidate, attempt } of attempts) {
      if (attempt === result) continue;
      console.warn(
        `npc-dialog-visual-browser.test.js: browser candidate failed: `
        + browserAttemptDiagnostic(candidate, attempt)
      );
    }
    assert.equal(
      bodyAttribute(result.stdout, 'test-status'),
      'pass',
      bodyAttribute(result.stdout, 'test-error') || result.stderr
    );
    assert.ok(Number(bodyAttribute(result.stdout, 'element-count')) >= 8);
    const selectedBrowserVersion = browserVersion(browser);
    assert.notEqual(
      selectedBrowserVersion,
      '<unknown>',
      `Could not determine selected browser version: ${browser}`
    );
    console.log(
      `npc-dialog-visual-browser.test.js: PASS (` +
      `${bodyAttribute(result.stdout, 'element-count')} DOM elements, ` +
      `real cache=${bodyAttribute(result.stdout, 'real-cache')}, ` +
      `ListView=${bodyAttribute(result.stdout, 'list-interactions')}, ` +
      `browser=${browser}, version=${selectedBrowserVersion})`
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
