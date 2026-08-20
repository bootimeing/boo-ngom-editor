# BOO V4.2.5 代码与发布包清理审计

审计日期：2026-07-28  
审计方式：引用图分析、发布包反查、协议能力对比、隔离副本删除演练、完整回归、真实 VSIX 打包与解包验证。  
本文前 10 节记录 V4.2.5 基线审计与隔离删除演练；第 11 节记录已完成的 V4.2.6 正式实施。

## 1. 总结

当前工程确实存在一批已被新功能替代的代码，最值得处理的是：

| 优先级 | 候选项 | 结论 | 主要收益 |
|---|---|---|---|
| P0 | `src/utils/db-cache.ts` | 整个模块不可达，可删除 | 去掉旧数据库全量缓存路径 |
| P0 | `src/utils/pak.ts` 的 PNG 导出文件夹扫描器 | 已被直接 PAK/JPK 索引读取替代，可删除 | 约 122 行旧素材路径 |
| P0 | UI 编辑器旧服务端目录树 | DOM 与扩展消息入口均已退出，可删除 | 约 160 行 HTML/JS/CSS |
| P0 | 未挂载的旧 snippets 文件 | 明确不再参与补全，可删除 | 87,655 字节 |
| P0 | `boo.openCsvEditor` 清单命令 | 只有声明、没有注册，可删除清单项 | 避免无效命令入口 |
| P0 | 一组无调用函数、导出和变量 | 可机械清理 | 约 100 行，降低维护噪声 |
| P1 | M2Reloader net7/net8 两个 EXE 和旧 C# 实现 | 原生版已在三引擎完成实机替代验证，可删除 | VSIX 约减少 10.45 MB |
| P1 | `xlsx` 的浏览器版、ESM、map、CLI 等副本 | Node 运行只需 CommonJS 主包和码表 | VSIX 约减少 1.90 MB |
| 阻断 | `mdb-reader` 的生产依赖未进入当前 VSIX | 不是删除项，但清理发布前必须修复 | 否则发布版 MDB 导入即失败 |
| P1 | `data/const.json` 与旧共享数据转换链 | 三引擎独立常量已替代；先归档旧工具再删除 | 清除双数据源风险 |
| P2 | 旧 CHM 提取、双引擎导入、一次性迁移脚本 | 不应继续混在当前工具链；建议归档 | 约 3,848 行历史脚本 |

只做 P0 清理，用户功能不会变化，但包体仅从 31.19 MB 降到 31.17 MB。完成 P1 并正确补齐 MDB 依赖后，隔离实包为 **20.004 MB / 1,733 个文件**，比当前 31.19 MB 减少 11.19 MiB。先前 18.80 MB 的结果遗漏了 MDB 依赖，是损坏包，不能作为发布目标。

### 1.1 深度删除复核结论

| 项目 | 最终判断 | 删除时必须联动处理 |
|---|---|---|
| P0 不可达 TypeScript、旧 PNG 扫描器、旧 Webview 服务树、旧 snippets、无效命令 | 可直接删除 | 删除孤立 `out`；严格编译；命令清单一致性测试 |
| Webview 旧素材搜索和缩放函数 | 可直接删除 | 一并删除 `_assetSearchKeyword`、`kw` 分支、`ZOOM_*` 常量和 `.zoom-controls` 样式 |
| M2 net7/net8 与 C# 旧实现 | 可删除 | GOM、翎风、996PC 的扫描、手动重载、保存自动重载和错误目标隔离均已通过 |
| `xlsx` 冗余分发文件 | 条件删除 | 保留 `xlsx.js`、`dist/cpexcel.js`、`package.json`、`LICENSE`，同步修改 BIFF8 打包断言 |
| `mdb-reader` 依赖 | 不可删除，且当前发布包缺失 | 打包完整的 57 个实际解析依赖目录，并新增解包后依赖闭包测试 |
| `data/const.json` 与旧转换脚本 | 先归档后删除 | 作为同一批处理，不能只删常量文件留下会失败的旧脚本 |
| `data/audit-report` | 目前不可整体外移 | 6 个文件被测试直接读取，另有文件被维护工具读取或写入 |
| `data/temp`、M2 `obj`、PakBridge `__pycache__` | 可删除 | 它们没有仓库调用者且不进入 VSIX |
| 旧 VSIX、`data/backups`、旧审计工具 | 外部归档 | 当前无 Git，必须先验证独立备份和回滚包可用 |

## 2. 遍历范围

- `src`：64 个 TypeScript 文件，约 21,269 行。
- `out`：64 个运行 JS 和 64 个 sourcemap。TypeScript 文件与 JS 文件一一对应，没有额外业务模块；唯一孤立模块是 `db-cache`。
- `media`：10 个 Webview 文件，约 10,491 行。
- `tests`：57 个文件，约 6,808 行。
- `tools/data-maintenance`：29 个脚本，约 19,552 行。
- `tools/legacy-data-import`：5 个脚本，约 1,424 行。
- `tools/chm-analysis`：4 个脚本，约 595 行。
- `package.json`、`.vscodeignore`、主题、语法、资源文件、根目录 VSIX、`data` 生成物和两个原生工具运行时。
- 最新 `boo-NGOM-editor-4.2.5.vsix` 的每个压缩条目及其压缩体积。

TypeScript 引用图以 `src/extension.ts` 为主入口，并额外把动态 Worker `src/utils/archive-image-worker.ts` 作为入口。64 个源文件中有 63 个可达，只有 `src/utils/db-cache.ts` 不可达。

## 3. P0：可直接删除的替代代码

### 3.1 旧数据库名称缓存模块

删除：

- `src/utils/db-cache.ts`，160 行。
- `out/utils/db-cache.js` 及 sourcemap。删除源文件后必须显式删除旧输出，因为 `tsc` 不会清理孤立 JS。

依据：

- 全仓没有任何 import、require 或动态路径引用。
- 它会使用 SQL.js 整库读取 `StdItems`、`Monster`、`Magic` 名称并保存在进程内存中。
- 当前数据库由 `DatabaseBrowserSession` 分页读取，入口位于 `src/utils/database-browser.ts:151` 和 `src/assistant.ts:3398`。
- 当前补全由三引擎 `command-index` 构建，不读取这个缓存。

注意：删除它**不能**删除 `sql.js`，数据库浏览器仍在使用 SQL.js。

### 3.2 旧“解压 PNG 文件夹”素材扫描链

在 `src/utils/pak.ts` 删除：

- `pakAssetsCache`。
- `matchPakRoot`（约第 93 行）。
- `PakAsset`。
- `inferPakImageIndex`、`formatPakImageName`、`parsePakImageIndex`。
- `scanPakAssets`、`scanSinglePakAssetFolder`（约第 156、201 行）。
- `clearPakCache` 中对应 `pakAssetsCache.clear()`。

保留：

- `loadPakIndex`：仍负责读取 `EffectImageList.txt`。
- `matchPakFile`：仍负责校验用户打开的 PAK/JPK 是否被服务端调用。
- `clearPakCache`：仍需清理 EffectImageList 索引缓存。

依据：旧代码只扫描用户预先解压出的 PNG 子目录；当前入口使用 `openArchiveIndexed`（`src/utils/archive-index.ts:98`），调用点在 `src/extension.ts:1203` 和 `src/providers/patch-manager.ts:469`。全仓没有旧扫描函数的调用者。

### 3.3 UI 编辑器旧服务端目录树

删除 `media/editor.html` 中：

- 第 162-189 行附近整组 `.server-*`、`.tree-*` 样式。
- 第 722-724 行的 `loadServerTree` 消息分支。
- 第 6079-6217 行的 `switchAssetsTab`、`requestOpenServerFolder`、`handleServerTreeFromVSCode`、`renderTreeNode`。

依据：

- `tabServer`、`serverEmpty`、`serverTreeWrap`、`serverPathLabel`、`serverTree` 等 DOM 已不存在。
- 扩展端没有发送 `loadServerTree`，也没有处理 `openServerFolder`。
- 当前服务端文件访问由 VS Code 左侧树、编辑器和独立功能视图承担。
- 如果旧消息意外到达，现代码反而会因为空 DOM 而报错。

### 3.4 Webview 中其余无调用函数

以下函数在定义之外没有任何引用，也没有 HTML 内联事件或消息入口：

| 文件 | 函数 | 说明 |
|---|---|---|
| `media/editor.html:2187` | `dialogAssetVisible` | `switchDialogPak` 已直接按 `data-pak` 过滤 |
| `media/editor.html:3045` | `zoomIn`、`zoomOut`、`resetZoom` | 页面已没有缩放控件，`zoom` 当前固定为 1 |
| `media/editor.html:3401` | `filterAssets` | 页面没有搜索输入、监听器或其他赋值入口 |
| `media/editor.html:4404` | `copyCode` | 当前界面没有调用该旧 `execCommand` 路径 |
| `media/editor.html:5478` | `scheduleSyncToCode` | `syncCanvasToCode` 自身已经做防抖 |
| `media/sidebar-detail.html:504` | `viewImage` | 无按钮、无调用者 |

还可删除 `media/editor.html:507-510` 已注释掉的三个旧 `<input type="file">`。

隔离删除后继续做引用扫描，发现上述函数还有两组连带死状态，必须同批删除，否则只是留下更隐蔽的无效分支：

- `_assetSearchKeyword`、局部 `kw`、按 `kw` 过滤和计数的分支。
- `CONFIG.ZOOM_MIN/MAX/STEP` 以及无 DOM 对应项的 `.zoom-controls` 样式。

单次出现扫描剩余的 `initResizers` 不是死函数，它是定义后立即执行的命名 IIFE，不能按“只出现一次”误删。

### 3.5 未挂载的旧 snippets

删除：`snippets/gom-snippets.code-snippets`。

依据：

- `package.json` 没有 `contributes.snippets`。
- `package.json:593` 明确把 `editor.snippetSuggestions` 设为 `none`。
- `tests/engine-help-data.test.js:234` 明确断言 snippets 不应注册。
- 当前补全由三引擎动态目录和补全编辑器提供。

该文件目前仍被装进 VSIX，属于无效发布内容。

### 3.6 无效的 CSV 命令清单项

删除 `package.json:311-314` 的 `boo.openCsvEditor` 命令贡献。

依据：

- 40 个 manifest 命令与 42 个运行时注册命令比对后，只有它“只声明、不注册”。
- CSV 已通过 `boo.csvEditor` Custom Editor 自动打开，注册位于 `src/providers/csv-editor.ts:6`。
- `boo.gotoVarLine`、`boo.gotoVarOccurrence`、`boo.insertClipboardSnippet` 虽未贡献到命令面板，但属于内部命令，必须保留。

### 3.7 TypeScript 中的机械死代码

可删除或简化：

- `src/reload.ts:303`：`doReload`，与 `boo.reloadM2` 的实际实现重复且无调用。
- `src/assistant.ts:4605`：`promptCreateFile`，已由 `boo.createMissingFile`（约第 2270 行）替代。
- `src/assistant.ts:983-989`、`1049-1054`：计算 `finalPath`/`newPath` 后立即返回 `null` 的旧分支。
- `src/assistant.ts:1156`：`isVar`。
- `src/assistant.ts:1160`：`isPath`。
- `src/assistant.ts:2732`：`inBlock` 及只写不读的赋值。
- `src/assistant.ts:2545`：永远返回 `null` 的可选 `getParent`。
- `src/types.ts:189`：`QuickImportItem`。
- `src/utils/archive-index.ts:383`：`isArchiveIndexCurrent`。
- `src/utils/engine-detect.ts:64`：`detectEngine` 包装函数；当前统一使用 `detectEngineDetails`。
- `src/utils/original-map.ts:202`：未使用的两个导出别名；删除别名后严格编译确认内部 `MAP_UNIT_WIDTH/HEIGHT` 也已无调用，应同批删除。
- `src/utils/regex.ts:11`：`safeRegex`。
- `src/utils/archive-index.ts:10,12`：两个未使用的 revision import。
- `src/utils/log-cleaner.ts:6`：未使用的 `vscode` import。
- `src/extension.ts:444`：`BooSidebarProvider` 未使用的 `_context` 字段。
- `src/providers/table-editor.ts:90`：未使用的 `context` 字段；`register(context)` 的参数也无用途，应连调用点改为无参。
- `src/utils/script-labels.ts:172`：`engine` 参数当前未使用；可从签名和调用点一起移除，或改为 `_engine` 明示保留接口。

建议清理后在 `tsconfig.json` 开启 `noUnusedLocals` 和 `noUnusedParameters`，防止同类代码再次进入。

## 4. P1：新实现已替代，但应在清包后再删

### 4.1 M2Reloader 的 net7/net8 运行时和 C# 实现

候选：

- `tools/M2Reloader/runtime/net7.0-win-x64/M2Reloader.exe`，11,705,395 字节。
- `tools/M2Reloader/runtime/net8.0-win-x64/M2Reloader.exe`，12,232,220 字节。
- `tools/M2Reloader/Program.cs`。
- `tools/M2Reloader/M2Reloader.csproj`。
- `src/reload.ts:50-56` 的 .NET 查找路径。

替代证据：

- `src/reload.ts:47-62` 永远优先选择 `native-win-x64`；发布包同时包含原生版，所以 net8/net7 不会被选中。
- 如果原生 EXE 存在但 `spawn` 失败，当前代码不会继续尝试第二、第三候选路径。因此两个 .NET EXE 即使存在，也从未形成可工作的启动回退。
- 当前扩展发送 `scanpath:` 和 `reloadpath:`。
- 原生版在 `tools/M2Reloader/native/M2Reloader.cpp:585-630` 支持 `scanpid`、`scanpath`、`reloadpid`、`reloadpath`。
- C# 守护进程只识别旧 `reload:`，不支持当前路径定向协议，已经不是真正可用的回退。
- 原生版使用 `/MT` 静态运行库并以 Windows 7 子系统构建，不依赖用户安装 .NET。
- 只含原生版的解包 VSIX 已分别精确锁定新 GOM、翎风、996PC：PID `15000 / 28560 / 35088`，窗口句柄 `68910 / 134224 / 68518`。
- 三引擎“所有NPC”真实重载分别命中菜单 ID `17 / 20 / 23`；QFunction 真实重载分别命中 `14 / 16 / 18`。
- 扩展配置的 52 个重载选项逐项与三套当前 M2 菜单比对，52/52 名称和 ID 一致。
- 不存在的完整路径、非 M2 PID、未知菜单名称均被拒绝，没有误投递到其他 M2。
- 直接加载解包 VSIX 的 `out/reload.js`，模拟三套真实 `AdminList.txt` 保存事件；500ms 防抖、脚本路径定位、守护进程启动、路径定向重载和退出均通过。
- 解包 VSIX 的 `boo.reloadM2` 手动命令在三引擎逐一执行通过。
- 重载后三个 M2 的 PID、窗口句柄和启动时间均未变化，进程全部 `Responding=True`；应用事件日志没有 M2 错误，也没有残留 M2Reloader 进程。

收益：这两个 EXE 在 V4.2.5 VSIX 中压缩后合计约 **10.45 MB**。

原定删除门槛已经完成。net7/net8、自包含 C# 源码及对应查找路径可以进入正式清理批次；正式发布包仍应保留一次安装后快速扫描作为发布门禁。

### 4.2 精简 xlsx 发布内容

当前 `.vscodeignore:17` 重新包含整个 `node_modules/xlsx/**`，VSIX 内有 26 个文件：CommonJS、ESM、浏览器 min、Extendscript、source map、CLI、类型等，共 7.70 MB 原始体积、2.31 MB 压缩体积。

扩展运行时是 CommonJS，实际需要：

- `xlsx.js`。
- `dist/cpexcel.js`，因为 `xlsx.js:4446` 会直接 require 它。
- `package.json`。
- `LICENSE`。

其余发布副本可通过 `.vscodeignore` 排除，预计减少约 **1.90 MB** VSIX。这里只调整发布白名单，不应删除本地 `node_modules` 中的类型文件，否则 TypeScript 开发编译会受影响。

隔离实包已用包内 `xlsx` 完成 BIFF8 打开、编辑、保存、重开，并保留第二工作表和公式缓存值。实施时还必须修改 `tests/database-biff8.test.js`：原测试硬编码断言 `!node_modules/xlsx/**`，精简后应改为断言 `xlsx.js` 与 `dist/cpexcel.js` 存在、宽泛白名单不存在。

现有 BIFF8 写入链只保证公式缓存值，不保证公式表达式本身。实测 SheetJS 在第一次写成 XLS 时就会丢掉 `f` 字段，这在清理前后相同，属于既有功能限制，不能把“缓存值仍在”描述成“公式完整保留”。

### 4.3 发布包缺失 MDB 生产依赖：清理前阻断项

当前 V4.2.5 的 `.vscodeignore` 只重新包含 `node_modules/mdb-reader/**`，没有包含它的生产依赖。直接从当前 VSIX 导入 `mdb-reader` 会报：

```text
ERR_MODULE_NOT_FOUND: Cannot find package 'fast-xml-parser'
```

这不是本次删除造成的，但如果以 18.80 MB 的清理包发布，会把一个已损坏的包误认为优化成功。`mdb-reader@3.2.0` 的实际 Node 解析闭包包含 57 个包目录，除 `fast-xml-parser` 外还包括 `browserify-aes`、`create-hash`、`pako` 及哈希/流依赖。部分依赖位于 `hash-base/node_modules`，只检查顶层包名仍会漏包。

隔离包补齐完整闭包后：

- `mdb-reader` 的 ESM import 和 CommonJS require 均通过。
- 使用包内模块真实读取本地 GOM 与 996PC 服务端的 `Data.mdb` 样本，均识别 7 个表。
- `create-hash`、AES、Pako、XML 解析依赖分别完成运行时冒烟。
- 递归按 Node 实际解析目录比对源安装与解包 VSIX，57/57 个包目录齐全。

建议新增发布门禁：打包后解开 VSIX，递归解析所有 `dependencies`，缺少任一 `package.json` 即失败。手工维护白名单容易在升级 `mdb-reader` 后再次漏包；长期应考虑生产依赖暂存或打包方案。

### 4.4 旧共享常量数据和转换链

候选：`data/const.json`，25,043 字节。

依据：

- 运行时不读取该文件。
- 当前三引擎分别读取 `constants-gom.json`、`constants-gee.json`、`constants-996pc.json`。
- 只有 `export-to-md.js`、`md-to-json.js`、`materialize-engine-language.js` 三个旧工具仍读取它。
- 它仍被错误装进 VSIX。

处理顺序：先把上述旧工具归档或改成读取独立常量目录，再删除 `const.json`，并在回归测试中断言 VSIX 不再包含它。

## 5. P2：建议归档，不建议直接销毁

### 5.1 已被三引擎审计管线替代的旧脚本

以下脚本主要服务于早期单 GOM 或 GOM/翎风共享数据模式，部分还硬编码桌面路径、`commands_final.txt` 或旧 `BOO指令合集`。当前已有 `audit-engine-language-accuracy.js`、`audit-final-engine-language-catalog.js`、`audit-help-command-coverage.js`、`reconcile-cross-engine-help.js` 等三引擎工具替代。

建议移动到工程外的历史归档：

- `tools/legacy-data-import/*`，5 个文件。
- `tools/chm-analysis/*`，4 个文件。
- `tools/data-maintenance/audit-all.js`。
- `tools/data-maintenance/deep-audit.js`。
- `tools/data-maintenance/export-to-md.js`。
- `tools/data-maintenance/md-to-json.js`。
- `tools/data-maintenance/rebuild-data.js`。
- `tools/data-maintenance/materialize-engine-language.js`。
- `tools/data-maintenance/apply-2026-07-engine-help.js`。

合计约 3,848 行、154,545 字节。体积不大，主要价值是防止误运行旧脚本覆盖现在已经人工核准的三引擎数据。

删除演练确认所有当前 npm script 的目标文件仍存在，仓库代码也没有引用这些旧入口。不过 `PROJECT_REPORT.md` 仍把 `tools/chm-analysis`、`tools/legacy-data-import` 和 net7/net8 M2 文件写成当前结构；正式整理时必须同步更新项目报告，否则文档会继续引导维护者使用已删除路径。`docs/reports/optimization-report-2026-05.md` 属于历史报告，可保留原叙述并标明日期，无需改写历史事实。

### 5.2 一次性 apply/review 脚本

`apply-final-*`、`apply-*-manual-review`、`apply-real-server-language-evidence.js` 等脚本看起来像历史迁移，但部分仍被测试或审计模块 require。不能只按名称删除。

建议做法：

1. 将最终人工核准数据固定为只读基线。
2. 把测试需要的纯映射拆到 `tests/fixtures` 或 `tools/data-maintenance/review-data`。
3. 删除只负责覆写 JSON 的一次性入口。
4. 保留最终审计器，确保三引擎数据仍能逐条复核。

`index-chm-help.js` 和 `audit-nested-variable-usage.js` 虽没有 npm script 引用，但仍是可独立执行的诊断工具；在确认不再需要人工审计前不建议删。

## 6. 仓库生成物与历史包

这些内容不影响用户安装包，因为已被 `.vscodeignore` 排除，但明显拖慢备份、搜索和目录遍历：

| 位置 | 当前体积 | 建议 |
|---|---:|---|
| 根目录 14 个 VSIX | 409.12 MB | 留当前 4.2.5 和一个 4.2.4 回滚包，其余移到外部发布归档 |
| `OpenVSX首次发布` | 27.51 MB | 发布记录确认后外移 |
| `data/temp` | 136.63 MB | 全部为可再生成的旧 VSIX 解包、Python 嵌入包和帮助索引，可清理 |
| `data/audit-report` | 47.63 MB | 目前不可整体外移；38.974 MiB 被测试直接读取，其余多为维护工具输入/输出 |
| `data/backups` | 227.23 MB | 无 Git 的情况下不要直接删；转移到独立备份盘 |
| `tools/M2Reloader/obj` | 约 0.90 MB | 编译生成物，可删除 |
| `tools/PakBridge/src/__pycache__` | 约 0.16 MB | Python 生成物，可删除 |

原报告将 `data/audit-report` 全部计入可外移体积是不安全的。至少以下 6 个文件是正式测试基线：

- `all-help-english-tokens-final.json`
- `help-all-token-manual-review-final.json`
- `help-command-coverage-final.json`
- `final-engine-language-entry-ledger.json`
- `engine-classification.json`
- `language-accuracy-final.json`

另外 `language-accuracy.json` 被当前维护脚本读取，`help-command-manual-review-final.json` 与 `cross-engine-omissions.json` 是审计流程产物。在先把基线迁到 `tests/fixtures` 或让测试可确定性重建之前，不应移动整个目录。因此可立即整理的工作区体积应扣除这 47.63 MB，不能再宣称全部 786 MB 都可直接删除。

若按“保留当前包 + 一个回滚包”的策略外移历史内容，仍能显著缩小工作目录，但必须先逐项核对归档位置和恢复方式。这属于仓库整理，不会缩小 VSIX。

`resources/使用教程.md` 已被新版 `README.md` 取代且不进包，可以删除。2026-08-20 整理时，`docs/engine-reference` 已保存到工作区外的回滚快照后从项目移除，根目录历史方案文档则已分类到 `docs`。

## 7. 不应删除的“看起来像旧版”代码

以下内容经核对仍是当前兼容链的一部分：

- `tools/PakBridge/bin/**`：必须保留。旧 GAMEOFMIR 冻结运行时实测通过，368 个块、100% RGBA 哈希匹配。
- `src/utils/pak-reader.ts` 的 `decodePakFully`：高速索引失败时仍自动回退。
- `src/extension.ts:1154-1225` 和 `src/providers/patch-manager.ts:469-490` 的 direct/legacy 双路径。
- `media/geepak3_exact.js`：被 `pak-reader.ts` 动态加载，也被精确索引测试使用。
- `src/utils/cache-storage.ts` 的旧缓存迁移：已有安装用户升级时仍需迁移，至少再保留一个明确的升级窗口。
- `out/**`：这是 VS Code 实际运行代码，`src/**` 反而不进 VSIX。
- `src/utils/archive-image-worker.ts`：由 Worker 路径动态启动，普通 import 图不会显示调用。
- `tests/fixtures/npc-looks/*.webp`：仅供地图 Webview 离线布局测试，已从运行资源和 VSIX 中移出；原始地图官方 NPC 改为读取客户端 PAK/JPK/WIL/WZL。
- `media/map-viewer.html` 与 `media/map-preview.html`：一个是地图查看器，一个是带标识/NPC/刷怪编辑的地图预览，功能不同。
- `CsvEditorProvider`、`TableEditorProvider`、`XlsEditorProvider`：分别处理 CSV、merchant/mongen 中间表和 XLS，不是重复实现。
- `iconv-lite`、`safer-buffer`、`sql.js`、`mdb-reader`、`xlsx`：都有运行时调用，不能因删除 `db-cache` 而移除依赖；`mdb-reader` 还必须保留完整传递依赖闭包。

## 8. 测试目录中的“孤立文件”不是废代码

下列 8 个测试没有接入任何 npm 测试脚本，但本次单独执行全部通过：

- `help-all-token-manual-review.test.js`
- `map-preview-editor.test.js`
- `map-preview.test.js`
- `pak-image-index.test.js`
- `pak-inflate.test.js`
- `pak-slots.test.js`
- `text-encoding.test.js`
- `webview-security.test.js`

建议新增 `test:all` 把它们纳入正式回归，不要删除。

`database-viewer-harness.js`、`map-preview-harness.js`、`patch-manager-harness.js` 是测试夹具；`vscode-archive-webview-smoke.js` 是需要 VS Code 环境的手动冒烟入口，也应保留并写入测试说明。

## 9. 本次验证结果

- 在隔离副本完整执行 P0、M2、xlsx、旧数据和旧工具删除演练，当前工程未改。
- `tsc --noEmit --noUnusedLocals --noUnusedParameters`：删除后零未使用项、零编译错误。
- `npm run test:cache`：20 项通过。
- `npm run test:language`：24 项通过。
- `npm run test:996pc`：20 项通过。
- 8 个未挂载独立测试：全部通过。
- 39 个 manifest 命令全部有运行时注册；3 个额外运行时内部命令不要求贡献到命令面板。
- `npm run verify:pak-runtime`：通过。
- 用最终解包 VSIX 的 PakBridge 运行旧 GAMEOFMIR 冻结样本：368 块、12,601,984 原始字节、RGBA SHA-256 100% 匹配。
- 用最终解包 VSIX 的原生 M2Reloader 完成三引擎路径扫描、52 项菜单映射、所有NPC/QFunction 真实重载、手动命令、保存自动重载、错误目标隔离和退出：全部通过。
- 最终解包 VSIX 的 `sql.js` 建表/查询通过。
- 最终解包 VSIX 的 XLS 打开、编辑、保存、重开和第二工作表保留通过。
- 最终解包 VSIX 的 MDB import/require、完整依赖闭包、密码学依赖冒烟与两个真实 `Data.mdb` 读取通过。
- 发布内容断言通过：无 `db-cache.js`、旧 snippets、`const.json`、net7/net8 M2；仅含原生 M2 和 4 个必要 xlsx 文件。

隔离包尺寸对比：

| 包 | 文件数 | 体积 | 结论 |
|---|---:|---:|---|
| V4.2.5 基线 | 1,122 | 31.19 MiB | 与当前发布包一致 |
| 仅 P0 | 1,120 | 31.17 MiB | 功能安全，包体收益很小 |
| P1 但漏 MDB 依赖 | 1,095 | 18.80 MiB | **损坏，禁止发布** |
| P1 + 完整 MDB 闭包 | 1,733 | 20.004 MiB | 当前正确的清理实包 |

尝试使用系统 `code --install-extension` 做隔离安装时，CLI 启动了一个独立 VS Code 窗口而没有以命令行模式退出，120 秒后终止；所有带临时 user-data 参数的进程已关闭。这项结果不表示 VSIX 安装失败，但也不能算作安装级通过。`vsce package`、ZIP 解包、manifest/文件清单与包内运行时验证均已通过；正式实施后仍应在 Extension Development Host 或干净 VS Code 配置中做一次可见激活测试。

## 10. 推荐实施顺序

1. 先备份当前 V4.2.5 源码、VSIX、用户状态与缓存恢复说明，确认回滚包可安装。
2. 先修复 `.vscodeignore` 的 MDB 生产依赖闭包，并增加“解包后依赖完整性 + 真实 MDB”发布测试。这是现有发布缺陷，不应等清理后再处理。
3. 做 P0 源码清理，显式删除对应孤立 `out` 文件；同步删除素材搜索/缩放的连带死状态，重新编译并跑全部测试。
4. 增加 `test:all`，把 8 个漏接测试纳入正式回归。
5. 精简 xlsx 白名单，同时更新 `database-biff8.test.js` 的打包规则断言；用真实 XLS 做打开、编辑、保存、重开验证。
6. 三引擎原生 M2 替代门槛已通过，可删除 net7/net8、C# 源码、旧查找路径和 `obj`；打正式 VSIX 后再执行一次快速扫描，防止发布清单回退。
7. 删除 `data/const.json` 前先外部归档旧单/双引擎数据脚本，并同步更新 `PROJECT_REPORT.md` 的目录和 M2 说明。
8. 最后整理历史 VSIX、`data/temp` 和生成物。`data/audit-report`、`data/backups` 不得混入直接删除批次。

建议每个阶段单独生成可回滚 VSIX。这样一旦某项清理影响用户，可以精确回退，不必恢复整个项目目录。

## 11. V4.2.6 正式实施结果

- V4.2.5 已备份到 `D:\BOO版本备份\BOO-V4.2.5-20260728-164848`；2,100 个文件逐个 SHA-256 匹配，V4.2.5 VSIX 哈希为 `77FD153306298F652523DF9BA70942DA1D3CE6FFA4F680BD34EE1D753ECFC689`。
- P0 源码、Webview 连带状态、旧 snippets、旧工具、一次性数据脚本、C# M2 与 net7/net8 运行时已按审计清单删除。
- `data/temp`、M2 `bin/obj`、PakBridge `__pycache__` 和孤立 `out/utils/db-cache.*` 已清理；`data/audit-report`、`data/backups`、PakBridge 兼容链和历史 VSIX 明确保留。
- `.vscodeignore` 已改为完整 MDB 传递依赖闭包、四文件 xlsx 和单一原生 M2 运行时。
- 8 个原未挂载测试已接入 `test:extras`，新增 `test:all` 与解包后 `verify:packaged-dependencies`。
- 真实验收时发现 WPS 产生的 996PC 怪物和技能 XLS 含 SheetJS 无法回写的 OLE 文档属性；V4.2.6 仅在写出副本中剥离这些非游戏元数据，三张真实表均完成修改、写出和重开。
- `npm run test:all`、严格 TypeScript、PAK 自包含运行时、旧 GAMEOFMIR 全像素、两份真实 MDB、三份真实 XLS 和 57 个生产依赖节点全部通过。
- 最终 VSIX 内的原生 M2Reloader 对 GOM、翎风、996PC 分别完成“所有 NPC + QFunction”真实重载，菜单 ID 为 `17/14`、`20/16`、`23/18`，三进程保持响应且无守护进程残留。
- 最终包 `boo-NGOM-editor-4.2.6.vsix` 为 20,975,738 字节（1,733 项），SHA-256 为 `A7A4BFCD6D9E5BD6BC28B4D4BA7C8AA06D3ECF823D5B114636D071159AF5BE03`。相比 V4.2.5 减少 11,726,592 字节（35.86%）。
