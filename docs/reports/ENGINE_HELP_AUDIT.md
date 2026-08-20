# BOO 引擎帮助与语言能力核查

> 核查日期：2026-07-19  
> 当前扩展版本：V4.1.9  
> 最新文档来源：整理时使用的三引擎本地帮助副本，原始帮助不进入源码仓库。

> 本文保留为 2026-07-19 的历史核查快照。GOM、翎风独立语言目录及
> 996PC 对比的最新状态见 `THREE_ENGINE_COMPARISON.md`。

## 实施状态

本报告确认的“补全与引擎分类”已于 2026-07-19 实施：

- 已建立统一语言索引，命令、变量、触发器均按 GOM/GEE 和脚本上下文过滤。
- 720 条原有命令已完成逐条证据分类：493 条确认共有、170 条 GOM 独有、1 条翎风独有。
- 另有 56 条在两套最新帮助中均无可靠证据，继续按双引擎兼容并显示“共有（待确认）”，避免旧脚本补全突然消失。
- 已补录本报告列出的 GOM 新命令、变量、触发器、别名和最新参数，并补上两个翎风缺口。
- 补全、悬停、语义着色、引擎兼容提示和代码补全编辑器现已使用同一索引，并显示“共有 / GOM独有 / 翎风独有”。
- 自动识别改为证据计分；证据不足时保留用户选择，不再把普通文件夹判成 GOM。
- 分类证据报告保存在 `data\audit-report\engine-classification.json`，可追溯到两套帮助中的命中页面。
- 严格命令诊断尚未启用，本轮不会因旧版引擎或自定义命令产生新增报错。

## 1. 核查范围

本次核查使用以下资料：

- 最新 GOM：整理时使用的 GOM 帮助副本。
- 整理前本地 GOM 参考副本（已外部归档，不进入源码仓库）：`docs\engine-reference\GameOfMir引擎使用说明书.chm`
- 最新翎风：整理时使用的翎风帮助副本。
- 扩展数据：`data\commands.json`、`functions.json`、`functions-gee.json`、`variables.json`
- 扩展实现：补全、悬停、语义着色、触发器补全、代码审查和引擎自动识别

核查时先将 CHM 离线展开，再按相对路径、页面哈希、命令格式、更新记录和关联页面进行对比。没有运行会自动改写数据文件的旧维护脚本。

## 2. 最新帮助新增内容

### 2.1 GOM

项目内 GOM 文档共有 838 个 HTML 页面，最新版共有 844 个。最新版新增 6 个页面，并修改了 19 个既有页面。

新增页面：

1. `调整飞剑命令.htm`：新增 `FLYINGSWORDSET`
2. `发送滚动系统公告.htm`：完整说明 `SendScrollMsg`
3. `预置特效脚本命令.htm`：新增 `PLAYPRESETEFFECT`
4. `拾取触发来源检测.htm`：新增 `CHECKPICKUPITEMEXMODE`
5. `怪物词缀系统使用说明.htm`
6. `自定义技能飞剑功能.htm`

2026-07-17 更新记录还关联了 34 个功能页面。需要同步到语言能力的数据不只有以上 4 条新命令，还包括材料仓库、背包选物、英雄操作、跨服、怪物标识、技能特效、地图参数、变量和触发器。

本次确认的既有页面重要变更：

- `GoHome` 新增强制参数。
- `MAPMOVE` 补充范围参数说明。
- `MonGenEx` 增加国家名称和同国家攻击控制参数。
- `ChangeModeEx` 补充无敌模式持续补满属性规则。
- `SetIcon` 位置由 0-9 扩展为 0-19。
- `AddHumNewValue` 支持元素 0-16、20-28、40-43。
- 地图参数新增 `CustomEffect(...)`。
- 技能特效新增 `SETMAGICWILLID`。
- `[@BeginMagic]` 增加人物、英雄施法前判断及相关变量说明。
- 怪物标识增加 `CHANGEATTACKFILTERMASK` 和多级写法。

### 2.2 翎风

最新版翎风帮助共有 849 个 HTML 页面。其最新更新记录为 2026-07-07，内容主要是日志 CPU、管理员列表和显示细节优化；2026-07-04 也没有新增脚本命令。

因此本轮“最新新增命令”的主要变化来自 GOM。翎风旧页面仍发现少量资料覆盖缺口，例如 `M.CheckMonAddByte` 和旧兼容别名 `POSEHAVEPRENTICE` 没有进入结构化数据。

## 3. 当前数据现状

| 数据 | 数量 | 当前行为 |
| --- | ---: | --- |
| 已确认共有命令 | 493 | GOM、翎风都加载 |
| GOM 独有命令 | 170 | 仅 GOM 加载 |
| 翎风独有命令 | 1 | 仅翎风加载 |
| 旧版兼容命令 | 56 | 双引擎加载，界面标记“共有（待确认）” |
| GOM / 翎风函数 | 36 / 689 | 同名 30 条显示共有，其余按所在函数库分类 |
| 系统变量 | 449 | 16 条已确认 GOM 独有，其余保持双引擎兼容 |
| 触发器 | 111 | 8 条已确认 GOM 独有，其余保持双引擎兼容 |
| 静态 snippets | 347 | 不区分引擎 |

命令分类由最新版 GOM 844 个 HTML 页面、最新版翎风 849 个 HTML 页面和两套结构化函数库交叉生成。分类脚本为 `tools\data-maintenance\classify-engine-data.js`，重复运行会按同一规则重建分类。

变量名和触发器名容易在帮助正文中作为普通文本出现，因此本轮没有用简单单词命中强行划分旧条目；只有带明确功能页和来源的新增条目才标为独有。这样既能让已确认的独有能力正确过滤，也不会让旧引擎或自定义脚本的补全无故消失。

## 4. 已确认的 GOM 缺口

### 4.1 完全缺失

以下命令在最新版 GOM 帮助中有明确格式，但当前 GOM 结构化补全和悬停数据中没有：

| 类型 | 命令 |
| --- | --- |
| 材料仓库 | `CHECKMATERIAL`、`MATERIALSTORAGEIN`、`MATERIALSTORAGEOUT`、`TAKEMATERIAL` |
| 物品操作 | `SELECTBAGITEM`、`MOVEBAGITEM`、`CHECKBAGITEM` |
| 英雄 | `PREPAREUNITEHIT` |
| 拾取与标识 | `CHECKPICKUPITEMEXMODE`、`CHANGEATTACKFILTERMASK` |
| 特效与飞剑 | `PLAYPRESETEFFECT`、`FLYINGSWORDSET` |
| 技能特效 | `SETMAGICEFFLEVEL`、`SETMAGICWILLID` |
| 数据处理 | `SPLITNUMBER` |

`IsSpanRegionHumam` 是帮助中的历史拼写，正文又出现 `IsSpanRegionHuman`。实现时应作为同一命令的别名处理，不能擅自只保留其中一个。

### 4.2 被放在 GEE 专属库

以下命令已存在于 `functions-gee.json`，但最新版 GOM 帮助也明确支持。选择 GOM 时，它们没有结构化 GOM 悬停数据：

- `SetDummyPickItemFile`、`SetDummyPickItem`
- `AddScreenMagicButton`、`DelScreenMagicButton`
- `AddToMagicBar`、`DelFromMagicBar`
- `SetAngryValue`、`CheckAngryValue`
- `CancelHeroForcePeaceMode`
- `SetTempDBMode`
- `QueryUserState`、`QueryUserStateEx`
- `M2SpanRegion`、`M2ReturnRegion`
- `ChangeMapMonName`、`ChangeMapMonNameEx`
- `SetIcon`
- `ChangeHumAbilityEX`、`CheckStateValue`
- `RandomSplit`、`UnixToStr`
- `AddHumNewValue`

其中部分命令可能通过不区分引擎的静态 snippet 偶然出现，但这不能替代正确的命令归属、参数和悬停说明。

### 4.3 已存在但语法过时

| 命令 | 当前数据 | 最新帮助 |
| --- | --- | --- |
| `SendScrollMsg` | 只有消息内容 | 消息、文字色、背景色、显示秒数 |
| `GoHome` | 无参数 | 新增可选强制参数 |
| `TAKEMAKEINDEX` | “物品位置、存储变量” | `MakeIndex`、数量 |
| `MonGenEx` | 7 个参数 | 新增国家名称、同国家攻击控制 |
| `SetIcon` | 位置 0-9 | 位置 0-19，参数说明也需复核 |
| `AddHumNewValue` | 属性 0-20 | 属性 0-16、20-28、40-43 |
| `CSVGetCellInfo` | 当前展示 4 个参数 | 文件、行数变量、列数变量 |
| `CSVFindTextRow` | 当前参数过少 | 文件、文本、行范围、列、模式、结果变量 |

`commands.json` 的 702 条命令全部没有示例，82 条没有参数说明。98 条触发器的描述全部为空。

## 5. 变量与触发器缺口

最新版 GOM 页面中确认缺少的触发器数据包括：

- `[@HeroDie]`
- `[@ConfirmDearRecall]`
- `[@ConfirmMasterRecall]`
- `[@QueryUserStateFail]`
- `[@QueryUserStateExFail]`
- `[@BeginMagic]`

`[@BeginMagic]` 目前在 `assistant.ts` 中有硬编码 snippet，但没有进入统一触发器数据。这说明触发器来源已经分裂，补全编辑器、悬停和后续审查无法共享同一份真值。

确认缺少或不完整的变量包括：

- `<$DEARNAME>`
- `<$AllowDeal>`、`<$AllowGuild>`、`<$HearGuildChat>`、`<$HearWhisper>`、`<$BanShout>`
- `<$H.MagicID>`、`<$H.MagicName>`、`<$H.MagicTarget>`、`<$H.MagicTargetRace>`
- `<$OldUserName>`、`<$OldServerName>`、`<$OldServerID>`
- `<$BagItemName>`、`<$BagItemMakeIndex>`
- `<$UTCNow>`

## 6. 代码审查覆盖情况

当前代码审查已经实现：

- 标签未闭合、重复定义和未定义引用
- 动态变量写法的部分检查
- `#IF/#OR` 后缺少动作或显示块
- `#CALL` 文件和目标标签存在性
- HUMAN/GUILD 自定义变量声明
- `merchant.txt` 引用脚本存在性

当前没有实现：

- 未知或拼错的命令
- 当前引擎不支持的命令
- 检测命令误写在 `#ACT`、执行命令误写在 `#IF`
- 必填参数不足、参数过多和参数类型
- 命令别名、`H.`、`M.` 等多级对象的合法性
- 未知系统变量和错误变量作用域
- 触发器适用文件检查
- MapInfo、MonGen、数据库字段等专用文件格式审查

`allCmdSet` 当前只用于语义着色，不用于诊断。因此“命令被着色”不代表代码审查确认它正确。

## 7. 引擎识别问题

当前自动识别规则为：

- 同时有 `GameCenter.exe` 和 `Mir200\Mir.dat` 判为 GEE。
- 有 `GameOfMir引擎控制器.exe`，或没有 `Mir200\Mir.dat`，判为 GOM。

第二条会把普通文件夹、残缺服务端和部分旧版目录直接判成 GOM，并写入全局设置。建议改为证据计分：

1. 识别多个引擎特征文件和可执行文件版本信息。
2. 只有证据足够时自动切换。
3. 无法确定时保持用户选择并显示“未确认”，不修改全局设置。

## 8. 实施结果与后续

### 第一阶段：修正数据模型（已完成）

为命令、变量和触发器增加：

```json
{
  "name": "FLYINGSWORDSET",
  "engines": ["GOM"],
  "kind": "action",
  "contexts": ["ACT"],
  "aliases": [],
  "minArgs": 1,
  "maxArgs": 10,
  "source": {
    "revision": "2026-07-17",
    "page": "功能操作命令/调整飞剑命令.htm"
  }
}
```

旧数据没有可靠证据时按共享兼容处理，保证升级兼容。运行时已经建立按引擎过滤后的统一命令索引；补全和悬停可显示分类，独有命令会随当前引擎过滤。

### 第二阶段：补最新版 GOM（已完成）

1. 加入本报告确认的缺失命令、变量、触发器和 `CustomEffect`。
2. 修正过时语法和参数。
3. 将误放在 GEE 专属库、但 GOM 同样支持的命令标记为双引擎或分别保存来源。
4. 对帮助中的拼写差异使用别名，不直接“纠正”引擎兼容写法。

### 第三阶段：扩展代码审查（尚未启用）

按低误报到高约束依次启用：

1. 未知命令和当前引擎不支持。
2. `#IF/#ACT` 上下文错误。
3. 必填参数不足。
4. 可选的严格参数数量和类型检查。
5. 专用文件格式检查。

严格检查应受 `boo.diagnosticSeverity` 控制，并允许单行忽略，避免老脚本或自定义引擎命令产生大量误报。

### 第四阶段：建立防回退测试（已完成基础部分）

- 每个引擎分别构建补全集合。
- 同一命令测试 GOM、翎风、共享和旧版兼容四种内部状态。
- 对最新版新增命令建立语法、悬停、snippet 和诊断测试。
- 检查数据中不存在无来源的引擎归属。
- 分类总数、证据来源和代表命令已加入自动测试。
- 每次更换 CHM 后先生成候选差异报告，再人工复核待确认项。

## 9. 结论

原有 720 条命令已经完成可追溯分类，最新版 GOM 增量也已进入统一补全索引。当前选择 GOM 时不会出现已确认的翎风独有命令，选择翎风时也不会出现已确认的 GOM 独有命令。

剩余风险集中在 56 条无文档证据的旧兼容命令、433 个旧变量、103 个旧触发器和未按引擎拆分的静态 snippets。它们当前继续双引擎可用并带待确认提示，不会转化为严格审查报错；后续应以旧版引擎资料或实际 M2 验证结果逐步确认。
