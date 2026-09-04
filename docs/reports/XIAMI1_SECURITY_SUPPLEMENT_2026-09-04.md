# 虾米工具 `xiami1` 对 BOO 的可借鉴性审计报告

- 审计日期：2026-09-04（Asia/Shanghai）
- 上游仓库：[woshinidge/xiami1](https://github.com/woshinidge/xiami1)
- 固定审计提交：[`dc8084e0267ed6afe748b7d803b356ab415cd05f`](https://github.com/woshinidge/xiami1/tree/dc8084e0267ed6afe748b7d803b356ab415cd05f)
- 对照目标：当前工作区 BOO VS Code 扩展 `boo-ngom-editor` 4.3.4
- 审计性质：源码、仓库元数据、依赖、测试、构建和 BOO 差距的只读评估；不是法律意见

> 本文件保留为安全、构建与候选差集的补充审计。最终综合交付以 [XIAMI1_BOO_BORROWING_REPORT_2026-09-04.md](XIAMI1_BOO_BORROWING_REPORT_2026-09-04.md) 为准。

## 一、结论先行

这个仓库有值得借鉴的细节，但不值得把整个程序复制进 BOO。

上游是一个约 2.2 万行的 PySide 单体 Windows 编辑器，而 BOO 已经是 VS Code/TypeScript 扩展，并且当前 BOO 已覆盖上游多数核心卖点：中文说明反查命令、分引擎语言隔离、重复标签诊断、数字触发标签模板、Merchant 脚本跳转、缺失文件/标签 Quick Fix、快捷文件、M2 保存后重载、编辑器/搜索/多光标等。

因此建议采用“行为级借鉴 + TypeScript 重写 + BOO 现有能力增量补齐”，不要整体移植 Python 主程序，也不要建立第二套编辑器壳。

真正有增量价值的内容要按两个维度判断，不能把“小而适合立刻做”和“长期产品价值最高”混成同一个 P0：

1. **最适合立即开工的首切片**：`SetOnTimer/SetOnTimerEx` 与 `QManage.txt` 中 `[@OnTimerX]/[@OnTimerExX]` 的双向定义跳转和引用。范围小、价值明确、没有新增网络或写盘边界。
2. **长期产品价值最高、但有明确前置条件**：如果 BOO 以后要让模型直接修改工作区，应吸收文件 allowlist、两次确认、完整 diff 和未知路径拒绝，并把上游逐文件覆盖重做为一次性 `WorkspaceEdit`、批次快照和批次回滚。当前 BOO 主要是内嵌 DeepSeek Harness，因此这不是立即复制一个聊天面板的理由。
3. **低成本语言体验增量**：在 Hover 中显示手册版本、来源页面和证据状态；再基于已核验参数增加 VS Code `SignatureHelpProvider`。BOO 数据模型已保存来源，但当前 Hover 没有展示。
4. **需要逐引擎核验的数据增量**：补查 `HM.`、`HL.`、`PET.`、`BB.`、`CO.` 等上游独有作用域前缀，并可选实现“用户从本机合法持有 CHM 导入 → 候选预览 → 冲突审查 → 隔离 staging schema”。只借鉴流程，不打包第三方 CHM 或派生目录。

不应复制的部分包括：远端登录/注册/找回密码、自更新、默认 UAC 提权、无认证 localhost TCP、仓库外动态模块加载、XOR“记住密码”、直接覆盖式写盘、服务器下发 AI API Key/endpoint，以及当前仓库携带的 CHM/CSV/Markdown/bin 数据。

## 二、决策矩阵

| 上游能力 | BOO 当前事实 | 决策 | 优先级 |
| --- | --- | --- | --- |
| `SetOnTimer n` ↔ `[@OnTimern]` 跳转 | BOO 命令库有定时器语义，但 `src/`/`tests/` 未发现专门的双向导航 | 按 BOO Definition/Reference Provider 重写并补真实脚本测试 | P0（立即首切片） |
| AI 多文件 allowlist + 双确认 + Before/After | BOO 当前主要内嵌 DeepSeek Harness，没有同等的 BOO 原生批次写回闭环 | 作为未来 AI 编辑产品规格；只复用交互思想，写入事务必须重做 | P0（战略，需求触发） |
| 帮助来源、版本和证据状态可见 | BOO 的 `HelpSource` 与索引已保留 `source`，但当前命令 Hover 只显示名称、说明和已核验参数 | 在不信任 Markdown 的前提下显示来源；打开原页只走受控命令参数 | P1（低成本） |
| 活动参数卡片/参数提示 | BOO 已有 Completion、Hover、参数文本；未发现 `registerSignatureHelpProvider` | 复用现有引擎索引实现 Signature Help，不搬 Qt 弹窗 | P1 |
| `H.`/`M.`/`PET.` 等作用域前缀补全 | BOO 的单词匹配保留点号，目录中显式存在的带点命令已经可匹配；缺口是上游独有前缀的权威核验、覆盖数据与回归测试 | 只补经各引擎证明的 `HM.`、`HL.`、`PET.`、`BB.`、`CO.` 等，不把翎风规则扩散到其他引擎 | P1/P2 |
| CHM 导入并生成 isolated schema | BOO 已有分引擎语言索引和自定义语言编辑器，但无 CHM 导入 | 可选新增“隔离导入区”；默认只读、带来源与置信标记 | P2 |
| 快捷文件/目录 | BOO 已有 8 个内建文件并支持自定义 Mir200 相对路径；上游多 `StartPoint`、`AdminList`、`PlugList` 等 | 用户有高频需求时补默认项即可，不复制搜索 UI | P3 |
| 保存后 M2/NPC 重载 | BOO 已有按引擎重载项和保存触发 | 只对照多实例目标匹配与去抖测试；不复制自动提权 | P3 |
| 中文说明反查命令 | BOO 已实现中文搜索评分、filterText 和引擎标签 | 已覆盖；只做回归对照 | 不立项 |
| 重复标签诊断 | BOO 已精确标出后续定义和首个定义行 | 已覆盖 | 不立项 |
| Merchant/#CALL/GOTO/路径跳转与缺失项创建 | BOO 已有 DefinitionProvider、DocumentLink 和 Quick Fix | 已覆盖；逐项比边界用例即可 | 不立项 |
| 数字触发标签模板 | BOO 已把 `X]` 触发器生成带数字占位的 snippet | 已覆盖 | 不立项 |
| 编辑器壳、标签页、文件树、搜索、多光标、主题 | VS Code 原生与 BOO 已提供更成熟能力 | 不复制 | 放弃 |
| 登录、更新、UAC、TCP、动态模块、凭据缓存 | 有明显安全和产品边界问题 | 禁止复制 | 放弃 |

BOO 对照证据：

- 中文反查与补全：[src/assistant.ts](../../src/assistant.ts#L842-L955)
- 分引擎索引：[src/assistant.ts](../../src/assistant.ts#L650-L672)
- 数字触发模板：[src/assistant.ts](../../src/assistant.ts#L970-L997)
- 标签/路径/Merchant 定义跳转：[src/assistant.ts](../../src/assistant.ts#L1320-L1489)
- 重复标签诊断：[src/assistant.ts](../../src/assistant.ts#L1834-L1913)
- 缺失标签/文件 Quick Fix：[src/assistant.ts](../../src/assistant.ts#L2680-L2860)
- 分引擎自定义语言编辑：[src/assistant.ts](../../src/assistant.ts#L4502-L4727)
- 快捷文件与安全相对路径：[src/utils/quick-files.ts](../../src/utils/quick-files.ts#L13-L170)
- 帮助来源模型及索引保留：[src/types.ts](../../src/types.ts#L18-L42)、[src/utils/command-index.ts](../../src/utils/command-index.ts#L197-L246)
- 当前命令 Hover 输出：[src/assistant.ts](../../src/assistant.ts#L5380-L5390)
- 带点命令 token 的解析与补全：[src/assistant.ts](../../src/assistant.ts#L388-L414)、[src/assistant.ts](../../src/assistant.ts#L842-L902)

## 三、上游项目画像

### 3.1 仓库成熟度

截至审计时间，GitHub API 与固定副本显示：

- 仓库创建于 2026-09-02，最后 push 为 2026-09-02T21:35:23Z。
- 只有 2 个提交、1 个分支、0 tags、0 releases、0 Actions workflows。
- 5 stars、7 forks、0 open issues。
- HEAD 提交经 GitHub 验证；初始提交 `c5d05d0...` 为 unsigned。
- GitHub 仓库元数据 `license: null`，License API 返回 404。

这说明它是一个刚公开的源码快照，不是已经建立版本发布、持续集成和长期维护记录的成熟上游。star/fork 数不应替代构建、许可或安全证据。

### 3.2 技术栈与结构

| 项目 | 事实 |
| --- | --- |
| 主程序 | `虾米AI编辑器.py`，914,233 字节、22,184 物理行 |
| UI | PySide6；失败时尝试 PySide2 |
| 平台 | 强依赖 Windows：注册表、DPAPI、Win32 窗口消息、UAC、`hh.exe` |
| CHM 抽取 | `extract_chm_commands.py`，234,868 字节、5,496 行 |
| 可选网络/AI依赖 | requests、openai、certifi、BeautifulSoup |
| 测试 | 8 个 pytest 文件，实际收集 100 个测试 |
| 打包 | PyInstaller `onedir` 的 `EXE + COLLECT`，不是单文件 |
| 构建外部边界 | spec 把仓库同级 `../虾米工具箱` 加入 `pathex`，并声明仓库内不存在的 `toolbox_update` |

上游 README 自身也承认打包需要准备外部目录，见 [README 80–87 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/README.md#L80-L87)；spec 的实际边界见 [虾米AI编辑器.spec 6–28 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.spec#L6-L28)。

### 3.3 已证实功能组

源码中可以确认以下功能：

- Windows 桌面编辑器壳：多窗口、多标签、文件树、大纲、主题、字体、托盘、TXT 文件关联。
- 传奇脚本编辑：高亮、命令/变量/触发器补全、中文检索、Hover、参数卡片、标签大纲、书签、矩形多光标、编码和 CRLF 处理。
- 传奇语义跳转：当前/外部标签、Robot、路径、QuestDiary、Merchant、Timer、`#CALL`、`GOTO`、缺失引用创建。
- 命令知识：CSV/Markdown/bin 目录、用户 schema、isolated schema、CHM 解包与启发式抽取。
- 搜索替换：当前文件与全局搜索、正则、大小写、后台扫描。
- AI：OpenAI-compatible 请求、流式/非流式、单文件与多文件改写、历史和撤回。
- 运维壳：登录、注册、找回密码、远程配置、更新、M2/NPC 重载、单实例通信。

需要收窄宣传口径的三项：

- README 的“断点”未见调试适配器、运行时暂停或单步；源码只证实内存书签/行标记。
- 源码会生成机器 ID，但当前登录/注册 payload 未见 device 字段；本轮只证实其用于本地密码混淆，不能宣称服务端机器码绑定已实现。
- “加密命令库”是固定 key + zlib + XOR，只是混淆，不是可承担保密责任的加密。

## 四、授权与第三方内容边界

用户已说明取得作者全部授权，本报告把它视为项目背景；但公开仓库本身不是标准开源许可仓库：

- 根目录没有 `LICENSE`、`COPYING`、`NOTICE` 或 `SECURITY.md`。
- README 仅写“保留作者署名与再发布许可声明”，没有完整规定商业使用、修改、衍生、闭源发布、再许可、专利和免责声明，见 [README 94–96 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/README.md#L94-L96)。
- 程序 UI 又写有“禁止商业倒卖”及“仅限个人/非商业场景使用”，见 [主程序 2652–2668 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L2652-L2668)。这至少与商业集成存在文本冲突，需要书面澄清。

正式复制作者自有代码前，建议把授权原件与以下范围一并留档：

1. 授权主体对全部拟复制代码和资源拥有相应权利。
2. 允许 BOO 商业使用、修改、复制、打包、再分发、闭源发布和必要的再许可。
3. 授权覆盖 `xiami` 与 `woshinidge` 两个提交身份所贡献的内容。
4. 明确署名位置、授权期限、地域、是否可撤销，以及后续更新是否自动覆盖。
5. 单独列出不属于作者的第三方材料。

最重要的排除项是翎风资料。README 明确写明 CHM 及提取数据版权归翎风引擎及其作者，并要求“请勿用于商业传播”，见 [README 89–92 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/README.md#L89-L92)。因此作者对自有代码的授权不能自动覆盖：

- `翎风引擎帮助文档2026.CHM`；
- `翎风引擎2026_命令提取_高置信版.csv`；
- `翎风引擎2026_命令提取_卡片版.md`；
- 由这些内容生成的 `mir_cmd_catalog.bin`；
- 不能确认来源权利的图标及其他资源。

保守落地方式是：BOO 只吸收抽取方法和数据结构，由用户在本机选择其合法持有的手册，生成不随 BOO 发布的隔离索引；内建官方语言库仍走 BOO 现有的分引擎证据和人工复核流程。

> 本节是工程风险边界，不替代律师对具体授权文件的审查。

## 五、安全审计：哪些实现不能进入 BOO

### 5.1 明文认证与可变信任根

默认登录地址硬编码为 `http://114.66.40.205:9997/api/login`，见 [主程序 441–444 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L441-L444)。登录、注册、验证码、重置密码以及后续 bearer token 请求均沿用该 HTTP 服务。UI 还把服务器地址设为只读并隐藏，使普通用户难以确认实际目的地。

登录后的 `/api/client_config` 可以周期性下发 AI API URL、model 和 API Key；证书验证还可由环境变量关闭。结果是身份认证、token、AI 数据目的地和更新信任根都不是 BOO 可以接受的边界。

结论：登录/注册/找回、远程 `client_config` 和该套 AI 配置不能复制。BOO 应继续使用自己的授权中心；所有认证只能 HTTPS，固定可信域名，证书验证不可静默关闭，密钥不得由不受信配置服务改写。

### 5.2 自更新供应链

上游更新流程有一些正确的局部检查：`.part` 下载、SHA-256、ZIP 路径穿越检查、包内 EXE 检查。但它同时允许 HTTP/HTTPS；哈希和下载包来自同一远端；没有发布签名、固定公钥或代码签名；安装脚本用 `ExecutionPolicy Bypass`、`Expand-Archive` 和 `robocopy /E` 覆盖目录，随后执行包内 EXE。

因此 SHA-256 只能发现传输/存储损坏，不能在 HTTP 上证明发布者身份。整个更新模块应判为“禁止复制”。BOO 应继续使用受信 VSIX/宿主发布链；若将来做独立更新，至少需要 HTTPS、签名 manifest、内置公钥、版本目录、原子切换和可验证回滚。

相关证据：[URL 协议与 ZIP 校验 760–878 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L760-L878)、[SHA-256 与安装确认 19730–19792 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L19730-L19792)。

### 5.3 默认提权与本地 IPC

普通启动默认尝试 UAC 管理员权限，见 [主程序 22098–22147 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L22098-L22147)。启动后又开放随机 localhost TCP 端口，把端口/PID写入 temp/AppData lock 文件，并接受未认证的 `OPEN`、`NEW_WINDOW`、`WAKEUP` 消息，见 [主程序 20875–20973 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L20875-L20973)。

它不等于已经证实可直接远程执行代码，但会让任意本地进程影响一个可能以管理员身份运行的编辑器，显著放大攻击面。BOO 不应复制自动 UAC 或无认证 TCP。需要 helper 时，应使用最小权限、明确目标、父子 stdio/命名管道、每次启动随机 token 和协议版本握手。

### 5.4 非事务写盘

保存、单文件 AI 应用和全局替换都直接打开目标并覆盖；多文件 AI 修改逐文件提交，任一文件失败会留下部分成功状态。虽然有进程内历史和部分确认 UI，但没有批次级原子提交、持久恢复工件或完整回滚。

结论：交互可以借鉴，写盘代码不能复制。BOO 应先保存原文哈希、编码、BOM 和换行，展示完整 diff，再用一次 `WorkspaceEdit` 或临时文件 + flush + 原子替换提交；批次要有一份可审计快照和一次性回滚。

### 5.5 AI 隐私边界

上游在普通聊天且没有选区时，也可能自动附带当前文件全文；多文件编辑会发送勾选文件全文、相对路径和根目录。结合服务端可改写 endpoint，用户很难准确判断代码将发往哪里。

如果 BOO 将来实现原生 AI 改写，应默认只发选区；发送前明确列出文件、范围、字符数和 endpoint；提供敏感路径排除；不把工作区根路径、未选择文件或秘密配置自动加入上下文。

### 5.6 凭据与动态代码加载

- “记住密码”使用设备 ID 派生 key 后重复 XOR + Base64，见 [主程序 1615–1635 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/%E8%99%BE%E7%B1%B3AI%E7%BC%96%E8%BE%91%E5%99%A8.py#L1615-L1635)。这不是安全加密。
- Windows API Key 正常路径使用 DPAPI，但非 Windows fallback 只是 Base64，服务端 key 的异常路径还可能明文落盘。
- `_editor_update_module()` 会从当前目录或父级“虾米工具箱”动态加载 `toolbox_update`；结合 spec 的外部 `pathex`，构建和运行边界都不闭合。

结论：不存用户密码；token/API Key 使用 VS Code SecretStorage 或 Windows Credential Manager/DPAPI；拒绝从仓库外搜索并执行同名模块。

### 5.7 未发现的内容也要准确表述

本轮没有发现 Sentry、独立 analytics SDK、私钥或真实 `sk-*`/`nvapi-*` Key。登录、配置轮询和 AI 请求是业务网络请求，不应误称为“遥测”。程序确实读取 MachineGuid、主板/BIOS/CPU/磁盘标识，但当前登录 payload 未发现 machine ID 字段，所以只能确认其参与本地密码混淆，不能声称已上传。

## 六、命令数据与抽取器质量

### 6.1 抽取器可信度

CHM 抽取器的工程思路有价值：HTML 清洗、多编码、表格和多段格式、变量/触发标签、来源记录、卡片输出、用户 schema 与隔离模式。但它是启发式抽取器，不是引擎 parser 或运行时验证器。

尤其 `is_high_confidence_record()` 在若干过滤后最终无条件 `return True`，见 [extract_chm_commands.py 2373–2421 行](https://github.com/woshinidge/xiami1/blob/dc8084e0267ed6afe748b7d803b356ab415cd05f/extract_chm_commands.py#L2373-L2421)。因此“高置信”不能直接升级为 BOO 诊断、自动改写或跨引擎补全的权威事实。

可复现性检查还发现：

- 仓库提交的 `mir_cmd_catalog.bin`：99,512 字节，SHA-256 `36EF7081DAF134DB08765EDEDA9BFF69F3449E7FB533EDEB9BD6DE75148F2C99`。
- 当前 helper 由同仓库 CSV/Markdown 连续两次生成的结果相同，但为 98,772 字节，SHA-256 `92002C2BD2035BFE70044DA8793466DDA2A34962E719FCFD9C0CB963FA2105E9`。
- 即 helper 本轮自身确定，但 committed binary 不能由当前提交的源码/数据按现有 helper 字节复现。

建议把导入结果分为三层：

1. `raw-extracted`：原始抽取，只作搜索和人工审查。
2. `reviewed-local`：用户确认过的本机隔离 schema，不进入官方 BOO 语言库。
3. `verified-builtin`：有对应引擎手册、真实服务端样本和 BOO 回归证据，才可进入内建补全/诊断。

任何动态参数、变量拼接或不确定引擎语义都不应由静态抽取器猜值。

### 6.2 与 BOO 当前 GEE 活动索引的候选差集

本轮把上游固定提交中的 1,454 条记录按普通命令/静态 token、触发标签、变量/常量分类，并与 2026-09-04 当前 BOO 工作树的 GEE 活动索引比较。比较时纳入 BOO 活动索引中的别名、`#SAY` 静态 token、MapInfo 参数，并做 `<$$NAME>` → `NAME` 规范化，避免制造明显的假缺口。

| 类别 | 上游条目 | 被当前 GEE 活动索引覆盖 | 候选差集 | 仅 BOO 其他引擎已有 | BOO 三引擎均无 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 普通命令/静态 token | 774 | 753 | 21 | 5 | 16 |
| 触发标签 | 231 | 78 | 153 | 7 | 146 |
| 变量/常量 | 449 | 358 | 91 | 2 | 89 |
| **合计** | **1,454** | **1,189** | **265** | **14** | **251** |

这里的 265 条只能叫**候选差集**，不能叫“BOO 缺失命令”。抽查已经发现：`RACELMG` 可能是怪物攻击模式代码，`ItemCount` 很像返回字段，`PKFIRE` 可能是安全区配置参数，`NoCastleGuildName` 可能是显示配置；`BeginWeaponCurse`、`CHECKNAMELIST`、`HOUR`、`MIN` 等最终记录还缺少来源页。即使某条已存在于 BOO 另一引擎，也不能据此自动跨引擎复制。

完整 265 条记录、原页面、归一化 key、其他引擎状态、风险标记、固定输入哈希及 BOO 数据哈希见：

- 候选差集账本：`artifacts/research/xiami1-gee-candidate-ledger.json`（本地审计工件，不随仓库发布）
- 可复现生成脚本：`artifacts/research/generate-xiami1-gee-candidate-ledger.py`（本地审计工件，不随仓库发布）

账本和生成器是审计工件，不是生产语言数据；本轮没有把其中任何候选写入 `data/commands.json`、`data/variables.json` 或其他 BOO 语言目录。

## 七、构建、测试与依赖实测

所有动态测试均在临时目录完成，没有启动目标 EXE，也没有修改 BOO 现有源码。

### 7.1 固定输入

- 当前保留源码目录：`artifacts/research/xiami1-upstream`。
- 当前保留源码 ZIP：`artifacts/research/xiami1-dc8084e-source.zip`，5,739,998 字节，SHA-256 为 `AA08A195DDCE9CD3DCE3A339FF74E2003279517055E1579F282405656A991081`。
- 动态构建阶段另用过同提交的 codeload 封装（5,737,742 字节，SHA-256 `B1CB91F4C0260C790B8237A3C956C408BB6688AF5E6A42185067FB0601F4FD13`）；它与当前保留 ZIP 是不同字节级封装，不作为最终归档工件。
- 固定 HEAD：`dc8084e0267ed6afe748b7d803b356ab415cd05f`。

### 7.2 语法、测试和依赖

| 检查 | 结果 | 解释 |
| --- | --- | --- |
| `py_compile` 主程序、CHM 抽取器、目录 builder | 通过，退出码 0 | 基础语法可解析 |
| 无 PySide 环境执行 pytest | 7 个模块 collection 失败 | `QtWidgets=None` 后仍定义 Qt 子类；PySide 实际是硬依赖 |
| 按 README 安装当前最新依赖后 `pytest tests -q` | 94 passed、6 failed、11 warnings，退出码 1 | 2 个更新测试、1 个清理上下文提示、3 个 PySide6 6.11 快捷键/枚举兼容失败 |
| `pip check` | 通过，退出码 0 | 本次临时环境依赖关系自洽 |
| `pip-audit --local` | 退出码 1；只列出 `pip 25.3` 的 6 条已知漏洞记录 | 扫描的是临时测试/构建 venv，不是仓库锁定依赖；项目没有 lockfile，因此结果不能代表可重复发布基线 |

本轮解析到的顶层版本为：PySide6 6.11.2、requests 2.34.2、openai 3.8.0、certifi 2026.7.22、beautifulsoup4 4.15.0、pytest 9.1.1、PyInstaller 6.22.2。它们是 2026-09-04 当时解析出的最新版本，不是上游声明或锁定的版本。

`pip-audit` 没有在输出中列出上述项目包的漏洞，但这不等于“上游依赖安全”：一是没有锁文件，二是运行时网络、更新、提权和写盘风险来自应用逻辑而非 CVE。

### 7.3 PyInstaller 构建

在 Python 3.14.3 + PyInstaller 6.22.2 下，`pyinstaller 虾米AI编辑器.spec` 可以完成，但产物不是单文件：

- 249 个文件，总计 180,351,194 字节。
- 主 EXE 372,232 字节。
- EXE SHA-256：`26E1D55AA941EA78143DA84BF4DAA6A9228459D0B1333327B52E4CDFE01A0ACD`。
- Authenticode：`NotSigned`。
- FileVersion/ProductVersion：缺失。
- PyInstaller warning：`missing module named toolbox_update`。

这只能证明当前机器上的 fallback 构建能产出 onedir，不能证明仓库是独立、完整、可重复的发布闭包。README 没有 pin，仓库没有 lockfile、CI、tag 或 release；README 所称 Python 3.8/3.13 测试覆盖也没有公开 CI 证据。

发布还需处理 PySide6/shiboken6 的 Qt LGPL/GPL 选择与合规、requests/openai 的 Apache-2.0、certifi 的 MPL-2.0、BeautifulSoup/pytest 的 MIT，以及 PyInstaller 的许可证例外和第三方 notices。本轮构建目录中没有形成覆盖主要依赖的完整 notices 闭环。

### 7.4 为什么没有启动 EXE

没有启动最终 EXE是主动安全边界：源码显示它会默认请求 UAC，并可能连接硬编码 HTTP 登录/更新服务、启动本地 IPC。对“有哪些值得借鉴”这一只读任务，启动未知网络/提权状态的程序不是必要证据。

因此报告没有声称“最终 GUI 已通过真实开窗验收”；只确认语法、pytest、依赖检查和 PyInstaller 产物。

## 八、推荐实施路线

### 批次 A：先做一个低风险、明确增量

实现定时器双向导航：

- 静态数字参数 `SETONTIMER 3 ...` 跳到当前引擎规定的 `QManage.txt` 中 `[@OnTimer3]`。
- `SETONTIMEREX 3 ...` 只在对应引擎文档确认后映射 `[@OnTimerEx3]`。
- 从定时器标签提供“查找所有引用”，返回工作区内所有静态调用。
- 参数为变量、表达式或拼接值时不猜测目标。
- 对注释、大小写、多个 MirServer 根、缺失 QManage、多个标签、不同引擎目录布局分别测试。

这项改动小、用户价值直接，而且不会引入 Python、网络、第三方资料或新写盘路径。

### 批次 B：补齐编辑器语言体验

1. 先把现有 `source` 展示在 Hover：手册修订版、页面、证据状态；若提供“打开原页”，只允许受控命令与已校验参数，继续保持 Markdown 不受信任。
2. 用现有 `languageIndex` 实现 `SignatureHelpProvider`，只对 `completionVerified` 的语法显示活动参数。
3. 保留现有对显式带点命令名的支持；只为逐引擎核验通过的额外前缀补数据和测试，不建立跨引擎共享的推测规则。
4. 复用当前 Markdown Hover、中文搜索和引擎标签，不新建自定义补全窗口。

### 批次 C：可选 CHM 导入器

如果确有用户需求，再做独立导入功能：

1. 用户显式选择本机 CHM，并记录源文件 SHA-256。
2. 在临时 ASCII 路径调用 `hh.exe -decompile`，支持取消和清理。
3. 解析结果先进入隔离区，不自动合并 BOO 内建语言库。
4. 展示新增、冲突、低置信和来源页；用户逐批确认。
5. 保存为按引擎隔离的自定义 catalog，默认仅本机使用。
6. 不随 VSIX 打包 CHM、上游 CSV/Markdown/bin 或绝对源路径。

### 批次 D：仅在 BOO 要做原生 AI 写回时采用

这是长期产品价值最高的借鉴项，但只有在 BOO 确认要做“模型直接写工作区”时才启动。产品规格可以吸收上游的 allowlist、路径白名单、两次确认和 Before/After；实现必须增加：

- 默认只发送选区，发送前显示 endpoint、文件和范围；
- 绝对路径、`..`、符号链接逃逸和未授权路径全部拒绝；
- 完整 diff，不只显示前三行；
- 一次 `WorkspaceEdit` 或等价事务提交；
- 批次快照、编码/换行回读、外部变更冲突检测和一次性回滚；
- 敏感路径规则及明确的日志脱敏。

BOO 当前已经集成 DeepSeek Harness，所以此项不是为了复制一个新的聊天面板，而是未来如需“模型直接改工作区”时的安全门槛。

## 九、明确的复制边界

### 可以吸收

- 传奇语义行为：定时器与触发标签的映射。
- CHM 在中文路径下的多级解包 fallback 思路。
- 导入 catalog 的来源、schema、参数卡片字段设计。
- AI 多文件 allowlist、未知路径拒绝、应用前二次确认的交互原则。
- 快捷键/IME/矩形编辑中的边界测试思路。

这里的“吸收”优先指行为、数据模型和测试用例的 TypeScript 重写；即使作者授权允许复制，也应逐函数审查并保留来源记录。

### 需要重写后吸收

- CHM 抽取器：去掉上游第三方数据和宽泛“高置信”判定。
- 参数提示：改用 VS Code Completion/Hover/SignatureHelp。
- AI 改写：改成 VS Code 文档模型和批次事务。
- M2 重载：最小权限 helper、多实例明确选择、无默认 UAC。
- 配置/Secret：改用 BOO 授权中心和 SecretStorage。

### 不复制

- PySide 单体主程序及第二套编辑器壳。
- 登录、注册、验证码、找回/改密与硬编码 HTTP IP。
- 服务端动态下发 AI endpoint/API Key。
- 自更新器及 PowerShell 覆盖安装。
- 默认管理员提权。
- 无 token 的 localhost TCP 协议。
- 仓库外 `toolbox_update`/`工具箱_qt` 动态发现与加载。
- XOR 密码缓存、固定 key 命令库混淆。
- 逐文件直接覆盖式保存、全局替换与 AI 写回。
- 翎风 CHM、CSV、Markdown、bin 及权利未单独确认的图标。

## 十、实施验收门槛

任何从本报告转入 BOO 的功能，至少满足：

1. 不引入 PySide/Python 桌面运行时，不新建第二套编辑器。
2. 只使用当前选定引擎的已核验语义；跨引擎数据默认隔离。
3. 动态参数不静态猜测；无法证明的跳转返回无结果或清楚提示。
4. 写入通过 VS Code 文档/WorkspaceEdit 或原子事务，并有独立回滚证据。
5. 不新增默认外发网络、不上传未选文件、不改变 BOO 授权信任根。
6. 不把第三方 CHM 或派生数据打入 VSIX。
7. 至少运行 `npm run compile`、对应新增测试、`test:language` 中相关子集和引擎隔离回归。
8. 发布前更新第三方 notices、版本清单、包内容检查和最终 VSIX 验证。

## 十一、最终建议

建议立刻进入规格/实现的只有一个项目：定时器双向导航。随后可用很小成本补上帮助来源可见性和 Signature Help；作用域前缀只补逐引擎核验通过的缺口。CHM 导入属于有明确用户需求后再做的中型功能。

如果从长期产品价值判断，最高的是“安全的 AI 批次修改事务”，但它不是当前最适合先做的功能：必须先确认 BOO 原生 AI 写回需求和可验证的 Harness/模型协议，再建设完整 diff、URI allowlist、一次提交与批次回滚，不能照搬虾米的逐文件覆盖实现。

上游最大的价值不是“可复制代码量”，而是提供了一批真实传奇脚本编辑交互样例。BOO 当前能力已经明显高于它的整体架构和大多数编辑功能，所以最划算的做法是从差异里挑 2–4 个行为补齐，而不是并入 2.2 万行 Python、180 MB onedir、远端登录和自更新体系。

在书面授权与第三方资料边界落档之前，不把任何上游代码或数据放进正式 BOO 发布分支；授权完成后仍执行逐函数审查、TypeScript 重写、测试和来源记录。
