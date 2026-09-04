const assert = require('assert');
const fs = require('fs');

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

  assert.ok(
    readme.startsWith(`# BOO 可视化编辑器 V${manifest.version}\n`),
    'README 标题版本必须与 package.json 一致'
  );
  assert.match(readme, /## V4\.3\.4 更新重点/);
  assert.match(readme, /ITEMSHOW[^\n]*IDX[^\n]*Looks/);
  assert.match(readme, /## 安装/);

  const featureHeadings = [
    '### 传奇脚本助手',
    '### 变量管理',
    '### UI 可视化编辑器',
    '### 客户端与补丁管理',
    '### 数据库编辑器',
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

  const script = section(readme, featureHeadings[0], featureHeadings[1]);
  const scriptSubheadings = [
    '#### 多引擎语言服务',
    '#### 智能补全与说明',
    '#### 导航与引用',
    '#### 审查与快速修复',
    '#### 编辑与显示',
  ];
  let scriptSubheadingPosition = 0;
  for (const heading of scriptSubheadings) {
    const position = script.indexOf(heading);
    assert.ok(position > scriptSubheadingPosition, `传奇脚本助手子分类顺序错误：${heading}`);
    scriptSubheadingPosition = position;
  }
  assert.match(script, /GOM、翎风或 996PC/);
  assert.match(script, /命令、变量、标签、路径、系统常量和引擎函数智能补全/);
  assert.match(script, /自定义检测命令、执行命令、界面语句、引擎函数和系统常量/);
  assert.match(script, /CHECKTEXTLIST/);
  assert.match(script, /AutoRunRobot\.txt/);
  assert.match(script, /SETONTIMER ID/);
  assert.match(script, /ADDBUTTON ID/);
  assert.match(script, /ADDDLG/);
  assert.match(script, /实时语法检查/);
  assert.match(script, /变量 `STR\(\)` 包裹/);
  assert.match(script, /代码折叠、文档结构、CodeLens 和语义高亮/);
  assert.match(script, /检测命令、执行命令和 `#SAY` 界面指令分别高亮/);
  assert.match(script, /`<TEXT`、`<&TEXT` 等界面指令支持补全，指令名和每个参数都可悬停查看说明/);

  const variables = section(readme, featureHeadings[1], featureHeadings[2]);
  assert.match(variables, /候选变量\/候选标识/);
  assert.match(variables, /动态编号不会导致整个候选列表不可用/);

  const ui = section(readme, featureHeadings[2], featureHeadings[3]);
  assert.match(ui, /#### 常规 UI 编辑器/);
  assert.match(ui, /#### Ctrl\+F12 NPC 对话画布/);
  assert.match(ui, /`Ctrl\+F12`/);
  assert.match(ui, /与原 UI 编辑器互不影响/);
  assert.match(ui, /ITEMSHOW[^\n]*IDX[^\n]*Looks/);
  assert.match(ui, /只在 Webview 内本地预览/);
  assert.match(ui, /不提交服务器/);

  const patches = section(readme, featureHeadings[3], featureHeadings[4]);
  assert.match(patches, /传奇客户端目录/);
  assert.match(patches, /自定义补丁/);
  assert.match(patches, /PAK、JPK、WIL、WZL/);
  assert.match(patches, /WIL\/WZL 当前只读/);
  assert.match(patches, /SafePointEffect/);

  const maps = section(readme, featureHeadings[5], featureHeadings[6]);
  assert.match(maps, /原始地图/);
  assert.match(maps, /Merchant\.txt/);
  assert.match(maps, /MonGen\.txt/);
  assert.match(maps, /当前可视区域/);
  assert.match(maps, /持久瓦片/);
  assert.match(maps, /bit7 DrawBlend/);
  assert.match(maps, /永久 `MAPEFFECT`/);
  assert.match(maps, /不代表 M2 当前实时状态/);
  assert.doesNotMatch(maps, /完成后缩放和平移直接复用已加载内容/);

  const synchronization = section(readme, featureHeadings[6], featureHeadings[7]);
  assert.match(synchronization, /“快捷工具”中提供独立“脚本同步”入口/);
  assert.doesNotMatch(readme, /最下方[^\n]*脚本同步|脚本同步[^\n]*最下方/);

  const reload = section(readme, featureHeadings[7], featureHeadings[8]);
  assert.match(reload, /连续保存请求会自动合并/);
  assert.match(reload, /等待当前菜单命令完成/);

  const deepseek = section(readme, featureHeadings[9], '## 安装');
  assert.match(deepseek, /独立 DeepSeek 入口/);
  assert.match(deepseek, /本机 DeepSeek Harness/);

  assert.match(readme, /按工作区添加或移除 Mir200 相对路径/);
  assert.match(readme, /选择“添加自定义文件”后输入相对于 `Mir200` 的路径/);
  assert.match(readme, /悬停在某个参数值上只显示该参数的含义/);
  assert.match(readme, /\| `Ctrl\+F12` \| 打开当前 `\[@函数]` 的独立 NPC 界面可视化面板 \|/);

  console.log('README Marketplace structure test passed.');
}

main();
