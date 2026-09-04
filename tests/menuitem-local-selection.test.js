const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parseMenu() {
  const source = [
    '[@main]',
    '#SAY',
    '<MenuItem|id=LOCAL_MENU|x=180|y=166|menuid=S$自定义|itemname=我要变强#我要装备#我要经验|select=我要变强|direction=0|fontcolor=250|selectcolor=254|itemhei=30|link=@菜单触发2>',
    '[@菜单触发2]',
    '#SAY',
    '<Text|x=20|y=20|color=251|size=18|text=服务器触发页面>',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/menuitem-local-selection.txt',
    fileName: 'menuitem-local-selection.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\menuitem-local-selection.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function testMenuItemRetainsLocalSelectionContract() {
  const model = parseMenu();
  const menu = model.pages[0].elements.find(
    element => element.statementId === 'newui-menuitem-996pc'
  );
  assert.ok(menu, 'documented 996PC MenuItem must remain recognized');
  assert.equal(menu.kind, 'menu');
  assert.deepEqual({
    items: menu.menuPreview?.items,
    selected: menu.menuPreview?.selected,
    menuId: menu.menuPreview?.menuId,
    link: menu.menuPreview?.link,
  }, {
    items: ['我要变强', '我要装备', '我要经验'],
    selected: '我要变强',
    menuId: 'S$自定义',
    link: '@菜单触发2',
  }, 'MenuItem must retain the documented S/S$ menu ID and link with its default selection');

  const menuIdParameter = menu.parameters?.find(parameter => parameter.key?.toLowerCase() === 'menuid');
  const linkParameter = menu.parameters?.find(parameter => parameter.key?.toLowerCase() === 'link');
  assert.equal(menuIdParameter?.value, 'S$自定义');
  assert.equal(linkParameter?.value, '@菜单触发2');
  assert.match(menu.warning || '', /仅本地预览/,
    'the model must state that selection changes are local preview state');
  assert.match(menu.warning || '', /不提交服务器/,
    'the model must not imply that Ctrl+F12 writes the documented S/S$ server variable');
  assert.match(menu.warning || '', /@?menu|菜单/i,
    'the local-only boundary must identify the MenuItem control');
  assert.match(menu.warning || '', /@菜单触发2/,
    'the documented link must be visible in the boundary');
  assert.match(menu.warning || '', /仅展示|不执行/,
    'Ctrl+F12 must not claim to execute the MenuItem server link');
  assert.equal(
    model.pages[0].unsupportedStatements.some(statement => /<MenuItem\b/i.test(statement)),
    false
  );
}

testMenuItemRetainsLocalSelectionContract();
console.log('menuitem-local-selection.test.js: PASS');
