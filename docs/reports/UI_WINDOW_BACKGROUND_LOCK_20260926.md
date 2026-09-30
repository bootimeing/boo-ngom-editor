# UI 编辑器独立窗口与背景锁定验收

日期：2026-09-26。版本：4.3.6，本地独立候选 `ui-window-r2`。

## 已完成

1. UI 编辑器默认使用 VS Code 独立窗口。再次打开仅激活原面板，不创建第二份画布、不拉回主窗口；旧版宿主不支持时保留标签页。
2. 对话框背景固定在画布 `(0,0)`，鼠标拖动、Ctrl 多选拖动、方向键、属性坐标处理器均不能移动背景。背景仍可选中，X/Y 只读。
3. 普通图片、文字、按钮仍可移动。复制背景得到普通图片；删除背景不会将其他图片自动升级为背景。没有对话框的 IMG 源码不会被误认成背景。
4. `OPENMERCHANTBIGDLG` 的游戏内移动开关、位置与偏移参数保持可编辑。本次锁定的是编辑器画布背景，不改游戏客户端行为。
5. 跨窗口重建页面时恢复画布、尺寸、缩放、选择、代码草稿、文字、按钮三态、动画帧和对话框参数。素材目录由宿主重发，不放进前端画布快照。

## 根因与修复

原背景与普通图片共用移动代码，拖动、键盘和属性修改没有统一的背景身份约束。现在使用显式 `isDialogBg`；旧数据按首个普通图片兼容，并统一两套解析/生成路径。

原 UI 编辑器固定在右侧标签页，且先写 HTML 后注册消息监听。现在先安装监听，页面完成初始化后握手，再调用 `workbench.action.moveEditorToNewWindow`。

独立复核发现，VS Code 1.128 的 `OverlayWebview.claim` 在跨窗口时会清理旧 Webview 并重新创建页面，`retainContextWhenHidden` 不能保证跨窗口 DOM 保留。因此第一轮候选 `ui-window-r1` 未作为最终交付。第二轮补充：

- 每个新 document 使用唯一身份，重复握手幂等；新页面重发当前紧凑目录，自动浮窗只执行一次。
- 初始化先读 `getState` 并恢复，再启用 `setState`，防止空画布覆盖旧内容。
- Blob 图片和透明 Canvas 帧转换为可恢复图源；图片加载后真正重绘画布，动画恢复运行。
- 旧图片回调检查恢复代次与元素数组身份；旧文件选择器 ticket 在页面重建后失效。
- 同一次渲染周期合并快照，鼠标/键盘释放和页面隐藏等边界强制保存；动画逐帧绘制不保存快照。

## 验证结果

| 层级 | 结果 | 验证范围 |
| --- | --- | --- |
| 工作区专项 | 5 项通过 | `npm run test:ui-window`：宿主生命周期、页面重建、背景锁定、代码生成、UI 回归 |
| Webview 安全 | 通过 | `webview-security.test.js` |
| 最终包内专项 | 11 项通过 | 窗口/状态/背景、代码生成、进度条、快捷导入协议与浏览器、素材选择器/存储/主列表/边界 |
| 打包门禁 | 通过 | lint 0 errors、25 个已有 warnings；compile 和 PAK runtime 通过 |
| 包内依赖 | 通过 | 60 个生产依赖包，Ctrl+F12 66 文件本地闭包及相关运行时 |
| ZIP 与解包目录 | 通过 | 1,448 个文件条目逐字节 SHA 一致，无额外文件 |
| 构建输入 | 通过 | 529 个实际输入前后无漂移；168 个 out/media/data 生产文件与候选一致 |
| 真实 VS Code | 通过 | 1.128.0，正式 `boo.openEditor`、首次辅助窗口、重复打开单实例、关闭重开、源文本标签/组不变 |

背景浏览器测试先复现原问题 `background mouse drag must keep origin`，修复后通过。窗口模型先复现新 document 无目录重发，修复后通过。状态测试先复现编辑未持久化，修复后通过。

页面重建测试实际删除旧 iframe，再以完整生产 HTML 创建新 iframe：

- 七类元素、画布尺寸/缩放、选择、对话框参数、代码草稿恢复。
- 检查生产 canvas 背景像素，以及文字内容/颜色/字体/字号/加粗/触发脚本和非空像素一致性。
- 按钮 hover/click 三态、effect 与旧动画帧实际推进，透明帧保留。
- 百万槽素材目录不进入画布状态；80 次连续 mousemove 最多 2 次状态写入，动画运行不增加状态写入。
- 清空后重建仍为空，未知状态版本安全忽略。

上述状态 API 使用测试替身、浏览器输入为合成事件。真实 VS Code 验收使用正式命令和原生辅助窗口日志，不是原生鼠标键盘验收；其同一 tab 身份不单独证明画布内容保留。两类证据分别记录，没有冒称游戏客户端验收。

## 最终交付

[安装包：boo-ngom-editor-4.3.6-ui-window-r2.vsix](../../artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-ui-window-r2.vsix)

- 大小：20,746,618 字节，比上一轮 `scale-r1` 增加 4,068 字节。
- SHA-256：`ffc19dc6a42efee442f568d0d41a690d61d1867496b828b56f14a17d2989fb3a`
- ZIP 文件条目：1,448；扩展文件：1,446；根级源码、测试、文档、审计工件及 PAK/JPK 样本泄漏：0。
- 未升版、未提交/推送/发布商店，未覆盖旧包或默认 VS Code 安装。

真实宿主运行使用独立 user-data、extensions、APPDATA、LOCALAPPDATA、TEMP 和 shared-data。原生日志确认使用隔离共享数据库；默认 `Code.exe`、候选及安装副本生产文件前后哈希一致，只结束本轮创建的进程。

## 证据入口

- [候选包与 13 项检查（11 项专项、2 项包装检查）](../../artifacts/ui-window-20260926/verification-ui-window-r2.json)
- [构建输入、哈希和打包日志](../../artifacts/pak-completion-20260926/package-ui-window-r2.json)
- [解包清单](../../artifacts/pak-completion-20260926/unpack-ui-window-r2.json)
- [真实宿主结果](../../artifacts/ui-window-20260926/runs/2026-09-26T08-23-31-230Z-3d5e4505/result.json)
- [隔离与完整性结果](../../artifacts/ui-window-20260926/runs/2026-09-26T08-23-31-230Z-3d5e4505/wrapper-result.json)
- [窗口生命周期回归](../../tests/ui-window-lifecycle.test.js)
- [页面重建回归](../../tests/ui-window-state-browser.test.js)
- [背景锁定回归](../../tests/ui-background-lock-browser.test.js)

边界：本轮按受影响范围验证，没有重跑无关地图、全量 PAK 语料或完整游戏客户端。状态恢复针对同一编辑器 panel 的跨窗口页面重建，不等同文件保存、关闭编辑器后的项目存档或应用重启恢复。状态大小仍随实际画布元素和动画帧增长，不承诺任意画布恒定内存；原倒计时仍是静态预览。
