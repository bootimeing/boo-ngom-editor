# 补丁资源工作台 P1：实现与分层验收

日期：2026-09-26。版本：4.3.6，本地候选标识 `resource-p1-r1`。

## 后续调整：工作台留在编辑区

按用户后续要求，资源工作台改为当前 VS Code 窗口内的编辑区标签页，移除自动浮窗计时器、命令调用和回退提示；同包重复打开仍复用标签页。UI 编辑器与 Ctrl+F12 的窗口行为不变。下文 P1-r1 的独立窗口描述和原生结果属于旧候选历史记录，不能视为此次变更后的验收。

Provider 回归已先在旧编译代码上确认失败（首次 ready 后发现了浮窗命令），再在新代码上通过。测试等待超过旧 350ms 延迟，覆盖首次/重复 ready、页面重建、关闭/重开；不清计时器掩盖行为。生产哈希对比确认，相对 P1-r1 只有 `out/providers/resource-editor.js` 变化。

此窗口改动不涉及素材格式、像素、导出或写包；不重复将上一轮真实 PAK 和原生宿主结果称为新候选的本轮实测。自动浮窗已不属于当前工作台需求。

本次新候选为 `artifacts/resource-editor-20260926/p1-r2/boo-ngom-editor-4.3.6-resource-p1-r2.vsix`，大小 20,769,451 字节，比 P1-r1 小 240 字节；SHA-256 为 `a1567a6fb1e0e3becf40b20c049b5b61fe90a93c89574b8ab3e1bfd0528be676`。版本仍为 4.3.6，旧包保留，未更新默认安装或商店。

P1-r2 的打包门禁（lint、compile、运行时检查）、解包依赖闭包、ZIP 字节比较以及包内 model/export/provider/browser、archive-inspection、archive-errors、ui-brand-resource、ui-window-lifecycle 全部通过。533 项实际构建输入和 181 项生产/资源哈希在构建与验包期间保持一致，包内禁含项为 0。证据为该候选目录的 `result.json` 和逐项 JSON。本轮未重复原生宿主/键鼠或真实包全量导出验收。

## P1-r1 历史实施与验收

**结论：浏览/导出功能已实现并形成可安装候选；整个资源编辑计划尚未完成。** 本轮没有资源包导入、偏移写回、撤销/重做或资源包另存能力，也不以按钮占位宣称具备这些功能。P0 和 P1 仍有真实样本及原生交互验收边界，P2–P6 按原计划继续。

本报告是供查证的实施/测试参考；实际使用步骤见 [操作指南](../user-guide/PATCH_RESOURCE_WORKBENCH.md)，范围与后续顺序见 [整体计划](../plans/PATCH_RESOURCE_EDITOR_PLAN_20260926.md)，首次读取基线见 [P0 报告](PATCH_RESOURCE_EDITOR_P0_20260926.md)。P0 的“待执行”记录是采集时状态，由本报告补充，不改写历史结果。

## 1. 实际交付范围

| 能力 | 本轮结果 |
| --- | --- |
| 打开入口 | 补丁管理中已缓存 direct 高速索引条目的“素材”；命令 `BOO: 打开补丁资源工作台` |
| 工作台 | 左侧列表、中间图像、右侧只读属性和导出；使用 `resources/icon.png`，精简标签 |
| 浏览 | 每页 100 个逻辑槽；ID 0/末槽定位后保留整页邻近素材；空槽、损坏、不支持单独显示 |
| 多选 | Ctrl 多选、Shift 连选、跨页保留、选本页、清选择；手选上限 10000，范围/全包导出不受该手选上限限制 |
| 预览 | 棋盘/黑/白背景，50%–800%缩放，原点及已知偏移；拖动只平移视口，不改包内坐标 |
| 导出 | 当前/选中/范围/全包，PNG 与 `boo.archive-export.v1` 清单，进度与取消 |
| 状态安全 | document/session/request ID、已退休文档拒绝、索引 generation 与源变化检查，迟到图片/消息不能覆盖当前状态 |
| 窗口 | 首次打开尝试宿主独立窗口命令；不支持则留在标签页，同包同版本复用面板 |

当前只接入已有 direct 高速索引；旧版 PNG 缓存不能直接变为可操作会话。包变化后需在补丁管理重载。窗口移动实现已存在，但本轮真实宿主探针主动抑制浮窗，不能将其写为原生跨窗口验收通过。

## 2. 导出完整性与安全边界

- 文件名保留逻辑 ID；空槽不生成假 PNG，损坏/不支持/失败槽进入清单而不挤动后续编号。
- 清单保留 ID、状态、解码后源状态、宽高、X/Y、像素/压缩/Alpha 信息、PNG SHA-256、源包及伴随索引前后 SHA-256。未知偏移是 `null`，不是伪造的 0。
- 不输出密码、密钥、凭据哈希、源文件绝对路径或原始异常文本。该清单是 BOO 自有 schema，不宣称兼容原版 GM 坐标文件。
- 宿主选择目录后创建唯一 `boo-export-…` 子目录；PNG 校验容器/尺寸/CRC，暂存后以不覆盖已有文件的方式发布。无硬链接的文件系统使用 `COPYFILE_EXCL` 回退并核对哈希。
- 元数据每批最多 100 项，清单流式写入；“百万槽范围”测试不构建百万条富对象或百万项选中数组。
- 取消停止后续图片处理，但仍完成源文件结束哈希审计；大包取消收尾不保证立即返回。取消/部分失败保留输出并标明 `cancelled`/`partial`，不能当作完整备份。
- 磁盘或清单写入失败不会报告完整成功；可能留下 `.incomplete` 或不完整清单。只保留本次新建输出，不自动删除用户目录。
- `boo-archive:` 仍为只读；Webview 不能提交任意本地写路径、密码或写包命令。未引入 GM EXE、VM snapshot、外部 writer 或新的运行依赖。

## 3. 验收结果及证据层次

| 层次 | 实际执行 | 结果及不代表的内容 |
| --- | --- | --- |
| 源码/静态 | TypeScript 编译、ESLint、`git diff --check` | PASS；不等于客户端验证 |
| 新专项 | `test:resource-editor` 的 model/export/provider/browser 四项 | PASS；export 为 16 组，Provider 用模拟宿主但执行生产编译代码 |
| 关联回归 | patch-manager、patch-verification-provider、patch-verification-browser、webview-security、ui-regressions | PASS；浏览器 runner 曾遇 Edge 无 DOM，随后 Chrome 通过，不能写成两个浏览器全通过 |
| 最终包 | 解包依赖闭包、ZIP 字节核对；包内四项新专项及 archive-inspection、archive-errors、ui-brand-resource、ui-window-lifecycle | 全部 PASS；生产文件从解包候选读取，不回退工作区 |
| 实际 Chromium DOM | 900×700、1100×800、1440×960；加载图标/合成图像、定位、多选、迟到回包、导出/取消意图、资源 URL 安全矩阵 | PASS；不是原生 VS Code 鼠标键盘 |
| 实际截图 | 四张生产 HTML 截图，覆盖 900 棋盘、900 白底范围、900 损坏、1440 棋盘 | 逐张目视检查通过，无关键控件重叠/裁字；合成 PNG 与宿主协议已明确标注 |
| 真实 VS Code | Microsoft VS Code 1.128.0 的独立 Extension Host/Webview，实际候选 Provider 与资源 URI，生产 Worker 导出 | 有限范围 PASS，详见下一节 |
| 真实用户 PAK | 两份固定身份 PACK4 样本，全量导出，逐图 PNG 字节/清单核对，源 SHA 前后一致 | 两包 PASS，详见第 5 节；不是 GM/客户端独立像素基准 |

未运行全量 `test:all`。本轮选取新增链路、补丁管理、安全和素材相关回归；没有用“全项目测试全绿”描述有限检查。

## 4. 真实 VS Code 的覆盖范围

候选复制到独立临时 extensions 目录，由真实 Microsoft 签名的 VS Code 1.128.0 激活。代码、版本、安装路径和 181 项生产/资源哈希核对通过；默认 `Code.exe` SHA 前后相同。独立 user-data、extensions、shared-data、APPDATA、LOCALAPPDATA、TEMP；实际日志确认 shared storage 落在本次临时 shared-data 中。没有改注册表、默认安装或清默认缓存；结束时仅停止此次唯一临时运行根的新进程树。

临时 PACK4 夹具：256 槽、3 张图、253 空槽。实际结果：

- 生产 Provider 接收 ready、inspect(0)、jump(255)、page(100)、jump(0)，未由替代 handler 代办。
- 首页 0–99 共 100 项，中页 100–199 共 100 项，尾页 200–255 共 56 项；定位不丢邻图。
- 真 Webview 图标与 32×16 资源图加载；ID 0 偏移为 (-23,17)，尾图为 (-23,14)；2 倍缩放位置 (-46,28)，图像 64×32。
- 导出服务调用真实 Worker：3 张 PNG、253 空、0 失败，ID 为 0/2/255；清单/PNG 与生产 reader 一致，源 SHA 不变。

边界：操作输入为 DOM 合成 click/submit/change；没有原生键鼠、目录选择框、自动浮窗移动或游戏客户端测试。导出是直接调用实际服务，不冒充用户点击原生目录选择框。首屏 52.8ms、合成流程 185.5ms 仅是这台机器的单次小夹具记录，不代表大包或冷盘指标。

## 5. 两份真实 PACK4 全量导出

| 样本 | profile | 总槽 | PNG | 空槽 | 失败 | 源文件未变 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| LEG-360-APPLE.pak | pack4-plain-bgra | 1200 | 832 | 368 | 0 | 是 |
| leg-ksf.pak | pack4-ksf-bgra | 1200 | 832 | 368 | 0 | 是 |

两包累计 2400 槽、1664 张 PNG、736 空槽、0 失败。每张 PNG 与清单 SHA 一致，并与**同一候选生产 reader**逐字节一致；这验证导出传递未丢图/改号，不是独立客户端解码正确性的证明。

源 SHA-256：

- `LEG-360-APPLE.pak`：`f6a58a149ca6556fa1819a7264e39e84cf36ff6af554483103d1300859499c30`
- `leg-ksf.pak`：`87bfbe6723d7d7d4877a9d9fecde5a9e5fefa0735b5aa03e3a7430326ff3adf8`

KSF 的密码只通过本轮受控隐藏 stdin 提供，不写入工具脚本、进程 argv、日志、报告或导出清单。用户原 PAK 仅被读取，没有转换、修改或自动重建。

## 6. 已复现并修正的问题

1. **生产：旧文档迟到 ready 复活。** 先由 Provider 测试复现，再增加已退休 document ID 的拒绝；保留有效重建页面的状态重放。
2. **生产：真实 VS Code 资源域名被误拒。** 原白名单遗漏 `boo-archive+…` 的加号，补精确主机语法；验证合法域名、伪后缀、userinfo、任意子域/非默认端口，真实宿主加载已通过。
3. **生产：导出完成通知等待用户操作可能延长 busy。** 通知改为非阻塞，完成/取消后独立释放 busy。
4. **测试工具：原生 hash map 漏图标。** 初始 map 只含 out/media/data；从构建时固定的 inputs 摘要核对 resources 后生成附加 map，没有重新写候选包或伪造旧记录。
5. **测试工具：URI query 编码假设。** 真实 VS Code 把 `generation=` 序列化为 `generation%3D`；探针改为解码一次后严格核对完整 generation，保留首次失败。生产 query 无需修改。
6. **测试工具：KSF 漏密码。** 首轮一包通过，KSF 在打开阶段返回 password-required。补受控 stdin、失败证据和 finally 后，新目录复跑两包通过；不把该问题算成 PAK 兼容修复。

其他测试修正包括滚动区视口断言只约束固定控件、导出逐图状态回读后仍逐次校验查询长度不超过 100。没有为了通过而删掉逻辑 ID、取消、源变化或完整性断言。

## 7. 本地候选与产物完整性

- 文件：`artifacts/resource-editor-20260926/p1-r1/boo-ngom-editor-4.3.6-resource-p1-r1.vsix`
- SHA-256：`d205c41ec1477f01ea0a598e9ed1f97c247ee0f3e33e1aeb7209fdbcbaf270bc`
- 大小：20,769,691 字节；上一份 UI 候选为 20,748,367 字节，本轮增加 21,324 字节。
- ZIP 共 1452 条，extension 内 1450 文件、57,274,724 字节；不应发布的根级 artifacts/tests/src/docs 等条目为 0。
- VSCE 实际选择输入 533 项，构建前后及候选测试后相同；候选生产哈希与工作树/临时安装核对通过。
- 保留旧包；未更改版本号、未安装到默认用户环境、未替换 VS Code、未提交/推送/建 tag/发布商店。
- 这是脏工作树当前生产闭包的本地候选，不是某个已提交 SHA 的远端发布证明；没有重置或暂存用户既有修改。

## 8. 本机可复核证据

以下相对路径均从项目根开始，位于本地 artifacts，不属于 VSIX 分发内容：

- `artifacts/resource-editor-20260926/p1-r1/result.json`、`build-inputs.json`、`native-production-hashes.json`、各专项 JSON：构建与包内验收。
- `artifacts/resource-editor-20260926/final-audit-p1-r1.json`：收尾再次核对 533 项构建输入、181 项生产/资源哈希、全部 1664 张导出 PNG、两份原包 SHA 和文档链接，全部通过。
- `artifacts/resource-editor-20260926/native/RESULTS-P1-r1.md`：原生结果摘要。
- `artifacts/resource-editor-20260926/native/runs/2026-09-26T09-59-24-594Z-6d8dfaee/`：首次 URI 探针失败。
- `artifacts/resource-editor-20260926/native/runs/2026-09-26T10-00-47-149Z-d5ce59b1/`：成功原生 result/wrapper-result。
- `artifacts/resource-editor-20260926/real-p1-r1/failure-observed.json`：真实样本首轮漏密码记录，成功的第一包导出仍保留。
- `artifacts/resource-editor-20260926/real-p1-r1-retry/result.json`：两包成功复测及逐包清单路径。
- `artifacts/resource-editor-20260926/appearance/run-2026-09-26T09-55-22-946Z/`：四张截图、DOM 记录和视觉检查说明。

## 9. 尚未完成与下一阶段

下一主线是 **P2：已确认 JPK 分支的导入、偏移调整、撤销/重做、另存与 reader 回读**，不是继续增加无作用按钮。开始开放写入前仍要固定真实样本、审查 writer 来源/依赖，并通过未改槽保真、原包不变和失败不发布门槛。

后续还有 P3 分 profile 可写适配、P4 批量与缓存联动、P5 动画/图像增强、P6 原生交互/性能/失败恢复与最终交付。本轮不承诺全部格式可写、GM 功能完全替代或有密码即可恢复损坏数据。

P1 的自动浮窗、原生输入/目录选择框、全 profile 真实导出矩阵、大包冷盘/P50/P95/峰值内存仍未全面验证；百万槽有界选择测试不等于百万张图真实全量导出。
