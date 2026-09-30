# GXX 引擎源码 × BOO VS Code 扩展交叉审查报告

审查日期：2026-09-20；本轮实施与回归：2026-09-22  
范围：只读审查本仓库与本地参考源码目录；本轮不修改脚本、数据库、地图、PAK、缓存或 VS Code 安装。

## 结论先行

BOO V4.3.5 已经覆盖了一个完整的脚本开发工作流：三引擎语言服务、Ctrl+F12 NPC 对话画布、常规 UI 编辑器、PAK/JPK/WIL/WZL 资源、数据库、原始地图、表格、多区同步、M2 重载、爆率分析和 DeepSeek Harness。Ctrl+F12 当前也不是“只生成一个空 DOM”：解析器、变量求值器、Provider 素材补全和 Webview 绘制均已分层实现，并有严格套件、Provider 和 Chromium 测试。

GXX 源码对 BOO 最有价值的不是重复实现已有 GEE/GOM/JPK 基础解析，而是提供了若干“客户端实际如何做”的版本化参考：

1. GXX 在客户端运行时把 `#CALL` 外部脚本加载后改写为本地 `GOTO`。本轮 BOO 已补齐同源外部入口中“直接字面 `GOTO @标签` → helper 标签 → MOV/只读求值 → 调用方显示”的安全子集：最多递归导入 32 个标签，且要求唯一、静态、同源、边界完整；动态目标、冲突、循环和未知副作用仍保持未知。参数化 `CALL/CALLEX` 的参数/返回合同尚未被各引擎共同确认，继续 Hold。
2. GXX 支持 `HXM2` 以及 `LzPak V0/V1`，包括独立 alpha、4-bit alpha、RLE/ZLib 和不同索引结构；BOO 当前明确支持 GEEPAK2/3、GAMEOFMIR、JPK、WIL/WZL，但没有 HXM2/LzPak 生产解析器。没有合法样本、密码和逐字节校验前，不应把这项写成“可直接兼容”。
3. GXX 对 `ITEMSHOW` 的 IDX→数据库 Looks→`Items/ItemsN`、边框/主体/置灰/发光/父容器裁切/数量绘制顺序提供了可校准细节。BOO 的链路已经基本正确；本轮已有 IDX→Looks→ItemsN、数量 0 隐藏、缺帧保留时间槽和缓存 provenance 回归，后续仍需真实非方形、负偏移、越界裁切和发光样本做视觉校准。
4. GXX 的 `PLAYIMGEX`、`MONSTER` 和原始地图包含完整帧序、动作表、混合模式、`ENMap/EIMap/ReturnMap/Map 2010` 和 `wAniTiles` 逻辑。BOO 可借鉴，但必须按 `engine + version + profile` 隔离，不能把 GXX 枚举和 MAP 结构直接套到 GOM、翎风或 996PC。

因此建议顺序为：

**P0 外部 CALL 只读求值 → P1 PAK/ITEMSHOW/PLAYIMGEX 差分与真实样本 → P2 MONSTER 和原始地图 profile → Hold HXM2/LzPak 直到样本齐全。**

## 1. BOO 当前功能面

### 1.1 清单证据

`package.json` 当前版本为 `4.3.5`，贡献点包括：

- 49 个命令；
- 1 个 `gomscript` 语言注册；
- 3 个自定义编辑器（`merchant.table`、`mongen.table`、CSV、XLS 相关视图）；
- 8 个 Activity Bar 容器和 8 个主要视图；
- `GOM`、`GEE`、`996PC` 三引擎配置隔离；
- `direct`/`legacy` 两种归档预览模式；
- `Ctrl+F12` 绑定到 `boo.openNpcDialogVisualEditor`。

README 与源码共同确认的功能组如下：

| 功能组 | 当前能力 | 主要入口 |
|---|---|---|
| 语言服务 | 命令/变量/标签/路径补全、悬停、诊断、语义高亮、折叠、CodeLens、定义跳转 | `src/extension.ts`、`src/providers/symbol.ts`、`src/data/*` |
| 三引擎隔离 | GOM、翎风/GEE、996PC 各自的目录、命令和参数合同 | `src/utils/engine-registry.ts`、`data/functions-*.json` |
| 变量分析 | U/T/A/G、个人标识、嵌套变量、集合、候选变量、跨文件统计 | `src/utils/variable-statistics.ts`、`nested-variable-analysis.ts`、`variable-candidates.ts` |
| 常规 UI 编辑器 | 图片、文字、按钮、动画、倒计时、输入框、数字框、装备框、进度条及代码生成 | `src/ui/*`、`media/editor.html` |
| Ctrl+F12 画布 | 对话框、AddDlg、文字/图片/按钮/Input/Menu/ListView/ITEMSHOW/进度/动画、条件输入、GOTO 预览 | `src/ui-dialog/*`、`src/providers/npc-dialog-visual.ts`、`media/npc-dialog-visual.js` |
| 客户端资源 | GEEPAK2/3、GAMEOFMIR、JPK、WIL/WIX、WZL/WZX、索引、缓存、Worker、LRU、MD5 校验 | `src/utils/pak-reader.ts`、`archive-index.ts`、`jpk-reader.ts`、`wil-wzl-reader.ts` |
| 数据库 | SQLite、MDB 查看、996PC BIFF8 XLS 编辑；物品/怪物/技能详情和 Looks 资源 | `src/utils/database-browser.ts`、`biff8-database.ts`、`database-detail.ts` |
| 地图 | MAP 12/14/36 字节 profile、Tiles/SmTiles/Objects、动画、DrawBlend、MAPEFFECT、NPC、MonGen | `src/utils/original-map.ts`、`src/providers/map-preview.ts` |
| 工作流 | CSV/XLS/table、多区同步、M2 重载、爆率分析、DeepSeek Harness | `src/providers/*`、`src/utils/zone-sync.ts`、`m2-target.ts`、`drop-rate-*` |

### 1.2 当前 Ctrl+F12 的真实链路

Ctrl+F12 不是单一正则替换，而是以下链路：

```text
static-language / statement-catalog
        ↓
source-parser（引擎合同、坐标、条件、控件模型）
        ↓
variable-resolver + preview-script-program（局部执行、GOTO、CALL 图、变量快照）
        ↓
npc-dialog-visual Provider（数据库、PAK/JPK、缓存、MD5、assetRef/assetLayers）
        ↓
media/npc-dialog-visual.js（最终 DOM/CSS/Canvas 绘制、裁切、命中区、动画）
```

`README.md:66-78` 已明确动态字段的显示策略：未知文字为“预览文字”，未知数值为 `0`；显示占位不能解锁素材、数据库、坐标、动画或动作参数。这一安全边界应保留，不能为了“看起来有内容”把默认值当作客户端运行时值。

当前可见性必须分成四层判断：

1. 目录是否收录语句；
2. parser 是否生成了正确的 typed model；
3. Provider 是否真的解析了数据库和素材引用；
4. Webview 是否走到正确的绘制分支。

仅有 `unsupportedStatements=[]`、DOM 节点或 `assetRef` 不能证明最终画布完整可见。

## 2. GXX 源码证据

以下路径均来自 `参考源码/GxxSource\GameOfGeeM2`。GXX 是版本明确的行为参考，不能自动代表翎风、GOM 新版或 996PC 的通用合同。

### 2.1 外部 CALL/GOTO 和执行预算

- `M2Engine/LocalDB.pas:5973-6104` 的 `LoadScriptCall` 读取 `QuestDiary` 外部文件，找到目标标签后把 `#CALL` 改写成 `goto @label`；若原来没有 `#ACT`，还会插入 `#ACT`。外部文件的内容因此进入同一动作列表，而不是只作为导航元数据。
- `M2Engine/HandleNpcCmds.pas:533-589` 对 WHILE 建立开始/结束位置，并以 `Max(g_Config.nLimitScriptGotoCount * 5, 1000)` 限制循环执行次数。这个“共享预算 + 明确中止”思路可复用到 BOO 的静态执行，但不能执行发奖、扣费、属性重载等副作用命令。

BOO 对应实现：

- `src/ui-dialog/preview-script-program.ts:48-51,248-340` 已做路径、深度、来源冲突、调用数量、8 MiB 文本和可达性限制；
- `src/ui-dialog/variable-resolver.ts:884-950` 已能执行同文件 `GOTO`、参数和 `RETURN`；
- 本地 resolver 仍不会把任意外部 CALL body 当作服务器运行时执行；安全求值由 `preview-script-program.ts` 在构建虚拟程序时仅导入已验证的同源字面 GOTO helper。这样可覆盖用户实际的 `GOTO @获取上古神剑数据` 变量准备链，同时不会执行奖励、扣费、属性重载、文件写入或网络命令。

这解释了当前的安全边界：外部页面/按钮可以被 Provider 展开并绘制；满足静态同源 GOTO 条件的 helper 中通过 MOV/INC/GlobalVal 等只读求值得到的变量会回到调用方，其余外部 ACT、动态目标和参数化返回仍显示“预览文字”、`0` 或保持未知。现有 `tests/preview-return-values.test.js` 仍验证未建模外部调用为 unknown。

### 2.2 ITEMSHOW、Looks、边框、数量和裁切

- `Client-HGE/GUI/Share/FState.pas:12621-12777` 的 `NpcItemButtonDirectPaint` 分别绘制边框、物品主体、灰度、发光和数量；父容器 `VisibleRect` 会裁切边框与主体。
- `FState.pas:14472-14551` 解析 `ITEMSHOW:imageName:Idx:count:x:y:showBorder:light:gray`，其中第二个参数先按数据库 `StdItem` 的 IDX 查 Looks；只有查到数据库记录后才设置物品图。
- `Client-HGE/MShare.pas:6302-6321` 的 `TBagItemImages.LooksOf` 用 `Looks div 10000` 选择 `Items/ItemsN`，并用 `Looks mod 10000` 选择包内图片序号。
- `FState.pas:12720-12770` 只在 `m_nCount > 0` 时画数量。

BOO 对应实现已经具备：

- `src/utils/item-image.ts:36-51` 实现 Looks 分段；
- `src/providers/npc-dialog-visual.ts:1595-1640` 通过当前引擎数据库解析 IDX/Looks，并拒绝动态、歧义和越界值；
- `src/providers/npc-dialog-visual.ts:1985-2035` 对选中的资源包做精确 MD5 身份验证；
- `media/npc-dialog-visual.js:4488-4588` 分离边框、主体、灰度、发光和数量层，并对数量 0 不创建角标节点。

所以 ITEMSHOW 不是“需要重写”，而是需要真实客户端素材继续做视觉校准：非正方形图片、负 X/Y、主体超过边框、父容器越界、灰度只作用于主体、发光层叠加顺序以及 `ItemsN` 缓存缺槽时的诊断。

### 2.3 PLAYIMGEX

`FState.pas:14390-14468` 明确解析：资源文件序号、起始帧、帧数量、帧间隔、播放次数、X/Y 偏移和 `alphaDraw`；当 `alphaDraw != 0` 时使用 `Blend_SrcAlphaColor`，播放范围为 `startIndex .. startIndex + count - 1`。

BOO 已在 `statement-catalog.ts`、`source-parser.ts` 和 Webview 中支持部分帧、间隔、重复、偏移和缺帧诊断，但浏览器 `mix-blend-mode`/普通透明不等于 HGE 的 `Blend_SrcAlphaColor`。需要增加真实资源的共同原点、帧间隔、结束隐藏和混合对照；未知 blend 模式应继续报边界，不能默认为普通 source-over。

### 2.4 MONSTER 动作和方向

`FState.pas:13884-13978` 的动作编号为：0 站立、1 行走、2 跑、3 攻击、4 暴击、5 受击、6 死亡过程、7 死亡、8 第二攻击；再通过 `GetRaceByPM`、动作表的 start/frame/ftime 和方向偏移计算帧区间。

BOO `src/ui-dialog/source-parser.ts:7934-8077` 当前明确采用静态代表帧，并提示 GEE/LFM、GOM 的完整动作/方向步长缺少可靠文档。该保守行为是正确的：GXX 的 0-8 枚举不能直接覆盖 BOO 三引擎。下一步应引入显式 `engine + clientVersion + monsterProfile`，仅对取得动作表的 profile 开放完整播放。

### 2.5 PAK、HXM2 和 LzPak

- `Client-HGE/ReadResources/Pak.pas:111` 的 `TPakFileType` 包含 `pftPak1`、`pftPak2`、`pftPak3`、`pftLzPakV0`、`pftLzPakV1` 和未知版本占位。
- `Pak.pas:825-880` 识别 `GEEM2`、`GEEPAK2`、`GEEPAK3`、`HXM2`，并从解密后的 `bfType` 区分 LzPak V0/V1。
- `Pak.pas:1403-1497` 采用不同索引记录大小与解密路径；V0/V1 并非 GEEPAK2/3 的简单别名。
- `Pak.pas:2264-2316` 实现 V0 的 RLE、ZLib 和原始数据；`Pak.pas:2332-2369` 推导像素格式、图像长度和 alpha 长度；`Pak.pas:2372-2407` 处理每字节两个像素的 4-bit alpha，并以半字节乘 17 转成 0-255；`Pak.pas:2409-2469` 处理 V1 的独立 alpha 和特殊 16 位 alpha。
- `Common/UnitDes.pas:831-848` 的 `GetKeyDataPak` 用 SHA-1 前 8 字节初始化 DES key material，使用 `$60` 初始化 IV；`GetKeyDataPak2` 是另一条派生路径。

BOO `src/utils/pak-reader.ts:62,131-247,388-399` 当前明确识别 GEEPAK2、GEEPAK3、GAMEOFMIR/GAMEOFMIR2，并对 GOM/GEE2 走精确内置/离线桥回退；没有 HXM2/LzPak 类型。建议先做 GXX↔BOO 的逐字节差分 fixture 和格式探测诊断，再考虑新 parser。没有真实合法 HXM2/LzPak 文件、密码、解密后头部和像素样本，本项保持 Hold，不能靠合成数据自证。

### 2.6 原始地图

- `Client-HGE/MapUnit.pas:24-157` 除经典 `TMapInfo` 外，还定义 `TNewMapInfo`、`TReturnMapInfo`、`TENMapInfo`、`TEIMapTileInfo`、`TEIMapInfo` 以及 `wAniTiles/btAniTilesFrame/btAniTilesTick/btAniType`。
- `MapUnit.pas:324-520` 识别经典 MAP、`Map 2010 Ver 1.0`、ENMap、EIMap 和 ReturnMap，并按格式读取不同头、异或字段和分块。
- `Client-HGE/PlayScn.pas:1600-1632` 展示 Objects 的动画帧、门偏移和 bit7 处理；`PlayScn.pas:2082-2380` 处理 EIMap 的固定资源组、双对象和动画；`PlayScn.pas:2762-2814` 处理 `wAniTiles` 的特殊类型和帧公式。

BOO `src/utils/original-map.ts:4-166,221-285` 当前支持 12/14/36 字节 classic profile、GOM 已验证的对象动画和 DrawBlend 锚点；`src/providers/map-preview.ts` 负责视口分块、缓存、动画帧组和 MAPEFFECT。当前明确缺少 EIMap、ENMap、ReturnMap、Map 2010 和 `wAniTiles` profile。它们属于 P2 profile 扩展，不应为了“看起来能打开”把未知格式按 classic 解析。

## 3. BOO × GXX 优化矩阵

| 方向 | BOO 当前状态 | GXX 可借鉴内容 | 结论/优先级 |
|---|---|---|---|
| 外部 CALL/CALLEX 变量流 | 同源直接字面 GOTO helper 已导入虚拟程序并参与变量求值；参数化调用仍保守阻断 | `LoadScriptCall` 改写为 GOTO，外部 ACT 进入同一动作列表 | **P0 子集已实现；参数化 CALL/CALLEX Hold** |
| 同文件 GOTO/RETURN | GOM/GEE 已有参数帧、返回目标、循环/深度/步骤上限 | GXX 的动作列表和循环计数 | 已实现；补跨文件只读效果解释器，P0 |
| GEE 密钥/索引 | GEE2/GEE3 有内置/桥接精确路径和回退 | `GetKeyDataPak`、PAK2/3/LzPak 差分算法 | 可直接补差分测试；暂不替换 bridge，P0/P1 |
| GEEPAK2/3、GOM、JPK、WIL/WZL | 已有生产解析、索引、Worker、LRU、MD5 | GXX 的边界和 alpha 细节 | 已实现；主要做真实样本回归，P1 |
| HXM2/LzPak | 无生产 parser | HXM2 探测、V0/V1 索引、RLE/ZLib、4-bit alpha | **样本/密码阻塞，Hold** |
| ITEMSHOW IDX→Looks→ItemsN | 已实现并有 Provider/浏览器/MD5 测试 | 数据库查 IDX、Looks 分包、边框/主体/数量/裁切/发光顺序 | 已实现但需视觉校准，P1 |
| PLAYIMGEX | 有部分帧、间隔、偏移和缺帧模型 | 帧区间、播放次数、alphaDraw blend | 可实现；真实资源验证后 P1 |
| MONSTER | 静态代表帧、SmartMonster 部分支持 | 0-8 动作表、start/frame/ftime、方向偏移 | profile 证据不足，P2 |
| 经典原始 MAP | 12/14/36、对象动画、GOM DrawBlend、MAPEFFECT | EN/EI/Return/2010、wAniTiles、DoorOffset | profile 扩展，P2 |
| 数据库字段/物品详情 | SQLite/MDB/XLS、Looks 和详情链路已有 | GXX `StdItem`/`Monster` 加载及动作配置 | 可补字段冲突/版本 profile，P1/P2 |
| WHILE/GOTO 安全 | BOO 有执行预算和截断提示 | GXX 运行次数上限 | 已实现；增加跨文件共享预算回归，P1 |

## 4. 哪些是“可实现但还没实现”

### P0：外部 CALL 的只读静态求值（本轮已完成安全子集）

目标不是执行服务器，而是把满足以下条件的外部 helper 当作安全的局部数据流：

- 路径只能来自当前 `Envir/QuestDiary` 的已验证候选；
- 标签、来源、版本、字节哈希和调用图无歧义；
- 只允许直接字面量、参数绑定、`MOV/INC/DEC/MUL/DIV`、已验证的数据库/GlobalVal/GlobalStrVal 只读查询、条件和 `RETURN`；
- 拒绝发奖、扣费、属性重载、文件写入、网络、在线状态、计时器、插件回调、随机和未知命令；
- 共享步骤/深度/字节预算，遇循环、动态路径、冲突或未知副作用立即把受影响目标标为 unknown；
- 返回值只复制 raw/display 值，不能复制 `database-item-index`、资源索引、动作或服务器权限 provenance。

本轮实际实现的是：外部入口被确认后，扫描其同一文件内直接字面 `GOTO @标签`，递归导入唯一目标的完整 `{}` 块，再交给既有虚拟执行器。最多 32 个 helper，实际导入行按字节计入 8 MiB 预算；与主文档标签冲突、重复/缺失目标、动态目标、不完整块和循环均拒绝导入并保留未知。它已覆盖“`GOTO @获取上古神剑数据` → helper 设置 `A201`/`N$...` → 后续 `#SAY` 展示”的确定部分，同时保持画布不会伪造服务器状态。

仍未开放的范围：`#CALL/#CALLEX` 的参数列表、返回变量合同、跨引擎 `CALLEX` 重命名和带副作用 helper。GXX 的单一实现不足以证明 GOM、翎风/GEE、996PC 的共同语义，因此这些调用继续显示安全占位并给出诊断。

### P1：可直接补的差分和诊断

1. 把 GXX `GetKeyDataPak`、PAK2/3 index 解密和 BOO `gm_offline_crypto.py`/native bridge 的中间状态做 fixture 比较：SHA-1、DES key、IV/chain、索引长度、槽位和空槽。
2. 让 ITEMSHOW 真实样本回归同时断言 `IDX → Looks → package → slot → PNG`，并分别检查 frame/content/quantity/light/gray/clip。
3. 为 PLAYIMGEX 增加帧序、共同原点、负偏移、结束隐藏和 alphaDraw 的 Provider + Chromium 检查。
4. 为 GOTO/WHILE 增加“外部可达但副作用 handler 不暴露输入”的正反例，避免左侧条件面板泄漏奖励函数变量。

### P2：必须新增 profile 后才能做

- `MONSTER` 完整动作/方向播放：需要客户端资源动作表或实际帧分布，GXX 0-8 不能直接作为三引擎规则。
- EIMap/ENMap/ReturnMap/Map 2010：需要真实 MAP 样本、头部校验、资源组和像素对照；实现前先加 `MapProfile` 能力枚举。
- `wAniTiles`：需要按 `btAniType` 和资源版本建立动画公式表，未知类型必须保持未验证。

## 5. 哪些暂时不能实现，以及原因

| 项目 | 原因分类 | 不能越过的证据边界 |
|---|---|---|
| HXM2/LzPak 生产支持 | 环境/证据阻塞 | 缺真实归档、密码、解密头、索引和像素样本；合成 round-trip 不能证明外部兼容 |
| GXX MONSTER 枚举直接套到 GEE/LFM/996PC | 证据阻塞 | GXX 动作表与当前三引擎文档编号冲突，客户端资源布局和方向步长未证明相同 |
| 浏览器 blend 宣称像素等价 HGE | 证据阻塞 | CSS `mix-blend-mode` 与 HGE `Blend_SrcAlphaColor` 的混合常数、预乘 alpha 和裁切不等价 |
| 通过 Ctrl+F12 得到在线背包/穿戴/属性实时状态 | 运行时阻塞 | 静态画布没有玩家会话、在线角色、库存和 M2 状态；只能使用明确的本地输入或固定配置默认值 |
| 把 `0`/“预览文字”作为资源 ID 或服务器动作 | 设计安全边界 | 默认显示值是可视化 fallback，不是 source provenance；否则会产生错误素材和误执行路径 |
| 未缓存/缺 companion 的资源直接绘制 | 环境阻塞 | Provider 已请求正确 archive 但当前 workspace 没有完整索引、配套文件或 MD5 一致缓存；应显示 missing，而不是借用低优先级包 |

## 6. 建议实施和验收顺序

### 第 1 批：外部 CALL 只读求值（P0）

验收必须同时通过：

1. resolver 单元：外部 helper 的确定性 `MOV/RETURN` 能到达调用方；动态路径、未知命令、循环和冲突仍为 unknown；
2. Provider：外部物理文件、标签、调用位置和返回变量 provenance 正确；无奖励/属性重载函数变量泄漏；
3. Chromium：实际 canvas 文本显示具体值，输入/条件切换后更新，变量输入不改变源文件；
4. 负例：外部 CALL 只做奖励或属性刷新时，画布不把内部变量暴露为左侧输入，也不假设执行成功；
5. 重新解析/Apply：只写本地直接可定位坐标，外部 companion 未实现写回时保持只读。

### 第 2 批：PAK/ITEMSHOW/PLAYIMGEX（P1）

- GEE/GOM/JPK/WIL/WZL 现有样本必须保持槽位、空槽、宽高、X/Y、像素和 MD5 行为不变；
- ITEMSHOW 至少包含：IDX 1927→Looks 20699→Items2 槽 699、数量 0/正数、边框开关、灰度、发光、非方形和父容器越界；
- PLAYIMGEX 至少包含多帧、帧间隔、重复次数、负偏移、缺中间帧和 alphaDraw；
- 资源包同大小同时间但内容替换时，缓存必须被 MD5 拒绝；
- 运行 `npm run compile`、`npm run lint`、对应 Provider/Chromium 测试，并对解包 VSIX 重跑同一矩阵。

### 第 3 批：MONSTER/地图 profile（P2）

- 先加入 `engine + version + profile` 能力声明和未知 profile 诊断；
- 为 ENMap/EIMap/ReturnMap/Map 2010 分别准备真实样本和像素基线；
- 只有获得对应资源组和动作表后，才打开完整动画或特殊 blend；
- 经典 GOM 回归不得因新增 profile 改变现有 12/14/36 MAP 绘制。

### 第 4 批：HXM2/LzPak（Hold）

需要用户提供合法样本、密码来源和预期客户端截图/像素结果后，才开始 parser；首个交付应是只读探测器和错误诊断，不直接接入默认资源链。

## 7. 本轮实施与审查边界

- 本轮修改了 BOO 生产源码中的外部同源 GOTO 导入和原始地图 profile 拒绝诊断，并新增对应回归测试；没有修改用户脚本、数据库、地图、PAK、缓存或 VS Code；
- 没有新增 HXM2/LzPak parser；没有把参数化 CALL/CALLEX 当作已实现；没有重新打包 VSIX；
- 没有 Delphi 10.4 重编译 GXX；源码存在不等于本轮验证了可执行客户端；
- 没有真实游戏客户端逐像素同场景对照；Chromium/Provider 测试只能证明扩展自己的模型、资源请求和 DOM 绘制；
- 没有真实 HXM2/LzPak 样本，因此该格式结论保持 Hold；
- 本轮完整相关回归：`npm run compile`、`npm run lint`（0 errors，27 条既有 `require-atomic-updates` warnings）、`npm run test:extras`、`npm run test:npc-dialog-strict`（198/198）和 `npm run test:layout` 均通过。`test:layout` 首次被 Python 生成的 `tools/PakBridge/src/__pycache__` 阻断，删除该非源码缓存后重跑通过；该缓存清理未改动产品源码。
- 真实只读脚本回归：`preview-user-sword-real.test.js`（GOM，本地装备脚本/被调标签/GlobalVal.ini）和 `preview-user-rebirth-real.test.js`（本地转生脚本/转生数据表）通过；输入、GOTO、装备条件、转生 0/1/2/3、reset 和源文件哈希均通过。当前 MirServer 未发现客户端 `Items*.pak/jpk/wil/wzl`，因此这些真实脚本测试证明的是文件→resolver→model，不是客户端素材逐像素等价。
- 现有测试文件很多，且已有外部页面、返回值、ITEMSHOW、地图和 PAK 专项覆盖，但“测试通过”不等于所有脚本、引擎版本和客户端像素都兼容。

## 8. 结论

GXX 源码应继续作为“可验证的行为细节和 profile 结构”参考，不能当作跨引擎实现规范。本轮已完成最贴近用户问题的同源 `GOTO` 变量链，并以 198/198 严格套件、真实脚本、PAK、ITEMSHOW、动画和地图回归收口。下一阶段只有在取得真实客户端素材后，才继续做 ITEMSHOW/PLAYIMGEX 的像素差分；取得真实 MAP 2010/ENMap/EIMap/ReturnMap 样本后，才新增对应 profile；取得合法 HXM2/LzPak 样本、密码和像素基线后，才进入 Hold 项。参数化 CALL/CALLEX、跨引擎 MONSTER 动作、CSS 与 HGE 混合算法等仍按证据边界保持保守。
