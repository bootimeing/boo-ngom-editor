# 补丁资源编辑器 P0：读取基线与安全验收设计

日期：2026-09-26。采集时间：17:44–17:46（Asia/Shanghai）。工作区版本：4.3.6。Node.js：v24.14.0；npm：11.9.0。

**状态：本轮指定读取基线通过；P0 尚未整体闭环。** 本报告固定的是资源编辑新功能进入实现时的有限基线，不是资源导入、偏移写回、保存或所有 profile 的验收报告。

## 1. 范围与实际动作

- 执行 TypeScript 编译及下表七项 targeted 测试，没有运行全量多小时套件。
- 指定测试使用各自临时目录里的合成样本、真实 Node Worker、静态断言或模拟 VS Code 宿主；没有测试写入用户原始资源包。
- 对标准 PAK 样本目录中的五份用户样本仅做文件信息与 SHA-256 读取；没有重新解码、转换、修复或保存这些包。
- 本轮没有复制 GM 源码、VM snapshot、历史编辑器代码或第三方二进制；没有安装依赖。新增资源编辑器的其他实现工作并行进行，不能把本报告当作对其完成状态或最终依赖的审计。
- 当前工作树含大量已有未提交修改。本报告未重置、暂存或覆盖它们。执行编译会更新正常编译输出；本子任务唯一手写文件为本报告。

## 2. 本次实际测试结果

| 命令 | 结果 | 实际证据范围 |
| --- | --- | --- |
| `npm run compile` | PASS，退出码 0 | 此次编译时工作树可编译；并行新增文件随后仍须重新编译 |
| `node tests/archive-index.test.js` | PASS，退出码 0 | 合成 JPK 的逻辑槽位、空槽、偏移、direct/兼容缓存 PNG 一致、真实 Worker、缓存重开 |
| `node tests/archive-inspection.test.js` | PASS，退出码 0 | 有界槽位查询、实时状态账本、generation/源变化保护、元数据、敏感字段隔离 |
| `node tests/archive-errors.test.js` | PASS，退出码 0 | 输出确认 32 个识别故障点，以及未知格式/传输错误的安全分类；不代表 32 种真实格式均通过 |
| `node tests/archive-rejected-slots.test.js` | PASS，退出码 0 | 真实 Worker 错误、拒绝槽位保留、不生成伪正常 PNG、缓存迁移、源数据不写回 |
| `node tests/patch-manager.test.js` | PASS，退出码 0 | 静态契约：入口、密码安全存储、按引擎状态、路径发现、读取/异常及空槽约定；不是原生 UI 操作 |
| `node tests/patch-verification-provider.test.js` | PASS，退出码 0 | 模拟宿主下的真实 Worker 验证、列表路径限制、取消/恢复、详情、过期报告与 LRU |
| `node tests/webview-security.test.js` | PASS，退出码 0 | 公用 Webview 安全辅助函数的 CSP/nonce 等断言；不自动覆盖随后新增 Provider |

七项测试均独立进程执行，各自临时 fixture 清理由已有测试完成。结果没有 SKIP，但这是选定七项的结论，不是全项目无 SKIP 或资源编辑流程全通过。

## 3. 已有读写分离基线

1. `src/utils/archive-resource-provider.ts` 中 `boo-archive:` 是只读虚拟文件系统。`writeFile`、`delete`、`rename` 和 `createDirectory` 均拒绝操作，`watch()` 当前也不是自动同步外部修改的文件监听器。
2. `src/utils/archive-index.ts` 的 `openArchiveIndexed`、`readArchiveImagePng`、`inspectArchiveSlots` 提供索引和图像读取。索引缓存写盘不构成 PAK/JPK/WIL/WZL 的安全保存能力。
3. `src/utils/archive-index.ts` 的源身份包括路径、尺寸、mtime/ctime、SHA-256、generation，成对格式额外绑定伴随索引。`assertArchiveReadCurrent` / `assertArchiveSourceCurrent` 拒绝过期读取。
4. `src/utils/archive-image-metadata.ts` 明确表示归一化读取契约，不是原始包所有未知字段。`gee3-legacy-v2` 的偏移为未知，不允许新功能将其默认为已知 0。
5. `src/utils/archive-types.ts` 读取家族包含 GEE、GOM、HXM、PACK4、JPK、WIL、WZL。扩展名或“能显示 PNG”不构成可写 capability。
6. `src/providers/patch-manager.ts` 原基线仅管理读取、缓存、密码输入和逐图验证。其“密码”操作更新读取凭据，不会修改归档密码；UI 编辑器“快捷导入”也不是写入归档。
7. 素材主列表为虚拟滚动，100 项分页位于素材选择器/进度条设置；新资源工作台统一 100 项应作为新实现验收，不倒写为已有主列表形式。

## 4. 真实样本身份固定

以下五包均来自标准 PAK 样本目录。本轮只读 hash 与现有标准样本报告记录一致。profile 栏来源是此前已有报告 `PAK_COMPLETION_20260926.md`；本轮未重新解析 profile，也没有测试 writer。

| 文件 | 字节 | 历史报告 profile（本轮未重验） | 本轮 SHA-256 |
| --- | ---: | --- | --- |
| GOM.pak | 3,056,493 | gom-gameofmir2-v2 | `41a49afa77e74ddbce8c31bf890dc08c014eefd27ed9b8994232fac19398d453` |
| gee-V8-翎风.pak | 3,056,490 | gee3-main-v2 | `b2c55b48ff4a7b10baa1c43195c5a68b01a672168d37a3c66f802d00ba5ad3f2` |
| 龙族-LZM2-LEG3.pak | 3,056,486 | hxm2-lz-v1 | `43d351edf2788e8822b14065c6bd41e160664260f776b4ddf734398547cf166d` |
| LEG-360-APPLE.pak | 4,072,994 | pack4-plain-bgra | `f6a58a149ca6556fa1819a7264e39e84cf36ff6af554483103d1300859499c30` |
| leg-ksf.pak | 4,073,009 | pack4-ksf-bgra | `87bfbe6723d7d7d4877a9d9fecde5a9e5fefa0735b5aa03e3a7430326ff3adf8` |

### 仍需固定的样本

- JPK：此次检查桌面根目录没有原先提到的 Mon4013/Mon4024/Mon4028.jpk。应在确定当前路径后固定 hash；不能拿历史名字或桌面五个 PAK 代替 JPK 编辑验收。
- GAMEOFMIR 老分支与 GEEPAK3 legacy：此次未定位/固定真实样本；新 GAMEOFMIR2 和 main 样本不能替代它们。
- WIL/WIX、WZL/WZX：此次未固定真实成对样本；需要对主文件和伴随索引同时记录身份，按组验收。
- HXM V0、GEE 其他分支和特殊 WIL/WZL：仍须按 profile 单列真实样本与证据，不从合成向量推断完整客户端支持。
- 样本后续编辑测试必须使用测试副本，测试前后复核原包 SHA-256；用户密码不写入报告、命令行、导出清单或版本库。

## 5. 代码与依赖 SHA 基线

这是上述采集时刻的工作树快照，不是 Git 提交。并行实现会合理改变 Provider/manifest；后续应追加实现后证据，不能将新 hash 冒充此次基线。

| 文件 | SHA-256 |
| --- | --- |
| package.json | `1a85c3719e334ebc77301e95ccb9da474e6d536e397143ebcd731d7c0ad87c01` |
| package-lock.json | `9f11f19de4c53b1f19f2e99e1bc7ff1f00554790c2a9cd1d8705fadc5541b720` |
| src/utils/archive-types.ts | `12d9c0d2b7eb2b685d8a027acfd13610a31f7e92450560f023cde5c8c8175d50` |
| src/utils/archive-index.ts | `d10fba4f1a93c0987df68903b80a9e26d3c6b0f73c907453cb7bbf42bf8e271d` |
| src/utils/archive-resource-provider.ts | `0132b7d47bd80a89563a7b9ce6590c9493e091d895d504882570f3c9c056934f` |
| src/utils/pak-reader.ts | `c67660ece967580731bd8c833da4d66d8a5a2f4628314c39376b50e3bae84bef` |
| src/utils/jpk-reader.ts | `3930777a613b6c52d6c61d433a85001a812f6f09636e45e0aafd21b767765a6e` |
| src/utils/patch-cache.ts | `1b154ecc1ded91c8fdeac15fb82353582051bd1d17a43a3619d25f13910e5f54` |
| src/utils/archive-image-metadata.ts | `236c54aceeff67703695e82f231190a1c7ec4754bf77a114ee64f5e3c0654792` |
| src/providers/patch-manager.ts | `65b900f524124ec6168b20f5c37de5b938670f8baeb441528f3a546b9a2ead58` |
| media/patch-manager.html | `8ecb97e760dcaebcbe6ce681c5d85ad521ae54ebbfa18ebd4ffd06fa632e4e37` |
| tests/archive-index.test.js | `ebc2f9330f79a3766ac7005ea8d08bd29f1848cf9514dc5922255f96c04d2846` |
| tests/archive-inspection.test.js | `d7a5535e8b67184e5a2697fdae402c0af3bf5cfba2f8efcabbd4a3c15460a311` |
| tests/archive-errors.test.js | `c1fff017c432e4c9a78ebce5e5981407e520d5b154ef05f478d3fe9fad0d3ebf` |
| tests/archive-rejected-slots.test.js | `5b5c26aa3261702c67a70170b6d6970f416426346432cffcd5100a58deac3b1f` |
| tests/patch-manager.test.js | `2ffd86aeb6bf0bbf7d23413c0586901069445464b08a217d7cdb6eed90f542a5` |
| tests/patch-verification-provider.test.js | `06cde02128fb334e006215d2b386757e8631ab4d9a4f61c281d6c67535b825d7` |
| tests/webview-security.test.js | `b0833e210be7a89236819fcfd0e2bb91907a984a5a33a6e1c330ba389a92b55b` |

主工程 `package.json` 与根 `LICENSE` 声明 MIT，版权行是 `Copyright (c) 2026 BOO Visual Editor`。这是主工程声明，不是所有历史代码/二进制/参考程序的统一许可证明。当前生产依赖为 iconv-lite、mdb-reader、sql.js、xlsx；本任务未新增或升级它们，也未重新做全部传递依赖许可审查。

## 6. 来源与再分发门槛

本轮只使用主工程已有读服务开展新功能基线，未引入新的外部代码。计划涉及 GM 本地 writer、旧 BOO 原型、VM snapshot 等，必须分别核对来源和再分发条件：

1. 自主源码权属与第三方许可不能仅由项目路径或“本机可运行”推断。
2. 未确认许可/来源的二进制、受保护程序抽取内容不能直接并入新 writer 或 VSIX。
3. 复制既有模块时保留版权/NOTICE，并独立验证当前主工程生产 reader 能读取候选输出，不能仅由旧项目测试推断正确。
4. 本报告未确认任何外部 writer 的完整许可证闭包，未将任何 profile 标为已获准分发或已完成可写验收。

## 7. 新 Provider 的独立集成测试设计

下列是待新增/待执行验收，不是本轮七项旧测试已覆盖的内容。

| 区域 | 需要的测试与拒绝行为 |
| --- | --- |
| 打开入口 | 侧栏打开只接受当前 entries 的路径；命令/文件选择对话框选择的路径与 Webview 任意路径分开；manifest 激活与命令注册一致 |
| 受限消息 | 错误 sessionId、过期 revision、负数/浮点/越界 ID、无效范围、超大数组、未知动作、任意路径均拒绝；不能由 Webview 自报 capability 授权 |
| 异步会话 | 打开对话框后切包/销毁/移动窗口、Worker 后到、取消后回包，不能回写新会话；捕获请求发起时的 panel/session/generation |
| 独立窗口 | 移动窗口导致 DOM 重建时 ready 重放当前会话，保留包、选择、页码、缩放；不支持独立窗口时回退编辑区，不声称已移动 |
| UI 操作 | 导入/偏移写回在尚未实现时禁用且短说明；展示偏移与改变归档偏移分开；焦点在输入框时 Delete/Ctrl+Z 不穿透 |
| 导出安全 | 宿主选择目录；文件名来自校验后的逻辑 ID；清单无密钥；原包/草稿选择明确；PNG/清单失败与取消不发布伪成功目录；覆盖现有目标另行确认 |
| 源身份 | 导出前后检查源版本，期间发生外部修改则失败；同时验证成对索引；ID 不因空槽、坏槽或筛选改变 |
| Webview 边界 | 独立 CSP nonce、有限 localResourceRoots、无密码传入、HTML 转义、错误路径不变成资源协议；既有 boo-archive 仍只读 |
| 有界任务 | 每个任务有 busy/cancel/finally；不将整包 Base64 送 Webview；消息和预览限制；错误/取消后可重试 |
| 保存阶段 | 源身份、另存、回读、像素/元数据/未改字段、双文件事务、故障注入、按包缓存失效单独测试；P1 导出不提前代表此项通过 |

Provider 到位后应执行独立源码复核、受限消息测试、实际导出 fixture 回读及窗口状态测试。原生鼠标键盘、候选 VSIX、GM 参考程序和游戏客户端分别记录；模拟宿主和浏览器合成事件不代替它们。

## 8. 未闭环项

- 尚未重新执行各真实 profile 的读取/导出矩阵，也未测试任何归档 writer。
- 尚未固定当前真实 JPK、老 GOM、GEE legacy 及 WIL/WZL 配对样本。
- 尚未完成新 Provider、独立窗口和导出服务的本轮集成测试；它们在并行实现中。
- 尚未核对最终 worker、外部复用代码与 VSIX 依赖/许可闭包。
- 尚未做原生 VS Code/GM/客户端交互验收、性能长尾或保存失败注入。

因此本轮可准确表述为“指定旧读取基线全部通过，五份标准 PAK 原样固定身份，读写分离和新 Provider 验收门槛已建立”，不能表述为“P0 全部完成”或“资源编辑器已完整实现”。
