# UI 素材选择：100 项分页与 ID 定位

日期：2026-09-26。版本保持 V4.3.6，独立本地候选 `ui-id-r1`；未发布商店、未替换默认安装。

## 本轮结果

- 图片、三态按钮、特效、关闭按钮、装备框、进度条六类素材选择弹窗统一每页 100 项，尾页保留实际剩余数量。
- 输入非负整数 ID 后定位到所在页、高亮目标，并将目标滚入网格可见区域；不再将列表过滤为单项。
- 按 Enter 或点击“定位”立即执行；普通输入使用 120ms 防抖。
- 保留数字输入时可连续前后翻页。翻页取消尚未执行的定位，输入框失焦不重复定位，避免先跳目标页再翻页。
- 输入名称保留原有筛选功能；清空输入恢复完整素材包。
- 多包重复 ID 提示先选包；选定包内仍重复时明确提示，不任意选取。
- 非法数字或不存在的 ID 显示短提示，保留当前可浏览列表。定位仅高亮，不自动添加素材或确认选择。
- 使用全包视图中的实际位置计算页码，不把逻辑 ID 当数组下标；保留空槽与原始身份，百万槽只展开当前页的最多 100 项。

左侧主素材栏继续使用既有虚拟滚动及 ID 定位，并非固定分页；本轮验证定位后仍保留全列表和邻项，没有将其改为分页。

## 实现与复现

生产修改集中在 `media/editor.html`：统一页容量、公共导航解析、定位高亮/局部滚动、六类选择器事件绑定。

新增 `tests/archive-id-navigation-browser.test.js` 并加入 `test:asset-consumers`。测试在原实现确认分页/过滤不满足要求后转绿；独立审阅又补出“输入 ID 后失焦先触发 change，再点击分页”的失败用例。删除查询框重复 change 导航后，该序列通过。包选择框 change 保留。

测试调试中曾因旧高亮邻项造成过早断言：改为以多数普通邻项的计算样式作为高亮基准，保留目标实际可见性断言；未修改生产滚动来适配错误断言。

## 验证范围

工作区检查通过：

- 六类弹窗的 100 项分页、0/99/100/250 边界、51 项尾页、ID 定位/可见性、名称筛选、未命中/非法输入、重复 ID、切包、失焦与延迟定位竞争、Enter 重定位、百万槽尾页。
- `archive-selectors-browser`、`progress-bar-browser`：选择提交、跨包拒绝、原始逻辑 ID、状态门禁、图片复用及重开等相邻行为。
- `quick-import-browser`、`archive-asset-store-browser`、`archive-main-list-browser`、`archive-review-boundaries`、`webview-security`。
- `npm run test:ui-window`：生命周期、跨文档恢复、背景锁定、代码生成和 UI 回归。
- 打包 prepublish：lint 0 errors / 25 warnings；TypeScript 编译和 PAK 运行时健康验证通过。

最终 VSIX 解包后，使用 `BOO_PAK_RUNTIME_ROOT` 指向包内生产文件，复跑 12 项相关测试；另核对 ZIP 与解包文件逐字节一致、运行依赖完整、构建输入前后未漂移。证据见下列机器可读文件。

以上浏览器测试运行实际生产 HTML，但素材及输入事件为合成；宿主生命周期测试使用替身。本轮未重做原生 VS Code 鼠标键盘、真实素材视觉或游戏客户端对照，不把这些测试称为上述验收。此前独立窗口原生验收仅属于其原有候选及报告。

## 安装包与证据

- 安装包：`artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-ui-id-r1.vsix`
- 大小：20,747,909 字节；比保留的 `ui-window-r2` 增加 1,291 字节。
- SHA-256：`771ef0c3b6c72f47f1dadc8e7d5b356420e6352ac33adfe626fcf7479c4cf597`
- ZIP：1,448 个文件条目；`extension/` 下 1,446 文件、57,205,415 字节；禁入源码/测试/报告/样本条目为 0。
- 构建输入与日志：`artifacts/pak-completion-20260926/package-ui-id-r1.json`
- 解包清单：`artifacts/pak-completion-20260926/unpack-ui-id-r1.json`
- 包内验证：`artifacts/ui-window-20260926/verification-ui-id-r1.json`
- 生产文件哈希：`artifacts/ui-window-20260926/hashes-ui-id-r1.json`

旧候选包保留。本轮未安装扩展、未修改默认 VS Code 安装或默认数据、未修改源素材包/用户缓存，也未提交或推送 Git。
