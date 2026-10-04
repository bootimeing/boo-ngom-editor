# BOO 全项目功能与优化报告

审查日期：2026-10-04（Asia/Shanghai） · 当前源码：V4.3.8 · HEAD：`6244fdc57b6cb49f07ab46cc6c6c82bcaa289095`。

## 结论与阅读方法

BOO 已经具备完整的传奇开发工作流：分引擎脚本语言服务、变量与标识统计、UI 设计、Ctrl+F12 源码预览、补丁读取与编辑、数据库与配置表、原始地图、多区同步、M2 重载及本地 AI 入口。**当前最值得优化的不是继续增加按钮，而是保存安全、编辑保真、目标身份和结果一致性。**

本轮已经确认：部分保存/恢复分支会丢失外部修改或唯一原件；部分编辑动作会改错目标、改坏编码；常规 UI 的复制与双向转换会改变控件语义；另有设置、导航和生命周期不一致。它们大多可以通过工程实现解决，不属于“游戏引擎无法离线模拟”的天然限制。

建议顺序是：**数据与目标安全 → UI/源码往返保真 → 导航与生命周期一致 → 有量测的性能优化 → 测试、发布与维护闭环**。每项详细发现均给出位置、触发、原因、最小建议与验收标准。

本报告不是修复交付：没有修改产品源码、覆盖原 `out/`、重新打包、安装、提交或发布。用户此前未提交的功能改动全部保留。没有修改真实 MirServer、游戏数据库、补丁包、日志或启动/停止用户的 M2/DeepSeek 服务。

阅读顺序：先看“优先级与分批验收”和“按功能的优化总览”；再查三个领域的详细发现。最后的全量入口附录包含全部命令、视图、设置、快捷键、主题和动态模块。完整文件清单在附件中，不把十万条路径灌入报告正文。

## 范围与证据边界

| 项目 | 本轮核对范围 | 不应推导的结论 |
| --- | --- | --- |
| 文件盘点 | 包含隐藏目录、Git、依赖、发布包、运行时和历史工件；100,927 个文件；读取错误为 0；不追外部链接；排除本轮生成目录 | 不代表十万个文件每个字节均人工通读 |
| 产品源码 | 159 个 TS 文件、65,181 行；51 个公开命令全部映射到注册；8 视图、3 CustomEditor、12 设置、8 快捷键、19 主题 | AST/入口可达不代表所有控制流分支均实际运行 |
| 深审 | 三个领域逐功能跟踪入口、模型、宿主动作、IO、Webview最终消费者；重点审查保存、恢复、跨文件/地图编辑和 UI 往返 | 不声称所有 NPC 指令在游戏客户端逐像素等价 |
| 隔离实证 | 当前源码隔离 tsc；临时数据库/脚本/资源夹具；真实 Chrome 生产 HTML；受控 IO 故障与文档/API 替身 | Mock 文档与合成键鼠不等于原生 VS Code；容量探针不等于典型用户 p95 |
| 现有安装包 | 现有 V4.3.8 VSIX 解压、60 个生产包与 Ctrl+F12 66 文件本地闭包检查通过 | 包依赖检查通过不代表它包含当前 dirty 源码的新功能 |
| 依赖公告 | `npm audit --omit=dev --json` 本轮返回 0 条生产依赖公告 | 不是“绝对安全”；外部 tarball、冻结 EXE/Python、供应链和业务漏洞另有边界 |

行数按逐文件split换行统计，包含空行、注释及终止换行后的空项。源码 hash 对账覆盖 610 个产品源码、页面、数据、维护脚本、资产和 manifest 文件；原 out 的318个文件另按大小与mtime对账。读取和报告创建不会替代已安装版本验收。

证据用语：`reproduced` 表示本轮生产源码/模块的隔离反例确实发生；`source-confirmed` 表示源码链成立但未做完整宿主调度实证；`candidate` 表示需要量测或新场景验证。报告中的“测试 PASS”只证明相应断言，没有自动升级为功能完美。

## 分层事项与本轮核验汇总

共 41 项事项：26 项隔离缺陷复现、11 项源码确认风险/建议、1 项单样本容量测量、3 项待测候选。不是41个同等严重bug。按等级：P1 14、P2 20、P3 7。ST-09 与主域开关反例已去重，.table不再在脚本域重复立项。

本轮实际执行 103 次所选回归脚本，跨域去重 92 个唯一脚本，均PASS、无SKIP；另有隔离compile/lint通过。现有包完整依赖核验与npm生产依赖公告核查分别通过。26个缺陷反例和容量样本不混入功能通过数量。

三个领域累计123行功能台账，存在跨域重叠且包含一条尚未交付的成本分析设计；不宣称有123个互不重叠的已实现功能。全量公开入口以51命令附录为准。

| 编号 | 优先级 | 证据分类 | 事项 |
| --- | --- | --- | --- |
| RD01 | P1 | reproduced | SQLite 普通保存可能静默覆盖外部修改 |
| RD02 | P1 | reproduced | XLS 发布与恢复同时失败时删除唯一原件 |
| RD03 | P1 | reproduced | XLS 非 A1 起始区域保存偏移 |
| RD04 | P1 | reproduced | XLS CustomEditor 生成备份却未加载热退出备份 |
| RD05 | P1 | reproduced | SQLite 忽略已提交但仍在 WAL 的数据 |
| ROOT-01 | P1 | reproduced | 自动设置编码清空合法JSONC，并覆盖用户编码 |
| ST-01 | P1 | reproduced | 区服同步目标子目录 junction 造成越界写入 |
| ST-02 | P1 | reproduced | 同步失败回退覆盖丢失原件与候选 |
| ST-03 | P1 | reproduced | 跨文件创建中文标签破坏 UTF-8 主体并绕过草稿/撤销 |
| ST-04 | P1 | reproduced | 当前文件标签修复写入错误活动文档 |
| ST-08 | P1 | reproduced | 清日志入口目录junction可删除外部文件 |
| VISUAL-01 | P1 | reproduced | UI 编辑器复制粘贴丢控件类型与关键参数 |
| VISUAL-04 | P1 | reproduced | 常规 UI 双向同步解析会静默丢自己的可生成内容 |
| VISUAL-06 | P1 | reproduced | 地图实体/地点编辑仅凭行号写盘，可能改错记录或覆盖未保存编辑 |
| RD06 | P2 | reproduced | MonItems/MonIcons 详情保存不检测外部修改 |
| RD07 | P2 | reproduced | 996PC BIFF8 写入失败后行数元数据未回滚 |
| RD08 | P2 | reproduced | merchant.table/mongen.table 注册后匹配不到编辑器 |
| RD09 | P2 | reproduced | 归档缓存发布失败会先删旧 summary |
| RD10 | P2 | measured | 100 槽分页前仍创建全包富对象数组 |
| RD11 | P2 | source-confirmed | 数据库最终覆盖仍缺少断进程持久化契约 |
| ROOT-02 | P2 | source-confirmed | 主门禁重复编译与测试、运行来源和故障覆盖需要统一 |
| ROOT-03 | P2 | source-confirmed | 发布本地闭包门禁需扩大到整个扩展与动态入口 |
| ST-05 | P2 | reproduced | 变量References旧边界/分支/归一口径漏项 |
| ST-06 | P2 | reproduced | 六脚本模板占位不是Snippet且NPC缺默认目标标签 |
| ST-07 | P2 | reproduced | 无关404服务判为DeepSeek在线 |
| ST-09 | P2 | reproduced | CodeLens/Folding设置关闭不生效 |
| ST-10 | P2 | reproduced | 合法大小写标签诊断与定义导航分裂 |
| ST-11 | P2 | source-confirmed | 后台磁盘诊断发布缺版本/代次/配置守卫 |
| ST-12 | P2 | source-confirmed | 内置补全修改安装目录且多文件保存非事务 |
| ST-13 | P2 | source-confirmed | DeepSeek随机实例未共用复用/启动锁生命周期 |
| VISUAL-02 | P2 | reproduced | 有效零值被 \|\| 默认值覆盖 |
| VISUAL-03 | P2 | reproduced | 倒计时坐标往返每轮累计 +4 |
| VISUAL-05 | P2 | reproduced | Ctrl+F12 同 URI 关闭重开仍绑定旧 TextDocument / 旧画布 |
| VISUAL-07 | P2 | source-confirmed | Ctrl+F12 有素材页面仍整模型 eager hydration，每次输入重做目录快照 |
| RD12 | P3 | source-confirmed | 补丁扫描/重建缺少端到端取消 |
| RD13 | P3 | source-confirmed | 资源草稿目前仅在本进程内保护 |
| RD14 | P3 | source-confirmed | 缓存生命周期与解密状态隐私需要产品化 |
| RD15 | P3 | source-confirmed | 数据库侧栏多根工作区身份需显式绑定 |
| ROOT-05 | P3 | candidate | create-jpk产品helper仅测试可达的生命周期整理 |
| ST-14 | P3 | candidate | 脚本语言/装饰/外部解析同步IO性能优化需要测量 |
| VISUAL-08 | P3 | candidate | .map 查看器与原始地图重复读取/解析/全量数字数组协议 |

## 按功能的优化总览

| 功能 | 当前实际能力 | 最有价值的优化 | 建议验收重点 |
| --- | --- | --- | --- |
| 分引擎语言服务 | GOM/GEE/996PC 目录、补全、参数悬停、语义高亮、引擎识别、用户补全 | 统一 label/variable span 和归一；用户定制从安装目录改成版本化 overlay；混引擎多根明确边界 | 中文名、大小写、前导零、不同服务器、切引擎；升级保留定制 |
| 定义/引用与快速修复 | 本地/跨文件标签、CALL/INCLUDE、机器人/回调、Merchant/MapInfo/MonGen链接、缺失文件确认创建 | 修复目标 URI 绑定及编码/dirty/撤销；让诊断、引用、跳转使用同一解析结果 | 改 active editor、分屏、目标dirty、UTF-8/GBK、大小写标签；只改指定文档 |
| 变量与个人标识 | 保存后稳定刷新、UTAG、个人标志、嵌套求值、候选编号、临时显示输入 | 保留侧栏现有准确机制；补齐老引用/备注/当前统计口径；报告范围和草稿策略一致 | 四类UTAG、中文扩展名、U3/u3/U003、自定义名大小写不混；统计与引用能互相对账 |
| 常规 UI 编辑器 | 独立设计窗口、图片/三态按钮/动画/文字/输入/进度/装备/倒计时、100项素材、ID定位、背景锁定 | 先统一模型、clone与序列化，再统一手动/silent parser/generator；修复丢字段、零值与累计偏移 | 每种控件复制与10轮往返不变型、不丢未知源码；只允许指定位置/ID变化 |
| Ctrl+F12 | 当前函数、GOTO/CALL、静态数据流、条件/变量输入、素材证明门禁、显示和坐标编辑 | 关闭重开绑定新TextDocument；量测后按页lazy hydration与目录快照复用 | 同URI新对象、草稿冲突、确定变量/占位变量分权；真实Host最终验收 |
| 归档解析与补丁管理 | PAK/JPK/WIL/WZL按profile索引、密码、按需Worker、状态账本、缓存、逐槽验证 | 继续按真实结构/像素证据扩展；大稀疏索引减少富对象；建立磁盘/RSS预算与清晰状态原因 | 坏槽/空槽/未知/取消分开；source pair hash失效、冷热、大槽量；未知profile拒绝写 |
| 资源工作台 | 浏览、PNG/偏移导出、批量/动画导出、编辑/偏移、另存；支持格式按能力开关 | 保持候选回读/no-clobber/profile gate；大范围解码及编辑增加预算/进度/取消与源摘要复核 | 原包不变、全量回读、pair共同发布、失败可恢复；不把有密码等同能修复损坏 |
| 数据库编辑与详情 | SQLite/BIFF8读取、字段编辑、新增/删除/撤回、中文详情、MonItems/MonIcons、保持滚动 | 正常保存也校验源版本；WAL/活连接隔离；失败回滚catalog；详情文本走版本/编辑器协议 | 外部改A、界面改B；拒绝冲突或保留二者；失败不跳行、不丢草稿；活动库不盲覆盖 |
| CSV/配置表/XLS | CustomEditor、类Excel范围选择/填充/复制、二进制XLS保存与备份接口 | XLS恢复消费backupId；恢复失败保留唯一原件；非A1起点写回保真；修正.table注册/识别分裂 | crash/reload、C5/D10稀疏多sheet、发布/恢复双失败；声明文件能打开不是空白 |
| 原始地图与实体编辑 | strict地图解析、Tiles/SmTiles/Objects、瓦片LRU/缓存、NPC/顶戴/刷怪/标识、导航与静态永久MAPEFFECT | 保存锁定实体身份与版本；dirty走WorkspaceEdit；多文件事务；LOD与旧.map查看器共核 | 前方插行/删除/改名/外部改时不能改错NPC；图层/遮挡/动画不回退；显示地图归属 |
| 爆率分析 | 分引擎条件基准、分组/CASE/RANDOM、外部CALL、精确分数、预算/循环/路径保护 | 保留条件基准与真实概率分离；量测同步解析后缓存外部依赖；缺覆盖样本补边界 | 同源码位置可追溯；不把各分支概率随意相加；取消、循环、预算、同服路径正确 |
| 多区/双栏同步 | 多选源、相对路径、多目标确认、取消/进度、逐项失败反馈 | 执行时逐级realpath围栏；恢复型替换，禁止失去原子的直接copy覆盖回退 | 根/祖先/子目录junction、确认期间替换、故障注入；源/外部SHA不变 |
| M2重载 | 保存合并、手动重载、按exe路径定向、队列和菜单扫描、native runtime | 保留现有定向与队列；补真实引擎/权限/慢响应的宿主与状态验收 | 同机多服绝不串用；500ms合并与重试；不可拿mock队列绿当真正M2成功 |
| 辅助编辑/收藏/参考 | 模板、数值/大小写、STR/fcolor包裹、快捷文件、行/变量备注、颜色/代码表、19主题 | 修模板Tab占位；语义保持格式化/大小写预览与备份；备注稳定锚点；开关真正生效 | 六模板默认闭合、一次撤销；SAY/字符串不误改；插行后备注不漂移 |
| 日志清理 | 固定日志路径/后缀、确认和计数 | 入口与祖先真实路径围栏；可恢复清理、精确清单与逐项失败 | 取消零删除；junction不能删到其他目录；部分失败不称全成功 |
| DeepSeek入口 | 本机Harness复用/启动、右侧iframe、外部浏览器、随机端口 | 校验服务身份；统一single-flight生命周期和active URL复用 | 无关200/404不是在线；连续三入口只spawn一次；慢启动/退出/旧地址原因可见 |
| 激活/项目设置 | 对工作区自动设置脚本编码与缓存迁移 | 不用JSON.parse重写JSONC；保留用户明确编码与非传奇工作区设置；迁移与普通启动分开 | 注释/尾逗号、utf8、只读、多根；不开编辑器就丢设置的反例必须消除 |
| 发布/测试/维护 | lint、tsc、主回归、真实浏览器矩阵、包依赖闭包、CI版本门禁 | 单次compile+去重runner；统一runtime注入；扩展全部动态入口闭包和构建来源清单；工件分层归档 | 缺浏览器/空DOM不算通过；缺worker/资源必须门禁失败；最终包SHA绑定源码快照 |

## 全项目层面的具体发现

### ROOT-01 · P1 / reproduced · 自动设置编码会丢合法 JSONC 配置，并强制改用户编码

位置：`src/extension.ts:200-215`。现有 `.vscode/settings.json` 使用 `JSON.parse`。VS Code 合法的注释/尾逗号导致解析异常后，代码保留空对象并将文件重写为只有 `files.encoding=gb2312`。即使是普通JSON，只要用户明确设utf8，也会改成gb2312。激活事件包含plaintext，影响不只特定NPC文件。

反例执行的是原始生产块经TypeScript转译，宿主指向本轮唯一临时工作区：带fontSize=19、autoSave=onFocusChange和注释/尾逗号的配置，在激活后只剩编码项；普通JSON正控保留fontSize但utf8被强制替换。没有打开/改写用户真实工作区设置。

建议：采用VS Code配置API与按语言默认设置，默认不要覆盖用户明确选择；对合法JSONC保留注释及其他键，对非法配置拒绝写并反馈，不捕获失败后默默清空。

验收：注释、尾逗号、BOM、utf8/GBK显式配置、无settings、只读目录、嵌套/多根和非传奇TXT；非目标键/格式/用户编码不被破坏。设置失败不影响其他功能激活，也不能报告全成功。证据：`main-probe-results.json` 的 activation。

### ROOT-02 · P2 / source-confirmed · 测试门禁可去重编译，并强化运行来源和故障矩阵

展开 `package.json` 的test:all顶层调用得到183次测试文件调用、158个唯一文件和11次compile。ui-codegen/ui-regressions各3次，另21个文件重复2次。尚未展开NPC严格runner，**这不是全部用例数，也不是实测总耗时收益**。

建议：单次编译后运行去重测试计划，保持已有失败语义；按模块拆fast/unit/browser/native/real-corpus gates，发布必须的浏览器分支缺环境应fail，环境专项明确skip；将所有测试逐步支持统一runtimeRoot，包括Worker、fs读取、Python兼容层与Webview资源，不只redirect require。把本轮外部修改、C5、backupId、双rename、错目标、clone、多轮往返、JSONC等反例接入正式回归。

验收：旧/新计划同一fixture断言和负例保持，编译次数1；发布必需用例零静默SKIP；任意故意损坏关键入口必须红；日志包含runtime源码/包摘要和浏览器版本。证据：`main-probe-results.json` 的testPlan和完整入口附录。

### ROOT-03 · P2 / source-confirmed · 发布闭包应覆盖整个扩展，而不止 Ctrl+F12 与爆率入口

当前 `tools/release/verify-packaged-dependencies.js` 对NPC静态模块与archive-image-worker、爆率入口做了可靠本地闭包检查，同时验证生产依赖、SQL/XLS/Tabulator/native M2。应保留这些已落地门禁。

剩余范围：extension主入口、资源编辑edit-worker/animation-worker、其会话模块及动态HTML/JS入口需要完整显式manifest。常规静态import图的8个未命中模块，其中7个可由动态Worker/其依赖或开发CLI确认用途；create-jpk.ts目前仅测试调用，另作生命周期候选，不能把8个模块统一称为已上线动态入口。

建议：维护入口/动态asset清单+包内完整闭包+源码/构建摘要；不把“同版本号”当“同内容”，不把过时的out残留进包。验收应做删worker/删HTML/缺传递依赖的负例；候选包必须与冻结源码和输出逐文件对账，随后做原生Host smoke。

### ROOT-04 · 说明 / 已现场核对 · 现有 V4.3.8 包是较早快照，不是当前源码发布物

原包：`artifacts/releases/vscode-marketplace/boo-ngom-editor-4.3.8.vsix`，20,825,140字节，SHA-256：`c67ef0557905db4330c6f9c1015098c474a1477afc9ef011f682cf3fc559eee2`。解包核验通过60个生产包、Ctrl+F12 66文件闭包和SQL/XLS/Tabulator/native M2。

与本轮159个编译JS比较，4个新模块在旧包缺失、7个模块不同：MonGen批量创建命令、MapInfo/MonGen链接Provider与drop helper未进入该包；其余差异包括assistant、extension、map-preview、NPC Provider、source-parser及地图helpers。**这是源码在打包后继续改进的正常版本快照差异，不将该包误报成损坏。**后续实施并发布时必须重新冻结、编译、验证和打包，不能继续引用旧包作为新修复验收。

证据：`package-snapshot-results.json` 与 `logs/existing-vsix-verification.log`。本轮没有生成新VSIX或更新安装版本。

### ROOT-05 · P3 / candidate · 已下线创建入口的历史 helper 与测试可做生命周期整理

`src/resource-editor/create-jpk.ts` 当前只有 `tests/resource-editor-create.test.js` 调用；产品注册/调用图未发现新建JPK入口。它与真正动态加载的两个Worker、三个格式session和两个结构CLI模块性质不同。

建议核对历史设计/回归依赖后，决定保留为内部工具或归档；若实施清理，同时检查out残留与包内引用，不能删掉测试来让死代码审查“通过”。这只是精简候选，收益未经测量，不作为当前功能故障，也不恢复用户已要求去掉的新建JPK入口。

验收：公开命令与界面不变化；完整生产/Worker/工具闭包仍通过；该helper的必要测试意义有明确去向；清理前后VSIX体积实际对比，不按行数宣传收益。

## 性能与项目整理：哪些已经有数据，哪些还不能下结论

| 优化对象 | 当前证据 | 方案 | 验收方式 |
| --- | --- | --- | --- |
| 百万稀疏槽索引 | 合成999,999槽、4,000,076字节JPK，一次运行返回999,999个富对象；堆增183.7MiB、RSS增192.1MiB、event-loop gap104.3ms | 索引与状态用紧凑存储/惰性对象；消费者只取页/范围；已有紧凑IPC目录不要回退 | 冷/热多轮、10万/100万槽与真实包；像素/槽语义相同；报告p50/p95/RSS，区分进程baseline |
| NPC多scene资源与补丁目录 | 源码仍按全部scene hydration；纯文字无扫描与30→1合并已修且本轮复跑 | 按来源身份复用目录快照、可见页lazy/相邻预取、底层取消 | 素材需求数/扫描数/FS次数/首次和热切页p95；动态占位不能获得素材权限 |
| 脚本语言同步IO/解析 | 同步目录、CALL读取、装饰扫描有明确路径；没有本轮大服延迟曲线 | 先冷/热基线，再依赖缓存、有限并发、取消和发布版本门禁 | 相同大服A/B，不误判不存在命令，不返回旧引擎诊断 |
| 小地图/原始地图LOD | 原始图chunk预算已有限；低缩放中心36块及旧.map独立parser为边界 | strict共核、按viewport/LOD降低成本，标清未加载区域 | 全图低缩放、快速跳转/拖动、遮挡/动画像素、未知profile拒绝；不是只看DOM数量 |
| 工作区工件 | 起始artifacts 80,142文件/3,926,648,447字节；不进VSIX | 当前证据保留，历史候选做可恢复外部归档与索引；不要删运行时/测试基线 | 整理后源码/包hash与复跑入口不变；显式列出可恢复位置；包体和仓库占用分开 |
| 自动化重复工作 | 顶层11次编译、183次调用/158唯一文件；尚未测CI墙钟收益 | 去重编译/计划、合理并行；同共享文件/缓存的测试串行 | 断言不减少、不掩盖race；实际CI同机A/B墙钟与峰值RSS |

容量样本只是结构开销的证据，不是“所有包都慢104ms”。大文件行数、同步调用或主文件体积也不能直接转换成性能结论。优先保留引擎隔离、源证明门禁、cache/version bounds、profile gate、LRU及no-clobber，不为追求速度降低准确性和写入安全。

本轮D盘曾显示0剩余空间。只将本轮新建的VSIX解包临时副本移动至系统临时目录的 `boo-project-audit-20261004-existing-v438-vsix` 子目录，可重新解包恢复；没有清理用户历史工件、VS Code、补丁或缓存。报告/日志仍在本项目审计目录。

## 可实现缺口与离线边界

| 类型 | 具体例子 | 本轮判断 |
| --- | --- | --- |
| 明确可修的工程缺陷 | 编码/JSONC破坏、备份被删、XLS坐标、dirty/错URI/旧行号、复制控件变型、零值/漂移、旧文档、引用/模板/设置开关 | 不应归因于游戏运行时或PAK密码；用回归反例闭环 |
| 可以改进但先量测 | 全scene hydration、目录快照、稀疏富对象、同步IO、LOD、重复compile | 不保证未经量测的“提升几倍”，按真实样本A/B决定 |
| 可以扩展但缺可靠映射/样本 | 未核profile、UIModel完整裸模/发型/特效组合、某些地图门/灯光/客户端blend | 需要格式/引擎/像素证据，不跨引擎借规则，不按猜测开放writer |
| 离线天然未知 | 当前角色背包/MakeIndex/装备实时属性、M2时刻状态、随机/玩家行为、私有插件动态回调、全部在线条件 | 可加用户预览场景或显式fixture，不等同真实在线内容；预览文字/0与源确定值保持区别 |
| 无法凭密码补出的物理数据 | 截断文件、丢索引/像素、未知加密变体而无结构证据 | 密码不能恢复不存在的数据；诊断/有证据恢复与写回能力分别管理 |

之前用户指定的五项Ctrl+F12修复、数据库滚动保持、MapInfo/MonGen链接与确认创建，本轮相关回归再次通过；没有把它们重新列成未修项。仍需原生Host和游戏客户端验收的边界保留，不将历史测试或assetRef存在当忠实绘制。

## 优先级与分批验收

P0为最高数据恢复风险，应最先核验/实施；P1为会破坏源内容、目标或关键操作的确定缺陷；P2为正确性/生命周期/一致性与重要门禁；P3为需量测的性能/维护候选。领域原始级别保留，分批顺序可以把P2依赖随P1一起修，不为统一排版强改等级。

| 批次 | 范围 | 完成的最低标准 |
| --- | --- | --- |
| A：数据与目标保护 | SQLite外部/WAL、XLS发布/恢复/backupId/原点、BIFF8失败元数据、详情文本；ROOT-01；ST01/02/03/04/08；VISUAL06 | 所有反例由红转绿；每个失败点原件/可回读备份至少一个；取消不写；外部/错误目标hash不变；版本冲突明确 |
| B：编辑保真 | UI clone、单一类型schema、无损tokenizer/serializer、零值与倒计时bias、未知片段 | 每控件10轮往返及复制生成语义相等；未知源码不丢；生成与silent同核；一次撤销与恢复保留草稿 |
| C：可用性一致 | Ctrl+F12文档重绑、变量/标签导航、模板、折叠/CodeLens、后台诊断代次、补全overlay、DeepSeek生命周期、.table入口 | 本轮行为负例全过；dirty/切文件/引擎/关闭重开/同时点击无旧结果；设置与UI状态一致；升级定制可恢复 |
| D：量测优化 | 稀疏素材内存、NPC资源lazy/快照、语言IO/装饰、地图LOD与共核 | 同一真实/合成样本A/B；正确性零回退；记录cold/warm、p50/p95、event-loop、RSS、FS/IPC和cache hit；取消停止后续工作 |
| E：交付门禁 | 正式接入反例、runner去重、统一runtimeRoot、所有动态入口/包内闭包、最终源码与VSIX摘要 | 单次编译、必需零SKIP、故意删入口必失败；干净checkout；原生Host测试关键保存/恢复/快捷键；最终发布物绑定确切源码SHA |

建议A/B/C先小步闭环，不先重构整个assistant或整个parser；复用已有正确模型与围栏。跨文件事务、安全发布、输入schema等可抽小公共模块，但应由失败案例驱动，不以“公共层更漂亮”为目标。

## 验证记录与审查限制

本轮编译和lint通过；按领域选取了现有回归文件并保存逐文件日志。统计在生成报告时跨领域去重：脚本文件数、执行次数、断言/场景数、反例数量分别记录，不能相互相加。本轮没有完整执行npm run test:all，没有运行真实M2/native菜单操作、登录真实Harness或游戏客户端，也没有对全部用户PAK/数据库逐槽/逐行测试。

首次主域runner因Windows NODE_OPTIONS反斜线和一个未传参包核验命令失败，属于审查harness错误，已修正/分离；原始原因保留在 `main-check-harness-error.json` 和临时日志中，没有计为产品缺陷。后续主域正常回归与现有包实检分别保存，避免用重跑隐藏断言失败。

主要附件目录：`../../artifacts/project-deep-audit-20261004/`。包含全量文件元数据、源码起止摘要、入口ledger、各领域发现/功能台账、临时反例脚本和结果、运行时与测试日志。HTML来自同一Markdown内容，浏览器不会执行产品代码或加载远端内容。

以下附上三个领域的全部功能和发现，以及全量公开入口附录。域内相对工件链接在总报告中会统一指向审计目录。报告提供优化顺序和验收，不代表已实施。


## 资源、补丁、数据库与表格域深度审计

审计日期：2026-10-04；manifest 版本：4.3.8。范围是读取当前源码、编译到隔离运行目录、执行既有回归和有界反例；本轮没有实施产品修复，没有写入用户真实数据库、归档、客户端或缓存。

### 结论

这个领域已经具备完整的补丁读取、精确槽索引、按需图片 Worker、100 槽工作台、严格 profile 编辑、PNG/偏移导出、批处理、动画/APNG、数据库 CRUD 与表格能力。不能把“有贡献点/解析函数”直接当作功能完整验收。本轮确认 **9 个可复现正确性/恢复缺陷**（8 个运行/故障反例，另有 1 个原生 SQLite WAL 反例），以及 1 个已测量的全量对象分配瓶颈。最先应处理的是数据保存、失败恢复和并发冲突，而不是继续增加格式写入猜测。

25 套既有测试全部通过、无跳过；另有 2 套真实 Chrome 渲染回归通过。这不与新反例冲突：正常路径已覆盖，外部修改、WAL、错误恢复、非 A1 工作表和 backupId 契约尚有缺口。数据库保存后滚动回顶的旧问题，在当前源码的 11 场景 Chrome 回归中没有复现，**不列为本轮未修问题**。

P1＝保存/恢复、数据完整性风险；P2＝确定正确性、可用性或显著容量问题；P3＝增强建议。已运行复现、单样本测量、源码确认、未验收边界分别标注。

### 功能覆盖台账（40 项）

| ID | 功能 | 当前行为/边界 | 入口源码 | 本轮验证 | 对应优化 |
|---|---|---|---|---|---|
| RDF01 | 客户端资源绑定 | 选择客户端/补丁目录，识别 data/map/wav/graphics；兼容保存状态与旧 data 路径。 | `src/utils/client-resources.ts:35` | 模型测试通过 | 增加多根会话身份与缺目录状态；不全盘猜路径。 |
| RDF02 | 资源根优先级/自定义目录 | 同名归档按所选资源根优先级定位，支持非标准补丁目录名。 | `src/utils/client-resources.ts:170` | 模型测试通过 | 可视化显示实际选中根/重名来源；避免跨引擎同名污染。 |
| RDF03 | 补丁目录扫描 | 根据 EffectImageList 等需求扫描关联包，另提供全量读取。 | `src/providers/patch-manager.ts:325` | 源审查；相关回归通过 | 扫描/哈希/重建贯穿取消，去除不必要全包富对象。 |
| RDF04 | 密码文件解析 | PAK配置/TXT 路径重定位，按明确匹配与特异性选密码，冲突不盲选。 | `src/utils/pak-password.ts:94` | pak-password测试通过 | 维持有证据的错误分级，不把格式错统一成密码错。 |
| RDF05 | 密码输入/保存 | SecretStorage 记录路径散列键，支持重输；区分确认密码错、歧义和非密码错误。 | `src/utils/pak-password.ts:16` | 模型测试通过；宿主存储未实测 | 缓存分享脱敏并保护等效解密状态，见RD14。 |
| RDF06 | 缓存恢复/重载 | 恢复缓存快照、MD5/源身份检查、显式重载和引擎/资源根关联。 | `src/utils/patch-cache.ts:1` | async快照测试通过 | 不把缓存存在当源新鲜；旧代失败发布保护见RD09。 |
| RDF07 | 精确逻辑索引 | 持久化二进制索引与summary，保持真实槽序、不压缩空槽；generation/source守卫。 | `src/utils/archive-index.ts:331` | 索引/验证/检查测试通过 | 紧凑索引+窗口懒模型，见RD10；缓存原子发布。 |
| RDF08 | legacy 整包PNG回退 | direct默认，legacy保留离线旧路径及旧缓存兼容；非JPK整包读取/逐槽PNG。 | `src/utils/pak-reader.ts:200` | 源审查，非所有实包本轮重测 | 显示成本/范围与取消；禁止把回退成功称为源修复。 |
| RDF09 | PAK家族只读解析 | GEE2/GEE3、GOM、HXM2、PACK4等分支独立解析、边界校验与诊断。 | `src/utils/pak-reader.ts:1` | 相关索引测试通过；未穷尽实包 | 逐profile证据扩展；密码正确仍无法恢复缺失数据/索引。 |
| RDF10 | 996PC/XUW JPK | GameLib/996M2头、RC4、索引/尾部处理、坏槽隔离、像素布局。 | `src/utils/jpk-reader.ts:1` | JPK编辑/索引/坏槽测试通过 | 等效解密状态保护；新格式不能强行解释为已有profile。 |
| RDF11 | WIL/WIX与WZL/WZX | 多位深、类型/flag、调色板、stride、偏移、PNG/RGBA及解压预算。 | `src/utils/wil-wzl-reader.ts:1` | reader/boundaries测试通过 | 保持未知flags/共享尾部只读；新增样本需真实客户端比对。 |
| RDF12 | 图像导入解码 | 严格PNG 8位非交错标准颜色类型、24位/不透明32位BMP，尺寸/CRC/字节预算。 | `src/resource-editor/image-codec.ts:27` | JPK/batch实际编码测试通过 | 不支持APNG/16位等输入应明确；可增加正规转换前置，不静默丢信息。 |
| RDF13 | 逻辑槽状态/诊断 | 区分indexed/unverified/decoded/recovered/empty/unsupported/corrupt及基础设施失败。 | `src/utils/archive-status.ts:1` | verification/inspection/rejected-slots通过 | 统一短文案+可展开详情，空槽不等于坏槽，解码失败不缓存假PNG。 |
| RDF14 | Worker按需图片读取 | boo-archive只读URI、pending去重、64/128MiB压缩图片LRU与解码worker池。 | `src/utils/archive-resource-provider.ts:17` | 生产worker导出/错误路径测试通过 | 按队列/耗时基线设背压；大索引主线程分配仍独立存在RD10。 |
| RDF15 | 全包验证/断点恢复 | 并行worker扫描、取消/恢复、进度与有限错误样本，源与伴随索引身份重验。 | `src/utils/archive-verification.ts:1` | 实际worker验证测试通过 | 保留已覆盖的取消和基础设施/格式错分级；新增profile先加验证样本。 |
| RDF16 | 工作台100槽浏览 | 每页100、左侧5列；输入ID定位并保留邻居、稳定逻辑ID、跨页多选与范围。 | `src/resource-editor/model.ts:3` | Chrome三视口+模型通过 | 界面分页已完成；底层全量资产对象待优化RD10。 |
| RDF17 | 素材预览/元信息 | 棋盘/黑/白背景、缩放平移、原点/偏移；未知尺寸/偏移不伪装为0。 | `src/providers/resource-editor.ts:144` | Chrome布局/PNG实际载入通过 | 继续以实际元信息区分未知和空；窄窗保持画布优先。 |
| RDF18 | PNG+偏移导出 | 当前/选中/范围/全包输出PNG、coords与流式manifest；空/坏槽保序，不覆盖目标。 | `src/resource-editor/export.ts:1` | 16组实际worker/IO测试通过 | 保持取消生成不完整清单与失败状态；编辑模式另加草稿导出可选。 |
| RDF19 | 编辑能力准入 | 仅严格JPK、GOM GAMEOFMIR2 v2、Windows特定WIL/WZL profile可编辑；其他只读。 | `src/providers/resource-editor.ts:260` | provider/core准入测试通过 | 这是安全边界不是按钮缺陷；扩展writer需独立profile及客户导入验收。 |
| RDF20 | 替换/填空/追加/清空 | 不删编号、不重新排列；严格格式可表示性、空槽与损坏槽区别。 | `src/providers/resource-editor.ts:344` | JPK/GOM/pair core通过 | 维持稳定ID与unknown字段拒绝规则，勿支持猜测重写。 |
| RDF21 | 偏移调整 | 单槽/批量绝对与相对X/Y，signed int16范围与透明画布原点。 | `src/providers/resource-editor.ts:405` | Chrome输入/4-profile批处理通过 | 对超界与不可编辑profile给准确短原因；不自动重居中。 |
| RDF22 | 撤销/重做/修订守卫 | 100级/128MiB草稿历史预算，session/document/revision校验，旧请求拒绝。 | `src/resource-editor/edit-client.ts:1` | core/provider/browser通过 | 将内存预算与UI剩余量简化展示；新增操作必须同一历史事务。 |
| RDF23 | 批量素材导入 | 按编号/顺序/追加；预检后执行，256图/64MiB预算，原子历史与取消/回滚。 | `src/resource-editor/batch.ts:7` | 4-profile实际编码批处理通过 | 保持预检与实际提交同revision；以可恢复事务处理系统写失败。 |
| RDF24 | 复制/粘贴与变换 | 素材剪贴板、裁切、翻转、缩放，并同步坐标偏移。 | `src/resource-editor/image-transform.ts:1` | batch测试通过 | 可增加数值预览/固定原点对照，不只肉眼判断。 |
| RDF25 | 动画/参考/APNG | 固定世界原点播放，空帧保留时长，参考叠加与独立APNG导出worker。 | `src/resource-editor/animation.ts:23` | 独立CRC/帧RGBA/序列/时序测试通过 | 真实客户端循环与混合另验；不把APNG验证升级成游戏导入完成。 |
| RDF26 | 安全另存/重开验证 | JPK/GOM新文件no-clobber，WIL/WZL伴随对新目录发布；重开比较、源哈希不变。 | `src/providers/resource-editor.ts:574` | JPK/GOM/pair发布故障回归通过 | 禁止误加源覆盖；只读格式writer按证据独立扩大。 |
| RDF27 | 关闭编辑标签保护 | 脏标签关闭确认；Cancel保留worker并重新开标签，取消/修订安全。 | `src/providers/resource-editor.ts:312` | 模拟宿主真实worker测试通过 | 进程崩溃草稿未持久化，见RD13；原生窗口关闭待单独验收。 |
| RDF28 | SQLite数据库目录/CRUD | 读目录/字段/rowid，保护复杂schema；单/批量更新、增删行、字段变更。 | `src/utils/database-browser.ts:341` | database-browser测试通过；冲突反例 | 优先正常保存冲突、WAL与最终发布，见RD01/RD05/RD11。 |
| RDF29 | 数据库分页/筛选/排序 | 含contains/exact、指定列/多列过滤、SQLite全局排序；稳定row身份。 | `src/utils/database-browser.ts:615` | 模型测试通过 | 大库完整COUNT/同步sql.js量化后再移worker；不要盲换驱动。 |
| RDF30 | MDB只读浏览 | mdb-reader读取、分块可取消过滤；当前明确页内排序，不宣称全局。 | `src/utils/database-browser.ts:673` | 模型测试通过；未全量实库 | 按需要增全局排序/索引；UI维持页内排序标识。 |
| RDF31 | 996PC BIFF8数据库 | cfg_item/cfg_monster/cfg_magic协议三行头保护、字段说明、行CRUD/备份撤销。 | `src/utils/biff8-database.ts:197` | database-biff8测试通过；故障反例 | 失败时元数据完整回滚RD07；最终原子发布RD11。 |
| RDF32 | 类Excel数据库网格 | Tabulator多格选区、粘贴/填充/递增、批量保存、详情联动与滚动位置保留。 | `media/database-viewer.html:1` | Chrome保存滚动11场景通过 | 旧滚动回顶问题本轮未复现，不能列为待修；原生VSCode键盘待验。 |
| RDF33 | 备份与撤销保护 | 数据库写入前备份；撤销校验修改后哈希、拒绝覆盖外部改动。 | `src/utils/database-browser.ts:519` | undo测试通过 | 正常保存也要同级冲突保护；备份≠抗断进程事务。 |
| RDF34 | 物品详情与图片 | 类型化中文字段、Looks→items资源、描述文字/素材/动画、能力分级。 | `src/utils/database-detail.ts:1` | database-detail测试通过 | 跨会话缓存与源身份显式绑定；实包画面/客户端效果另验。 |
| RDF35 | 怪物详情/身体动画 | Appr/SmartMonster等字段与MonIcons扩展动画，预算及透明度预览。 | `src/utils/database-detail.ts:1` | detail模型测试通过 | 增加代表实怪真实视觉验收，不将字段读取等于客户端全动画。 |
| RDF36 | MonItems/MonIcons编辑 | 怪物爆率/扩展图标文本，保GBK/UTF8/BOM/EOL，图标配置合法性检查。 | `src/utils/database-detail.ts:241` | detail测试通过；外部修改反例 | 保存指纹/原子写/绑定根RD06/RD15。 |
| RDF37 | CSV表格编辑 | 分隔符、引号转义、BOM/EOL保真；TextDocument编辑与原生undo/save联动。 | `src/providers/csv-editor.ts:1` | csv/table core测试通过 | 本轮未做原生宿主保存/撤销；大表按基线虚拟化。 |
| RDF38 | 通用XLS CustomEditor | 首工作表表格、其他工作表保留、公式警告、undo/redo/save/revert/backup接口。 | `src/providers/xls-editor.ts:63` | 正常路径xls测试通过；3个反例 | 修复发布最后副本/范围原点/backupId RD02/RD03/RD04。 |
| RDF39 | Merchant/MonGen表格 | .txt列说明/表格解析及空格行编辑；manifest另注册.table入口。 | `src/providers/table-editor.ts:90` | core/configs通过；selector反例 | 统一文件匹配并真开编辑器验收RD08。 |
| RDF40 | 外置缓存迁移/管理 | 扩展存储目录与旧缓存兼容、generation源身份、归档/索引/解码分层。 | `src/utils/cache-storage.ts:1` | 相关快照/索引回归通过 | 设置可见用量、保留代与安全GC；不是删除用户旧缓存来掩盖问题。 |

### 优先级问题与验收条件

#### RD01 · P1 · SQLite 普通保存可能静默覆盖外部修改

- 证据级别：isolated-runtime-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/database-browser.ts:836`，`src/utils/database-browser.ts:777`，`src/utils/database-browser.ts:798`，`src/utils/database-browser.ts:519`。
- 触发：打开数据库形成内存快照后，其他程序修改源 .db，再在扩展里保存另一个字段。
- 本轮观察：夹具外部把 Name 改成 external-edit；扩展仅改 Price=77 后，磁盘成为 Name=initial、Price=77。外部修改丢失；备份存在但正常保存未报告冲突。
- 影响：修改字段以外的数据也被旧快照回写；运行中的 M2/工具或第二编辑器可能受影响。sql.js 的 BEGIN IMMEDIATE 只锁内存库，不能锁源文件。
- 建议：每次正常保存携带读取时的源身份/哈希并重新核验；冲突保留草稿并拒绝覆盖。离线 sql.js 会话明确限制并发写入，若需在线编辑则采用原生 SQLite 连接及真实文件锁。
- 验收：外部修改字段 A、扩展修改字段 B：保留 A 或明确拒绝保存，禁止无提示回退。 拒绝时源字节不变、草稿保留；普通单/批量/新增/删除/撤销回归保持通过。
- 证据工件：`resources-data-reproduce.json`。

#### RD02 · P1 · XLS 发布与恢复同时失败时删除唯一原件

- 证据级别：isolated-fault-injection-reproduced；状态：本轮只报告，未修复。
- 源码：`src/providers/xls-editor.ts:48`，`src/providers/xls-editor.ts:50`，`src/providers/xls-editor.ts:54`，`src/providers/xls-editor.ts:59`。
- 触发：已有目标 XLS 被移动为 .original 后，临时文件→目标的 rename 失败；随后 .original→目标恢复也失败，例如权限/占用异常。
- 本轮观察：注入两次 EACCES；保存失败后 targetExists=false、originalBackups=[]，finally 删掉仍然存在的唯一原始备份。
- 影响：此故障组合会失去原始文件和可恢复副本，属于持久化安全问题，而非普通 UI 提示不足。
- 建议：用明确的发布/恢复状态机记录文件所有权；只有成功发布并验证或成功恢复后才能清理旧件。恢复失败保留 .original 并显示其位置。
- 验收：对候选写入、校验、发布 rename、恢复 rename、清理 unlink 分别故障注入。 每一失败点都至少保留一个可验证原件/备份；不得由 finally 破坏最后副本。
- 证据工件：`resources-data-reproduce.json`。

#### RD03 · P1 · XLS 非 A1 起始区域保存偏移

- 证据级别：isolated-runtime-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/xls-table.ts:17`，`src/utils/xls-table.ts:20`，`src/utils/xls-table.ts:104`，`src/utils/xls-table.ts:113`。
- 触发：首工作表有效区从 C5 等非 A1 位置开始，在表格里修改相对第二行。
- 本轮观察：源 !ref=C5:D6；保存后 !ref=A1:B2、A2=edited、C6=null。读取基于范围原点，写入却固定使用零原点。
- 影响：表格写回到错误坐标，截断范围，破坏具有前置空行/列、固定模板或非 A1 布局的表。
- 建议：XlsTableState 保留范围原点，全部增删改/缩扩/撤销按相对↔绝对坐标转换；重新计算 !ref 时保留原点与未编辑单元格。
- 验收：C5:D6 夹具修改、缩小、扩大、撤销、重开仍从 C5 起始，改动落在 C6。 稀疏单元格、样式、公式警告和非活动工作表保护回归。
- 证据工件：`resources-data-reproduce.json`。

#### RD04 · P1 · XLS CustomEditor 生成备份却未加载热退出备份

- 证据级别：provider-mock-reproduced；状态：本轮只报告，未修复。
- 源码：`src/providers/xls-editor.ts:80`，`src/providers/xls-editor.ts:195`。
- 触发：VS Code 用 CustomDocumentOpenContext.backupId 恢复未保存 XLS 草稿。
- 本轮观察：模拟宿主提供内容不同的 recovery.xls；openCustomDocument 只读取 fixture.xls，返回 Name 而非 recovered-draft。
- 影响：重载/崩溃恢复可能回到原件并丢失未保存修改；目前 backupCustomDocument 存在不代表完整恢复链可用。
- 建议：接收 openContext 并从 backupId 读取恢复内容，仍以原 URI 作为正式保存目的地；明确备份的格式、清理、取消与多文档身份。
- 验收：源与备份内容不同：打开显示备份草稿、保存仍写原 URI。 再做真实 VS Code 重载/热退出/异常退出恢复；当前证据仅为 Provider 模拟，不冒称原生恢复验收。
- 证据工件：`resources-data-reproduce.json`。

#### RD05 · P1 · SQLite 忽略已提交但仍在 WAL 的数据

- 证据级别：isolated-native-sqlite-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/database-browser.ts:211`，`src/utils/database-browser.ts:840`。
- 触发：原生 SQLite 连接处于 WAL 模式且保持打开，已提交事务还未 checkpoint 到主 .db。
- 本轮观察：Python sqlite3 读到 committed-in-wal；扩展 sql.js 只读主文件，显示 checkpointed；walPresent=true。本夹具未通过扩展写库。
- 影响：显示不是数据库真实已提交状态；若允许整库回写，将进一步放大活动库风险。单独比较主 .db 哈希不能覆盖 WAL 的真实状态。
- 建议：离线编辑路径检查 -wal/-shm/活动 journal，明确只读或拒绝；若要支持活动数据库则用原生 SQLite snapshot/锁机制。禁止猜测合并 WAL。
- 验收：WAL 已提交内容必须可见，或清楚提示受限并禁止写入。 保存/撤销不能覆盖活动库；主文件与侧文件完整保留；checkpoint 与多连接用例加入回归。
- 证据工件：`resources-data-wal.json`，`resources-data-wal-fixture.py`，`resources-data-wal.cjs`。

#### RD06 · P2 · MonItems/MonIcons 详情保存不检测外部修改

- 证据级别：isolated-runtime-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/database-detail.ts:241`，`src/utils/database-detail.ts:258`，`src/utils/database-detail.ts:267`，`src/extension.ts:308`。
- 触发：侧栏加载文本后，其他编辑器修改同一怪物文件，再保存旧草稿。
- 本轮观察：外部文本 external-edit 被旧文本+local 覆盖；existingPath 读取只用于编码/EOL，不比较加载时身份。
- 影响：爆率/图标配置的并发修改无提示丢失，直接写入也缺少数据库路径已有的备份恢复层。
- 建议：会话保存源指纹、编码/EOL 与工作区身份；保存前冲突检查，再用验证候选+可恢复原子发布。冲突保留草稿，不用磁盘新编码替旧草稿悄悄覆盖。
- 验收：外部修改触发冲突或显式合并，源字节不变且草稿保留。 GBK/UTF8/BOM/EOL 保真；MonIcons 校验、新建、取消、保存异常回归。
- 证据工件：`resources-data-reproduce.json`。

#### RD07 · P2 · 996PC BIFF8 写入失败后行数元数据未回滚

- 证据级别：isolated-fault-injection-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/biff8-database.ts:211`，`src/utils/biff8-database.ts:300`，`src/utils/biff8-database.ts:401`。
- 触发：新建行提前增加 lastDataRow/rowCount；候选写入 ENOSPC 失败后再次新建。删除流程也在发布前修改元数据。
- 本轮观察：第一次失败，第二次成功：total=3、rows=[initial,'',second-row]，预期应仅有两行。
- 影响：磁盘回滚不等于会话元数据回滚；后续操作出现空洞、错误计数/定位。
- 建议：工作簿、source 行边界与 catalog 作为同一个候选事务提交；失败恢复完整元数据或使会话重新读源，而非只释放 active workbook。
- 验收：新增/删除在序列化、验证、发布、恢复故障下文件哈希不变，行数/ID/范围正确。 失败后重试不出现空洞，三行协议头不受损；CRUD/撤销已有回归继续通过。
- 证据工件：`resources-data-reproduce.json`。

#### RD08 · P2 · merchant.table/mongen.table 注册后匹配不到编辑器

- 证据级别：provider-mock-reproduced；状态：本轮只报告，未修复；根域与脚本域去重。
- 源码：`package.json:72`，`package.json:75`，`src/utils/table-configs.ts:32`，`src/providers/table-editor.ts:95`。
- 触发：按 manifest 的 CustomEditor selector 打开 merchant.table 或 mongen.table。
- 本轮观察：merchant.table 的 matchTableFile 返回 null，resolveCustomTextEditor 在设置 HTML 前退出；generatedHtml=false。
- 影响：贡献点实际打开空编辑器；.txt 列说明装饰器/命令入口不能代替 .table 的可用实现。
- 建议：统一 selector 与真实 matcher；支持别名并映射到各自表配置，或移除无效 .table 贡献点并提供准确 .txt 入口。
- 验收：两个 manifest selector 示例均实际出表，编辑/保存/撤销/注释处理正常。 .txt 装饰器与表格入口的文案和行为清楚，不能仅靠静态贡献点测试。
- 证据工件：`resources-data-reproduce.json`。

#### RD09 · P2 · 归档缓存发布失败会先删旧 summary

- 证据级别：isolated-fault-injection-reproduced；状态：本轮只报告，未修复。
- 源码：`src/utils/archive-index.ts:1073`，`src/utils/archive-index.ts:1077`，`src/utils/archive-index.ts:1078`，`src/utils/archive-index.ts:696`。
- 触发：有效缓存更新元信息时，先删除原 summary，再 rename 临时文件；rename 被占用/权限异常阻止。
- 本轮观察：注入 EACCES 后 summaryExists=false，sourceUnchanged=true。
- 影响：丢失的是可重建缓存，不是源 PAK/JPK；导致缓存恢复失败、重索引、潜在半代目录。应与用户素材丢失严格区分。
- 建议：同目录安全替换或 generation 目录完整发布，summary 最后提交；失败保留最后有效代，避免名为 atomicWriteFile 但有可见空窗。
- 验收：失败更新后旧 summary/index 仍可用或明确保留 pending generation。 不得发布不匹配的 summary/index；源归档哈希不变；清理仅移除本操作候选。
- 证据工件：`resources-data-reproduce.json`。

#### RD10 · P2 · 100 槽分页前仍创建全包富对象数组

- 证据级别：single-run-synthetic-capacity-measured；状态：本轮只测量与报告，未优化。
- 源码：`src/utils/archive-index.ts:760`，`src/utils/archive-index.ts:765`，`src/utils/archive-index.ts:338`，`src/extension.ts:1369`，`src/extension.ts:1606`。
- 触发：打开具有接近百万个逻辑槽、绝大多数为空的合法稀疏包。
- 本轮观察：999999 空槽、文件 4,000,076 字节；返回 999999 个 DecodedPakAsset 对象。单次本机 heap 增量 183.74 MiB、RSS 192.14 MiB、elapsed 121.72ms、max event-loop gap 104.31ms。
- 影响：浏览界面虽只显示 100 槽，底层仍按全包分配/遍历，多个包累积占用与扩展宿主阻塞。不是实包解码速度或生产 p95 数据。
- 建议：保留紧凑二进制索引和 slot 状态表，按窗口懒生成展示模型；补丁侧栏/工作台避免构造并 flatMap 全包富对象。配套有上限 summary LRU 与 generation GC。
- 验收：百万稀疏槽冷打开内存接近 O(index+window)，不再仅富对象就增加约184MiB。 ID、空槽、坏槽、元信息不变；建立实包冷/热多次分布、主线程阻塞/RSS基线再定预算。
- 证据工件：`resources-data-capacity.json`，`resources-data-capacity-999999.json`。

#### RD11 · P2 · 数据库最终覆盖仍缺少断进程持久化契约

- 证据级别：source-confirmed-crash-not-reproduced；状态：静态风险，不计入9个运行复现缺陷。
- 源码：`src/utils/database-browser.ts:798`，`src/utils/database-browser.ts:530`，`src/utils/biff8-database.ts:397`。
- 触发：最终 copyFileSync 覆盖源文件过程中进程被终止/系统掉电。
- 本轮观察：源码确认候选写完后以 copyFileSync 覆盖最终源；普通异常有备份恢复，未见与资源 save-as 同级的最终原子发布/fsync/启动恢复协议。本轮未注入真实断电/杀进程。
- 影响：过程异常恢复能力与突然中断持久化能力不同；可能需要用户手动从备份恢复，不应把存在备份称为抗中断事务。
- 建议：提取公共候选验证、fsync、最终替换和恢复日志事务；SQLite/BIFF8/文本/XLS 共用明确状态与保留策略。优先结合 RD01/RD02/RD05 修复，不各造半套事务。
- 验收：各发布阶段强制终止夹具进程后重新打开：源或可验证备份仍完整。 启动识别中断事务并给出恢复路径；权限/占用/磁盘满回归不删最后副本。

#### RD12 · P3 · 补丁扫描/重建缺少端到端取消

- 证据级别：source-confirmed；状态：功能体验增强建议。
- 源码：`src/providers/patch-manager.ts:365`，`src/providers/patch-manager.ts:429`，`src/providers/patch-manager.ts:463`，`src/providers/patch-manager.ts:568`。
- 触发：大目录扫描、索引生成、legacy 整包解码期间用户切换/取消。
- 本轮观察：多处进度任务 cancellable:false；全包校验、导出与批处理已有取消，应保留并复用。
- 影响：长任务难中止，切换后无用工作仍可能执行；当前不是已复现错误覆盖。
- 建议：AbortSignal 从命令贯穿扫描/哈希/索引/legacy 解码，取消只清本操作候选，旧代可用；节流进度消息。
- 验收：目录/哈希/解析/写候选各阶段取消后快速返回，不发布半代，不影响旧缓存/源文件。 测响应延迟与残余队列；已存在校验/导出取消回归保持通过。

#### RD13 · P3 · 资源草稿目前仅在本进程内保护

- 证据级别：source-confirmed-native-crash-unverified；状态：功能增强；不是现有关闭标签逻辑失败。
- 源码：`src/providers/resource-editor.ts:312`，`src/providers/resource-editor.ts:322`，`src/resource-editor/edit-worker.ts:1`。
- 触发：编辑资源后关闭标签有确认/恢复，但扩展宿主重载或崩溃。
- 本轮观察：关闭标签保留 worker 并可在取消后重开已由测试覆盖；未见持久化 draft/change-set 恢复协议。
- 影响：进程级草稿恢复仍是边界，不应宣传成热退出/崩溃恢复已完成。
- 建议：可选持久化有版本的 change-set，绑定源 SHA/profile/revision，重启后用户确认恢复；限额、过期和隐私策略明确。
- 验收：真实宿主重载后可恢复同源草稿；源变化拒绝盲恢复，取消/删除只作用草稿。 并保持当前关闭标签确认、revision guards、undo/redo 通过。
- 证据工件：`resources-data-resource-editor-edit-provider.test.js.log`。

#### RD14 · P3 · 缓存生命周期与解密状态隐私需要产品化

- 证据级别：source-confirmed；状态：设计与隐私增强建议。
- 源码：`src/utils/archive-index.ts:121`，`src/utils/archive-index.ts:201`，`src/utils/archive-index.ts:208`，`src/utils/archive-index.ts:323`，`src/utils/archive-index.ts:1100`。
- 触发：长期加载多个包/多代缓存，或用户复制缓存目录给他人。
- 本轮观察：summaryCache 未见容量上限、generation 目录保留；JPK 等效解密状态以 base64 存于 summary。密码输入另用 SecretStorage，未发现据此网络外发。
- 影响：磁盘/内存随历史增长；base64 不是加密，缓存导出可能携带可用于解密的材料。不是明文密码或已证实泄露。
- 建议：加会话 pinned 的 LRU/代清理与缓存用量入口；根据离线需求选择加密等效状态或不持久化，明确隐私说明与诊断脱敏。
- 验收：清理不碰活跃会话/源包；多代压力下容量受控。 导出的诊断/分享缓存无密码及可复用解密材料；本地重新加载策略有测试。

#### RD15 · P3 · 数据库侧栏多根工作区身份需显式绑定

- 证据级别：source-confirmed-cross-root-not-reproduced；状态：能力边界与增强建议。
- 源码：`src/assistant.ts:3806`，`src/extension.ts:308`，`src/extension.ts:332`。
- 触发：多个 MirServer workspaceFolders 同时打开，用户在不同根查看/编辑数据库详情。
- 本轮观察：相关入口以 workspaceFolders[0] 取服务端根；本轮未构造跨根真实 UI 误写证据。
- 影响：多根场景不直观，详情/保存的服务端身份容易与当前文件预期不一致。
- 建议：按当前数据库会话显式绑定根和 Envir，侧栏显示简短服务端标识；保存携带 session/document/server 身份，不靠全局第一根。
- 验收：A/B 两根详情与保存均只作用所选会话根；切换后旧消息被拒绝。 无有效根时只读或明确选择，不能默默认另一个服务端。

### 实测与既有回归

测试从 `artifacts/project-deep-audit-20261004/runtime/out` 加载当轮新编译文件，不依赖主项目可能过时的 `out`。预加载钩子将测试的旧 out 引用重定位至隔离 runtime，真实资源 Worker 也在隔离 runtime 运行。

- 25 套独立既有测试：`database-browser.test.js`、`database-biff8.test.js`、`database-detail.test.js`、`xls-table.test.js`、`csv-table.test.js`、`table-editor-core.test.js`、`table-configs.test.js`、`resource-editor-model.test.js`、`resource-editor-export.test.js`、`resource-editor-jpk.test.js`、`resource-editor-gom.test.js`、`resource-editor-pair.test.js`、`resource-editor-batch.test.js`、`resource-editor-animation.test.js`、`resource-editor-provider.test.js`、`resource-editor-edit-provider.test.js`、`archive-index.test.js`、`archive-verification.test.js`、`archive-inspection.test.js`、`archive-rejected-slots.test.js`、`wil-wzl-reader.test.js`、`wil-wzl-boundaries.test.js`、`patch-cache-snapshot-async.test.js`、`client-resources.test.js`、`pak-password.test.js`。全部 PASS，无 FAIL/SKIP；日志逐个保存，汇总在 `resources-data-tests.json`。
- 资源工作台 Chrome：900×700、1100×800、1440×960 均 100 项；预览宽 430/594/890px；icon/PNG 实际加载。编辑栏/偏移输入存在，编辑模式浏览导出禁用。覆盖 ID 定位、跨页选区、URL 白名单、能力准入、旧修订/race 拒绝、signed int16、空槽 ID、撤销/另存/取消。证据 `resources-data-resource-browser-summary.json`；模拟宿主/归档，不是原生 VS Code。
- 数据库滚动 Chrome 154.0.8037.93：11 场景，failures=[]、appErrors=[]。单保存前后 top=1450、left=1500、row37/Value15 选中一致；批处理、重建、重复保存、失败、撤销、新增/切表等分支包含在 `database-scroll-browser/results.json`。
- 八个反例汇总 `resources-data-reproduce.json`；独立 WAL `resources-data-wal.json`；都是故障诊断成功复现，不能混入常规 PASS 总数证明功能完美。
- 百万槽稀疏容量：999999 槽 / 4,000,076 字节 / 999999 富对象；heap +183.74MiB，RSS +192.14MiB，121.72ms，最大事件循环间隙104.31ms。是合成空槽单次采样；不当作实包 decode 性能、用户 p95 或客户端表现。

### 建议实施顺序

1. RD02：先保证 XLS 发布失败不删除唯一原件；建立故障矩阵。
2. RD01/RD05，配合 RD11：确定数据库离线/在线写入准入，修复源身份冲突与 WAL，再统一候选验证/原子发布/恢复协议。
3. RD03/RD04：补 XLS 坐标原点和备份恢复链，并做真实 VS Code reload/hot exit。
4. RD06/RD07：详情文本冲突、BIFF8 失败元数据回滚；复用前述事务而非各造新路径。
5. RD08：贡献点/matcher契约；RD09：缓存保留最后有效代。
6. RD10：紧凑索引+窗口懒模型，去掉分页之前全量富对象创建，再用代表实包多次冷/热压测。
7. RD12–RD15：扫描取消、可选持久草稿、缓存隐私/GC、多根会话；作为明确能力增强，不夸大成已发现源文件损坏。

### 应保留的正确保护

- 密码/引擎/profile 分离，明确错误分类；未知 flag、尾部、索引共享/别名没有充分证据时保持只读。
- 资源工作台新文件/新目录 no-clobber 保存，源哈希保护；WIL/WZL 伴随对不能逐文件随意替换。
- 逻辑 ID 保持原索引，空槽、坏槽和不支持槽分开，不能通过压缩槽“修好”索引。
- 批处理 preflight/revision/原子历史/预算、导出与全包校验取消、基础设施错误不伪装成坏图。
- 宿主关闭标签与 worker 内存草稿恢复已有证据，但与崩溃/热退出持久恢复明确区分。

### 未验收边界

没有对真实用户数据库/素材包做写入，没有全格式穷尽、真实客户端导入、GM转换前后对照、真实 VS Code 键盘/窗口/热退出、断电/杀进程持久化验收。源代码当轮编译/测试通过也不证明现有 VSIX 已包含全部修改。未知格式、有密码但缺失的真实索引/像素，不能承诺“完美恢复”。所有建议本轮仅报告，未自动扩张为产品修改。

本域使用了 code-review-pro、boo-database-details、optimize-boo-archive-preview、diagnose-996pc-jpk 的证据分层与持久化核验方法；其影响是增加外部写入/恢复故障反例、保持严格格式准入，未修改产品功能。



## 可视化与地图功能域审查

日期：2026-10-04。版本：4.3.8。此报告只读核对当前源码与隔离运行时，没有修改产品代码、真实 MirServer、用户补丁缓存或启动游戏客户端。

完整功能台账与机器可读发现：[`domain-visual-map.json`](../../artifacts/project-deep-audit-20261004/domain-visual-map.json)。本域共 42 个功能台账条目，涵盖常规 UI 编辑器、Ctrl+F12 与两个地图查看路径。源码入口/最终消费者逐项追踪，但不宣称把超过 12,000 行的解析器每个分支逐行精读或每个语句进行了客户端等价验收。

### 主要结论

最优先的改进不是继续扩展目录中的语句，而是保护编辑语义和源文件：地图编辑目前只有行号身份；常规 UI 复制/粘贴可把输入框变成普通图片代码，往返解析可静默丢内容；Ctrl+F12 关闭后重开仍持有旧文档对象。十月二日的五项修复已复跑，未把它们当作残留问题。

| ID | 优先级 / 证据 | 位置 | 当前结果 | 建议与验收 |
|---|---|---|---|---|
| VISUAL-06 | P1 / 生产 pure helpers 复现 + Provider 源码 | `src/providers/map-preview.ts:1373`、`:1507`、`:1551`；`src/utils/map-entities.ts:332` | 画布加载后前方插入一条记录，旧乙 NPC 的第 2 行操作实际改甲 NPC 坐标与外观。刷怪/标识同样覆盖错误目标。磁盘写绕过 dirty TextDocument；Merchant→icon 两文件非事务。 | 消息携带源版本/预期原始行、检查身份；dirty 用 WorkspaceEdit；多文件候选/原子发布/备份。插行、换行、dirty、外部修改必须拒绝旧写，故障注入不能残留半保存。 |
| VISUAL-01 | P1 / Chrome 生产 HTML 复现 | `media/editor.html:6132`、`:6167`、`:6196` | `cloneElement` 是旧白名单：真实 `isInputText` 没复制，粘贴 INPUTTEXT8 生成 `<&imgex:39:2:020:030>`。按钮脚本/sendID、倒计时参数、进度条真实索引与偏移、装备名称均漏。 | 一个类型化序列化/clone 契约用于复制、窗口恢复、浮动同步；逐控件比较生成语义，只允许预定位置/ID变化。 |
| VISUAL-04 | P1 / Chrome 生产 HTML 复现 | `media/editor.html:5293`、`:5300`、`:6484`、`:6570` | 负坐标文字丢失；同一行两 TEXT 仅第一；文字 `HP:20` 丢失。生成器却可生成负坐标和冒号文字。模型减量后重新生成会丢片段。 | 统一 tokenizer/parser/serializer，保留未知片段，不能无提示以缩减模型覆盖整段。10轮往返、多标签、Unicode、负坐标、分隔符与未知源码必须不丢。 |
| VISUAL-02 | P2 / Chrome 复现；其他零字段源确认 | `media/editor.html:5071`、`:5311`、`:6365` | `fcolor=0` 与 `textColor=0` 都变 255（白）；输入边框/字色/占位色与数值上限亦有 `||` 默认问题。 | 区分 undefined/NaN 与明确 0；合法边界不得默认替换。 |
| VISUAL-03 | P2 / Chrome 复现 | `media/editor.html:5114`、`:5440`、`:6624` | COUNTDOWN(14,24) → (18,28) → (22,32)，生成加4，解析未减4。 | 对称使用已接受的 source/display bias；这不是要求取消 +4。至少10轮往返位置稳定。 |
| VISUAL-05 | P2 / 当前生产 Provider API 替身复现 | `src/providers/npc-dialog-visual.ts:814`、`:819`、`:2111` | 同 URI 关闭重开先构建 new，但 existing 分支丢弃新模型、仍绑定 closed oldDocument、发布旧内容且 conflict 保留。 | 重绑当前文档、独立保存草稿/本地路径；同URI新对象、同版本/新版本、草稿冲突分别测，随后真实 Host 重开验收。 |
| VISUAL-07 | P2 / 源码确认的优化路径，未量测用户延迟 | `src/providers/npc-dialog-visual.ts:1308`、`:1421`、`:1475` | 有素材需求时仍遍历全部 scenes，并每次 hydration 建资源扫描快照；没有当前页面选择参数。纯文字0扫描与30事件合并已修好。 | 先测冷/热 p95、目录扫描数/素材请求、event-loop/RSS，再按来源身份复用目录、当前页懒加载。不能牺牲动态素材门禁。 |
| VISUAL-08 | P3 / 候选，源码有据 | `src/assistant.ts:4122`、`:4130`、`:4159` | 简单 .map 查看器仍有独立同步解析：四个全量数组、首工作区、四舍五入单元长、middle 掩位，与原始图 strict parser 不同。obj/mid 前端存而不用。 | 共用 strict parser/server归属；只传使用字段。先测百万格开销，严格格式、多根与图层行为回归后优化。 |

### 功能台账（按用途）

#### 常规 UI 编辑器

这是“设计器”，不是 Ctrl+F12 的全部语句执行器。入口 `src/extension.ts:757`，最终画布和双向代码在 `media/editor.html`。

- 窗口/状态：独立辅助窗口、同 panel DOM 重建、草稿 JSON、位图/动画/按钮状态恢复；巨量稀疏素材目录由宿主回灌，不复制进窗口 state。
- 引擎/资源：GOM/翎风/996PC 独立参数；EffectImageList/选定缓存、最近打开、重读和关闭包、稀疏槽、包标签、ID定位、虚拟列表、透明空槽。
- 素材工具：图片/三态按钮/特效选择、100项分页、右键按钮/特效构建、Inspector/偏移/原点/帧动画/缩放；关闭按钮、装备框、进度条三种快捷导入支持缓存、默认和本地图片。
- 控件：文字/字体/字号/色/链接、图片、三态按钮、特效、倒计时、文本框、数字框、装备框、进度条、对话框 OPENMERCHANTBIGDLG 配置。设计器输入与倒计时是设计位图，不是在线用户输入或运行倒计时。
- 交互：拖动/多选/方向键、复制粘贴/删除、缩放、左右面板调整、背景位置锁定、可收起/调整的代码区；未发现设计器具有与 Ctrl+F12 同等的坐标 undo/redo 协议，不应混同。
- 代码链：手动与 silent 各一套 parser/generator，300ms 画布→代码、800ms 代码→画布。此重复结构是上述往返/零值/clone问题的主要维护根源。建议先统一模型再精简旧实现，不要求本轮实施。

#### Ctrl+F12 代码→画布

入口 `src/providers/npc-dialog-visual.ts:781`；目录→parser→preview execution→source authority→Provider hydration→`media/npc-dialog-visual.js:1708`。目录目前基础记录 GOM27 / GEE34 / 996PC42，这是记录数，**不是完整绘制覆盖率**。

- 阅读与执行：当前 @函数、可见页面与链接、GOTO/CALL/CALLEX、Defines/INCLUDE静态常量、参数和返回、跨文件源图与权限；执行有明确 source/byte/depth/step 预算。
- 条件和输入：个人标识、数值、文字、集合、称号、穿戴及分组冲突、GOM GlobalVal 初始化、Reset、可见依赖投影；这些是离线本地场景，不是在线角色状态。
- 图片及按钮：IMG、IMGEX 三态、PLAYIMG、Frames/Effect、background、九宫格/透明/灰化、文字黄下划线链接。确定值与用户显示占位严格分开，用户数字0不会取得素材 IDX 或动作权限。
- 文字及时间：TEXT、MText、rich/flow text、客户端表达式、图像数字/TextAtlas、COUNTDOWN/IMGCOUNTDOWN/TimeTips。确定显示原值，未知显示预览文字/0；来源诊断在 Inspector。
- 交互控件：input、CheckBox、Slider、MenuItem、ProgressBar/PercentImg/LoadingBar、ListView裁切/滚动条和 local scrolling、Layout尺寸/父子关系。
- 数据和角色：ITEMSHOW 的 IDX→数据库Looks→Items槽、tooltip、Light；装备与 MakeIndex 分清证明来源；CostItem、Monster、UIModel可确定部件。UIModel裸模/发型/完整特效映射以及live物品内容仍有证据/运行时限制，不能以 assetRef/DOM个数声称完整。
- ACT界面：ACT UI参数卡、ADDBUTTON、AddDlg companion/window、生命周期删除；ACT诊断卡不是任意游戏窗体已忠实模拟。
- 编辑：坐标选中/拖动/方向键/Inspector、history/undo-redo、定位源、跨文件一次 WorkspaceEdit、版本校验、保存反馈；保存多文件为顺序执行并披露部分成功，不称文件系统原子提交。
- 性能和竞争：automatic source变更80ms合并、single-flight/latest-pending、发布revision门禁、无需求不扫描、exact asset身份回检。旧任务拒绝发布≠底层计算物理取消。

#### 地图

两条入口不能混同：“.map 文件查看器”在 `src/assistant.ts:4092`，显示通行/阻挡色块与可用 MiniMap；“原始地图”在 `src/providers/map-preview.ts`，真正解析并加载 Tiles/SmTiles/Objects。

- 导航：MapInfo显示名 Ctrl+click、MonGen地图号 Ctrl+click、Merchant NPC名称定位；按源服务端归属，实例 mapId 和物理 originalMapId 分开，dirty MapInfo新定义纳入。
- 图层/格式：经典12/14/已验证36前缀、保留middle full Word、单双格 Tiles辨识；未知 ENMap/EIMap拒绝或未验证profile静态处理，不跨引擎猜动画。
- 按需加载：16×16 cell chunks、36块安全上限、request/generation/viewportSeq、500ms邻圈预取、只读URI、持久静态切片、LRU；底图只含Tiles/SmTiles，Objects保留y-major遮挡。缩小到很低比例只加载中心36块，是当前可解释但可优化的LOD边界。
- 动画：对象连续帧、tick驻留、blank透明时间槽、bit7 additive以及已验证三格锚点；GOM经典profile门控，附加资源4096/256MiB；一调度器、隐藏/切换停止。
- 永久 MAPEFFECT：QManage @Startup严格静态可达、空条件、全员visibility0、playCount=-1、drawMode0/brightness0，保留告警和扫描预算；不是M2实时所有特效。
- 实体：NPC官方/自定义外观、顶戴、名称、地图拖动、外观/移图；刷怪位置/范围/字段编辑（不模拟怪物身体AI）；StartPoint安全区规则/效果按引擎。
- 地点标识：导入、按服务器保存路径、恢复/缺失反馈、增删/文字/颜色/模式/拖动；当前source identity写保护不足。
- 右下角导航：MiniMap或已缓存区域、视口框、拖动定位、文字地点标记和去重/短文本/tooltip；缺MiniMap时不是完整全图烘焙。

### 新鲜验证与证据

运行时：父代理隔离 `tsc` 产物 `artifacts/project-deep-audit-20261004/runtime/out`。旧测试中 `../out` 硬编码通过本域 `run-visual-runtime-test.js` 虚拟入口重绑，避免把工作区旧 out 当新源码证据。使用本机 Google Chrome，版本154.0.8037.93。

| 脚本 | 本轮结果 | 证明层 |
|---|---|---|
| `visual-ui-roundtrip-probe.js` | 已复现复制、零色、COUNTDOWN漂移、负坐标、多tag/冒号丢失 | 生产HTML + 真实Chrome + Canvas/生成源码，mock宿主API，不写服务器 |
| `visual-model-probe.js` | stale行号错目标复现 | 当前生产pure update helpers + 内存synthetic记录；Provider写链静态核对 |
| `visual-provider-session-probe.js` | 关闭重开发旧model复现 | 当前生产Provider，API/document替身；不是原生VSCode |
| `preview-proofed-visual-fields.test.js` | PASS99检查 | 当前隔离模型/Provider字段，十月二日修复仍在 |
| `preview-demand-hydration.test.js` | PASS39场景 | 0需求与所有positive typed需求门禁 |
| `preview-reload-coalescing.test.js` | PASS | controlled timers、30→1及竞争生命周期 |
| `preview-variable-contracts.test.js` / `preview-inputs.test.js` | PASS | 类型发现/条件/验证 |
| `preview-execution-budget.test.js` | PASS6场景 | bounded执行与证明撤销；本轮117..489ms为synthetic基线 |
| `original-map` / `map-effects` / `map-entities` / `map-marker-state` / `map-preview` | 5个脚本PASS | 隔离out + temp/in-memory数据 |
| `map-config-links.test.js` | PASS17行为 | mock宿主，源/服务端/alias与旧入口竞争；5387行一次目录扫描 |
| `map-animation-browser.test.js` | PASS | 真实Canvas红/绿、蓝/黄像素切换、blank、150/200ms、visibility、一timer |
| `map-viewport-protocol-browser.test.js` | PASS11行为 | Chrome生产HTML，original-mode、navigator地点文字、重试、bounded预取 |

主要结果文件：`visual-ui-roundtrip-results.json`、`visual-model-results.json`、`visual-provider-session-results.json`。UI结果保存生产HTML SHA256；地图helper结果保存Provider与源helper SHA256。这些并非官方客户端pixel golden，也并非用户原始NPC/数据库完整验收。

### 建议实施顺序

1. 地图写安全与源身份（P1），防止错误记录/dirty/部分多文件覆盖。
2. UI控件clone/序列化契约（P1），先保证复制不改语义。
3. UI无损parser/generator与未知片段保留（P1），同时消掉重复实现漂移。
4. 明确零值与倒计时双向bias（P2）；不是取消全部+4。
5. Ctrl+F12当前文档对象重绑（P2），保留dirty/navigation独立状态。
6. 测量多页资源与目录冷/热成本，再做lazy/catalog复用；再统一旧.map topology reader。

不可把上述实现缺口解释成“密码/客户端运行时无法解决”；也不可把live物品、裸模/发型、地图门/光照/条件MAPEFFECT等真实边界冒充现成优化即可完美等价。当前报告给出了这两类的分界。


## 脚本语言、变量、编辑与服务工具域深度审查

审查日期：2026-10-04（Asia/Shanghai）。源码版本：4.3.8。只读审查当前工作树；保护既有 dirty 修改，未实施产品修复。当前实现与历史报告分别核对，以下缺陷均取自当前源码或隔离反例，不把历史问题直接当结论。

本域发现 5 项 P1、8 项 P2、1 项 P3 候选。10 个当前生产源码反例复现通过；41 个现有独立回归文件绑定本轮隔离编译 runtime/out 实跑通过，无 SKIP。这里的 PASS 是测试文件通过，不是客户端/原生 VS Code 验收，也不能推导所有边界已经完善。

### 建议先后顺序

1. 先关闭数据损坏和越界操作缺口：同步真实路径围栏、失败发布恢复、日志清理围栏、添加标签写入协议与目标绑定。
2. 补齐常用编辑功能的实际行为：引用/定义统一解析、模板真正可填、开关真正生效。
3. 修复异步诊断、目录自定义和 DeepSeek 会话生命周期。
4. 量测大服冷/热性能，再移动同步 I/O、建立缓存与取消协议；不要仅按文件行数宣称卡顿。

### 带证据的发现

#### ST-01 · P1 · reproduced · 同步可通过目标子目录 junction 写到所选区服之外

- 位置：`src/utils/zone-sync.ts:174`、`:187`、`:208`、`:320`；来源入口 `src/commands/zone-sync.ts:82`。
- 触发：目标根合法，但目标内 `Envir/QuestDiary` 指向外部目录。`resolveTargetPath` 只检查字符串；`mkdir/copyFile/rename` 沿实际父目录链接写入。双栏根校验也不能保护目标根内的现存子链接。
- 复现：隔离 source、target、outside；复制报告成功 1、失败 0，outside/test.txt 实际被创建。没有接触真实服务端。
- 影响：用户以为只覆盖所选其他区，实际可能覆盖另一目录甚至源服。源路径祖先链接与源/目标真实重叠也需同一机制防护。
- 建议：确认后重新锁定 realpath 根；执行前逐级 lstat/realpath 验证父目录与最终目标，禁止或显式处理链接，源与目标真实路径做重叠检查。
- 验收：目标根、子目录和最终文件 junction/链接、确认期间替换、源祖先链接等负例均拒绝；外部与源文件 SHA-256 不变；普通多区同步继续通过。

#### ST-02 · P1 · reproduced · 同步的 Windows 覆盖回退丢失原子性，失败后旧文件与候选都可能失去

- 位置：`src/utils/zone-sync.ts:304` 至 `:315`。
- 触发：rename 返回 EPERM/EACCES 等，进入 `copyFile(temporaryPath, targetPath)`；复制中断已破坏目标，finally 又无条件清临时候选。
- 复现：只对隔离目标注入 rename EPERM 和 fallback copy 中途 EIO，目标由 ORIGINAL TARGET 变成 PARTIAL；操作报告失败，但没有旧副本或完整候选留下。不是声称普通 rename 必然失败。
- 建议：不可将直接覆盖当原子发布。使用可恢复备份/候选/发布事务；无法安全替换时保留原件并报错，恢复失败保留唯一可回读备份。
- 验收：注入临时写、发布、回滚、清理失败，原件或明确可恢复副本至少一个保持可读；成功时完整内容/时间戳正确，失败不得把部分内容计成功。

#### ST-03 · P1 · reproduced · 给目标脚本添加中文标签会使 UTF-8 主体出现乱码，且绕开编辑器撤销/草稿

- 位置：`src/assistant.ts:2873` 至 `:2882`；`src/utils/text.ts:14`。
- 触发：UTF-8 目标含“转生系统”，快速修复添加 `[@新增标签]`。原件用旧 readFileGBK 读取，全文件固定 GBK 直写。
- 复现：生产命令回调从当前 AST 提取执行；最终解码为 GBK，原“转生系统”变成“杞敓绯荤粺”。准确边界：不是所有 UTF-8 原件都会损坏，纯 ASCII 新标签可能保留旧字节，但中文新增会造成混合编码或强制转码。
- 影响：中文内容损坏；磁盘写绕开 dirty 文档与一次 Ctrl+Z，目标存在未保存修改时仍按磁盘旧文本拼接。
- 建议：使用目标 TextDocument + WorkspaceEdit，并绑定源/目标版本，重复标签幂等；必须写磁盘时用 decodeTextFile/encodeTextFile 保留原编码、候选回读及原子发布。
- 验收：UTF-8/BOM/GBK、中文标签、dirty 目标、重复点击/并发点击；原主体字符和编码不变、一次撤销、无草稿丢失、失败原字节不变。

#### ST-04 · P1 · reproduced · “添加标签到当前文件”实际写任意 active editor，未绑定传入 URI

- 位置：`src/assistant.ts:2851` 至 `:2862`。
- 触发：CodeAction 源文档 A，命令执行时活动编辑器 B；只要有活动编辑器便不打开 A，直接往 B 尾部插标签。
- 复现：传入 intended-source.txt，当前为 different-active.txt，实际插入 B。
- 建议：始终以 docUri 锁定 TextDocument；编辑前复核版本及既有定义，用 WorkspaceEdit 目标 URI 或明确 showTextDocument 后绑定对象。
- 验收：快速修复弹出后切文件/分屏、无 active editor、目标 dirty/关闭；只改 A，B 字节与草稿不变；失败不宣称已创建。

#### ST-05 · P2 · reproduced · 变量引用服务仍用旧规则，与准确统计口径分裂

- 位置：`src/assistant.ts:1585`、`:1599`、`:1602`；相关悬停 `:1252`、备注 `:3665`。
- 复现：生产 References Provider 对 N$累计充值、L$abc、GL$abc、Z1 返回 0；u3 和 U003 只返回同拼写两处，漏掉额外 U3；N$rank中文 可被 ASCII 边界截为 N$rank，不是可靠完整名解析。
- 影响：新侧栏虽统计准确，右键“查找所有引用”仍漏；同一个变量的备注/悬停/报告口径不同。`$` 后名字要保持大小写，不可全局忽略大小写。
- 建议：共用 findScriptVariables/normalizeScriptVariableName 和精确 span，再统一悬停/References/备注/当前统计；纯数值变量归一、custom suffix 保留大小写。
- 验收：完整中文/混合名、N$/S$/D$/L$/GL$/Z、U3/u3/U003、相邻标识符、注释、同一行重复出现；返回完整变量范围和完整次数，不误合 N$abc/N$ABC。

#### ST-06 · P2 · reproduced · 六类脚本模板没有真正的可填参数，NPC 默认还跳未定义标签

- 位置：`src/assistant.ts:3635` 至 `:3655`。
- 复现：六个当前命令返回的 SnippetString 都是 `{1:…}`，没有 `${1:…}`。VS Code 会把它当普通字面文字，不能 Tab 到编号占位。NPC 包含 `GOTO @checkLevel`，却不包含 `[@checkLevel]`。
- 建议：按实际引擎收录可靠模板；正确转义源码 `$` 和 snippet 占位，默认输出自身闭合并通过诊断。
- 验收：六模板在真实 VS Code 插入后不残留 `{1:…}`，Tab 循环和关联字段同步有效；默认诊断无未定义标签，撤销一次完整回退；各引擎独立验证。

#### ST-07 · P2 · reproduced · 无关 HTTP 404 服务被误判为 DeepSeek 在线

- 位置：`src/providers/deepseek-view.ts:72` 至 `:78`。
- 复现：随机端口本机隔离服务返回 unrelated fixture + HTTP 404，probeDeepSeekServer 返回 true。
- 影响：错误复用端口，侧栏在线但 iframe 是别的服务或错误页；启动被错误跳过。
- 建议：就绪分为连通、服务身份/协议版本和关键前端资源；响应有大小和超时上限，401/404/重定向不能凭状态码判就绪。
- 验收：无关 200/404、认证 401、错误重定向、正确兼容服务、前端资源缺失，状态准确；不探测/关闭用户真实服务来造负例。

#### ST-08 · P1 · reproduced · 清日志的固定根目录为 junction 时会删除服务端之外的文件

- 位置：`src/utils/log-cleaner.ts:14` 至 `:22`、`:30`、`:78`；入口 `src/extension.ts:537`。
- 复现：隔离 Mir200/Log 指向隔离 outside；outside/must-not-delete.txt 被删除，返回删除 1。子目录 Dirent 不递归链接不代表入口目录本身安全。
- 建议：确认之前只读列出精确清单；确认后做真实路径和普通文件校验，拒绝所有越界入口/祖先链接；优先可恢复清理或明确导出清单与备份。
- 验收：入口/祖先/执行期间替换 junction 均拒绝，所有外部 SHA 不变；普通仅允许扩展名被清理；取消零删除，部分失败不显示全成功。

#### ST-09 · P2 · reproduced · 折叠与引用计数两个设置没有实际控制 Provider

- 位置：`package.json:618`、`:623`；`src/providers/codelens.ts:10`、`src/providers/folding.ts:9`。
- 复现：配置 get 返回 false，生产 provider 仍返回 2 个折叠、1 个引用 CodeLens。两 Provider 从未读取开关。
- 建议：按文档作用域读取选项并监听配置变化刷新；行备注是否受 CodeLens 总开关控制需明确定义。
- 验收：关闭立即不再输出，重新开启恢复；分屏与工作区配置一致；已有备注不因关闭被删除。

#### ST-10 · P2 · reproduced · 大小写不敏感的合法同文件标签，诊断承认存在但定义跳转找不到

- 位置：`src/assistant.ts:1359`、`:1404`；引用定义匹配 `:1617` 也需统一。
- 复现：`/@BUY` 指向 `[@buy]`，findUndefinedScriptLabelReferences 为 0，真正 Definition Provider 返回 null。当前同文件查找重新使用区分大小写的 RegExp('g')，没有复用已归一的定义集合。
- 建议：定义/引用/CodeLens/未使用标签统一 findScriptLabelDefinitions 与 normalizeScriptLabelKey；复用半开 span，不再多套弱正则。
- 验收：UI、GOTO、输入回调、中文/短横线、大小写、首尾空白与 BOM；返回真实定义位置，注释不命中，多定义有明确选择，不越一字符误触发。

#### ST-11 · P2 · source-confirmed · 后台磁盘诊断可覆盖草稿/新引擎/已关闭的诊断状态

- 位置：`src/assistant.ts:2093` 至 `:2098`、`:2154` 至 `:2158`、`:5097`。
- 当前代码：workspaceAuditVersion 和 cancel 在 readFile 之前检查，diagnoseFileFromDisk await 后直接 set；不消费 dirty 文档文本，发布前也没有代次/配置/版本校验。
- 触发与影响：后台审查读取期间编辑/关闭开关/切引擎；旧磁盘内容或已过期计算可能晚到，覆盖当前正确的诊断。这里没有伪称已做真实 Extension Host 调度复现。
- 建议：以 URI+documentVersion+engine+auditRevision 绑定结果，读取后/发布前复核；打开文档用快照，关闭文档走磁盘；取消不发布。
- 验收：受控 read gate：读中编辑、保存、切引擎、关闭诊断、切工作区、删除/重命名；旧代次零 publish，最后诊断只对应当前文本与引擎。

#### ST-12 · P2 · source-confirmed · 编辑内置补全直接改安装目录、多文件半成功，升级时也不保证保留

- 位置：`src/assistant.ts:4806`、`:4997` 至 `:5008`。
- 当前代码：现有条目写 extPath/data/*.json，用户新增条目才进 globalState。多个 changedFiles 逐个直接 writeFileSync，之后 globalState 更新失败会报告失败但前面文件已更改。
- 影响：修改内置命令的个人定制与新增目录生命周期不同；扩展升级替换安装目录丢定制，文件只读/第二次写失败可能半成功。
- 建议：内置数据只读，全部用户修改存版本化 overlay；校验单次保存、原子快照，失败不改变当前索引；提供导出/导入与跨版本迁移。
- 验收：修改内置、新增、第二写失败、globalState失败、重开及升级；结果全有或全无，定制可恢复，来源验证标签不被用户更改伪装成官方核验。

#### ST-13 · P2 · source-confirmed · DeepSeek 随机端口实例未被所有启动入口复用

- 位置：`src/providers/deepseek-view.ts:220` 至 `:238`、`:292`、`:323` 至 `:335`、`:160`。
- 当前代码：spawn 获取随机 `_activeUrl`，但 autoStart/startServer 只 probe 配置固定端口；startServer/openInBrowser 的启动没有共用 `_starting` 锁。openInBrowser 另把 stale `_activeUrl` 直接当可用。
- 影响：重复点击启动、面板关闭重开可能重复启动进程/隔离会话；服务已退时浏览器仍开旧地址。超时只 unref，没有解释该进程是继续启动还是已失败，也不消费 stderr。
- 建议：共用 single-flight 生命周期服务，先探 active URL 身份，再配置地址；记录启动/运行/超时/退出状态；超时由用户决定重试，不能误杀外部服务。
- 验收：连续/并发点击三入口只 spawn 一次；关闭重开复用同实例；退出/改配置不复用旧地址；慢启动/错误输出原因可读；只清理本扩展自己拥有的子进程。

#### ST-14 · P3 · candidate · 语言助手同步 I/O、全扫描与装饰事件适合先建立性能基线

- 位置：`src/assistant.ts:1034`、`:1982`、`:2229` 至 `:2311`；`src/providers/decorator.ts:26`、`:116`；`src/utils/drop-rate-external.ts:97`。
- 已确认路径：补全 readdirSync；每次诊断逐 CALL readFileSync；数据流求值同步读 INI/列表/表格；装饰每文本事件全扫描；外部爆率已有 64 文件/4MB/深度/展开预算，但仍同步执行。
- 未确认：本轮没有大服 p95、event-loop 或卡顿实测，不能把同步代码直接宣称已测慢。现有变量侧栏已做异步与350ms保存合并，不建议回退成每输入扫描。
- 建议：先对大服冷/热补全、保存、诊断、统计/爆率、装饰做 event-loop gap、p95、FS次数/RSS；命中瓶颈后分步缓存目录/外部依赖、异步有限并发、取消与代次门禁。单一 assistant.ts 超大不是独立功能缺陷。
- 验收：相同样本 A/B 测；纯编辑不重复全服扫描，取消停止后续 I/O；冷/热与低速磁盘结果分别报告，准确性测试不回退。

### 功能台账（逐入口核对，不把报告设计当已实现）

| 功能 | 入口/关键模型 | 当前能力与边界 | 已有验证/优化落位 |
| --- | --- | --- | --- |
| 引擎自动识别与切换 | assistant autoDetectEngine/toggleEngine；engine-detect/registry | 证据不足保留选择，手选优先；语言索引是工作区全局单引擎，混引擎多根不是隔离完成 | engine-detect、engine-language-isolation；按服配置需单独设计 |
| 普通/中文命令搜索补全 | Completion Provider；completion-search/range、command-index | 上下文检测/执行/SAY排序；未核参只补名称；中文搜说明 | completion-search/range、command-index |
| 变量/常量/触发/SAY/MapInfo补全 | data loader、static-language、say-markup | 当前引擎目录+可编辑 overlay；变量范围与参数模板有来源门禁 | static-language、engine-language-isolation；ST-12 |
| 标签与路径补全 | assistant:786/990 | 本文件标签；子目录展开、最多50目录条目，同步读 | completion-range、script-labels；ST-14 |
| 命令与参数悬停 | Hover Provider；command-arguments/say-markup | 参数、兼容提示、地图代码和常量说明 | command-arguments；ST-05 变量中文/大小写另补 |
| 语义高亮与文本语法 | Semantic Provider、semantic-commands、syntaxes | 流程/命令/变量/路径/标签/多级对象；名称核实与参数核实分层 | semantic-provider、semantic-commands、engine-language-isolation |
| fcolor颜色装饰/表格表头列线 | providers/decorator | 实时色块、配置列装饰/侧栏表头；活动文件全量扫描 | table-configs；ST-14 |
| 文档大纲 | providers/symbol、document-symbols | 标签/条件结构符号与位置 | document-symbols |
| 块折叠、region折叠 | providers/folding | 标签、IF/OR、region；设置无效 | ST-09；未做原生视图验收 |
| 引用计数/行备注 CodeLens | providers/codelens | 本文件引用计数；备注存workspaceState | ST-09；备注按行号会随插行漂移，需稳定锚点 |
| 标签定义/UI/GOTO跳转 | assistant Definition、script-labels | 同文档与输入回调、系统标签识别 | script-labels；ST-10 |
| 机器人与命令派生回调 | robot-definition、assistant:5259 | AutoRun→RobotManage，timer→QM，AddButton/新GOM AddDlg→同服QF/QD；异步回退dirty覆盖 | robot-definition、script-labels；数字 /@NNN 旧分支仍取首工作区，建议同服统一 |
| CALL/CALLEX/INCLUDE/普通路径导航 | utils/path、script-call-context | 标签/文件跳转，缺文件点击才确认创建，定义查询不写 | script-path-reference、script-call-context |
| Merchant/MapInfo/MonGen列导航与补建 | merchant-script；map-info-link/mongen-link；mongen-drop-files | NPC脚本、原始地图、怪物爆率，Alt+R去重确认缺失，不覆盖 | merchant-script-reference、map-config-links、mongen-drop-files/command；地图绘制归地图域 |
| 查找变量/标签引用 | References Provider | 本文件；旧边界、归一与类型遗漏 | ST-05、ST-10 |
| 代码诊断/全服代码审查 | computeDiagnostics；script-audit-scope | 标签、动态引用、IF块、CALL目标、HUMAN/GUILD与NPC路径；实时仅前1万行，主四目录后台 | conditional-drop-diagnostics、script-audit-scope；ST-11 |
| 快速修复/创建标签/缺文件 | codeAction、quickFix、createMissingFile | Ctrl+Q首选；新MonGen有确认后重验，旧标签写入不安全 | ST-03、ST-04；应把各入口安全协议统一 |
| 未使用标签 | boo.findUnusedLabels | 本文件 UI/GOTO/官方触发过滤，不等于全服入度/死代码 | script-labels；文案应明确局部参考，不建议自动删除 |
| 变量列表与保存后更新 | variable-list Scanner/Provider | 异步逐文件缓存；保存/显式操作更新，旧树保留，dirty不混保存快照，失效/代次保护 | variable-list、provider、UTAG flags；保留已改进机制 |
| 全工作区变量报告/当前脚本统计 | analyzeVariables/showStats | 全TXT vs侧栏脚本目录口径不同；报告含草稿，showStats仍旧正则；报告禁脚本但分类数靠script显示，实际可为“-” | variable-statistics、variable-candidate-command；建议同核可选范围+计数服务端插值 |
| UTAG/个人标识 | variable-statistics、variable-candidates | 编号归一、自定义后缀大小写保留；GOM/GEE1..1024、996PC0..999标志 | variable-utag-flags；不把候选范围当引用范围 |
| 嵌套变量/点击参数/外部表列表求值 | nested-variable-analysis、resolver | 有限值集合/最多512、64迭代，resolved/partial/unresolved；INI/CSV/列表/Excel文本识别 | nested-variable-analysis、personal-flag-analysis；非完整运行引擎 |
| 未用变量/标识候选 | pickUnusedScriptCandidate、candidates | 分引擎推荐，动态待核实、空/读失败阻断；含草稿，范围限定脚本 | variable-candidate-command/candidates |
| 爆率基准分析 | boo.analyzeDropRates；drop-rate-analysis | 分引擎CHILD/条件/CASE/RANDOM/BURSTRATE，BigInt分数，不伪称实际概率、不相加 | drop-rate-analysis、conditional-drop-diagnostics |
| 外部爆率CALL | drop-rate-external | 同服QD、唯一标签、预算与realpath、循环保护、源位置；CALLEX未证实不借NPC规则 | drop-rate-external、command；准确保留边界，ST-14性能量测 |
| 批量数值编辑 | Alt+X；number-transform | 加减乘除/顺序递增，多选文档顺序一次编辑 | batch-number-edit |
| 变量STR/固定颜色包裹 | Ctrl+D/Ctrl+E；variable-wrap | 注释/已包裹/动态内部排除；多选一次可撤销 | variable-wrap；Ctrl+E源码及键位作用域核对 |
| 选区大小写/全服转大写 | stringTransform/toUpperCase/toUpperCaseAll | 选区可撤销；全服原磁盘直写、首根、GBK、明确不可撤销；会改自定义大小写/字符串值 | 不等同安全语法重写；建议先diff、编码保留/备份、逐源版本检查 |
| 脚本格式化 | boo.formatScript | trim所有行+合并空行，会改变SAY缩进；不是语义保持 formatter | 建议保护SAY文本/注释/编码换行，生成diff后验样本 |
| 六类模板 | boo.insertTemplate | NPC/检测/兑换/升级/CALL/变量；当前占位失效 | ST-06 |
| 变量/行备注 | addVarDesc/addLineNote/clearLineNotes | 工作区存储不写脚本；别名未归一，行号不能跟编辑自动迁移 | ST-05；独立备注稳定锚点/配置刷新测试 |
| 常用指令收藏 | clipboardView/addToClipboard | 最多50，多行、备注、编辑/删除/复制；workspaceState，未做原生clipboard验收 | 插入入口与复制界面行为分开，补重复/并发存储/大文本测试 |
| 快捷服务端文件、自定义快捷项、全部保存 | quick-files commands/utils | 八默认文件、自定义Mir200相对路径、移除只删项、saveAll调用宿主 | quick-files；跨服回退需提示所属服，不当同服保证 |
| 颜色/位置/StdMode/地图参数/ANIS/编码参考 | showColorChart/showEquipSlots/showStdMode/showMapInfo/showAnisSymbols/detectEncoding | 参考面板/插入、不运行引擎；硬编码参考需版本化来源，颜色/符号插入应锁目标编辑器 | static-language、text-encoding；未逐项客户端核对常量表 |
| 代码补全编辑器 | boo.openCompletionEditor | 检测/执行/函数/变量/常量/SAY/custom分引擎修改，保存锁和索引刷新 | custom-language、command-index；ST-12 |
| 资源管理器多区同步 | syncToOtherZones；zone-sync | 多选、相对路径、多目标、确认、进度/取消、局部失败；当前实际路径/回退缺口 | zone-sync/command；ST-01、ST-02 |
| 双栏脚本同步 | openScriptSync；script-sync-tree | 同执行器、realpath目录枚举/输入校验，盘符选目标；不是地图/UI独立窗口 | script-sync-tree/panel；执行阶段还需ST-01 |
| M2自动/手动重载、菜单扫描 | reload、m2-target/reload-queue；native M2Reloader | 保存500ms合并、按目标exe路径/名称、排队/750ms恢复，SendMessageTimeoutW等待；未验证引擎拒绝 | m2-target、m2-reload模型/原生源码断言；本轮未启动守护进程/触发真实M2 |
| DeepSeek三入口/侧栏内嵌 | deepseek-view | 便携node/dsh检测、隔离home、随机端口、iframe/CSP、不自行请求API Key | ST-07、ST-13；本轮仅本地随机fixture，不拉起用户服务 |
| 日志清理 | cleanAllLogs | 固定目录/扩展名、确认、计数；同步删除、不可撤销 | ST-08；本轮仅隔离fixture |
| 货币/材料/保底养成预算 | 无对应交付入口 | 现有是设计建议，不能以变量数据流或爆率分析冒充已交付成本模型 | 后续独立功能：语义IR→资源账本→路径/状态→概率→对账 |

### 证据与复跑

- `script-tools-reproduce.cjs`：直接内存转译当前 TS；VS Code callback 从生产 AST 提取；10 反例，文件操作仅唯一临时目录，结束清理。
- `script-tools-reproduction-results.json`：反例观测，不包含真实服务端/账号/密钥。
- `script-tools-existing-tests.cjs` + `script-tools-runtime-hook.cjs`：41 个现有独立测试重定向 production require 到本轮隔离编译 out；历史 artifacts 输出归入本审查目录。
- `script-tools-test-results.json`：逐文件退出码、时间、stdout/stderr、SKIP识别。复跑 `node artifacts/project-deep-audit-20261004/script-tools-existing-tests.cjs`；反例 `node artifacts/project-deep-audit-20261004/script-tools-reproduce.cjs`。
- 41个文件覆盖：补全、参数、符号、标签/调用/路径/Robot/merchant/MapInfo/MonGen，变量统计/Provider/UTAG/候选/嵌套/标志/包裹，目录隔离/自定义，批量数字、快捷文件、爆率、同步和M2队列。没有 Native M2、真实编辑器鼠标快捷键、DeepSeek真实服务、真实客户端验收。
- 技能：code-review-pro、boo-script-definition-jumps、boo-variable-analysis、boo-explorer-zone-sync、add-boo-deepseek-harness-view、audit-mir-engine-language-isolation。方法是入口→纯模型→实际动作→异常/取消/发布生命周期；技能中的历史版本和宣称均再次查源。
- 记忆只用于边界提醒/测试方法：`MEMORY.md:552-554`；当前 DeepSeek 404 等结论来自本轮独立复现，不依赖历史报告。


## 全量入口与功能配置附录

快照：当前 V4.3.8 dirty 源；仅入口对账，不代表每个入口所有运行时分支均验收。完整参数、内部 executeCommand 调用和 import 边见 entry-ledger.json。

### 51 个公开命令

| 命令 | 显示名称 | 注册位置 | 快捷键 |
| --- | --- | --- | --- |
| boo.resourceEditor.open | BOO: 打开补丁资源工作台 | src/extension.ts:226 | 命令面板/页面入口 |
| boo.analyzeDropRates | BOO: 分析当前爆率（只读） | src/commands/drop-rate-analysis.ts:8 | 命令面板/页面入口 |
| boo.openEditor | BOO: 打开可视化编辑器 | src/extension.ts:534 | 命令面板/页面入口 |
| boo.openNpcDialogVisualEditor | BOO: NPC 界面可视化编辑器 | src/providers/npc-dialog-visual.ts:736 | ctrl+f12 |
| boo.showStats | BOO: 显示脚本统计 | src/assistant.ts:3030 | 命令面板/页面入口 |
| boo.formatScript | BOO: 格式化脚本 | src/assistant.ts:3103 | 命令面板/页面入口 |
| boo.showColorChart | BOO: 显示颜色代码表 | src/assistant.ts:3094 | 命令面板/页面入口 |
| boo.showEquipSlots | BOO: 显示装备位置代码表 | src/assistant.ts:3097 | 命令面板/页面入口 |
| boo.showStdMode | BOO: 显示StdMode代码表 | src/assistant.ts:3100 | 命令面板/页面入口 |
| boo.quickColor | BOO: 快速插入颜色代码 | src/assistant.ts:3154 | ctrl+f1 |
| boo.stringTransform | BOO: 大小写智能转换 | src/assistant.ts:3228 | alt+shift+u |
| boo.addVarDesc | BOO: 添加变量备注 | src/assistant.ts:3661 | 命令面板/页面入口 |
| boo.addLineNote | BOO: 添加行备注 | src/assistant.ts:3678 | 命令面板/页面入口 |
| boo.clearLineNotes | BOO: 清除所有行备注 | src/assistant.ts:3702 | 命令面板/页面入口 |
| boo.toggleEngine | BOO: 切换引擎 (GOM / 翎风 / 996PC) | src/assistant.ts:5040 | 命令面板/页面入口 |
| boo.diagnoseAll | BOO: 代码审查 (全部文件) | src/assistant.ts:3715 | 命令面板/页面入口 |
| boo.analyzeVariables | BOO: 变量统计 (全工作区) | src/assistant.ts:3718 | 命令面板/页面入口 |
| boo.batchEditNumbers | BOO: 批量编辑数值 (加减乘除/递增+) | src/assistant.ts:3177 | alt+x |
| boo.showAnisSymbols | BOO: ANIS特殊符号插入 | src/assistant.ts:3721 | 命令面板/页面入口 |
| boo.detectEncoding | BOO: 检测文件编码 | src/assistant.ts:3741 | 命令面板/页面入口 |
| boo.openDatabase | BOO: 数据库编辑器 (物品/怪物/技能) | src/assistant.ts:3757 | 命令面板/页面入口 |
| boo.openMapViewer | BOO: 地图查看器 (.map文件) | src/assistant.ts:4092 | 命令面板/页面入口 |
| boo.showMapInfo | BOO: MapInfo 地图参数参考 | src/assistant.ts:3085 | 命令面板/页面入口 |
| boo.insertTemplate | BOO: 插入脚本模板 | src/assistant.ts:3617 | 命令面板/页面入口 |
| boo.findUnusedLabels | BOO: 查找未使用的标签 | src/assistant.ts:3570 | 命令面板/页面入口 |
| boo.toUpperCase | BOO: 英文转大写 | src/assistant.ts:3298 | 命令面板/页面入口 |
| boo.toUpperCaseAll | BOO: 所有脚本英文转大写 | src/assistant.ts:3316 | 命令面板/页面入口 |
| boo.openCompletionEditor | BOO: 代码补全编辑器 | src/assistant.ts:4250 | 命令面板/页面入口 |
| boo.autoLoadSettings | BOO: 助手设置 | src/assistant.ts:3415 | 命令面板/页面入口 |
| boo.reloadM2 | BOO: M2重载 | src/reload.ts:279 | 命令面板/页面入口 |
| boo.scanM2 | BOO: 扫描M2Server菜单 | src/reload.ts:301 | 命令面板/页面入口 |
| boo.quickFix | BOO: 自动快速修复 | src/assistant.ts:2657 | ctrl+q |
| boo.createMissingFile | BOO: 创建缺失文件 | src/assistant.ts:2723 | 命令面板/页面入口 |
| boo.createMonGenDropFiles | BOO: 批量创建 MonGen 怪物爆率文件 | src/commands/mongen-drop-files.ts:11 | alt+r |
| boo.addLabelToFile | BOO: 添加标签到目标文件 | src/assistant.ts:2873 | 命令面板/页面入口 |
| boo.addLabelToCurrentFile | BOO: 添加标签到当前文件 | src/assistant.ts:2851 | 命令面板/页面入口 |
| boo.wrapVariable | BOO: 变量转STR包裹 | src/assistant.ts:3261 | ctrl+d |
| boo.wrapFColor250 | BOO: 选中文字添加 fcolor=250 | src/assistant.ts:3252 | ctrl+e |
| boo.retriggerPathComplete | BOO: 路径补全展开 | src/assistant.ts:374 | 命令面板/页面入口 |
| boo.cleanAllLogs | BOO: 一键清理所有日志 | src/extension.ts:537 | 命令面板/页面入口 |
| boo.openFontSettings | BOO: 字体设置 | src/extension.ts:450 | 命令面板/页面入口 |
| boo.addToClipboard | BOO: 加入常用指令 | src/extension.ts:518 | 命令面板/页面入口 |
| boo.refreshVariables | 刷新变量列表 | src/assistant.ts:2955 | 命令面板/页面入口 |
| boo.openColorSettings | BOO: 颜色设置 | src/extension.ts:456 | 命令面板/页面入口 |
| boo.syncToOtherZones | 同步其他区 | src/commands/zone-sync.ts:23 | 命令面板/页面入口 |
| boo.openScriptSync | BOO: 脚本同步 | src/commands/script-sync.ts:33 | 命令面板/页面入口 |
| boo.openQuickFiles | 快捷文件 | src/commands/quick-files.ts:24 | 命令面板/页面入口 |
| boo.saveAll | 全部保存 | src/commands/quick-files.ts:25 | 命令面板/页面入口 |
| boo.deepseek.openPanel | DeepSeek: 在右侧打开 AI 助手 | src/extension.ts:286 | 命令面板/页面入口 |
| boo.deepseek.openInBrowser | DeepSeek: 在浏览器中打开 | src/extension.ts:287 | 命令面板/页面入口 |
| boo.deepseek.startServer | DeepSeek: 启动本地服务 | src/extension.ts:288 | 命令面板/页面入口 |

### 7 个字面量内部命令

- `boo.pickUnusedScriptCandidate`
- `boo.gotoVarOccurrence`
- `boo.gotoVarLine`
- `boo.openMerchantNpcOnMap`
- `boo.openMapInfoOriginalMap`
- `boo.openMonGenOriginalMap`
- `boo.insertClipboardSnippet`

### 8 个活动栏视图

| 容器 | 视图 | 类型 | 名称 |
| --- | --- | --- | --- |
| boo-patch | boo.patchView | webview | 补丁管理 |
| boo-clipboard | boo.clipboardView | webview | 常用脚本指令 |
| boo-editor | boo.editorView | webview | 使用教程 |
| boo-assistant | boo.varView | tree | 变量列表 |
| boo-tools | boo.toolsView | webview | BOO脚本助手 |
| boo-database | boo.dbView | webview | 数据库 |
| boo-map-preview | boo.mapPreviewView | webview | 地图预览 |
| boo-deepseek | boo.deepseekView | webview | DeepSeek |

### 3 个 CustomEditor

| viewType | 名称 | 选择器 |
| --- | --- | --- |
| boo.tableEditor | BOO 表格视图 | merchant.table；mongen.table |
| boo.csvEditor | BOO CSV 编辑器 | *.csv |
| boo.xlsEditor | BOO XLS 编辑器 | *.xls |

### 12 个贡献设置

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| boo.completionCase | "uppercase" | 代码补全时命令名称的大小写方式 |
| boo.enableCodeLens | true | 是否在标签定义上方显示引用计数 |
| boo.enableFolding | true | 是否启用脚本块代码折叠(#IF块和标签区域) |
| boo.engine | "GOM" | 选择当前使用的传奇引擎类型（NGOM引擎922G版 / 翎风引擎 / 996PC引擎），影响命令补全、代码审查和资源读取 |
| boo.autoDetectEngine | true | 根据服务端特征自动识别引擎；证据不足时保留当前选择，不修改设置 |
| boo.archivePreviewMode | "direct" | 资源包读取方式；高速模式失败时会自动回退兼容模式，不会删除旧缓存 |
| boo.enableFColor | true | 是否在fcolor值旁显示实际颜色方块 |
| boo.diagnosticSeverity | "normal" | 脚本诊断的严格程度 |
| boo.enableCompletion | true | 启用代码补全功能 |
| boo.enableDiagnostics | true | 启用代码审查(诊断)功能 |
| boo.deepseek.host | "127.0.0.1" | DeepSeek Harness 本地服务地址 |
| boo.deepseek.port | 3080 | 复用已有 DeepSeek Harness 实例时探测的端口；本扩展新启动的服务会自动选择空闲端口 |

### 8 个快捷键与完整作用域

| 按键 | 命令 | when |
| --- | --- | --- |
| alt+r | boo.createMonGenDropFiles | editorTextFocus && resourceScheme == file && resourceFilename =~ /^mongen\.txt$/i |
| ctrl+e | boo.wrapFColor250 | editorTextFocus && editorHasSelection && !editorReadonly && editorLangId == gomscript |
| ctrl+d | boo.wrapVariable | editorTextFocus && editorHasSelection && editorLangId == gomscript |
| ctrl+q | boo.quickFix | editorTextFocus && editorLangId == gomscript |
| ctrl+f1 | boo.quickColor | editorTextFocus && editorLangId == gomscript |
| alt+shift+u | boo.stringTransform | editorTextFocus && editorHasSelection |
| alt+x | boo.batchEditNumbers | editorTextFocus && editorHasSelection |
| ctrl+f12 | boo.openNpcDialogVisualEditor | editorTextFocus && editorLangId == gomscript |

### 19 个主题与语言资产

| 主题 | 界面类型 | 文件 |
| --- | --- | --- |
| BOO Dark | vs-dark | ./themes/boo-dark-color-theme.json |
| BOO Forest | vs-dark | ./themes/boo-forest-theme.json |
| BOO Ocean | vs-dark | ./themes/boo-ocean-theme.json |
| BOO Sunset | vs-dark | ./themes/boo-sunset-theme.json |
| BOO Neon | vs-dark | ./themes/boo-neon-theme.json |
| BOO Monochrome | vs-dark | ./themes/boo-monochrome-theme.json |
| BOO Cyberpunk | vs-dark | ./themes/boo-cyberpunk-theme.json |
| BOO Aurora | vs-dark | ./themes/boo-aurora-theme.json |
| BOO Ember | vs-dark | ./themes/boo-ember-theme.json |
| BOO Mint | vs-dark | ./themes/boo-mint-theme.json |
| BOO Lavender | vs-dark | ./themes/boo-lavender-theme.json |
| BOO Crimson | vs-dark | ./themes/boo-crimson-theme.json |
| BOO Steel | vs-dark | ./themes/boo-steel-theme.json |
| BOO Amber | vs-dark | ./themes/boo-amber-theme.json |
| BOO Jade | vs-dark | ./themes/boo-jade-theme.json |
| BOO Violet | vs-dark | ./themes/boo-violet-theme.json |
| BOO Obsidian | vs-dark | ./themes/boo-obsidian-theme.json |
| BOO Coral | vs-dark | ./themes/boo-coral-theme.json |
| BOO Arctic | vs-dark | ./themes/boo-arctic-theme.json |

语言：gomscript（.txt）；TextMate：syntaxes/gom.tmLanguage.json；语言配置：language-configuration.json。.txt 与 plaintext 广泛激活是当前行为，不等于所有普通文本都是传奇脚本。

### 159 个 TS 模块的入口角色

151 个模块可由 extension.ts 与 archive-image-worker.ts 经静态 import（含类型 import）归类，其余 8 个逐项反查如下。动态入口和工具代码不能按普通 import 未命中删除；只被测试调用的产品helper另作生命周期审查。

| 源码 | 角色 |
| --- | --- |
| src/resource-editor/animation-worker.ts | 资源编辑动态 Worker 或其会话依赖；edit-client.ts、resource-editor.ts 的 new Worker 及 edit-worker imports |
| src/resource-editor/create-jpk.ts | 当前只有 resource-editor-create 测试调用；历史/备用创建helper，未发现产品入口，不把它列为用户已具备新建JPK功能 |
| src/resource-editor/edit-worker.ts | 资源编辑动态 Worker 或其会话依赖；edit-client.ts、resource-editor.ts 的 new Worker 及 edit-worker imports |
| src/resource-editor/gom-session.ts | 资源编辑动态 Worker 或其会话依赖；edit-client.ts、resource-editor.ts 的 new Worker 及 edit-worker imports |
| src/resource-editor/jpk-session.ts | 资源编辑动态 Worker 或其会话依赖；edit-client.ts、resource-editor.ts 的 new Worker 及 edit-worker imports |
| src/resource-editor/pair-session.ts | 资源编辑动态 Worker 或其会话依赖；edit-client.ts、resource-editor.ts 的 new Worker 及 edit-worker imports |
| src/utils/pak-structure-contracts.ts | 开发只读结构检查 CLI：tools/pak/inspect-structure.js；不是废弃代码 |
| src/utils/pak-structure.ts | 开发只读结构检查 CLI：tools/pak/inspect-structure.js；不是废弃代码 |

### 自动化主门禁的重复情况

只展开 package.json 中 npm run 的 shell 串联，不展开 npc-dialog-strict-suite.js 的动态矩阵：183 次顶层测试文件调用、158 个唯一文件、11 次 compile；不能拿这组数字作为断言数或总测试用例数。

| 重复测试文件 | 调用次数 |
| --- | --- |
| tests/geepak3-unicode-global.test.js | 2 |
| tests/gom-reader-tolerance.test.js | 2 |
| tests/patch-cache.test.js | 2 |
| tests/pak-password.test.js | 2 |
| tests/jpk-reader.test.js | 2 |
| tests/patch-manager.test.js | 2 |
| tests/database-browser.test.js | 2 |
| tests/database-biff8.test.js | 2 |
| tests/item-image.test.js | 2 |
| tests/minimap.test.js | 2 |
| tests/m2-target.test.js | 2 |
| tests/ui-codegen.test.js | 3 |
| tests/ui-regressions.test.js | 3 |
| tests/pak-inflate.test.js | 2 |
| tests/archive-verification.test.js | 2 |
| tests/completion-search.test.js | 2 |
| tests/script-labels.test.js | 2 |
| tests/script-call-context.test.js | 2 |
| tests/engine-language-isolation.test.js | 2 |
| tests/static-language.test.js | 2 |
| tests/engine-detect.test.js | 2 |
| tests/engine-help-data.test.js | 2 |
| tests/server-language-audit.test.js | 2 |


## 附件与可复跑入口

附件位于维护者本地 `artifacts/`，不随公开仓库提交，也不是 GitHub 下载链接。历史附件若被项目整理移出，按对应整理记录从外部归档恢复；公开源码不包含真实游戏资源或凭据。

- [audit-summary.json](../../artifacts/project-deep-audit-20261004/audit-summary.json)
- [optimization-backlog.json](../../artifacts/project-deep-audit-20261004/optimization-backlog.json)
- [inventory-summary.json](../../artifacts/project-deep-audit-20261004/inventory-summary.json)
- [file-inventory.json](../../artifacts/project-deep-audit-20261004/file-inventory.json)
- [entry-ledger.json](../../artifacts/project-deep-audit-20261004/entry-ledger.json)
- [resolved-command-ledger.json](../../artifacts/project-deep-audit-20261004/resolved-command-ledger.json)
- [source-hashes-before.json](../../artifacts/project-deep-audit-20261004/source-hashes-before.json)
- [readonly-verification.json](../../artifacts/project-deep-audit-20261004/readonly-verification.json)
- [main-probe-results.json](../../artifacts/project-deep-audit-20261004/main-probe-results.json)
- [main-check-results.json](../../artifacts/project-deep-audit-20261004/main-check-results.json)
- [package-snapshot-results.json](../../artifacts/project-deep-audit-20261004/package-snapshot-results.json)
- [dependency-audit-results.json](../../artifacts/project-deep-audit-20261004/dependency-audit-results.json)
- [resources-data-reproduce.json](../../artifacts/project-deep-audit-20261004/resources-data-reproduce.json)
- [resources-data-wal.json](../../artifacts/project-deep-audit-20261004/resources-data-wal.json)
- [resources-data-capacity.json](../../artifacts/project-deep-audit-20261004/resources-data-capacity.json)
- [script-tools-reproduction-results.json](../../artifacts/project-deep-audit-20261004/script-tools-reproduction-results.json)
- [visual-ui-roundtrip-results.json](../../artifacts/project-deep-audit-20261004/visual-ui-roundtrip-results.json)
- [visual-model-results.json](../../artifacts/project-deep-audit-20261004/visual-model-results.json)
- [visual-provider-session-results.json](../../artifacts/project-deep-audit-20261004/visual-provider-session-results.json)
- [domain-resources-data.json](../../artifacts/project-deep-audit-20261004/domain-resources-data.json)
- [domain-visual-map.json](../../artifacts/project-deep-audit-20261004/domain-visual-map.json)
- [domain-script-tools.json](../../artifacts/project-deep-audit-20261004/domain-script-tools.json)

复跑脚本保存在审计目录：audit-inventory.js（重新清点会刷新起始摘要，请用新日期目录）、main-probes.js、run-main-checks.js、resources-data-reproduce.cjs、script-tools-reproduce.cjs、visual-ui-roundtrip-probe.js、visual-model-probe.js、visual-provider-session-probe.js、package-snapshot-audit.js、verify-readonly.js、build-report.js。复跑前确保runtime/out来自对应源码，浏览器与容量任务的临时输出需有足够空间；不要把当前工件路径当干净checkout隐式依赖。

方法已按用户要求补入既有code-review-pro技能，并通过quick_validate；没有修改记忆库。报告结论依据当前源码和本轮证据，历史记忆只用于排序和验收边界提醒。
