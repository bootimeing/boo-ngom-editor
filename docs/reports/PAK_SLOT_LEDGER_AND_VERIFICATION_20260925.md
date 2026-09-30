# PAK 逐槽状态与全量验证交付报告

日期：2026-09-25。版本：4.3.6。交付范围：源码、编译产物、隔离自动回归。**无新 VSIX、无安装替换、无本轮游戏客户端验收。**

本轮完成整体计划第 3 步的 direct 按需状态持久化、第 6 步的可取消/恢复验证入口，并推进第 7 步的包级汇总与详情。八步计划未整体完成，下一步边界见文末。

## 已完成项

| 之前的缺口 | 当前行为 | 验证依据 |
| --- | --- | --- |
| 单张图片已读，重开仍为待验证 | 保存 decoded/recovered/corrupt/unsupported；新进程重开恢复 | 初始红测明确得到 indexed-unverified，修复后通过新进程与双 Worker 断言 |
| 压缩校验恢复结果丢失 | 保留 `recoveredChecksum`，不冒充普通成功 | 合成 HXM 压缩尾损坏与正文损坏分别为 recovered/corrupt |
| 多 Worker 写整份 JSON 容易互相覆盖 | 同代次一个定长二进制文件，每槽原位写一个字节 | 双 Worker、同包并发验证、缓存重开通过 |
| 缓存 PNG 命中绕过源检查 | LRU 命中前及异步结果发布前检查源元数据、索引代次；关闭后不再回退解码 | 实际资源 Provider 回归 |
| size/mtime 无法覆盖保留时间戳的改包 | 新索引绑定 ctime、源及配套文件 SHA-256；验证前后核对完整内容摘要 | 同大小/mtime 改包、配套索引变化、绕过元数据后独立 SHA 拒绝 |
| 重载后旧 Worker 可复用旧结果 | 独立随机索引代次、索引内容摘要、代次专用状态文件 | 旧代次拒绝、新代次恢复待验证；源文件不写入 |
| 没有完整解码入口 | 补丁列表“验证／取消／继续验证／详情” | 实际 Provider + Worker 与真实 Edge DOM/IPC 分层验证 |
| 坏图使后续诊断中止 | 可隔离图片错误记账后继续；基础设施故障中止且不记为坏图 | GOM 1659槽：1654正常、4空、1结构坏槽；缺 Worker/EACCES/坏状态文件负向测试 |

## 存储与失效合同

- 新 direct revision 为 `archive-direct-v3-slot-ledger`，旧目录保留，不清用户缓存。
- 新建索引在解析前后各流式计算一次源 SHA-256，WIL/WZL 同时包含 WIX/WZX；普通单帧读取不全包散列。
- 索引记录自身有 SHA-256；缓存载入验证后方可使用。
- 首次实际解码时才建立 `slots-<generation>.bin`：64 字节头加每槽 1 字节。头绑定 archiveId、decoderRevision、源/配套内容摘要与索引内容摘要。空槽与已知结构拒绝槽仍由经过验证的索引提供。
- 初始化使用同目录完整临时文件、flush 与 hard-link create-if-absent，防止其他 Worker 读到半份初始文件；后续不同槽位互不覆盖。已在本机文件系统验证，未单独验收不支持硬链接的卷。
- 取消只关闭本次专用 Worker，不关闭其他预览 Worker；引擎切换、视图销毁、扩展销毁均取消正在运行的任务。
- 结果汇总互斥：总槽位等于六类状态之和。失败明细最多1000条并显式标记截断，完整逐槽状态保持定长存储；界面最多保留32份报告。
- 报告是本次验证快照，不是持续监控。读取、继续验证、再次打开详情均重新核对有效性；已经显示的行不会实时监控外部进程写包。
- 逐槽数据写入失败会明确报环境错误，不假报成功；因此缓存不可写时，即便源图可解码，本次读取也可能被拒绝，需要先解决缓存问题。

## 实际语料验收

用户提供的标准 PAK 样本目录中的五包，密码仅经 stdin 提供；原始文件均只读。

| 实际文件 / profile | 槽位 / 正常 / 空槽 | 冷索引 ms | 全量验证 ms | 再验证 ms |
| --- | --- | ---: | ---: | ---: |
| GOM.pak / gom-gameofmir2-v2 | 1200 / 832 / 368 | 23 | 696 | 6 |
| LEG-360-APPLE.pak / pack4-plain-bgra | 1200 / 832 / 368 | 12 | 662 | 5 |
| gee-V8-翎风.pak / gee3-main-v2 | 1200 / 832 / 368 | 18 | 664 | 4 |
| leg-ksf.pak / pack4-ksf-bgra | 1200 / 832 / 368 | 16 | 703 | 5 |
| 龙族-LZM2-LEG3.pak / hxm2-lz-v1 | 1200 / 832 / 368 | 18 | 683 | 4 |

硬件/环境：AMD Ryzen 9 9950X、约47.1 GiB RAM、Windows、Node v24.14.0。样本约3.1–4.1 MB；已启动隔离 bridge，不包含其启动时间。

- 每包状态文件 **1264字节**，没有在 direct 验证目录导出 PNG。
- 索引/状态等合计约35 KB；KSF 因既有短像素前缀约142 KB。
- 2ms探针采样到的进程总 RSS 峰值约84.5–112.7 MiB、事件循环最大间隔12–18ms。这是整个测试进程（含 Worker）采样值，不是单包独占内存，也不是严格峰值或超大包承诺。
- GOM取消：完成1图后请求，约1ms返回；继续只解码余下831图，最终832正常、368空。
- 五包共6000槽 direct、legacy、实际 Worker 的 PNG、尺寸、偏移、空槽与上一轮基线一致；原始源 SHA-256前后不变。
- JPK 和 WIL/WZL 本轮使用合成及既有回归，没有新桌面 JPK 实包验收。

## 自动检查与证据

- `npm run test:archive-verification`：状态核心、实际 Provider/Worker、真实 Edge DOM 三组通过。
- 原有22项资源/解析/快照/消费者/浏览器回归通过，`test:layout` 三项通过；补丁管理既有静态回归也通过。
- TypeScript编译通过；ESLint 0 errors、25 warnings，剩余为既有代码的异步赋值警告位置。
- 浏览器测试实际运行生产 HTML，在260px容器内检查验证、取消、继续、详情按钮和IPC，以及文件名转义。宿主接口由测试替身提供；**不是原生 VS Code 安装后的键鼠验收**。

本机证据（不作为干净 checkout 的隐式依赖）：

- `artifacts/pak-slot-ledger-20260925/real-verification-r1.json`：五包耗时、状态、摘要、运行时SHA。
- `artifacts/pak-read-integrity-20260925/real-pixels-ledger-r1.json`、`real-structures-ledger-r1.json`：6000槽完整像素及结构复验。
- `artifacts/pak-read-integrity-20260925/tests-ledger-r1.json`：保留首次发现旧测试夹具未提供新ctime字段的失败记录。
- `artifacts/pak-read-integrity-20260925/tests-ledger-r2.json`：修正夹具后22项通过。
- `artifacts/pak-slot-ledger-20260925/tests-final.json`：最终源码的编译、lint与29个测试脚本，附运行时摘要。

## 仍未完成

1. 全部格式的统一结构化错误协议仍未全部接入，当前新增的是逐图片错误与基础设施错误的明确区分。
2. HXM/Lz其他有源码依据的布局、Lz V0、特殊alpha，以及PACK4历史分支尚待实现或对应真实样本，不靠猜测放开。
3. 素材缩略图列表逐槽徽标、原始像素/偏移模式、背景与原点工具仍未在本轮完成。当前“详情”是包级JSON报告。
4. 多GB/百万槽压力验证、真实VS Code安装包运行、参考工具或游戏客户端对比仍待后续，不由本轮小包/DOM测试替代。

操作见[验证资源包全部图片](../user-guide/ARCHIVE_VERIFICATION.md)；完整顺序见[整体计划](PAK_COMPLETE_DISPLAY_PLAN_20260925.md)。
