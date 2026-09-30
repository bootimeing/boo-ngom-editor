# 紧凑素材目录与 WIL/WZL 坏槽收尾报告

日期：2026-09-26；版本：4.3.6。**本轮两项剩余实现及相关回归已完成，最终独立候选为 scale-r1。** 本文承接 [r2 历史验收](PAK_COMPLETION_20260926.md)。不代表未知历史格式、宿主内存重构或真实游戏客户端全部验收。

## 已实施

| 项目 | 实现结果 |
| --- | --- |
| 素材目录传输 | direct 包使用包级身份、URL 模板和非空/异常槽元组；空槽保留逻辑编号，不再逐槽传输完整素材对象。legacy 素材仍兼容原路径 |
| 前端存储 | 使用包范围视图和最多 1024 项的素材对象 LRU；列表只创建当前可见条目，按 ID 精确查询不遍历所有空槽 |
| 长列表与同步 | 超长列表映射到最高 1600 万像素滚动面；尾 ID 可定位。全状态使用可克隆的紧凑目录，不向 IPC 发送 Proxy 或展开百万富对象 |
| 五类选择器 | 图片、按钮、特效、关闭按钮、装备框统一为每页 96 项，支持包筛选、ID/名称检索和跨页保留选择；进度条继续使用 96 项分页 |
| WIL/WZL 坏槽 | 非零非法 offset、截断图头、非法尺寸、未知类型、无效 PNG 头和跨块负载保留为原 ID 的损坏/不支持记录，不再静默转为空槽 |
| WIL/WZL 合法边界 | 零 offset 与完整全零 16 字节 WZL 空槽哨兵仍为空，单引用/共享哨兵均兼容；合法共享有效 offset 保留各自原 ID |
| 缓存修订 | direct decoder revision 更新为 `archive-direct-v6-wil-wzl-slots`，旧索引按版本失效重建，不清除用户其他缓存或重写原包 |
| 状态一致性 | 状态统计从权威槽记录计算；对象淘汰后重复回包不重复计数；逐槽只接收最新请求结果，已完成/过期请求释放跟踪记录 |
| 主列表来源保护 | 双击/拖拽和图片成功/失败回调绑定素材源代次；换包后不把旧下标映射到新包；关闭最后一包清空排队绘制使用的范围 |
| 快捷配置 | 关闭按钮/装备框保存逻辑 ID、包编号、包名和归档身份；direct 无导出 PNG 路径时保留设置，等待目录到达再解析，不猜同名歧义 |
| 本地选图 | request/session 与宿主 panel/engine/source 校验；选图仅草稿，确认才保存，关闭重开不接受旧响应；背景/填充独立通道 |
| 已确认添加 | 图片/按钮/特效绑定素材源代次；同源打开下一个选择器不误取消已确认添加，换源仍丢弃旧图片回调；特效使用用户输入帧数 |

整包索引截断、I/O 中断仍是整包错误，不伪造成单张损坏。未确认的 WZL flags/profile 未扩大放行。

## 验收记录

| 验收层次 | 本轮结果 |
| --- | --- |
| 工作区 | compile、lint、test:all 退出码 0；全套约 167.6 秒；Lint 为 0 错误、25 条既有警告 |
| 候选包专项 | 15/15 通过，直接读取最终解包的生产 HTML/JS；168 份生产文件哈希保持一致 |
| Ctrl+F12 严格矩阵 | 工作区及最终包内运行时均 198/198；候选设置 `BOO_NPC_DIALOG_RUNTIME_ROOT`，支持该入口的测试不回退到工作区生产文件 |
| WIL/WZL | 19 组异常/合法别名/空哨兵测试；15 个坏槽场景覆盖 direct、Worker、缓存重开、全量验证和源 pair 双 SHA 不变 |
| 五类选择器 | 2 万传统素材和百万紧凑槽位，每个选择器最多 96 DOM 项；精确 ID/包/名称、跨页选择、保存恢复、来源失效均通过 |
| 真实 PAK | 五包共 6000 槽、4160 图、1840 空；direct/legacy/Worker 全槽一致，PNG 序列基线一致，像素错误 0、原包 SHA 不变 |
| 合成后端压力 | 百万槽/3 图及 3 万有效图/123.7 MB 场景通过，取消/继续、重开和源完整性通过；持久缓存均 3 文件、0 个逐图 PNG |
| 隔离 VS Code | Microsoft VS Code 1.128.0 的真实 Extension Host、Webview、资源 provider/IPC 通过；百万槽尾 ID、进度条、动画空帧、偏移、两次保存和紧凑 fullState 通过 |

百万槽/3 图的最终原生宿主测量：目录 **653 字节**，fullState **964 字节**；索引约 92.84 ms，目录构建约 28.08 ms，从 Webview 收到素材消息至首图可见约 57.20 ms，输入尾 ID 至图片可见约 205.20 ms。后两项不含启动 VS Code 或先前建立索引；不是所有格式或百万有效图片的性能承诺。本次原生输入是合成 DOM 事件，不是物理鼠标/键盘；metadata 由探针 adapter 经真实 IPC 调用生产接口，私有宿主分派另由协议测试覆盖。验收期间另有包内回归/压力任务，耗时不作为独占机器基准。

Chrome 完整 HTML 的独立百万槽夹具记录 637 字节目录、958 字节 fullState，与原生数字不同来自包名、资源 URL、几何/状态等夹具差异，不是漏槽。对象 LRU 上限 1024；在一列、超过浏览器原生 CSS 高度上限的布局下，尾槽仍实际绘制。

### 证据附件

- [工作区完整回归](../../artifacts/pak-completion-20260926/regression-scale-r1.json)、[15 项包内专项](../../artifacts/pak-completion-20260926/candidate-verification-scale-r1.json)、[包内 Ctrl+F12 矩阵](../../artifacts/pak-completion-20260926/candidate-npc-scale-r1.json)。
- [真实五包像素](../../artifacts/pak-completion-20260926/real-pixels-candidate-scale-r1.json)、[真实五包结构](../../artifacts/pak-completion-20260926/real-structures-candidate-scale-r1.json)。结构报告的像素栏仍为 `not-run`，像素结论由独立像素证据提供。
- [候选后端压力](../../artifacts/pak-completion-20260926/stress-candidate-scale-r1.json)、[压力范围与历史对比](ARCHIVE_LARGE_PACKAGE_STRESS_20260926.md)。
- [原生百万槽结果](../../artifacts/pak-completion-20260926/native-probe/runs/2026-09-26T07-44-33-570Z-be0eb0f8/result.json)、[原生收尾审计](../../artifacts/pak-completion-20260926/native-probe/runs/2026-09-26T07-44-33-570Z-be0eb0f8/post-run-audit.json)。

### 未计为通过的检查

完整套件仍有 5 项 SKIP：`map-effect-provider-real-sample`、`map-effect-real-sample`、`map-blend-real-sample` 缺当前修订可用的真实客户端缓存；`table-editor-browser`、`database-grid-browser` 的旧 headless Edge 运行器没有返回 DOM。没有清理默认缓存或弱化断言来抹去这些结果。rank 真实页面的功能断言通过也不代表缺缓存的背景图已绘制。

## 交付包与安全边界

- [boo-ngom-editor-4.3.6-scale-r1.vsix](../../artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-scale-r1.vsix)：20,742,550 字节；ZIP 共 1448 项，extension 文件 1446 个、57,185,048 字节。
- SHA-256：`9fd97ead1d9e0b0fd57a60a559c0926a72445e6316d4f3a8c3b7d759a7e663a1`。
- [构建记录](../../artifacts/pak-completion-20260926/package-scale-r1.json)：529 个实际 VSCE 输入在构建前后未变；[解包记录](../../artifacts/pak-completion-20260926/unpack-scale-r1.json)确认版本、包内容及根级源码/测试/样本泄漏数为 0。
- [最终综合审计](../../artifacts/pak-completion-20260926/final-audit-scale-r1.json)核对 ZIP/解包逐文件一致、生产输入未漂移、依赖闭包、同候选所有结果及文档链接。

本轮没有改版本号、覆盖历史候选、安装到默认 VS Code、提交、推送或发布商店。使用本轮修复需安装该独立候选并重载窗口，旧的同版本 VSIX 不会自动含有这些变化。

原生验收使用独立用户数据、扩展、缓存和显式 shared-data 目录；候选/隔离副本各 168 个生产文件未变，官方 Code.exe 与临时别名哈希相同，本轮进程收尾遗留为 0。保留历史边界：更早 r2 准备阶段失败尝试曾访问默认 sharedStorage，因无前置基线不能断言那次默认共享数据绝对未变；本轮成功验收未使用该默认共享目录。未为验证主动修改或回滚默认用户数据。

## 仍未关闭的边界

1. **宿主大包内存**：本轮消除了富对象 UI 传输和空槽前端展开，Extension Host 仍构造原 `DecodedPakResult.assets`。全为非空图的紧凑元组数仍随图片数增长，不是任意规模恒定内存；后续可将宿主改为索引范围/按页查询。
2. **格式实样**：HXM V0 已有代码与独立合成向量，仍缺对应真实包；pf15、SD 与未对齐多行 RLE 有源码歧义，未直接开放。
3. **其他历史分支**：PACK4 其他 type/压缩、空 KSF、GEE legacy 坐标、GEEM2 仍需真实包及可信 writer/source 或同格式转换配对。
4. **客户端验收**：浏览器 DOM 和真实 VS Code Webview/IPC 不等于原生鼠标键盘或游戏客户端像素/混合验收。动画起止与混合规则不能从缺少该信息的图片包中推导出来。

密码不能修复已截断字节；未知结构不会通过扫描猜图冒充兼容。用户源资源和默认安装不作为本轮修改目标。
