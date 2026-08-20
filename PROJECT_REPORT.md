# BOO 可视化编辑器项目报告

> 报告日期：2026-08-20  
> 当前版本：V4.3.1  
> 项目类型：Visual Studio Code 扩展  
> 发布标识：`boo1213.boo-NGOM-editor`

## 1. 项目概览

BOO 可视化编辑器面向传奇 GM、版本制作人员和脚本开发者，将多引擎脚本语言服务、UI 编辑、补丁资源、数据库、地图预览、脚本同步和 M2 重载集中到 VS Code。

| 项目 | 当前状态 |
| --- | --- |
| 扩展版本 | V4.3.1 |
| VS Code 要求 | `^1.68.0` |
| TypeScript 源文件 | 87 个，25,528 行 |
| 自动回归文件 | 74 个 `*.test.js` |
| 注册命令 | 46 个 |
| 内置主题 | 19 套 |
| 生产依赖闭包 | 解包后验证 60 个实际包节点 |
| 当前发布包 | `boo-ngom-editor-4.3.1.vsix` |

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
├─ resources/               扩展图标与 NPC 外观资源
├─ src/                     TypeScript 扩展源码
├─ syntaxes/                TextMate 语法定义
├─ tests/                   自动回归、夹具与测试辅助代码
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

`src/utils/engine-registry.ts` 定义引擎能力，`src/utils/command-index.ts` 按当前引擎组合检测命令、执行命令、系统常量、标签和函数。`src/assistant.ts` 提供补全、中文描述搜索、悬停、参数说明、跳转、审查、变量分析和 Webview 入口。

### 3.2 补丁与素材

PAK/JPK/WIL/WZL 使用统一资源协议。常见格式通过索引直读和按图解码减少全量解压；PakBridge 自包含运行时保留为特殊 PAK 兼容回退。UI 编辑器、数据库详情、小地图和原始地图共用缓存与资源定位规则。

### 3.3 数据库与表格

SQLite、MDB、CSV 和 BIFF8 XLS 使用独立 Provider。数据库与普通表格均支持接近 Excel 的选区、粘贴、填充、递增、撤回和单元格更新；MDB 保持只读，写入流程对可写格式执行临时文件与重开校验。

### 3.4 地图与脚本工具

地图模块支持小地图、原始 MAP、NPC、刷怪与地图标识预览。脚本模块支持路径跳转、缺失文件创建确认、快捷文件、批量数值处理、脚本同步和按工作区精确定位 M2 进程的重载。

## 4. 2026-08-20 项目整理

### 4.1 整理前回滚点

外部备份目录：`D:\BOO项目归档\boo-ngom-editor\20260820-151914-before-open-source-cleanup`

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
- `resources/npc-looks`：按编号动态定位，不能依据静态文件名引用次数裁剪。
- 旧缓存迁移、PAK/JPK/WIL/WZL 兼容和工作区状态迁移代码：仍服务已安装用户。

## 5. 当前验证结果

| 检查 | 结果 |
| --- | --- |
| 严格 TypeScript | 通过：`--noUnusedLocals --noUnusedParameters` |
| ESLint | 0 错误，19 条 `require-atomic-updates` 提示 |
| 完整回归 | `npm run test:all` 通过 |
| Edge 页面冒烟 | 当前 Edge 151 无 DOM 输出，2 项明确 `SKIP`，临时目录正常清理 |
| npm 安全审计 | 0 个已知漏洞 |
| PAK 自包含运行时 | 通过 |
| 旧 GAMEOFMIR PAK | 1,376 槽、368 图、RGBA SHA-256 100% 匹配 |
| GEEPAK2 真实包 | 未执行：本机未提供 `BOO_GEE2_PAK_PASSWORD` |
| M2 原生源码重建 | 通过，生成 317,440 字节 x64 EXE |
| VSIX 生产依赖 | 60 个包节点、SQL.js、XLS、Tabulator、原生 M2 全部通过 |
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

当前安装包：

- 路径：`artifacts/releases/vscode-marketplace/boo-ngom-editor-4.3.1.vsix`
- 大小：22,282,403 字节
- 压缩包条目：1,772
- SHA-256：`C16A7F942D83FB566A86CCFB933A95B5118CF67FABC62602C742070E39797AF8`

## 7. 已知边界

1. VSIX 仍包含 PakBridge 自包含 Python 运行时，这是格式兼容能力的必要成本；没有真实包回归证据时不得裁剪。
2. 19 条 ESLint 并发提示不是当前构建错误，但涉及数据库、补丁管理和异步面板状态，后续应按模块逐项验证后处理。
3. 当前 Edge 版本的 `--headless --dump-dom` 在本机返回空输出，浏览器布局断言没有执行；核心表格逻辑与其余回归均已执行。
4. GEEPAK2 真实加密样本需要单独提供测试密码环境变量，不能把缺少凭据记为运行时通过。
