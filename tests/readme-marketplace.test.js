const assert = require('assert');
const fs = require('fs');
const path = require('path');

function section(markdown, heading, nextHeading) {
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, `README 缺少章节：${heading}`);
  const end = nextHeading ? markdown.indexOf(nextHeading, start + heading.length) : markdown.length;
  assert.ok(end > start, `README 章节顺序错误：${heading}`);
  return markdown.slice(start, end);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.ok(readme.startsWith(`# BOO 可视化编辑器 V${manifest.version}\n`), 'README 标题版本必须与 package.json 一致');
  assert.ok(readme.includes(`Visual Studio Code ${manifest.engines.vscode.replace(/^\^/, '')}`), '最低 VS Code 版本须与 manifest 一致');
  assert.ok(readme.includes(`${manifest.contributes.themes.length} 套脚本主题`), '主题数量须与 manifest 一致');
  // README is a current feature reference, not a release history or an acceptance report.
  assert.doesNotMatch(readme, /CHANGELOG\.md|^#{2,6}\s+.*(?:更新日志|版本记录|更新内容|修复报告|验收)/m);
  assert.match(readme, /## 安装/);

  const featureHeadings = [
    '### 传奇脚本助手',
    '### 变量管理',
    '### UI 可视化编辑器',
    '### 客户端与补丁管理',
    '### 补丁资源工作台',
    '### 数据库编辑器',
    '### 爆率分析',
    '### 地图查看与可视化编辑',
    '### 文件、表格与多区同步',
    '### M2 在线重载',
    '### 常用辅助工具',
    '### DeepSeek Harness AI 助手',
  ];
  let previous = readme.indexOf('## 功能总览');
  for (const heading of featureHeadings) {
    const position = readme.indexOf(heading);
    assert.ok(position > previous, `README 功能分类顺序错误：${heading}`);
    assert.equal(readme.indexOf(heading, position + heading.length), -1, `README 功能分类重复：${heading}`);
    previous = position;
  }
  const feature = name => {
    const index = featureHeadings.indexOf(`### ${name}`);
    assert.ok(index >= 0);
    return section(readme, featureHeadings[index], featureHeadings[index + 1] || '## 安装');
  };

  const script = feature('传奇脚本助手');
  const scriptSubheadings = ['#### 多引擎语言服务', '#### 智能补全与说明', '#### 导航与引用', '#### 审查与快速修复', '#### 编辑与显示'];
  let scriptSubheadingPosition = 0;
  for (const heading of scriptSubheadings) {
    const position = script.indexOf(heading);
    assert.ok(position > scriptSubheadingPosition, `传奇脚本助手子分类顺序错误：${heading}`);
    scriptSubheadingPosition = position;
  }
  assert.match(script, /GOM、翎风或 996PC/);
  assert.match(script, /命令、变量、标签、路径、系统常量和引擎函数智能补全/);
  assert.match(script, /自定义检测命令、执行命令、界面语句、引擎函数和系统常量/);
  for (const token of ['CHECKTEXTLIST', 'AutoRunRobot.txt', 'SETONTIMER ID', 'ADDBUTTON', 'ADDDLG', 'QFunction-0.txt', 'QuestDiary']) assert.ok(script.includes(token));
  assert.match(script, /MerChant\.txt[^\n]*第一列[^\n]*缺失[^\n]*确认创建/i);
  assert.match(script, /第五列[^\n]*原始地图/);
  assert.match(script, /当前文档所属服务端[^\n]*取消不创建[^\n]*不覆盖/);
  assert.match(script, /实时语法检查/);
  assert.match(script, /变量 `STR\(\)` 包裹/);
  assert.match(script, /代码折叠、文档结构、CodeLens 和语义高亮/);
  assert.match(script, /检测命令、执行命令和 `#SAY` 界面指令分别高亮/);
  assert.match(script, /`<TEXT`、`<&TEXT` 等界面指令支持补全，指令名和每个参数都可悬停查看说明/);
  assert.match(script, /Ctrl\+E[^\n]*fcolor=250/);

  const variables = feature('变量管理');
  assert.match(variables, /候选变量\/候选标识/);
  assert.match(variables, /动态编号不会导致整个候选列表不可用/);

  const ui = feature('UI 可视化编辑器');
  assert.match(ui, /#### 常规 UI 编辑器/);
  assert.match(ui, /#### Ctrl\+F12 NPC 对话画布/);
  assert.match(ui, /默认独立窗口/);
  assert.match(ui, /对话框背景固定/);
  assert.match(ui, /每页 100 项[^\n]*ID 定位/);
  assert.match(ui, /与原 UI 编辑器互不影响/);
  assert.match(ui, /ITEMSHOW[^\n]*IDX[^\n]*Looks/);
  assert.match(ui, /GlobalVal\.ini/);
  assert.match(ui, /未知显示文字[^\n]*预览文字[^\n]*未知显示数值[^\n]*0/);
  assert.match(ui, /只在 Webview 内本地预览/);
  assert.match(ui, /不提交服务器/);
  assert.match(ui, /显示占位不替代真实素材、数据库或动作参数/);

  const patches = feature('客户端与补丁管理');
  for (const token of ['传奇客户端目录', '自定义补丁', 'PAK、JPK、WIL、WZL', 'SafePointEffect', 'HXM2/Lz', 'PACK4.0', '逐图验证', '继续验证', '损坏']) assert.ok(patches.includes(token), token);
  assert.doesNotMatch(readme, /WIL\/WZL 当前只读|WIL\/WZL 当前只提供预览/);

  const resources = feature('补丁资源工作台');
  assert.match(resources, /编辑区标签页[^\n]*不自动弹出独立窗口/);
  assert.match(resources, /每页 100 个槽位、每行 5 个/);
  for (const token of ['开启编辑', '批量导入', '偏移清单', '透明边裁剪', '撤销/重做', 'APNG', 'GAMEOFMIR2 v2', 'GameLib / 996M2', 'WIL/WIX、WZL/WZX']) assert.ok(resources.includes(token), token);
  assert.match(resources, /其他可读取的 PAK 分支[^\n]*不开放写入/);
  assert.match(resources, /另存新包[^\n]*不覆盖源包/);
  assert.match(resources, /不自动替换客户端绑定/);
  assert.match(resources, /重启或崩溃后不恢复未保存草稿/);
  assert.doesNotMatch(resources, /新建 JPK|导出 GIF/);

  const database = feature('数据库编辑器');
  assert.match(database, /SQLite[^\n]*MDB 只读[^\n]*cfg_item\.xls/);
  assert.match(database, /MonItems[^\n]*MonIcons/);
  const drop = feature('爆率分析');
  assert.match(drop, /基准概率/);
  assert.match(drop, /不修改或执行脚本/);

  const maps = feature('地图查看与可视化编辑');
  for (const token of ['原始地图', 'Merchant.txt', 'MonGen.txt', '当前可视区域', '持久瓦片', '永久 `MAPEFFECT`', '不代表 M2 当前实时状态', '地点文字标记']) assert.ok(maps.includes(token), token);
  assert.match(maps, /GOM 地图布局[^\n]*动画[^\n]*叠加/);
  assert.doesNotMatch(maps, /完成后缩放和平移直接复用已加载内容/);
  assert.match(feature('文件、表格与多区同步'), /“快捷工具”中提供独立“脚本同步”入口/);
  assert.doesNotMatch(readme, /最下方[^\n]*脚本同步|脚本同步[^\n]*最下方/);
  const reload = feature('M2 在线重载');
  assert.match(reload, /连续保存请求会自动合并/);
  assert.match(reload, /等待当前菜单命令完成/);
  assert.match(feature('DeepSeek Harness AI 助手'), /独立 DeepSeek 入口[^\n]*本机 DeepSeek Harness/);
  assert.match(readme, /按工作区添加或移除 Mir200 相对路径/);
  assert.match(readme, /\| `Ctrl\+F12` \| 打开当前 `\[@函数\]` 的独立 NPC 界面可视化面板 \|/);

  // Document public commands by their manifest title, not an invented entry.
  for (const id of ['boo.resourceEditor.open', 'boo.analyzeDropRates']) {
    const command = manifest.contributes.commands.find(item => item.command === id);
    assert.ok(command && readme.includes(command.title), id);
  }
  for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:\/\//.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(target)), `README 本地链接不存在：${target}`);
  }
  console.log('README Marketplace structure test passed.');
}

main();
