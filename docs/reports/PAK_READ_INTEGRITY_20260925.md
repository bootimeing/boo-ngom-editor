# PAK 正式读取链路完整性修复报告

日期：2026-09-25。版本保持 **4.3.6**。范围是当前源码、编译产物和隔离回归；未重新打包 VSIX、未更新用户安装、未执行游戏客户端验收。

本轮将前置结构检查中的两个确定缺陷修到生产 reader，并开始贯通逐槽状态。**八步整体计划尚未全部完成**；剩余项列在文末。

后续进展：本报告之后已补 direct 按需结果持久化、源内容绑定和可取消全量验证，当前状态以[逐槽状态与全量验证报告](PAK_SLOT_LEDGER_AND_VERIFICATION_20260925.md)为准。下文保留当时的验收范围。

## 修复结果

| 问题 | 本轮处理 | 验收结果 |
| --- | --- | --- |
| GOM 图片负载侵入下一张图头，仍能输出 PNG | 按物理偏移确定下一块边界，同时检查图头与负载；沿用原小比例坏块隔离阈值 | 合成第一图宽度 1→2、物理数据不变时，ID0 被标记 `overlapping-blocks`，ID1 起保留原编号 |
| GEE3 两种入口缺少同类检查 | buffer 与按需 reader 均检查索引区侵入、图头/负载重叠及过短压缩头 | 物理顺序与逻辑顺序不一致的正向样本通过，重叠/侵入样本均拒绝 |
| 解压先产生大量异常数据，之后才比较长度 | 正常 zlib 与 checksum 兼容分支均设 `maxOutputLength`；要求精确输出长度和压缩流完整消费 | 声明 16 字节、实际 1 MiB 被有界解压拒绝；不足输出、额外尾部、拼接流、截断与非法大小均拒绝 |
| 已知坏槽与真正空槽混同 | direct 摘要保存拒绝 ID/原因；legacy 资产保留失败状态、不再生成透明 PNG；asset table 提供 rejected 标记 | GOM ID1260 为 corrupt，ID1655 为 empty；JPK 已擦除图头/坏压缩流也分别保留失败 ID |
| GOM direct 与 legacy 解析来源不同 | legacy 改用同一个本地 GOM reader，保留颜色键透明规则 | 无需启动 bridge，两个路径的 profile 和合法像素一致 |
| 旧缓存可能继续返回假空图 | decoder revision 更新；新 legacy fingerprint 与旧目录隔离，direct 索引升级修订号 | 旧目录不删除；旧修订、丢失坏槽明细、非法 ID、索引与拒绝状态冲突均被拒绝 |
| 首/末槽坏图导致整个 legacy 缓存被判无效 | 缓存完整性门禁识别有明确失败记录的端点 | JPK 首图坏、后图正常仍可使用后续 PNG；缺图且没有失败记录仍不算完整 |
| GOM 所有错误都包装成密码错误 | 分为全局结构、密码或索引不匹配、图片结构异常三个阶段 | 全局不支持不再指责密码；索引不匹配仍明确保留密码/profile/损坏的歧义 |

新解压硬上限为单图 128 MiB，并同时受各已支持 profile 的尺寸与布局上限约束；不是放开任意尺寸。checksum 恢复继续只允许特定校验尾损坏，不能因此保证恢复像素和原始作者意图完全相同。

## 状态语义与消费端

生产资产增加 `decodeStatus`，取值为 `empty / indexed-unverified / decoded / recovered / unsupported / corrupt`，以及可选 `failureCode`；PAK 与 JPK 结果/缓存增加 `profileId`。

- direct 成功建立索引的非空图只标记 `indexed-unverified`，不提前宣称已解码。
- legacy 全量解码后，正常图为 decoded、有限 checksum 兼容图为 recovered。
- 已知结构拒绝槽具有错误状态；`isBlank=false`、`present=0`、`blank=0`。真正空槽仍可生成透明 PNG，保持动画节拍。
- JPK 压缩流失败不丢弃已验证图头中的尺寸和偏移，不伪造 1×1 原始图像。
- direct 单图读取与实际 Worker 对已知拒绝槽返回错误。资源提供器不会将失败放入成功 PNG 缓存，失败后仍可读取后续正常槽。
- Ctrl+F12 资源 Provider 区分“损坏或布局不受支持”与“空槽”，坏图不发布 ready URL。编辑器资源消息不会把无 PNG 路径解析为本地空路径。

**尚未完成的状态闭环：** direct 按需解码后尚未把 decoded/recovered 或运行期负载错误持久化回逐槽账本。全量验证、可取消进度和素材列表状态汇总仍待实现。当前六种状态类型不等于六种状态的全部 UI 生命周期已完成。

## 真实五包验收

只读使用用户授权的标准 PAK 样本目录；密码经 stdin 输入，不保存到脚本、报告或 argv。采用新建临时缓存和隔离的隐藏离线引擎，结束后只关闭本次测试进程并回收本次临时目录。

| 文件 | 结构 profile | 槽位 | 有图 | 真空槽 | 全槽三路径回归 |
| --- | --- | ---: | ---: | ---: | --- |
| GOM.pak | gom-gameofmir2-v2 | 1200 | 832 | 368 | 通过 |
| gee-V8-翎风.pak | gee3-main-v2 | 1200 | 832 | 368 | 通过 |
| 龙族-LZM2-LEG3.pak | hxm2-lz-v1 | 1200 | 832 | 368 | 通过 |
| LEG-360-APPLE.pak | pack4-plain-bgra | 1200 | 832 | 368 | 通过 |
| leg-ksf.pak | pack4-ksf-bgra | 1200 | 832 | 368 | 通过 |

合计 **6000 槽、4160 有图槽、1840 真空槽**。direct、legacy PNG 和实际 Worker 逐槽核对尺寸、X/Y、空槽及 PNG 字节；全部一致。五包均无跳过、无 checksum 恢复、无像素错误，direct 缓存重开通过，源文件 SHA-256 前后不变。

PNG 序列摘要继续与此前基线一致：

- GOM / HXM / 两种 PACK4：`5ff48fb3fbf758a5263f5a6bf990e7a7816fbda8902b16c4ffd8b3072ba9eb42`。
- GEE：`05f37d03f6281d99cf376149565336c00c17884e4a215881c7753984e89f465e`。保留该分支既有透明规则，没有为了相同哈希改变像素。

五个包内容高度对应，不能将其计作五类完全独立的历史像素布局样本。当前桌面未发现先前的 JPK 文件，本轮 JPK 状态回归使用独立合成夹具，不宣称再次完成真实 JPK 语料测试。

## 自动验证与证据

- 22 项针对性回归全部通过，测试名称、文件摘要、耗时与输出见 [最终测试记录](../../artifacts/pak-read-integrity-20260925/tests-final-r2.json)。
- 实际 Edge `153.0.4234.48`：94 个 DOM 元素的既有回归及新增坏图占位断言通过；使用隔离测试页，不是 VS Code 原生键鼠验收，也不是游戏客户端验收。
- `npm run test:pak-variants` 已纳入新的 GOM/GEE3 边界、解压和资源失败回归。
- TypeScript 编译、JS 语法检查和 `git diff --check` 通过；Lint 0 错误、27 个既有警告；`test:layout` 三项通过。布局中的包依赖测试是源码清单门禁，未生成新 VSIX。
- [最终五包全槽像素报告](../../artifacts/pak-read-integrity-20260925/real-pixels-final.json)。
- [最终五包结构报告及当前 reader SHA-256](../../artifacts/pak-read-integrity-20260925/real-structures-final.json)。
- [实际 Worker 与资源失败回归](../../tests/archive-rejected-slots.test.js)。

首次新增三个负向用例均按预期暴露旧问题。过程中另发现旧 Provider 测试 mock 缺 `Uri.from`、静态测试依赖旧源码字面串，以及端点失败槽被当缓存不完整；前两项修测试适配，后一项补生产门禁并以 JPK 回归确认。没有通过放宽错误图像断言消除失败。

## 仍未完成及下一顺序

| 优先项 | 当前剩余内容 | 原因/处理方向 |
| --- | --- | --- |
| 1. 状态账本闭环 | direct 解码/恢复/运行期失败的持久化、可取消全量验证、简洁状态 UI | 可实现，尚未完成；与现有 Worker 并发和源指纹失效保持一致 |
| 2. 错误/profile 完整统一 | 所有 reader 使用统一结构化错误，完整阶段/偏移/长度；仅在已确认分支识别精确原因 | 本轮仅完成 profile 落盘和 GOM 阶段区分，不把歧义当已证实密码错误 |
| 3. HXM/Lz 布局 | V0、pf15bit、特殊 4-bit alpha | 有部分源码依据，但实现、独立像素向量和相应实样尚未完成 |
| 4. 其他历史变体 | PACK4 其他 type/压缩布局、空 KSF、GEE legacy 真实 X/Y、GEEM2 | 缺相应可信结构和真实样本；不扫描猜图或放松边界冒充兼容 |
| 5. 发布验收 | 新 VSIX、真实 VS Code 操作、指定客户端对照 | 本轮未打包/安装；需要在功能收敛后单独验收 |

完整八步验收要求继续见 [整体计划](PAK_COMPLETE_DISPLAY_PLAN_20260925.md)。本报告按诊断、绘制审计及文档技能，将结构通过、像素一致、Provider 行为、浏览器渲染与最终安装/客户端验收分别记录。
