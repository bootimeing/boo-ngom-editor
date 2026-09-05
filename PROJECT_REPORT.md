# BOO 可视化编辑器项目报告

> 报告日期：2026-09-05  
> 当前版本：V4.3.5  
> 项目类型：Visual Studio Code 扩展  
> 发布标识：`boo1213.boo-NGOM-editor`

## 1. 项目概览

BOO 可视化编辑器面向传奇 GM、版本制作人员和脚本开发者，将多引擎脚本语言服务、UI 编辑、补丁资源、数据库、地图预览、脚本同步、M2 重载和本地 AI 助手集中到 VS Code。

| 项目 | 当前状态 |
| --- | --- |
| 扩展版本 | V4.3.5 |
| VS Code 要求 | `^1.68.0` |
| TypeScript 源文件 | 108 个，51,832 行 |
| 自动回归文件 | 171 个 `*.test.js`，其中 43 个浏览器测试 |
| 注册命令 | 47 个 |
| 内置主题 | 19 套 |
| 生产依赖闭包 | 解包后验证 60 个实际包节点 |
| 当前发布包 | `artifacts/releases/vscode-marketplace/boo-ngom-editor-4.3.5.vsix` |

## 2. 目录结构

```text
项目根目录
├─ .github/                 GitHub Actions 工作流
├─ .vscode/                 扩展调试与工作区设置
├─ artifacts/               当前本地发布包说明和生成目录
├─ data/                    三引擎运行时语言数据与审计基线
├─ docs/
│  ├─ plans/                技术方案
│  ├─ releases/             发布操作说明
│  ├─ reports/              调查与审计报告
│  └─ user-guide/           最终用户教程
├─ media/                   Webview 页面、样式和前端运行资源
├─ resources/               扩展图标
├─ src/                     TypeScript 扩展源码
├─ syntaxes/                TextMate 语法定义
├─ tests/                   自动回归、测试夹具与辅助代码
├─ themes/                  19 套脚本主题
├─ tools/
│  ├─ data-maintenance/     语言目录生成、分类和审计工具
│  ├─ M2Reloader/           M2 重载源码、构建脚本和唯一运行时
│  ├─ PakBridge/            特殊 PAK 兼容源码与自包含运行时
│  └─ release/              VSIX 构建和解包验证工具
├─ package.json             扩展清单与 npm 命令
├─ README.md                扩展商店产品说明
└─ PROJECT_REPORT.md        当前项目状态报告
```

`node_modules/` 和 `out/` 是本地依赖与编译输出，保留在开发工作区但不进入 Git。`artifacts/releases/` 保存本机最新安装包，也不进入 Git；仅 `artifacts/README.md` 进入源码仓库。

## 3. 核心架构

### 3.1 多引擎语言服务

`src/utils/engine-registry.ts` 定义引擎能力，`src/utils/command-index.ts` 按当前引擎组合检测命令、执行命令、系统常量、标签和函数。`src/utils/custom-language.ts` 保存用户按引擎新增的检测命令、执行命令、界面语句、引擎函数和系统常量，并将它们接入补全、悬停与语义高亮。`src/assistant.ts` 提供补全、中文描述搜索、悬停、参数说明、跳转、审查、变量分析和 Webview 入口。未使用变量与个人标识候选复用当前工作区统计结果，动态引用保留不确定性标记，但不会清空已知可用候选。

### 3.2 补丁与素材

PAK/JPK/WIL/WZL 使用统一资源协议。常见格式通过索引直读和按图解码减少全量解压；PakBridge 自包含运行时保留为特殊 PAK 兼容回退。UI 编辑器、数据库详情、小地图和原始地图共用缓存与资源定位规则。原始地图中的官方 NPC 优先读取自定义补丁 `npc` 至 `npc4` 的 PAK/JPK，缺少对应包时再读取客户端 WZL/WIL，并按实测映射保留正面动画与图片偏移；这四组资源已加入默认“读取需求资源”清单。

### 3.3 数据库与表格

SQLite、MDB、CSV 和 BIFF8 XLS 使用独立 Provider。数据库与普通表格均支持接近 Excel 的选区、粘贴、填充、递增、撤回和单元格更新；MDB 保持只读，写入流程对可写格式执行临时文件与重开校验。

### 3.4 地图与脚本工具

地图模块支持小地图、原始 MAP、NPC、刷怪与地图标识预览。原始地图可直接编辑 NPC 外观和 `NpcIcons` 顶戴配置，并以统一角色格原点叠加 NPC、顶戴和名称。脚本模块支持路径跳转、缺失文件创建确认、快捷文件、批量数值处理和脚本同步。M2 重载按工作区精确定位进程，连续保存请求会合并，并等待当前菜单命令完成后再继续。

### 3.5 NPC 脚本界面可视化

`Ctrl+F12` 从当前 `[@函数]` 打开独立 NPC 界面面板，不修改原有 UI 编辑器。`src/ui-dialog` 负责三引擎界面语句、条件分支、变量求值、坐标偏差和源码局部替换；`src/providers/npc-dialog-visual.ts` 管理文档冲突、应用、保存和独立窗口；`media/npc-dialog-visual.*` 完成 DOM 预览、条件切换、拖动、键盘微调、撤销与重做。动态或无法安全写回的内容保持锁定，保存只替换已经验证的坐标数字跨度。

## 4. 2026-08-20 项目整理

### 4.1 整理前回滚点

整理前源码快照保存在仓库外项目归档中；公开报告不记录本机绝对路径。

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| 整理前源码快照 | 40,506,820 字节 | `E4ACC0128E00D9CD114713ACDAA0EDE493FF86D8426D585D394B339E3CB2B64D` |
| 整理前正式 VSIX | 23,633,585 字节 | `C23268FD7436A77DF07F176082A74E46C2775F8D32FE64A930F6EA748775CC37` |
| 整理前候选 VSIX | 22,234,651 字节 | `5D0A30F77CFEDBDFD092EB3B3AEE59E55376CF260EA20EE890D71C17EF2CAC40` |

### 4.2 已清理

- 删除 `artifacts/tmp-research`、`artifacts/verification`、教程页面渲染中间图和开源验证临时包。
- 删除旧 VSIX、旧功能源码快照、旧语言目录备份和 PakBridge 历史备份；项目内只保留当前版本安装包。
- 删除误放在本项目中的 DeepSeek Harness 发布压缩包。
- 删除第三方 `Reference` 和本地引擎帮助转换副本；这些资料不进入开源仓库。
- 将已退出运行链的 NPC 帮助图移至 `tests/fixtures/npc-looks`，仅保留离线 Webview 布局测试用途，并通过 `.vscodeignore` 排除在 VSIX 外。
- 删除 M2 `obj`、PakBridge Python 缓存和冻结运行时中的空目录。
- 工作区总文件体积由 3,188,482,451 字节降为约 282 MB，减少约 2.91 GB；当前体积包含可重建的 `node_modules`。

### 4.3 结构修复

- `artifacts` 只保留当前本地发布包，历史回滚统一放到工作区外。
- 增加 `data/README.md`、`docs/README.md`、`tools/README.md`，明确目录边界。
- 审计基线不再被 Git 忽略，保证公开仓库克隆后语言准确性测试可复现；它们仍被 `.vscodeignore` 排除，不增加安装包体积。
- 目录回归新增对临时研究、旧备份、第三方参考目录和非当前 VSIX 的禁止检查。
- 打包依赖验证器兼容隐藏 `package.json` 的现代 `exports` 包，并补齐 `anynum`、`is-unsafe`、`xml-naming` 三个传递依赖。
- 浏览器测试共用可重试的临时目录清理，避免 Edge 退出延迟造成 `EPERM` 假失败。

### 4.4 明确保留

- `tools/PakBridge/bin`：特殊 PAK 的冻结兼容运行时，不得按普通生成物删除。
- `tools/M2Reloader/runtime/native-win-x64/M2Reloader.exe`：扩展实际发布的 M2 原生工具。
- `data/audit-report`：语言目录准确性与人工逐项核对的正式回归基线。
- `tests/fixtures/npc-looks`：仅供离线 Webview 布局测试，不属于扩展运行资源，也不进入 VSIX。
- 旧缓存迁移、PAK/JPK/WIL/WZL 兼容和工作区状态迁移代码：仍服务已安装用户。

### 4.5 2026-08-22 发布前整理

- 在仓库外建立 V4.3.2 发布前完整回滚点。
- 回滚点包含当前未提交源码、编译输出、测试、语言数据、运行时工具和上一份 V4.3.2 VSIX；不包含可重建的 `node_modules` 与 Git 元数据。
- 逐项检查根目录、发布目录、忽略目录、TypeScript 与编译输出映射。项目内没有旧候选包、回滚包、临时研究目录或孤立编译模块，因此没有为缩小体积而误删兼容运行时和语言审计基线。
- 补齐自定义引擎语言项目、嵌套变量整体包裹、原始地图 NPC 外观修改、NPC 多行名称和 NPC 顶戴编辑的产品说明与自动回归。

### 4.6 2026-08-25 V4.3.3 发布

- 在仓库外建立 V4.3.3 发布前回滚点，包含 1,037 个文件、105,689,873 字节。
- 补齐三引擎界面语句及参数悬停、自定义界面语句、独立 NPC 脚本可视化、动态变量与个人标识候选、GAMEOFMIR2 单块异常占位和 M2 重载队列。
- README 按脚本、变量、UI、资源、数据库、地图、同步和 M2 模块归类，并增加相应结构回归。
- 发布包与 V4.3.2 相比只新增 13 个预期运行文件、没有删除文件；新增内容为 NPC 独立面板、`src/ui-dialog` 编译模块、重载队列和变量候选模块。

### 4.7 2026-09-04 V4.3.4 发布

- Ctrl+F12 NPC 对话画布补齐主背景、AddDlg、输入、菜单/ListView、物品、进度、动画和本地动作预览；动态显示占位与素材、数据库、坐标、计时和动作参数严格隔离。
- `ITEMSHOW` 固定使用 `IDX → 当前引擎数据库 Looks → Items/ItemsN 槽位` 链路；动态编号、数据库歧义和过期缓存均拒绝猜测。
- 原始地图切换为按视口分批加载、邻区预取与 Tiles/SmTiles 持久瓦片；已验证的 GOM profile 支持 Objects 动画、bit7 DrawBlend 和永久 `MAPEFFECT` 安全子集。
- 增加静态 `SETONTIMER`、`ADDBUTTON` 和新 GOM `ADDDLG` 回调目标跳转，并按源脚本所属服务端限制查找范围。
- README 增加版本重点、安装、严格边界和最新地图加载说明；新增 `CHANGELOG.md`，专项报告与最终验收截图统一归档到 `docs/reports/`。
- `.gitignore` 明确排除 pytest 与截图中间工件；VSIX 增加 `THIRD_PARTY_NOTICES.md`，包内验证器将 README、许可证和第三方声明列为必需文件。

### 4.8 2026-09-05 V4.3.5 发布

- 将扩展清单、锁文件、README、项目报告和 VSIX 文件名统一更新为 V4.3.5，生产功能基线延续 V4.3.4。
- 浏览器倒计时回归使用同一 DOM 任务中的当前运行状态推导文字和图集期望值，修复慢速 Node 20 Runner 上将合法递减误判为失败的问题；未修改生产计时器。
- 从已提交发布基线的干净隔离 worktree 重建 VSIX，避免本地未提交内容混入安装包；60 个生产依赖包闭包、Ctrl+F12 38 文件运行闭包与严格矩阵 76/76 均通过。

## 5. 当前验证结果

| 检查 | 结果 |
| --- | --- |
| 严格 TypeScript | 通过：`--noUnusedLocals --noUnusedParameters` |
| ESLint | 0 错误，21 条 `require-atomic-updates` 提示 |
| 完整回归 | `npm run test:all` 退出码 0；Ctrl+F12 严格矩阵 76/76 通过 |
| 浏览器回归 | Ctrl+F12、原始地图与相关核心用例由 Chrome `152.0.7977.82` 实跑通过；两个旧 Edge 表格用例因无 DOM 按既有规则 SKIP，不记为 PASS |
| npm 安全审计 | 0 个已知漏洞 |
| Python 源码测试依赖 | `requirements-test.txt` 固定 PyCryptodome 3.23.0 与 Unicorn 2.1.4；GitHub Actions 使用 Python 3.12 安装 |
| GitHub Actions 运行时 | checkout、Node、Python 与产物上传均使用官方 v7 Action |
| PAK 自包含运行时 | 通过 |
| 自定义引擎语言 | 解包 VSIX 实测：自定义检测命令与界面语句进入当前引擎索引，参数悬停有效且不混入其他引擎 |
| 变量与个人标识候选 | 解包 VSIX 实测：已确认编号被排除；动态引用不再清空 U 类或个人标识候选；结果保持升序 |
| NPC 脚本可视化 | 76 项严格矩阵通过；最终 VSIX 的 38 文件本地运行闭包完整，动态值门禁、IDX→Looks、坐标逆写和本地动作边界通过 |
| 最终 VSIX Ctrl+F12 | `BOO_NPC_DIALOG_RUNTIME_ROOT` 指向最终解包 `extension/` 后再次执行严格矩阵，76/76 通过 |
| 官方 NPC 客户端素材 | 真实 `npc.wzl` 至 `npc4.wzl`：164 个外观、775 张正面帧，164 个外观逐项 PNG 解码通过 |
| 原始地图 NPC 动画 | 每帧图片预载并解码后原子切换，图片、尺寸和偏移保持同帧；解包 VSIX 使用真实 `npc.wzl#490`、`npc2.wzl#80` 复验通过 |
| NPC 顶戴与多行名称 | 解包 VSIX 实测：顶戴配置解析、角色格偏移、脚本偏移和反向多行名称均通过 |
| 旧 GAMEOFMIR PAK | 本轮固定样本登记路径已不存在，未复跑；此前 1,376 槽、368 图、RGBA SHA-256 100% 匹配证据保留，且本版未修改 PakBridge 源码或冻结运行时 |
| GAMEOFMIR2 单块异常兼容 | 真实包 1,659 槽、1,654 个有效块；异常序号 1,260 保留为空白占位，源码与自包含运行时结果一致 |
| GEEPAK2 真实包 | 未执行：本机未提供 `BOO_GEE2_PAK_PASSWORD` |
| M2 原生源码重建 | 通过，生成 322,560 字节 x64 EXE；隔离 M2 测试等待 2,016 ms 后确认命令完成 |
| VSIX 生产依赖 | 60 个包节点、Ctrl+F12 38 文件闭包、SQL.js、XLS、Tabulator、原生 M2 及项目声明文件全部通过 |
| VSIX 内容 | 1,632 个 ZIP 条目；`extension/` 1,630 个文件、58,011,264 字节；源码、测试、截图、报告和真实样本意外条目为 0 |
| 目录结构守卫 | 通过；无旧目录、旧包、候选包或回滚包残留 |

## 6. 构建与发布

```powershell
npm ci
npm run compile
npm run lint
npm run test:all
npm run verify:pak-runtime
npm run package
```

打包后必须解包 VSIX，再执行：

```powershell
npm run verify:packaged-dependencies -- "<解包后的 extension 目录>"
```

当前正式发布包：

- 路径：`artifacts/releases/vscode-marketplace/boo-ngom-editor-4.3.5.vsix`
- 大小：21,546,270 字节
- 压缩包条目：1,632
- 解包 `extension/`：1,630 个文件，58,012,036 字节
- SHA-256：`658D32B6F4081A47FBA07C78B53B863777F2E59B6D29A2EB02AA88456881DDAE`

上一版回滚包：

- 位置：仓库外发布回滚目录中的 `boo-ngom-editor-4.3.4-release-before-4.3.5-20260905.vsix`
- 大小：21,546,119 字节
- SHA-256：`F76F92B8B6A7F8BA13E0779D75A40D5CA1B5AC0BE5AE981E4A9FF2DCC83BBD30`

## 7. 已知边界

1. VSIX 仍包含 PakBridge 自包含 Python 运行时，这是格式兼容能力的必要成本；没有真实包回归证据时不得裁剪。
2. 21 条 ESLint 并发提示不是当前构建错误，但涉及数据库、补丁管理、地图加载和异步面板状态，后续应按模块逐项验证后处理。
3. GEEPAK2 真实加密样本需要单独提供测试密码环境变量，不能把缺少凭据记为运行时通过。
4. GAMEOFMIR2 异常序号 1,260 的高熵数据块仍属于未识别素材格式；当前只保留逻辑空位，未声称已解码其内容。
5. NPC 独立面板可以静态求值脚本、配置和表格中的确定值；依赖在线角色、随机数、插件或外部服务的运行时内容只能显示默认值或锁定占位。
6. Ctrl+F12 与永久 MAPEFFECT 均是安全离线预览，不代表游戏客户端像素、窗口生命周期或 M2 当前在线状态完全等价。
