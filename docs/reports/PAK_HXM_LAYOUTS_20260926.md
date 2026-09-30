# HXM/Lz确定布局实施与验收报告

日期：2026-09-26。工作区版本：4.3.6。交付层级：源码与自动化回归；本轮未生成或安装VSIX。

## 本轮结论

HXM/Lz V0的8字节索引、12字节图头、全局8/16/24/32位色深，以及raw/zlib/确定行对齐RLE已接入生产读取器、direct索引、legacy解码、Worker、结构检查器与逐槽验证。V1普通独立alpha补齐奇数宽、多行、各色深测试。V0仍缺真实文件和客户端参考，不能称为已完成真实兼容验收。

另修复两项实际发现：HXM RGB565转换应按GXX活动颜色表左移，不补低位；有界zlib超限的`ERR_BUFFER_TOO_LARGE`应记为坏图，而不是被误当宿主分配故障中止验证。

## 实施范围

| 项目 | 结果与证据层级 |
| --- | --- |
| V0索引与图头 | offset/i32 + 含头长度/i32；图头12字节；逻辑槽位保持，负坐标与物理乱序通过 |
| V0 raw/zlib | 对齐DIB行、严格长度；输出超限与尾随字节拒绝 |
| V0 RLE | 独立literal/repeat、最大128游程、跨行、输入不足/输出越界/尾随字节回归；对齐行和单行布局通过 |
| V1普通alpha | 8/16/24/32位，原始与压缩、奇数宽、毒化行填充、黑色半透明、32位独立A8通过 |
| RGB565 | HXM最大通道248/252/248；GOM/GEE原合同不变；源码确认+独立向量，缺HXM16位真实参考 |
| 坏槽与不支持槽 | 按需解码、Worker、legacy、缓存重开与全量验证均保留原ID，后续正常图片继续显示 |
| checksum恢复 | V0/V1均保留recovered，不冒充无损原始或独立像素验收 |
| 结构报告 | 第十个profile `hxm2-lz-v0`；indexRecordSize=8；展示compressionMode/indexDataSize，说明内部flags不是alpha |
| 缓存升级 | direct修订`archive-direct-v4-hxm-v0`；通用PAK legacy修订`pak-v3-hxm-v0`；不清除旧缓存目录 |

V0索引越界、负长度、块重叠、非法全局色深等结构错误仍拒绝打开该归档；负载中可独立判定的坏图/未知模式才逐槽隔离。本轮没有声称所有结构损坏都可局部恢复。

## 核对源码后修正的旧假设

1. `pf15bit`不能按枚举名称直接实现RGB555。`GameImages.MakeDibByPixelFormat`活动代码对pf15/pf16都设置565，最终转换表也按565取值；缺真实type4参考，保持未开放。
2. V0 RLE输出是紧密像素，但后续复制按DIB行对齐长度执行。非对齐多行会涉及错位及未初始化尾部；BOO明确标为不支持，未猜测逐行补齐。
3. SD 4-bit alpha检测调用传入预期颜色长度，不是实际解压长度；奇数宽时颜色/alpha分界也存在冲突。V1奇数宽RGB565无独立alpha的长度可与普通DIB重合，已增加逐槽“不支持”判定与红/绿回归，后续正常槽仍可读；不把可能的SD alpha静默忽略。V0及普通独立alpha不受此限制。缺可信writer或参考像素，不能依靠“解压后长度不同”猜开SD分支。
4. 客户端对不超过4像素的小图跳过纹理创建；资源检查器仍保留和解码小图。这是刻意区分资源数据与客户端显示策略，不是删除槽位。
5. 8位调色板继续使用已有合同，新增测试验证行序、索引与alpha叠加，不把共享调色板读取当独立调色板来源验收。

七份版本固定的源码SHA-256全部复核一致，包含新增`GameImages.pas`。详见[来源清单](../specifications/pak-source-evidence.json)与[结构规范](../specifications/PAK_STRUCTURE_CONTRACTS_20260925.md)。未复制厂商源码或写入用户归档。

## 验证结果

- 新增`pak-hxm-layouts.test.js`：21组完整链路布局；独立真彩/alpha期望值、首中尾空槽、负坐标、错误密码、尾部空格密码、RLE边界、局部故障、缓存重开、验证汇总及源不变。
- `test:pak-variants`通过。
- 影响范围回归30/30通过：编译、lint与28个资源/缓存/Worker/消费者/浏览器/目录检查。lint为0 errors、25条既有warnings。
- 初次批量回归29/30：Edge 153.0.4234.48返回exit 0但stdout/stderr均为空、没有DOM；单独复现一致。未据此改产品。测试沿用NPC浏览器回归的策略，仅对“未获得DOM”尝试另一已安装Chromium，真实DOM断言失败不重试绕过。
- 本次补丁管理按钮与NPC DOM最终使用Chrome 153.0.8010.53通过。属真实Chromium DOM与合成事件验证，不是原生VS Code操作或游戏客户端验收。
- 五个桌面标准包各1200槽、832张图、368空槽：总6000槽/4160张图/1840空槽，direct/legacy/Worker逐槽PNG一致，原五包PNG序列SHA-256基线完全不变；结构报告无问题；原文件SHA-256不变。

实样仍是此前五个有明确profile的标准包，不含V0、pf15或SD的新真实样本。

## 可复核证据

- `artifacts/pak-hxm-layouts-20260926/tests-r1.json`：首次29/30及Edge空响应失败，保留未覆盖。
- `artifacts/pak-hxm-layouts-20260926/tests-r2.json`：30/30；包含命令结果、运行时间、输入和runtime哈希。
- `artifacts/pak-hxm-layouts-20260926/tests-r4.json`：最终32/32，加入素材查看器和SD歧义判定；历史r3保留。
- `artifacts/pak-read-integrity-20260925/real-pixels-hxm-v0-20260926.json`：本日重新运行五包6000槽的像素结果。
- `artifacts/pak-read-integrity-20260925/real-structures-hxm-v0-20260926.json`：本日首轮结构结果及reader哈希，与当次tests-r2一致；最终编译产物以下方新后缀为准。
- 最终读取器对应后缀`hxm-v0-r2-20260926`的`real-pixels`/`real-structures`报告；旧后缀对应增加SD歧义判定前的编译产物，不用于冒充最终哈希。

证据文件均使用新名称，没有覆盖前次报告；密码只经无回显stdin进入测试，不保存在报告或命令行。

## 尚未闭环

总计划第4步仅完成确定布局实现与合成验证，V0真实兼容、pf15、SD、非对齐多行RLE待证据。第5步的其他PACK4/GEEM2/历史profile也仍缺样本。第7步只读查看器在本日后续批次完成，另见[素材查看器报告](PAK_ASSET_INSPECTION_20260926.md)，最终合并回归32/32见tests-r4；其原生VS Code、动画工具及实时账本同步仍未完成。第6步超大包压力以及第8步最终VSIX与客户端矩阵也不是本报告的已完成项。

当前不可承诺“只要有密码就能完美展示所有PAK”。密码只解决确定格式的解密，不补足未知布局或缺损数据。[整体计划](PAK_COMPLETE_DISPLAY_PLAN_20260925.md)继续区分实现、合成验证、实样验证和客户端验收。
