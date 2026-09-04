# 虾米 AI 编辑器（xiami1）对 BOO 的借鉴与复用评估报告

调研日期：2026-09-04  
上游仓库：`https://github.com/woshinidge/xiami1.git`  
上游审计提交：`dc8084e0267ed6afe748b7d803b356ab415cd05f`  
目标产品：BOO UI 编辑器 VS Code 扩展，当前工作树 manifest 版本 `4.3.4`  
结论口径：源码静态审计、上游测试/构建核验、BOO 当前源码差距核对、命令语料归一化差集；不把 README 声称或“测试文件存在”直接当作功能已经验证。

> 后续实施状态（2026-09-04）：BOO 已完成 `SetOnTimer ID` → `QManage.txt` 中 `[@OnTimerID]`，以及 `AddButton WIL ID ...` → `QFunction-0.txt` 中 `[@ButtonClickID]` 的正向定义跳转。实现只解析已核验范围内的静态十进制编号，并按源文档所属服务端锁定目标；本报告下文的“尚未实现/建议补齐”仍保留为调研时点快照。回调标签反向扫描命令引用尚未纳入本次实现。

## 1. 结论先行

这个仓库有借鉴价值，但不适合整体复制，也不适合把 2.2 万行 PySide 主程序嵌进 BOO。

真正值得 BOO 吸收的是三条主线：

1. **AI 修改的事务型交互**：目录候选勾选、发送前 allowlist、模型返回路径约束、写回前二次确认、Before/After 与撤回。这是本仓库对 BOO 最有价值的部分。BOO 应借其产品流程，使用 `WorkspaceEdit`、完整 diff、批次快照和原子回滚重新实现，不复制它逐文件直接覆盖的 Python 写回层。
2. **CHM 导入到隔离候选库的工作流**：`hh.exe` 多路径解包、命令/变量/标签抽取、来源记录、schema 切换和删除值得参考。BOO 已有更严格的分引擎目录，因此导入结果只能先进入 `unverified/staging`，不能自动混入诊断、自动修复或权威补全。
3. **少量编辑工作流补齐**：快捷打开目录、`StartPoint.txt`/`AdminList.txt`/`PlugList.txt` 等小入口，以及 `SetOnTimer n` 与 `[@OnTimern]` 的对应跳转、标签大纲同行注释。这些改动范围小，可以选择性实现。

相反，最初看起来很亮眼的多项功能，BOO 当前其实已经具备，部分实现还更完整：

- 中文说明反查命令；
- 分引擎命令、变量、触发器隔离；
- 标签大纲和重复标签诊断；
- `GOTO`、UI 标签、`#CALL/#CALLEX`、路径、Robot、Merchant 跨文件跳转；
- 缺失文件和缺失标签 Quick Fix；
- 快捷文件及用户自定义快捷文件；
- 保存后 M2 去抖、合并队列、按 M2 路径定位实例并等待命令完成；
- 多标签、搜索替换、多光标、矩形选择、书签、外部文件变化等 VS Code 原生编辑能力。

因此，**不要按上游功能清单逐项照搬**。推荐决策如下：

| 级别 | 项目 | 决策 | 复制方式 |
|---|---|---|---|
| P0 | AI 上下文选择、allowlist、完整 diff、二次确认、批次撤回 | 建议建设 | 借交互与安全门；TypeScript/VS Code 原生重写 |
| P1 | CHM 导入与 isolated schema | 有条件建设 | 借流水线；导入到未验证候选区，不自动激活 |
| P1 | 虾米命令语料差集 | 仅作审阅线索 | 生成候选账本；逐条核对来源、引擎和权限 |
| P2 | 快捷目录和 3 个缺少的常用文件 | 建议补齐 | 直接扩展 BOO 现有 Quick Pick，不新建工具壳 |
| P1 | `SetOnTimer` ↔ `[@OnTimerX]` 跳转 | 建议补齐 | 扩展 BOO 现有 Definition/Reference provider |
| P1/P2 | Signature Help 与帮助来源可见 | 建议补齐 | 复用已核验参数和现有 `source` 字段 |
| P3 | 标签大纲显示同行注释/触发说明 | 可选优化 | 填充现有 `DocumentSymbol.detail` |
| 不做 | 桌面壳、登录注册、更新器、文件关联、全局 UAC、Win32 代码整搬 | 拒绝 | 与 VS Code 架构重复且引入安全/维护风险 |

## 2. 下载、版本与证据边界

### 2.1 固定副本

此前临时下载被清理后，仓库已重新下载到非临时、且不会混入 BOO Git 变更的固定目录：

```text
<repository-root>\artifacts\research\xiami1-upstream
```

核验结果：

- 分支：`main`
- HEAD：`dc8084e0267ed6afe748b7d803b356ab415cd05f`
- 提交时间：`2026-09-03T05:35:23+08:00`
- remote：`https://github.com/woshinidge/xiami1.git`
- tracked files：26
- 仓库提交：2
- tag：0
- `git status`：clean
- `git fsck --full`：通过，无对象错误
- 克隆目录总大小（包含 `.git`）：约 12.29 MiB

主要证据文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `虾米AI编辑器.py` | `B27820DAB3A661AB6ED0950B46CD4F2CBC19DDA338BAFD3FB7648024C0650FD2` |
| `extract_chm_commands.py` | `0236B718BCC16DA429D0D6F5D7D298B669E5A325F8E9A922A9DD38B62EA2C01B` |
| `翎风引擎2026_命令提取_高置信版.csv` | `41EC5EC0B009596F260306CA70C9C4FD1FE4CF4F0D825692F6277C7597348F7B` |
| `翎风引擎帮助文档2026.CHM` | `DB8FF940ADECA0FC9B3B7E82EFACF7AA75FEB44D640BE90450964E3F31F9121D` |

### 2.2 可搬运源码快照

另外生成了只包含该提交 tracked files 的 ZIP：

```text
<repository-root>\artifacts\research\xiami1-dc8084e-source.zip
```

- 大小：5,739,998 bytes（约 5.47 MiB）
- SHA-256：`AA08A195DDCE9CD3DCE3A339FF74E2003279517055E1579F282405656A991081`
- 文件：26
- ZIP 条目：30（含目录）
- 统一根目录：`xiami1-dc8084e/`
- `..`、绝对路径或盘符型危险条目：0

### 2.3 BOO 对照快照

本报告对照的是当前本机 BOO 工作树，而不是只看旧 README：

- Git HEAD：`a74794a58199584fafb70652553575bafbbc5735`
- 当前 manifest：`4.3.4`
- HEAD 中的 manifest：`4.3.3`
- 开始本轮报告前工作区已有 118 条 `git status --short` 记录；这些是用户既有改动/工件，本轮没有覆盖、回退或清理它们。

BOO 行号引用以本轮工作树为准。上游行号引用以 `dc8084e` 为准。

CHM 的 1,042 个解包页面也已从系统 Temp 迁到固定缓存，避免候选差集依赖会被自动清理的目录：

```text
<repository-root>\artifacts\research\xiami1-chm-decompiled-dc8084e
```

- 文件：1,042
- 大小：6,667,494 bytes（约 6.36 MiB）
- 差集脚本默认直接使用这个固定缓存，无需再传 Temp 路径。

### 2.4 已做与未做

本轮做了：

- 仓库完整性和固定归档核验；
- README、主程序、CHM 抽取器、spec、配置、命令语料和测试源码交叉检查；
- BOO 当前补全、跳转、诊断、Quick Fix、符号大纲、快捷文件、分引擎索引、M2 重载和 DeepSeek 入口源码对照；
- BOO TypeScript 编译与 8 组针对性回归测试；
- 虾米语料与 BOO 当前语言索引的归一化差集初筛；
- 上游 pytest、构建闭包及 GUI 能力的可复现实测（结果见第 9 节）。

本轮没有：

- 修改虾米上游源码；
- 把虾米命令数据写入 BOO 的 `data/`；
- 实际登录虾米远程服务、提交账号密码、调用其更新接口或 AI 接口；
- 把 README 的“断点”“机器码绑定”“高置信”等宣传用语直接视为已证实事实。

## 3. 上游仓库是什么

### 3.1 结构与技术栈

| 部分 | 已确认事实 | 证据 |
|---|---|---|
| GUI | Windows PySide6，导入失败时回退 PySide2 | `虾米AI编辑器.py:1-9` |
| 主程序 | 约 914 KB、22,184 个换行；UI、编辑器、网络、登录、更新和 Win32 操作集中在单文件 | `虾米AI编辑器.py` |
| CHM 抽取器 | 约 234 KB、5,496 个换行；规则/启发式抽取命令、变量和触发标签 | `extract_chm_commands.py` |
| 数据 | CHM、1,454 项卡片/CSV 和约 99 KB 二进制目录 | 仓库根目录数据文件 |
| 测试 | 8 个 pytest 文件 | `tests/` |
| 打包 | PyInstaller `onedir`，不是 `onefile` | `虾米AI编辑器.spec:22-66` |
| 外部闭包 | spec 引用仓库外 `..\虾米工具箱`，并声明仓库中不存在的 `toolbox_update` hidden import | `虾米AI编辑器.spec:6-28` |
| 平台耦合 | 注册表、DPAPI、UAC、Win32 菜单、系统托盘、`hh.exe`、TXT 文件关联 | 主程序相应 Windows 分支 |

### 3.2 源码证实的主要功能

上游确实实现了以下能力：

- 多窗口、多标签编辑，未保存状态和外部文件变化检查；
- 常见 MIR 文本编码读取和尽量保留编码，文本保存统一 CRLF；
- 语法高亮、英文补全、中文说明反查、Hover/参数卡片；
- 用户命令 schema 和从 CHM 导入的 isolated schema；
- 标签列表、重复标签提示、当前文件/全局搜索替换；
- F1 上下文跳转：标签、路径、Merchant、Timer、`#CALL` 等；
- 23 个键盘/鼠标快捷动作、多光标与矩形编辑；
- DeepSeek/OpenAI-compatible 对话和单/多文件改写；
- 保存后调用 Windows 菜单重载 M2；
- 登录、注册、找回密码、客户端配置轮询、友情链接和更新下载；
- 自定义窗口、托盘、TXT 文件关联及提权辅助。

这说明仓库不是空壳，但“功能存在”和“适合复制进 BOO”是两件事。大量功能只是重新实现了 VS Code 已有能力，复制后会形成第二套编辑器基础设施。

## 4. 逐项差距矩阵

| 能力 | 虾米 | BOO 当前状态 | 决策 |
|---|---|---|---|
| 中文说明反查命令 | 已有，按说明/用法/来源匹配 | **已有**；仅在命令可开始的位置启用中文搜索，并按验证状态生成补全 | 不复制 |
| 分引擎隔离 | isolated schema | **已有且更严格**；按 GOM/GEE/996PC 构建命令、变量、触发器和常量索引 | 保留 BOO 方案 |
| 参数说明 | 自定义卡片、Hover | **已有** Markdown completion/hover；未确认参数只给指令名 | 不复制 UI；可继续补 Signature Help |
| 帮助来源 | 抽取结果带来源文件/CHM | BOO 数据模型/索引已经保留 `source`，但当前 Hover 未充分展示 | 补“手册版本/页面/证据状态” |
| 标签大纲 | 标签、同行注释和目录说明 | **已有** DocumentSymbol，但 `detail` 当前为空 | 只补同行注释/说明 |
| 重复标签 | 弹窗、复制、跳下一处 | **已有** DiagnosticCollection，标出后续重复定义和首次行号 | 不复制弹窗 |
| 未定义标签 | 提示并可插入 | **已有**诊断及当前/目标文件 Quick Fix | 不复制 |
| `#CALL/#CALLEX` | 路径和标签跳转 | **已有**路径解析、跨文件标签定位、缺失文件/标签创建 | 不复制 |
| Merchant NPC 脚本跳转 | 已有 | **已有**，并且 BOO 还支持地图 NPC 定位/编辑 | 不复制 |
| Robot 跨文件跳转 | 有候选逻辑 | **已有** AutoRunRobot → RobotManage 专门解析 | 不复制 |
| 普通路径跳转 | 已有，可询问创建 | **已有** Definition + DocumentLink，悬停查询无副作用、点击后才创建 | BOO 更安全 |
| `SetOnTimer` ↔ `OnTimerX` | 同文件最近项双向跳转 | 未发现专门 provider 逻辑，只有命令数据 | 可小幅补齐 |
| 数字型触发模板 | `ButtonClick7` 可匹配 `ButtonClickX` | **已有**触发器 X 模板补全；不同跳转关系仍应按引擎验证 | 仅按缺口补 |
| 快捷文件 | 9 文件 | **已有** 8 文件，并支持安全的 Mir200 相对路径自定义 | 只补 3 个缺项 |
| 快捷目录 | 6 目录 | 尚无同等 Quick Pick 目录入口 | 可补，低优先级 |
| 保存后 M2 重载 | 队列、窗口匹配、UAC fallback | **已有且更工程化**：原生 helper、目标 M2 路径、菜单名、去抖合并、超时和协议能力门 | 不复制 |
| 搜索/替换 | 当前/全局、正则、直接逐文件写 | VS Code 原生更成熟 | 不复制 |
| 多标签/多光标/矩形选择/书签 | Qt 自研 | VS Code 原生 | 不复制；只参考测试思路 |
| 外部文件变化 | 1.6 秒轮询和三选一 | VS Code 文档模型处理 | 不复制轮询 |
| AI 面板 | 内置聊天和改写协议 | 已有 DeepSeek Harness 入口，但目前主要是启动/复用服务及 iframe，没有 extension-owned 上下文/diff/apply 桥 | **主要缺口** |
| CHM 运行时导入 | 已有 | 有离线维护/审计数据链，没有最终用户运行时导入 | **条件性缺口** |
| 登录/注册/更新/友情链接 | 已有 | BOO 有自己的产品体系 | 不复制 |
| 桌面窗口壳 | PySide 自研 | VS Code 提供 | 不复制 |

BOO 关键证据：

- 中文反查与补全：`src/assistant.ts:842-957`、`src/utils/completion-search.ts:1-83`
- 分引擎索引：`src/utils/command-index.ts:198-492`、`src/utils/engine-registry.ts:20-68`
- 跨文件跳转：`src/assistant.ts:1320-1534`
- 重复标签与未定义标签：`src/assistant.ts:1846-1915`
- 缺失文件/标签 Quick Fix：`src/assistant.ts:2679-2759`
- 快捷文件：`src/utils/quick-files.ts:13-54`、`src/commands/quick-files.ts:31-200`
- 符号大纲：`src/providers/symbol.ts:9-32`
- M2 重载：`src/reload.ts:185-318`、`src/utils/reload-queue.ts:23-102`
- DeepSeek 当前边界：`src/providers/deepseek-view.ts:1-12`、`263-280`

## 5. 最值得借鉴的部分

### 5.1 P0：AI 修改的安全事务流程

#### 上游值得借的交互

多文件改写大致采用：

1. 只扫描白名单扩展名并限制单文件大小；
2. 让用户第一次勾选允许发送给模型的文件；
3. 给总上下文设上限；
4. 要求模型以 `<<<FILE:相对路径>>>` 协议返回；
5. parser 只接受第一次 allowlist 内的路径，未知路径丢弃；
6. 写回前第二次确认；
7. 显示 Before/After 摘要；
8. 保存变更历史并允许撤回。

证据：

- 文件筛选：`虾米AI编辑器.py:15633-15709`
- allowlist parser：`虾米AI编辑器.py:15588-15631`
- 上下文预算和多文件协议：`虾米AI编辑器.py:15966-16054`
- 第二次确认和写回：`虾米AI编辑器.py:15711-15801`
- Before/After、应用和撤回：`虾米AI编辑器.py:15125-15330`、`16117-16196`

#### 不能照搬的部分

上游逐文件覆盖，历史也是逐文件 LIFO；一个批次中途失败时可能形成“前几份已写、后几份没写”的半成功状态。它也没有把当前磁盘哈希、编辑器版本、外部变更冲突和整个批次绑定成一个原子事务。

#### BOO 推荐设计

由扩展宿主而不是 AI 网页直接拥有写权限：

```text
用户选择上下文
  → 扩展生成只读清单（URI、相对路径、编码、换行、SHA-256）
  → 用户确认允许发送的文件
  → DeepSeek Harness 返回结构化补丁
  → 扩展按 allowlist、realpath 和原始哈希验证
  → 打开 VS Code 完整 diff
  → 用户第二次确认
  → 单个 WorkspaceEdit 提交
  → 保存批次快照和一键回滚记录
```

最低安全规则：

- 拒绝绝对路径、盘符、UNC、`..`、NUL、目录链接逃逸和大小写绕过；
- allowlist 使用规范化 URI/realpath，而不是只比较未经规范化的字符串；
- 发送前再过滤 `.env`、凭据、授权数据库、私钥和用户自定义敏感规则；
- 记录原始文档 `version`、磁盘哈希、编码和换行；写回前任何一项变化都必须重新生成 diff；
- 模型不能创建未获授权的新路径；新文件必须单独显示并确认；
- 多文件作为一个 `changeSetId`，应用失败时恢复整个批次；
- 撤回前检查目标文件是否又被人工修改，冲突时进入三方 diff，不强行覆盖；
- AI 输出永远不能直接触发 M2 重载，只有用户确认并成功保存后才进入正常重载队列。

验收标准：

- 越界路径、未知路径、路径大小写/分隔符变体全部被拒绝；
- 文件在模型请求后被人工修改时禁止静默覆盖；
- 任意第 N 个文件应用失败，前 N-1 个也能完整恢复；
- GBK/UTF-8、CRLF/LF、未保存文档、多根工作区均有测试；
- diff 显示的是即将写入的完整结果，而不是前三行摘要；
- 一次撤回恢复整个批次。

### 5.2 P1：CHM 导入到“隔离候选库”

#### 上游值得借的流水线

- 使用 `hh.exe -decompile`；原路径失败时尝试临时副本和 ASCII 临时目录；
- 后台线程、进度和取消；
- 清洗 HTML、处理表格和实体、多编码读取；
- 提取命令、变量、触发标签；
- 保存来源文件、相对路径、CHM 和 schema；
- imported schema 标为 isolated，并允许切换和删除。

证据：

- CHM 解包：`虾米AI编辑器.py:6202-6275`
- 导入/写入 schema：`虾米AI编辑器.py:7568-7722`
- 进度、取消和删除：`虾米AI编辑器.py:9604-9760`
- HTML 清洗和多编码：`extract_chm_commands.py:459-493`
- 命令/变量/标签抽取：`extract_chm_commands.py:985-1050`、`1582-1682`、`1930-1987`
- 评分和输出：`extract_chm_commands.py:2373-2481`、`5206-5492`

#### BOO 不能沿用“导入后即使用”

“高置信”只是启发式评分，不是引擎 parser 或运行时验证。`is_high_confidence_record` 存在宽泛兜底，误分类、示例词、标题和解释文本都可能进入结果。不同引擎同名指令也可能参数完全不同。

#### BOO 推荐数据状态

```text
imported-unreviewed
  → normalized
  → source-linked
  → engine-assigned
  → human-reviewed
  → completion-enabled
  → diagnostic/autofix-enabled（需要更高证据等级）
```

每条至少保存：

- `importId`、CHM SHA-256、来源页和页内证据片段；
- 目标引擎、原始 token、规范化 token、类型；
- 原始用法、参数、说明和抽取器版本；
- `confidence` 与具体理由，而不是只有一个“高置信”布尔值；
- 冲突状态、人工审核人/时间、是否允许补全、诊断和自动修复。

导入数据默认只能被搜索和预览；只有确认过的条目才能进入当前引擎补全。诊断和自动修复应采用更高门槛，不能因为 CHM 中出现一次就开启。

### 5.3 P1/P2：Signature Help 与帮助来源可见

BOO 已经注册 Completion、Hover、Definition、DocumentLink、Reference 和 CodeAction；本轮没有找到 `registerSignatureHelpProvider`。当前 Hover 可以根据光标显示参数说明，但原生 Signature Help 在连续输入参数时更稳定，也更符合 VS Code 使用习惯。

建议：

- 仅对已经核验 `params`、`minArgs`、`maxArgs` 或完整 syntax 的指令启用；
- 仅确认名字的指令继续只显示名字，不能根据上游卡片猜参数；
- 不同引擎同名指令分别生成签名；
- 动态/变长参数明确显示可变部分，不用伪精确占位符；
- 以现有 argument parser 计算 active parameter，覆盖引号、方括号、嵌套变量和空参数测试。

BOO 的 `HelpSource`、命令变体和 `IndexedCommand` 已保留来源信息，但当前主要 Hover 仍偏向名称、说明和参数。建议在底部增加：引擎、手册修订版、来源页面、证据状态和受控“打开原页”命令。外部路径不能作为可信 Markdown command URI 直接执行。

证据：`src/types.ts:18-46`、`src/utils/command-index.ts:27-46`、`src/assistant.ts:1121-1200`、`5380-5390`。

### 5.4 P1：命令语料只做差集候选，不直接合并

上游卡片声明共有 1,454 项：

- 774 个普通命令 token；
- 449 个变量；
- 231 个标签/触发器。

以 BOO 当前 `GEE` 活跃语言索引作为与翎风最接近的对照，按名称大小写、外层 `[]/@/<$...>` 等做归一化后的初筛为：

| 类型 | 上游数量 | BOO 当前 GEE 名称覆盖 | GEE 名称差集 | 差集中在 BOO 其他引擎可见 | BOO 全引擎均未见的候选 |
|---|---:|---:|---:|---:|---:|
| 普通命令 | 774 | 753（97.3%） | 21 | 5 | 16 |
| 标签/触发器 | 231 | 78（33.8%） | 153 | 7 | 146 |
| 变量 | 449 | 358（79.7%） | 91 | 2 | 89 |
| 合计 | 1,454 | 1,189（81.8%） | 265 | 14 | 251 |

这组数字只是**名称级候选筛选**，不能解释为“BOO 缺 251 条正确命令”：

- 翎风不等于 GEE，不能因为名字相似就跨 profile；
- 上游类型分类含启发式结果，标签、变量和普通标题可能互相误分；
- BOO 可能已在帮助审计原始数据中看到，但没有进入当前 active index；
- 同名存在也不代表语法、参数、返回值和适用版本相同；
- 上游自带硬编码兜底与提取器结果混合，来源等级不一致；
- 第三方 CHM/派生数据的再分发权限需要单独确认。

因此正确做法是输出候选账本，逐项查 BOO 现有引擎帮助和真实服务端样本；不是把 CSV 转成 JSON 后合并。

本轮已生成两个可复现、且不修改 BOO `data/` 的审计工件：

```text
artifacts/research/xiami1-gee-candidate-ledger.json
artifacts/research/generate-xiami1-gee-candidate-ledger.py
```

复算命令：

```powershell
python -X utf8 artifacts/research/generate-xiami1-gee-candidate-ledger.py
```

固定缓存复算结果与上表完全一致。账本逐条保留 token、规范化 key、上游用法/说明、来源页面、BOO 各引擎出现状态、风险标志和人工审阅结论。

抽查已经证明“名称差集不等于真实命令缺失”：

- `RACELMG` 来自 `DB数据库资料/Monster详解.html`，内容实际是怪物攻击模式代码，不能直接当 NPC 脚本命令；
- `ItemCount` 的抽取用法为 `ItemCount : ...`，形态更像返回字段；
- `PKFIRE`、`SECRET`、`NoCastleGuildName`、`HERO1` 有地图参数、显示配置、示例常量或类别误判风险；
- `BeginWeaponCurse`、`CHECKNAMELIST`、`HOUR`、`MIN`、`M.CheckStateValue`、`ReleaseShutup` 在最终记录中没有来源页，不能开启补全；
- `BindUseItem`、`H.CHANGETRANPOINT`、`H.GETITEMADDVALUE`、`H.ItemFluteStoneEx`、`H.READSKILLNG`、`HAIRCOLOR`、`MAP`、`RESET` 有明确来源页，可进入第一批人工核验，但仍不是自动批准。

21 个普通命令型候选完整清单：

```text
AUTOCOLOR
BeginWeaponCurse
BindUseItem
CHECKNAMELIST
H.CHANGETRANPOINT
H.GETITEMADDVALUE
H.ItemFluteStoneEx
H.READSKILLNG
HERO1
HOUR
ItemCount
M.CheckStateValue
MIN
NoCastleGuildName
PKFIRE
RACELMG
ReleaseShutup
SECRET
haircolor
map
reset
```

其中 `CHECKNAMELIST`、`H.GETITEMADDVALUE`、`HOUR`、`MIN`、`SECRET` 已在 BOO 的其他引擎索引出现，只是当前没有进入 GEE 活动索引；这类条目应优先检查“GEE 标记漏项”与“确实跨引擎不同”两种可能。类似的其他引擎触发候选包括 `BeginTeleport`、`CloseClientBuffX`、`HeroAttackDamage`、`HeroEnterMap`、`HeroGroupItemOnEx`、`HeroItemExpired`、`ItemExpired`；变量候选包括 `DLGITEM.NAME`、`DLGITEM.STDMODE`。

当前工件快照 SHA-256：

- 候选账本：`A40448CEE65B4BBC0321FB5B60B0B665577FC3DA750418E7546999222E8B059B`
- 复算脚本：`2F9BE77237AA327E15C7E37677401F5A48FB1380EFB693C4ED5A90E58CC5F4B3`

账本包含生成时间和 BOO 工作树状态，因此每次复算后的账本哈希可以变化；输入数据哈希和统计结果才是复现时应重点核对的内容。

### 5.5 P2：快捷文件和快捷目录

虾米内置 9 个文件和 6 个目录入口。BOO 当前已有：

- `QManage.txt`
- `QFunction-0.txt`
- `MerChant.txt`
- `MapInfo.txt`
- `MonGen.txt`
- `MapEvent.txt`
- `AutoRunRobot.txt`
- `RobotManage.txt`
- 任意用户自定义 Mir200 相对文件路径

上游可补给 BOO 的文件只有：

- `StartPoint.txt`
- `AdminList.txt`
- `PlugList.txt`

可考虑的目录入口：

- `MirServer`
- `QuestDiary`
- `MonItems`
- `Market_Def`
- `MapQuest_Def`
- `Npc_Def`

建议仍放在 BOO 现有“快捷文件”Quick Pick 中，加“打开常用目录”分组，使用 VS Code `revealFileInOS` 或在资源管理器定位。路径继续使用 BOO 现有根目录解析和相对路径越界保护，不复制上游递归扫描及独立飞出面板。

### 5.6 P1/P3：两个小型编辑体验

#### Timer 对应跳转

上游支持：

- 在 `SetOnTimer 7 ...` 上跳到 `[@OnTimer7]`；
- 在 `[@OnTimer7]` 上跳到当前文件距离最近的 `SetOnTimer 7`；
- 忽略命令前已经出现 `;` 或 `//` 的注释内容。

证据：`虾米AI编辑器.py:12482-12534`。

BOO 可扩展现有 Definition/Reference provider，但应先按引擎确认：标签所在文件、`OnTimer`/`OnTimerEx` 命名、索引范围和跨文件规则不能用翎风逻辑套到全部引擎。

#### 标签大纲说明

虾米会把标签后的同行 `;`/`//` 注释，以及命令库中的第一行说明放进大纲文本，见 `虾米AI编辑器.py:10021-10082`。BOO 已有 DocumentSymbol，但当前 detail 为空，见 `src/providers/symbol.ts:22-27`。

建议只把安全截断的同行注释写进 `DocumentSymbol.detail`；默认触发器说明可作为 Hover，避免大纲过长。

## 6. 明确不建议复制的部分

### 6.1 架构和产品壳

- 22,184 行 Python 单体主程序；
- 自定义标题栏、窗口、标签页、文件树、搜索、主题、字体和系统托盘；
- TXT 默认文件关联；
- 启动阶段的全局 UAC 提权策略；
- Qt 多光标、矩形编辑和书签实现；
- 登录、注册、找回密码、友情链接和远程外观配置；
- 直接把 Win32 HWND/菜单枚举代码放进 Extension Host。

这些要么由 VS Code 原生提供，要么属于虾米自己的业务体系。复制会造成双重状态、双重快捷键、扩展宿主阻塞和难以维护的平台耦合。

### 6.2 写入和更新策略

- 全局替换逐文件直接覆盖，没有跨文件事务；
- AI 批量应用逐文件写入、逐项 LIFO 撤回；
- 更新使用 PowerShell `Expand-Archive` + `robocopy` 覆盖当前目录；
- 没有版本目录切换和完整 rollback；
- updater 会优先尝试仓库外 `toolbox_update`。

可以借 `.part` 下载、SHA-256 校验和 ZIP 路径检查，但不能复制覆盖安装方式。更新清单若来自未认证通道，仅校验清单给出的哈希也不能建立真实性。

### 6.3 “加密”实现

`mir_cmd_catalog.bin` 的 writer/reader 是固定在源码中的 key、zlib 和 XOR，见：

- `tools/build_encrypted_catalog.py:7-59`
- `虾米AI编辑器.py:98-163`

这只是混淆，不是密钥保密或防篡改方案。不能用于保护 BOO 的授权信息、账号、API key 或商业数据。

### 6.4 登录与传输安全

上游默认登录地址是：

```text
http://114.66.40.205:9997/api/login
```

代码会把 `username`、`password`、版本和应用名直接提交到该 URL，见 `虾米AI编辑器.py:443-444`、`1744-1791`。这是明文 HTTP，不能复制，也不建议实际使用真实凭据测试。

“记住密码”并非 DPAPI，而是 `MachineGuid` 派生 SHA-256 后做循环 XOR 再 Base64，见 `虾米AI编辑器.py:1615-1659`。本机同账户下可逆，不应当作凭据保险箱。API key 另有 DPAPI 路径，但这不能修复登录密码通过 HTTP 发送的问题。

### 6.5 仓库外耦合

- `虾米AI编辑器.spec` 引用 `..\虾米工具箱`；
- hidden import 包含仓库中没有的 `toolbox_update`；
- NPC 重载可调用外部 `工具箱_qt`；
- 还包含 `AutoLoadController.exe` 相关兼容逻辑。

因此公开仓库不是完全自包含的生产构建闭包。即使主程序通过 fallback 启动，也不代表所有更新和重载路径都可由仓库单独复现。

## 7. 授权与第三方材料边界

用户已明确说明获得作者全部授权，这足以让 BOO 团队在作者拥有权利的范围内研究和借鉴。不过仍建议把授权原件和以下内容留档：

- 被授权人/主体；
- 授权的仓库、提交或版本；
- 允许复制、修改、商用、闭源分发、再许可的范围；
- 是否要求署名、保留声明、公开修改；
- 是否覆盖未来版本；
- 作者对第三方材料只授予其依法可授予的部分。

仓库没有 `LICENSE`、`COPYING` 或 `NOTICE` 文件。README 的 License 只有“保留作者署名与再发布许可声明”，这不是一个完整标准许可证。用户的单独授权应作为项目合规证据保存，不能只依靠 README 一句话。

更重要的是，README 自己声明：

> `翎风引擎帮助文档2026.CHM` 及命令提取数据版权归翎风引擎及其作者所有，并写有“请勿用于商业传播”。

因此应区分：

| 内容 | 当前建议 |
|---|---|
| 作者原创的 UI 流程和程序代码 | 可在用户授权范围内借鉴；仍建议记录来源和修改 |
| PySide 单体代码直接并入 TypeScript | 技术上不合适，不建议 |
| CHM 解包/抽取的一般方法 | 可以自主重写 |
| 仓库中的翎风 CHM | 未确认第三方授权前，不放入 BOO/VSIX 或商业交付物 |
| 从该 CHM 派生的 CSV、Markdown、二进制目录 | 同样先按第三方派生数据处理，不直接分发 |
| 仅用于本机差集审阅的名称候选 | 可作为内部线索；最终条目应回到有权使用的原始帮助或真实样本核验 |

这不是否定作者授权，而是避免把作者无法再授权的第三方材料误当成作者原创内容。

## 8. README 声称但源码未充分证实的项目

### 8.1 “断点”

README 写有“断点”，但没有找到调试适配器、运行时暂停、单步、断点协议或与 M2 的调试会话。可确认的是内存书签和行背景标记，见 `虾米AI编辑器.py:521-524`、`13011-13108`。

结论：不能把它列成可复制的运行时调试器。

### 8.2 “机器码绑定”

程序会读取 MachineGuid/WMIC 等设备信息，但登录和注册 payload 没有 machine/device 字段。当前可证实的用途是本地密码 XOR 混淆，见 `虾米AI编辑器.py:1265-1324`、`1615-1635`、`1744-1791`、`2298-2344`。

结论：本轮源码没有证明服务端机器码绑定。

### 8.3 “加密命令库”

固定 key + zlib + XOR 不构成安全加密，也没有真实性校验。

结论：只能称轻度混淆。

### 8.4 “高置信命令库”

高置信来自规则评分、频次和手工覆盖，不是引擎运行时或语义 parser 证明。部分评分路径存在宽泛接受。

结论：适合搜索语料和人工审阅，不可未经复核驱动诊断、改写或格式化。

### 8.5 “可直接构建”

README 给出 PyInstaller 命令，但 spec 引用仓库外目录和缺失模块。

结论：应把“主程序/测试可运行”和“所有发布功能形成独立构建闭包”分开陈述。

## 9. 测试与构建实测

### 9.1 BOO 当前能力回归

本轮对当前工作树执行：

```text
npm.cmd run compile
node tests/completion-search.test.js
node tests/script-labels.test.js
node tests/script-path-reference.test.js
node tests/quick-files.test.js
node tests/m2-reload.test.js
node tests/document-symbols.test.js
node tests/command-index.test.js
node tests/engine-language-isolation.test.js
```

结果：TypeScript 编译通过，8/8 针对性测试通过。这个结果支持本报告关于“中文搜索、标签、路径、快捷文件、重载队列、符号和分引擎索引已经存在”的判断。

### 9.2 虾米上游测试/构建

上游动态核验已在固定提交的隔离依赖环境中完成。判定时遵守：

- pytest 通过只能证明测试覆盖的逻辑；
- import/无窗启动不等于真实 GUI 全功能可用；
- 主程序 fallback 可运行不等于外部 `toolbox_update`、`工具箱_qt` 等路径存在；
- PyInstaller 成功不等于生成单文件，因为 spec 明确是 `onedir`；
- 不登录远程服务、不提交真实凭据、不触发更新安装。

#### 环境与可重复性边界

- 验证平台：Windows / PowerShell；构建用 Python 3.14.3。
- 仓库没有 `requirements.txt`、锁文件、CI、tag 或 release；因此下面的依赖版本是 2026-09-04 隔离环境当时解析出的版本，不是上游锁定版本：PySide6 6.11.2、requests 2.34.2、openai 3.8.0、certifi 2026.7.22、beautifulsoup4 4.15.0、pytest 9.1.1、PyInstaller 6.22.2。
- 语法检查覆盖 `虾米AI编辑器.py`、`extract_chm_commands.py` 和 `tools/build_encrypted_catalog.py`，`py_compile` 退出码为 0。

#### pytest 实测

需要区分两个环境：

1. 本机默认 Python 没有 PySide6。直接执行 `python -X utf8 -m pytest -q` 时，有 7 个测试模块在 collection 阶段失败。源码在 PySide 导入失败后把 `QtWidgets` 设为 `None`，但仍立即定义 `QtWidgets.QLineEdit` 子类，所以 PySide 实际是硬依赖；这里不能解释成测试逻辑失败，也不能解释成无 Qt 可正常回退。
2. 安装 PySide6 等 README 所需依赖后执行 `pytest tests -q`，共收集并运行 100 个测试：**94 passed、6 failed、11 warnings，退出码 1**。

6 个失败项分类为：

- 2 个更新流程测试；
- 1 个清除 AI 上下文提示测试；
- 3 个 PySide6 6.11 键盘/鼠标枚举兼容测试。

因此准确结论是：被测的大部分编辑和辅助逻辑可运行，但当前测试套件不是全绿，且没有锁定依赖来保证未来复现同一结果。

#### 依赖与 PyInstaller 实测

- 隔离环境 `pip check`：通过，退出码 0。
- `pip-audit --local`：退出码 1，只报告该临时环境中 `pip 25.3` 的 6 条漏洞记录。它扫描的是临时环境，不是仓库锁定依赖，不能当作应用或依赖供应链已经完成审计。
- `pyinstaller 虾米AI编辑器.spec`：构建完成，但生成的是 `onedir`，不是单文件。
- 构建目录：249 个文件，180,351,194 bytes；主 EXE 372,232 bytes。
- 主 EXE SHA-256：`26E1D55AA941EA78143DA84BF4DAA6A9228459D0B1333327B52E4CDFE01A0ACD`。
- Authenticode：`NotSigned`；FileVersion、ProductVersion 均缺失。
- 构建 warning：`missing module named toolbox_update`。

这证明当前隔离环境可以沿 fallback 路径产出一个目录式程序，不证明公共仓库形成了独立、完整、可重复的发布闭包。spec 把仓库同级 `..\虾米工具箱` 加入 `pathex`，又声明仓库内不存在的 `toolbox_update`；当前目录或父级的同名模块还可能改变实际打包内容，既影响复现，也存在本地模块劫持风险。

#### GUI 与外部副作用边界

本轮**没有**启动最终 EXE、没有执行真实 GUI 开窗、没有登录硬编码远程服务，也没有触发更新、UAC、本地 IPC 或 AI 请求。主程序普通启动可能尝试提权和建立外部连接，这些副作用对本次只读借鉴审计没有必要。

所以动态结论只到：语法、pytest、依赖关系和 PyInstaller 产物已实测；最终 GUI 可见开窗、登录、更新、AI 和 NPC 重载等业务闭环均未验证。

## 10. 推荐实施顺序

### 阶段 A：先做小而确定的增量

1. 在现有快捷文件 Quick Pick 中增加 `StartPoint.txt`、`AdminList.txt`、`PlugList.txt`。
2. 增加常用目录分组，沿用现有工作区/引擎根解析和路径安全校验。
3. 为目标引擎实现 `SetOnTimer` ↔ `OnTimerX` 跳转并增加跨文件/注释/重复项测试。
4. 给 DocumentSymbol 补安全截断的同行注释。

这批不引入网络、AI 写入或第三方语料，回归面最小。

### 阶段 B：设计 AI 事务桥，不直接接写盘

1. 先实现只读的“当前选择/当前文件/勾选文件”上下文桥。
2. 定义结构化 patch schema 和严格 allowlist parser。
3. 完成 VS Code diff 预览，仍不应用。
4. 再增加单个 `WorkspaceEdit`、批次快照、失败回滚和冲突检测。
5. 最后才允许与保存后 M2 重载联动；默认仍由用户确认。

### 阶段 C：CHM 导入 MVP

1. 只解包、索引和搜索，不进入语言服务。
2. 显示来源页、冲突和分类置信理由。
3. 要求用户选择目标引擎，默认 isolated。
4. 允许逐项批准为 completion；诊断/autofix 另设更高门槛。
5. 对 CHM、提取器版本和结果建立 SHA-256/版本台账。

### 阶段 D：语料候选人工合并

1. 处理全引擎未见的 251 个名称候选。
2. 先清理误分类、标题和示例词。
3. 再查有权使用的引擎帮助与真实服务端样本。
4. 按 BOO 当前 `engineVariants` 结构写入，不创建跨引擎公共污染。
5. 运行完整 language/audit 测试后才合并。

## 11. 最终建议

如果目标是“最快把虾米的优点拿过来”，建议不要从复制代码开始，而是按以下顺序：

1. **先补快捷目录、三个文件入口、Timer 跳转和大纲注释**，成本低、风险小、用户马上能感知。
2. **把 AI 安全修改流程立项为一个独立能力**。这是最大增量，但必须以 BOO/VS Code 的事务模型重写。
3. **把 CHM 导入做成隔离候选库**，解决新引擎/私有版本说明书快速接入问题；默认只读，不污染权威语言索引。
4. **把虾米的 1,454 项语料当差集线索**，不直接复制数据。先解决第三方权限，再逐条核验。
5. 其余桌面壳、编辑器基础设施、登录更新、UAC 和 Win32 整体逻辑全部跳过。

一句话总结：**值得复制的是工作流与测试思想，不是 PySide 单体；值得审阅的是差集候选，不是直接搬运 CHM 数据；真正的新价值集中在 AI 事务桥和运行时隔离导入。**

## 12. 证据索引

### 虾米上游

- 项目说明与权限声明：`artifacts/research/xiami1-upstream/README.md`
- 主程序：`artifacts/research/xiami1-upstream/虾米AI编辑器.py`
- CHM 抽取器：`artifacts/research/xiami1-upstream/extract_chm_commands.py`
- PyInstaller 配置：`artifacts/research/xiami1-upstream/虾米AI编辑器.spec`
- 命令卡片：`artifacts/research/xiami1-upstream/翎风引擎2026_命令提取_卡片版.md`
- 高置信 CSV：`artifacts/research/xiami1-upstream/翎风引擎2026_命令提取_高置信版.csv`
- 测试：`artifacts/research/xiami1-upstream/tests/`
- 固定 CHM 解包缓存：`artifacts/research/xiami1-chm-decompiled-dc8084e/`
- GEE 名称级候选账本：`artifacts/research/xiami1-gee-candidate-ledger.json`
- 候选账本复算脚本：`artifacts/research/generate-xiami1-gee-candidate-ledger.py`

### BOO 当前实现

- 补全、Hover、跳转、诊断和 Quick Fix：`src/assistant.ts`
- 中文命令搜索：`src/utils/completion-search.ts`
- 分引擎索引：`src/utils/command-index.ts`
- 引擎能力门：`src/utils/engine-registry.ts`
- 标签解析：`src/utils/script-labels.ts`
- 符号大纲：`src/providers/symbol.ts`、`src/utils/document-symbols.ts`
- 快捷文件：`src/utils/quick-files.ts`、`src/commands/quick-files.ts`
- M2 重载：`src/reload.ts`、`src/utils/reload-queue.ts`、`src/utils/m2-target.ts`
- DeepSeek 入口：`src/providers/deepseek-view.ts`
