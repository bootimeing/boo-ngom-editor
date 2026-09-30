# PAK 可追溯结构阶段实施结果

日期：2026-09-25。版本号保持4.3.6；本轮为工作区源码与诊断工具交付，未重建VSIX、未替换安装、未执行客户端验收。

> 本文保留前置阶段结果。后续已将 GOM/GEE3 重叠校验、有界解压和已知坏槽状态接入生产读取链路，详见 [后续修复报告](PAK_READ_INTEGRITY_20260925.md)；下文“尚未改造”均指本前置阶段当时范围。

## 已交付

1. [结构规范第一版](../specifications/PAK_STRUCTURE_CONTRACTS_20260925.md)：全局头、V0/V1索引及图片头、各读取分支、来源等级与未知边界。
2. [源码证据清单](../specifications/pak-source-evidence.json)：六个GXX参考文件SHA-256及关键调用位置，可用只读脚本重新核对。
3. `src/utils/pak-structure-contracts.ts`：九个确定ID的机器字段合同，未知ID拒绝；不以品牌名泛化。
4. `src/utils/pak-structure.ts`：使用现有生产reader的只读检查接口，逐槽报告真实位置、空槽、拒绝块、结构重叠和未归类字节。报告包含输入文件与执行JS的摘要。
5. `tools/pak/inspect-structure.js`：stdin密码输入、报告排除密钥、只新建报告、不启动进程、不写缓存、不改原素材。使用方法见 [指南](../user-guide/PAK_STRUCTURE_INSPECTION.md)。
6. `tools/pak/verify-source-evidence.js`：只读校验明确指定的GXX源码根，不编译或执行原源码。

## 本轮生产修正

HXM全局头版本由4字节读取改为单字节，三个保留字节独立记录；依据是源码结构及 `Initialize` 的实际版本分支。`CheckCode:string[12]` 的长度检查由最多16改为最多12。真实样本和非零保留位的独立夹具均通过。

新接受的非零保留位文件在旧读取器中会被拒绝，不存在合法旧缓存可直接复用；原先可成功读取的HXM有效像素语义未改变。本轮没有为这一字段修正强制失效所有归档缓存。

GOM/HXM/PACK4 reader增加不含密钥的结构元数据。GOM补充拒绝块的ID、图头位置和脱敏原因代码，用于检查报告；没有改变原容忍阈值。GEE检查复用原文件读取与profile获取函数，未复制另一套解密算法。

## 能检查什么，不能据此声称什么

| 检查器行为 | 完成情况 | 边界 |
| --- | --- | --- |
| 结构来源与字段地址 | 已实现 | 解密后的相对地址与物理文件地址分开报告 |
| 空槽与GOM被拒绝块 | 已区分并保留原ID | 生产画布/缓存消费者的旧空图表现尚未整体改造 |
| 相邻区段重叠 | 检查器已检出合成GOM重叠 | 不是已修复所有生产reader的重叠处理 |
| 未解码的GEE legacy坐标 | 检查器输出null | 原绘制路径仍待对应样本和后续修复 |
| 全图像素验证 | 另行执行既有全槽回归 | 结构检查本身始终标明pixels=not-run |
| HXM V0 / pf15bit / 特殊alpha、更多PACK4布局 | 未新增解码支持 | 结构依据与未知项已登记，不能称全部兼容 |
| 通用解压输出上限 | 本轮未改 | 仍是此前计划的生产修复项 |
| 最终VS Code / 客户端展示 | 本轮未验收 | 没有增加已发布的界面入口 |

GXX旧代码不能全部直接采用：`WriteHeader`被原作者标注为有明显问题且未使用；`ReadLzImageHeader`在注释内。规范明确排除它们作为活跃写入/读取的证明。

## 本轮验证

### 真实五包

使用当前工作区编译运行时，对用户授权的标准 PAK 样本目录只读核验。

| 样本 | profile | 槽位 / 有图 / 空槽 | 结构问题 | 全槽像素回归 |
| --- | --- | --- | ---: | --- |
| GOM.pak | gom-gameofmir2-v2 | 1200 / 832 / 368 | 0 | 通过 |
| gee-V8-翎风.pak | gee3-main-v2 | 1200 / 832 / 368 | 0 | 通过 |
| 龙族-LZM2-LEG3.pak | hxm2-lz-v1 | 1200 / 832 / 368 | 0 | 通过 |
| LEG-360-APPLE.pak | pack4-plain-bgra | 1200 / 832 / 368 | 0 | 通过 |
| leg-ksf.pak | pack4-ksf-bgra | 1200 / 832 / 368 | 0 | 通过 |

总计6000槽；结构可归类区段覆盖文件全长，未分类空隙为0。**这不代表全局头每个保留字段的语义都已理解。** 原文件摘要前后不变。

独立全槽回归比较direct、legacy、实际Worker的PNG、尺寸、偏移、空槽及缓存重开；五包的PNG序列摘要与上一轮基线相同。没有跳过、checksum恢复或像素错误。

首次未启用桥接的检查中，GEE包未完成检查；报告保留该事实。随后使用隔离、隐藏窗口的本机离线引擎完成五包检查，并在验证结束后关闭该测试进程。工具自身仍不会隐式启动引擎。

### 自动测试

- `npm run test:pak-variants`：HXM/PACK4独立RGBA、Worker、缓存与负向夹具；新增结构来源、只读CLI测试。
- HXM非零保留字节通过direct/legacy/Worker全槽像素与缓存回归；超出12字节的校验字段拒绝。
- `gom-reader-tolerance`、`geepak2-parser`、`archive-index`、`pak-format`、`patch-cache`通过。
- `pak-pixel-contract`、`pak-inflate`及`test:asset-consumers`四项通过。
- 编译通过；Lint为0错误、27个既有警告；`test:layout`三项通过。
- 六份GXX源码摘要与清单全部匹配。

结构测试覆盖：逻辑ID与物理顺序不同、压缩索引的解码后位置、负偏移、空槽/坏块区分、GOM重叠、未知签名拒绝、报告数量限制、密码不落入报告、已有报告与原文件不能被覆盖。

## 可复核工件

- [最终真实结构报告](../../artifacts/pak-structure-implementation-20260925/real-structure-verified.json)
- [最终当前源码全槽像素回归](../../artifacts/pak-structure-implementation-20260925/real-pixel-final.json)
- [首次不启用离线引擎的检查记录](../../artifacts/pak-structure-implementation-20260925/real-structure-corpus.json)
- [结构回归测试](../../tests/pak-structure.test.js)

本轮保留所有先前未提交改动；未重写真实PAK、未清用户缓存、未修改VS Code安装、未升版或发布。按文档整理技能将字段规范、工具操作和实施结果分开，以免“有依据的结构”“已实现功能”“已经验收”混在一起。

下一阶段仍按 [完整展示方案](PAK_COMPLETE_DISPLAY_PLAN_20260925.md) 推进：将这些状态与边界检查接入生产缓存、资源提供器及画布，再补充尚缺布局。
