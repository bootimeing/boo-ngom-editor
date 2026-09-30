# UI 编辑器视觉改造

日期：2026-09-26。版本：V4.3.6，本地候选 `ui-style-r1`。

## 交付内容

- 统一中性深色面板、蓝色主操作、次级描边按钮、输入框、圆角和间距；移除主界面的高饱和渐变、发光、悬停位移及选中脉冲。
- 工具栏分为资源/视图操作和添加控件两层，收短文案并减少 emoji；“清空画布”保留危险操作提示色。
- 左侧素材与快捷槽、右侧属性和图层列表统一风格。固定属性标签空间，避免输入框把文字挤成逐字竖排；素材计数独立一行，不再挤撞标题。
- 统一图片、三态按钮、特效、关闭按钮、装备框、进度条、倒计时、调色盘和素材查看器外观；三态槽改横排，确认按钮有明确主色。
- 新会话默认收起代码窗，可一键展开；已有会话仍恢复原来的显示状态，代码内容与拖动/缩放逻辑保留。
- 主布局改为弹性高度，消除窄窗口底部越界；大画布在空间不足时可滚动到左上边缘，不使用负偏移居中把边缘藏起来。
- 保留 100 项分页、ID 定位、选择标记、禁用状态、虚拟素材列表尺寸、背景锁定与跨窗恢复。没有改动 PAK/JPK 解析、游戏控件绘制或源脚本。

## 验证

新增 `tests/ui-appearance-browser.test.js`，纳入 `test:ui-window`：

| 浏览器视口 | 中央画布工作区 | 布局结果 |
| --- | --- | --- |
| 1440 × 960 | 888 × 856 | 通过 |
| 1100 × 800 | 620 × 696 | 通过 |
| 900 × 700 | 420 × 596 | 通过 |

检查两层工具栏可访问性、实际点击命中、无整页水平溢出、侧栏真实滚动、代码展开、六类素材弹窗及其设置控件无遮挡、100 项与 ID 邻项保留、定位目标可见、键盘焦点和禁用状态。截图中的画布是合成示例素材，不是游戏客户端截图。

独立审阅发现的确认按钮 hover 样式优先级冲突已修复。既有 UI 回归中“资源包历史”的字面断言随新的中性文案“最近打开”更新，保留引擎隔离意图。

相关既有检查通过：窗口生命周期、文档重建恢复、背景锁定、代码生成、UI 回归、Webview 安全、快捷导入、素材选择/定位、进度条、主虚拟列表。最终解包生产文件另跑 13 项专项，加 ZIP 逐字节对比与依赖检查，见包内验证记录。

预发布编译和 PAK 运行时健康检查通过；lint 为 0 errors / 25 warnings，不宣称清零历史警告。

验证范围：实际 Headless Chromium 布局和 PNG 截图；除 Tab 焦点用 CDP 键盘输入外，业务交互采用合成 DOM 事件和合成素材；窗口状态 API 使用替身。本轮没有重新做原生 VS Code 鼠标键盘或真实客户端对照。

## 截图与一致性

- 最终截图与布局 JSON：`artifacts/ui-appearance-20260926/after-final/`
- 主界面：`editor-1440x960.png`
- 窄窗口：`editor-900x700.png`
- 三态按钮：`buttonSelectorModal-900x700.png`
- 进度条：`progressBarDialog-900x700.png`
- 代码区：`editor-code-1440x960.png`
- 旧版截图来自已交付 `unpacked-ui-id-r1/extension`，保存在 `before/`；中间 `after*` 目录是过程记录，不作为最终结果。
- 最终生产 HTML SHA-256：`bb7ce9835bcaf2ab5cf840621c9078ee73edbf3e4e687c1055100915c6d5d8e4`，与最终截图 JSON 中 `sourceSha256` 一致。

## 安装包

- `artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-ui-style-r1.vsix`
- 大小：20,748,337 字节，比上一 `ui-id-r1` 增加 428 字节。
- SHA-256：`3a220ba8c3ffd958e396390d21bd871ec04902280c1d3b8b3ca52ac9796172c0`
- ZIP 1,448 文件条目；扩展内容 1,446 文件、57,204,666 字节；禁入源码/测试/报告/样本为 0。
- 构建记录：`artifacts/pak-completion-20260926/package-ui-style-r1.json`
- 解包清单：`artifacts/pak-completion-20260926/unpack-ui-style-r1.json`
- 包内验证：`artifacts/ui-window-20260926/verification-ui-style-r1.json`

本轮使用排错流程先复现布局问题，再通过截图与几何检查验证；按发布流程保留旧候选，记录构建输入、包内文件及最终截图的哈希一致性。未覆盖默认安装、未改用户缓存或源素材、未发布商店、未提交或推送 Git。

## r2：品牌图标与素材计数精简

按后续反馈，左上角 BOO 文字标识改为现有 `resources/icon.png` 的“老卢”书法图。原图未修改，使用 32×32 等比显示。素材列表的“槽 · 图 · 空”统计不再显示或占行；内部状态计数保留，不影响分页、ID 定位和状态同步。

同时修正 `getWebviewContent` 资源目录与文件名之间的分隔符，确保图标映射到实际 Webview URI；不放宽 CSP 或资源权限。新增 `ui-brand-resource` 回归实际编译后的生产 HTML Provider，覆盖带/不带末尾分隔符、PNG、CSP 和 nonce。

三个尺寸的浏览器截图与图标实际加载/计数不占位检查通过，证据位于 `artifacts/ui-appearance-20260926/brand-r2/`。其生产 HTML SHA-256 为 `6094f3d997b8bc88ed59af396377151d198d5d53a04976df94430cbf87e6a34b`；图标 SHA-256 为 `8189698877e5dba364e9d26b6a2f99f5214c67feb5465115cffe1a6ede1160d3`。以上主文及 `after-final` 截图属于 r1，r2 以本节及新构建记录为准。

新候选文件为 `artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-ui-style-r2.vsix`；构建和解包信息分别见同目录的 `package-ui-style-r2.json`、`unpack-ui-style-r2.json`，包内回归见 `artifacts/ui-window-20260926/verification-ui-style-r2.json`。版本仍为 4.3.6，旧包保留，不自动安装。
