# NPC 缺失脚本 Ctrl+点击修复报告 — 2026-09-27

## 结论与使用

MerChant.txt 第一列的缺失 NPC 脚本已接入创建链接，不再需要先按 Ctrl+Q 才能创建。V4.3.6 独立候选保留上一轮全部 PAK 工作台修复。未替换默认扩展、未发布商店、未修改用户服务端脚本。

安装本报告候选并重新加载 VS Code 后，在以下配置的第一列上 Ctrl+左键：

```text
攻沙传送\特殊称号1 王师征伐地 241 252 特殊称号 0 10072 0
```

目标是该 MerChant.txt 所属 Envir 中的：

```text
Market_Def\攻沙传送\特殊称号1-王师征伐地.txt
```

文件缺失时出现“创建文本”确认；取消不创建，确认后创建空文件并打开。已有地图专属文件则直接跳转；若地图专属文件不存在、同目录 `特殊称号1.txt` 已存在，则沿用现有回退规则跳转该文件。不会覆盖已有内容。

## 根因及改动

1. 原 DefinitionProvider 只返回已存在文件，DocumentLinkProvider 未识别 Merchant 第一列，缺失文件因此没有可点击创建入口；Ctrl+Q 则已有诊断入口。
2. 原路径逻辑分别维护，使用工作区第一根，可能漏掉当前文档所在的另一套服务端；显式 `.txt` 还会被通用路径分支抢先处理。
3. 新增 `src/utils/merchant-script.ts`，统一第一列、地图名、目标解析和 Market_Def 边界；定义、链接、诊断、代码操作和创建命令复用它。
4. 命中范围使用真实第一列位置与半开区间，支持缩进；第五列的地图定位链接保留。查询/悬停只提供信息，不弹创建框，也不创建目录。
5. 支持中文多层子目录、两种斜杠、可选 `.txt` 及地图 `$` 前缀。找不到源文档自己的 Envir 时不猜测另一套服务端。
6. 拒绝绝对路径、`..`、动态占位和非法路径；通过最近存在祖先的物理路径解析拒绝 junction 逃逸。确认后和目录创建后再次核对边界，以 `wx` 独占创建文件。此为边界加固，不声称对任意并发文件系统攻击具有完全竞态免疫。

## 验证与证据

| 检查 | 结果与范围 |
| --- | --- |
| 修复前原生宿主复现 | 上一轮未改 NPC 的 PAK 候选失败于 `Missing NPC must have a create-file DocumentLink` |
| 编译、lint、PAK 运行时门禁 | 本次正式打包入口自动运行，通过 |
| `npm run test:language` | 全组通过，包含新增 Merchant 路径测试 |
| 包内 Merchant 测试 | `BOO_SCRIPT_RUNTIME_ROOT` 指向候选解包根，通过，不借用工作区生产模块 |
| 路径边界测试 | 中文、扩展名、地图前缀、多服务端、优先/回退、遍历与 junction 拒绝通过 |
| Microsoft VS Code 1.128.0 | GOM、GEE、996PC 的第一列链接、精确范围、第五列地图链接、取消、确认创建/打开、既有文件保留、定义跳转通过 |
| Ctrl+Q | GOM 中实际 `boo.quickFix` 命令独立发出确认，目标与点击链接一致；另外两引擎不重复该项 |
| 查询无写入 | 缺失定义/链接查询不触发确认；取消后目标父目录不存在 |
| 确认期间路径变化 | 测试在确认期间创建越界 junction，创建被拒绝，外部目标未写入 |
| 包内容与依赖 | 1,464 个 ZIP 文件条目逐字节比对，差异/额外项为 0；依赖闭包通过；源码/测试/样本泄漏为 0 |
| 上一轮 PAK 修复保留 | 两份解包目录逐文件比较，只有 `out/assistant.js`、新增 `out/utils/merchant-script.js` 和 `package.json` 不同；其余 1,459 文件相同，包括工作台和格式运行时 |

原生宿主通过独立 probe 驱动实际加载的候选 BOO，确认选项由测试适配。测试使用独立 workspace、user-data、extensions、shared-data、APPDATA 和临时目录；前后核对候选及加载的 193 个生产文件哈希。Microsoft Code.exe 前后哈希相同，退出时只关闭本次独立进程。

本轮没有物理鼠标/键盘验收，不能把命令 API 验证表述成已经按过 Ctrl+左键或 Ctrl+Q。没有再次操作用户实际 PAK；因相关包内文件逐字节不变，复用上一轮已记录的实际文件与 Webview 验收，而不是宣称重测。

本地原始证据（相对于仓库根）：

- 构建汇总：`artifacts/merchant-script-fix-20260927/r1/result.json`。
- 包内测试：`artifacts/merchant-script-fix-20260927/r1/merchant-script-reference-packaged.json`。
- 语言回归：`artifacts/merchant-script-fix-20260927/r1/language-workspace.json`。
- 修复前失败：`artifacts/merchant-script-fix-20260927/native/runs/2026-09-27T05-51-11-212Z-ccf313b8/result.json`。
- 修复后首次通过：`artifacts/merchant-script-fix-20260927/native/runs/2026-09-27T05-56-10-604Z-5b99d2ce/result.json`。
- 补强“Ctrl+Q 必须单独发出确认”及“创建后打开目标”断言后的同包复验：`artifacts/merchant-script-fix-20260927/native/runs/2026-09-27T05-56-57-494Z-e112b1d7/result.json`。

更早两次原生探针失败分别为“误要求 BOO 尚未激活”和“使用不存在的 executeDocumentLinkProvider 命令”，属于夹具问题，原日志保留。最终使用 `vscode.executeLinkProvider`，未为迁就测试削弱产品断言。

## 交付包

- 版本：4.3.6，本地组合候选。
- 路径：`artifacts/merchant-script-fix-20260927/r1/boo-ngom-editor-4.3.6-merchant-script-fix.vsix`。
- 大小：20,824,758 字节，相比上一轮增加 1,543 字节。
- SHA-256：`6869a92449e6684bbf1a1382ccc5cc6f9d0b1935ec65c5365fb2e2c594b33bd4`。
- 扩展解包内容：1,462 文件、57,467,699 字节；545 个构建输入前后稳定，193 个生产文件哈希一致。
- 安装方式：VS Code 扩展面板 → `…` → 从 VSIX 安装 → 选择该文件 → 重新加载窗口。未自动更新默认安装，旧候选仍保留。

本报告仅关闭本轮 NPC 反馈，不代表历史 P0–P6 的全部未开放能力已完成；历史边界继续以原专项清单为准。
