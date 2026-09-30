# PAK 展示与进度条设置增量验收

日期：2026-09-26；版本：4.3.6。**本报告保留 r2 阶段的历史验收；最新后续实现与候选见[紧凑素材目录与坏槽收尾报告](PAK_SCALE_COMPLETION_20260926.md)。** 进度条卡顿及重开保存问题已修复，r2 是本阶段候选，不是后续修复的最终包。本报告不是全格式兼容或整体计划全部完成声明。

## 本轮已实施

| 项目 | 结果与边界 |
| --- | --- |
| 跨格式诊断 | PAK/GOM/GEE/HXM/PACK4/JPK/WIL/WZL的明确失败点提供stage/reasonCode及可用的逻辑ID/范围；不按错误文字猜原因，未识别桥接/宿主异常保留unknown/runtime |
| 像素读取安全 | WZL按已确认tight/aligned最大尺寸限制解压，拒绝压缩尾部；内嵌PNG校验chunk范围/CRC/IHDR/连续IDAT/IEND、过滤器与有界扫描行，包括Adam7；不更改正常PNG内容 |
| 实时详情 | 只读取可见/选中槽位，每请求最多400个状态字节；核对源指纹与索引代次；不向前端发送密码、密钥或解密头 |
| 动画查看 | 1–240连续ID、正反序/间隔/步进、固定组范围和公共原点、原图alpha或用户滤色；空/坏/缺帧不补位；最多24图且64MiB RGBA缓存 |
| 进度条设置 | 每页96项、包筛选/精确ID/名称查找；双图解码复用、同一显示帧合并输入、预览表面上限800×300；保存仍使用原始ID/偏移 |
| 集成缺陷 | 修复已恢复素材被误禁用、旧数组位置覆盖稳定ID、弹窗失焦导致键盘穿透、进度条重开再确认丢失素材包编号；未知alpha不靠类型名称推断，JPK32明确独立A8/BGRX |
| 缓存迁移 | direct decoder revision为`archive-direct-v5-wzl-bounds`；旧缓存安全失效，保留原目录，不删除用户缓存 |

## 回归与性能

开发工作区已通过新增元数据、宿主消息分派、真实Chrome DOM的查看器/动画、进度条和独立交叉审查回归；最终工作区compile、lint及test:all退出码均为0，Ctrl+F12严格套件198/198。lint仍有25条既有warning，不写成零警告。完整套件中的5项SKIP详见下方，跳过不算通过。

进度条失败复现：2万素材打开时创建2万个条目及2万个`img`节点。修复后最终r2包内生产HTML只创建96项；实时Chrome运行开窗同步代码约11.0ms，连续100次偏移输入约11.2ms、不新建Image对象。该时间是本机合成测试，不含用户实际大图解码；旧测量使用虚拟时钟，不能与当前值当作精确加速比。

复查补出了另一个独立红例：首次确认后重开再确认，顶层`willIdx`会丢失。r2同时保存背景/填充各自包序号，并迁移历史顶层值。新增回归覆盖同包、跨包拒绝、未知序号不借旧值、显式0、正负偏移、翻页、换源和多次开关；r1保留为历史失败前候选，不作为最终交付。

百万槽/3图和3万图/123.7MB合成包已进行后端索引、首尾图、取消/恢复、持久账本和源SHA核验；详细指标及测量范围见[压力报告](ARCHIVE_LARGE_PACKAGE_STRESS_20260926.md)。这不是百万槽原生UI验收。

## r2 当时尚未完成与原因

下表是 r2 发布时的边界；其中百万槽紧凑传输、其他五类选择器和 WIL/WZL 异常槽已在后续实施，当前验收以[收尾报告](PAK_SCALE_COMPLETION_20260926.md)为准。

| 项目 | 当前状态 | 需要什么才能关闭 |
| --- | --- | --- |
| 百万槽UI整表传输及其他选择器 | 可实现但未实施；富对象JSON约362MiB，现有全状态同步也会放大；进度条已分页，其余五类选择器仍有全量DOM路径 | 包级紧凑描述符/范围视图或分页协议，同时改造随机索引消费者、浮动画布全状态和其他选择器；不能只把传输数组换成Proxy |
| HXM V0真实兼容 | 代码与独立合成向量通过，真实样本待验 | 对应版本真包、已知密码、可信逐帧参考 |
| HXM pf15/SD/未对齐多行RLE | 有源码歧义，尚未开放 | 匹配profile的真实包与客户端输出，特别半透明/奇宽布局 |
| PACK4其他type/压缩、空KSF、GEE legacy坐标、GEEM2 | 缺对应结构合同与实样 | 原包及可信writer/source或同格式转换配对，不能扫描猜图 |
| 原生鼠标/键盘、游戏客户端像素/混合 | 本轮没有此级证据 | 明确版本客户端/工具逐帧参考与交互验收 |
| WIL/WZL索引阶段被跳过的异常槽 | 既有parser仍有continue分支，本轮只修throw分类及像素读取 | 独立补rejected-slot保留和重复/截断等负向夹具；不能把本轮PAK账本覆盖直接推广到WIL/WZL |

PNG核验覆盖基础图片IDAT和容器完整性，不是附加块/APNG动画语义的兼容验收。结构化诊断有32个明确失败点测试，桥接未提供typed错误时仍保留unknown。

没有“有密码就能恢复所有归档”的保证：密码不能补回截断字节，也不能确定未记录的动画动作和客户端混合参数。

## 最终交付证据

### 最终本地候选

- [boo-ngom-editor-4.3.6-r2.vsix](../../artifacts/pak-completion-20260926/boo-ngom-editor-4.3.6-r2.vsix)：20,732,835字节，ZIP共1447项，extension文件1445个、57,152,241字节。
- SHA-256：`10a35b7d5957e8d8a5b2ec435e8f103b1984addeca268cc16f776ddd1155f295`。
- [构建记录](../../artifacts/pak-completion-20260926/package-r2.json)：实际VSCE选择的528个输入在构建前后哈希一致；候选没有根级源码、测试、审计工件或真实PAK/JPK。
- [解包记录](../../artifacts/pak-completion-20260926/unpack-r2.json)及依赖检查：60个生产依赖、Ctrl+F12的66文件本地闭包、SQL.js/XLS/Tabulator/native M2通过。
- [包内7项回归](../../artifacts/pak-completion-20260926/candidate-verification-r3.json)：逐图检查、32个明确诊断失败点、WIL/WZL安全边界、21种HXM合成布局、查看器、进度条、交叉边界全部通过；167份生产文件身份一致。

版本没有递增，没有替换旧正式包，没有安装到默认VS Code；本轮不提交、不推送、不发布商店。要使用本轮修复，需要安装上面的r2候选并重载窗口，旧4.3.6包不会自动获得它。

### 真实五包

[像素证据](../../artifacts/pak-completion-20260926/real-pixels-candidate-r2.json)与[结构证据](../../artifacts/pak-completion-20260926/real-structures-candidate-r2.json)均绑定最终解包运行时。五包各1200槽、832图、368空，总6000槽、4160图、1840空；direct/legacy/Worker全部槽位及既有PNG序列基线一致，像素错误为0，重开成功，五份原包SHA-256不变。

| 文件 | 已验profile |
| --- | --- |
| GOM.pak | gom-gameofmir2-v2 |
| gee-V8-翎风.pak | gee3-main-v2 |
| 龙族-LZM2-LEG3.pak | hxm2-lz-v1 |
| LEG-360-APPLE.pak | pack4-plain-bgra |
| leg-ksf.pak | pack4-ksf-bgra |

结构检查器仍将自己的像素栏写为`not-run`，因为它只做结构；像素结论来自独立像素记录，不能把两层混淆。这五个具体profile不代表所有历史PAK或JPK已覆盖。

### 真实VS Code宿主

[原生探针报告](../../artifacts/pak-completion-20260926/native-probe/RESULTS.md)最终成功运行：`2026-09-26T06-20-32-121Z-463a9e5c`。Microsoft VS Code 1.128.0实际激活隔离候选；正式资源provider、完整包内HTML、原生Webview图片、真实IPC、偏移、空帧动画、96项分页、ID255及两次确认保存全部通过。候选和安装副本各167份文件哈希不变；只停止本轮进程，收尾遗留0。

输入为合成DOM事件，不是原生鼠标键盘；metadata消息由探针adapter调用生产接口，不冒称覆盖私有dispatcher（该分派另有自动回归）。原生夹具为256槽合成PACK4，不代替6000槽真实包或游戏客户端验收。

官方安装路径已有RUNASADMIN兼容设置；最终用临时同哈希Code.exe副本及原payload只读链接完成非提升测试，未改安装/注册表。早期失败尝试日志显示访问了默认`.vscode-shared`数据库，缺少启动前基线，不能声称默认共享数据绝对未变；未主动编辑/回滚未知用户数据。最终成功运行显式隔离`--shared-data-dir`，日志和独立收尾审计均确认只使用本轮临时共享目录。

### 完整回归与未验收项

[工作区完整回归r4](../../artifacts/pak-completion-20260926/regression-r4.json)通过；[包内Ctrl+F12严格矩阵](../../artifacts/pak-completion-20260926/candidate-npc-r2.json)也通过198/198，记录设置`BOO_NPC_DIALOG_RUNTIME_ROOT`后的最终结果，支持该入口的测试直接使用候选运行时，测试辅助仍来自仓库。它与原生探针属于不同验证层次。

全套中以下项目跳过，仍未取得本轮结果：

- `map-effect-provider-real-sample`、`map-effect-real-sample`、`map-blend-real-sample`：缺当前修订有效的实际客户端缓存，不重建或删除默认缓存来消除SKIP。
- `table-editor-browser`、`database-grid-browser`：旧运行器的headless Edge没有返回DOM；不是已验证通过。与本次进度条相关的Chrome及原生Webview测试已执行。

历史失败保留：r1全套的过期整文件SHA断言、r2全套的缺缓存身份字段夹具和ListView候选运行器问题均已定位，测试修复后重新跑完整套件；真实DOM失败不会通过换浏览器掩盖。另有rank真实页面背景素材缺缓存的提示，其功能断言通过不等于该背景已绘制。

r2 后续两项实现和验收已移至[紧凑素材目录与坏槽收尾报告](PAK_SCALE_COMPLETION_20260926.md)；需要真实样本或客户端参考的格式分支维持待验，不用猜测或放宽校验替代。
