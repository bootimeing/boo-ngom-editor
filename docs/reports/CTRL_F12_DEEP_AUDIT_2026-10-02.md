# Ctrl+F12 深度审计：当前不足与下一轮验收清单

日期：2026-10-02。版本：V4.3.8。源码基线：`6244fdc57b6cb49f07ab46cc6c6c82bcaa289095`。

本报告回答“当前 Ctrl+F12 还有什么不足”，不是修复完成报告。本轮没有修改生产源码、正式测试、用户脚本、数据库或补丁，没有升版、打包、安装、提交或推送。审计开始时工作树干净。

## 1. 结论

当前已经不是早期“很多控件只有占位”的状态：同文件 GOTO、已映射 CALL、局部变量、确定文字样式、TEXT 偏移、图片数字、计时控件和多种交互都有实现及回归。不能继续照搬旧报告的未实现清单。

但目前仍不能宣称“代码到画布完整、可控、与客户端一致”。最影响使用的不足有四类：

1. **数据不可信**：部分运行时 writer 没有撤销旧赋值，旧数值被误标为确定，用户输入还会被隐藏；会话和工作区绑定也有旧源/错源问题。
2. **内容仍可能消失**：绝对坐标 `&IMG` 漏掉已确定变量的素材放行；若干常用条件没有输入，固定走未满足分支；真实字形大于估算框时裁字。
3. **能看见但不完全可操作**：文字溢出部分不能选中，Save 无改动也会清本地参数/历史，外部 QFunction 页面仍只读且动作被清空。
4. **可用模拟不等于客户端还原**：动画混合、240 帧上限、怪物代表帧、UIModel 缺层、默认皮肤/九宫格等仍有边界。

多数问题是工程上可以解决、尚未闭环；不是“离线预览必然做不到”。真实在线人物/服务器状态无法从 TXT 自动获得，但可以提供本地样本输入，不能因此继续认证旧值或把整个分支藏掉。

## 2. 证据与验证范围

| 层级 | 本轮实际执行 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| 当前生产源码与编译 runtime | 检查 catalog → parser → resolver → Provider → renderer；编译通过 | 可以定位实现；不单独证明最终可见 |
| 既有回归 | `test:npc-dialog-strict` **198/198 通过**；另外原 fidelity audit 20 个旧反例均 MATCH、remaining audit 27/27 通过 | 证明这些已覆盖场景没有回归；不是整体兼容率或视觉等价 |
| 新语义反例 | 16 项：4 个对照匹配，12 个反例不匹配，归为 3 组 | `--expect-perfect` exit 1 是揭示不足，不是程序崩溃；不把 12 例算作 12 个独立 bug |
| 新根代理模型/Provider 探针 | 18 个模型记录，7 个素材请求对照 | 调用当前生产 parser 与 hydrate；图片 resolver 为明确的合成素材，不是用户真实补丁验收 |
| 宿主探针 | 6 组不足 + 1 组正确刷新对照 | 当前生产 Provider、真实隔离夹具；VS Code 文档/消息/保存 API 为替身，不冒充原生操作 |
| 浏览器 | Chrome **154.0.8037.93**，生产 HTML/CSS/JS，4 个文字/边界样本 | 真实 DOM 字形、裁切和 `elementFromPoint` 命中；不是原生快捷键或游戏客户端截图对照 |
| GXX 参考源码 | 条件短路、EQUAL、PLAYIMG/ITEMSHOW blend 原文与文件身份 | 证明该 GXX 快照的实现；不能直接推广所有 GOM/GEE/LFM/996PC 版本 |

严格矩阵使用安装的 Chrome 作为必需浏览器。部分测试另尝试 Edge 时记录了无 DOM 的失败候选、随后 Chrome 成功；不能把矩阵通过写成“所有安装浏览器均通过”。日志保留这些候选，不据此无证据认定产品在 Edge 内坏掉。

所有证据文件见 [附件目录](../../artifacts/ctrl-f12-deep-audit-20261002/)，汇总身份见 [audit-manifest.json](../../artifacts/ctrl-f12-deep-audit-20261002/audit-manifest.json)。

## 3. 第一批：优先解决的内容与来源问题

这里的 P1 表示产品修复顺序优先，不是安全漏洞评分。F07 属于参考源码差异，需要先确认目标引擎契约，再实施。

| ID | 不足与当前实际 | 类型 / 原因 | 下一步与验收标准 |
| --- | --- | --- | --- |
| F01 | `MOV U101 42` 后 `GetPlayInfo Level U101`，仍显示 42；本地输入 6 无效，输入框消失。`GetHumVar`、`GetItemRemainingTime` 有同根因例子 | **已实现但有缺陷**：own-engine writer 注册缺失，普通 resolved 值没有失效 | 补按引擎输出合同注册。Auto 为 0 / 预览文字，显式输入有效；确定后续 MOV 仍按源序覆盖；GOTO/CALL 内同样正确；数据库 IDX 权限不可继承 |
| F02 | `<IMG:变量:资源:X:Y>` 能请求确定素材；同样的 `<&IMG:变量:资源:X:Y>` 没有请求，画布缺图 | **已实现但有缺陷**：静态放行正则只匹配 `^<IMG:`，漏掉绝对坐标修饰符 `&` | 共用已证明投影逻辑。相对/绝对两种写法均发相同素材请求；本地占位/输入、运行时覆盖、非法序号继续拒绝；浏览器加载、偏移、命中可见 |
| F03 | GOM `CHECKITEM 金刚 1`、`CHECKRENEWLEVEL`、`CHECKMAPNAME`；996PC 后两项与 `CHECKPOSEGENDER` 均没有对应输入，显示未满足分支 | **可实现但尚未实现**：类型化条件面板只注册了部分谓词；unknown 被按 false 回退 | 按自身手册增加背包数量/转生数字/地图文字/对象性别等本地场景。NOT 去重；开/关、数值、重置可切所有目标分支；只读模拟，不执行服务器动作 |
| F04 | 40 个粗体 Arial/W 的模型宽 600，浏览器实宽 1132.625，末尾 **453.625px 被裁**；20 个 W 可见溢出部分不能命中 | **已实现但有缺陷**：固定字符宽估算 + 静态文本未走真实宽度扩展 + canvas 隐藏溢出 | 真实字体测量闭环更新 label/wrapper/canvas/stage/scroll；完整末端可命中、拖动、反向 Apply；zoom 不二次放大；固定视口/列表裁切仍保持 |
| F05 | 外部服务器 B 的脚本不属于任何工作区时，AddDlg 读取第一工作区 A 的 QFunction，实际显示“这是服务器A” | **已实现但有缺陷**：无所属工作区时借用 `workspaceFolders[0]` | 不借第一工作区；只解析主文件或明确绑定经验证的 B 根。多根/外部文件/同名 QF 不能串源；数据和素材上下文同源 |
| F06 | 关闭源码后重开同 URI，已有会话继续引用已关闭的旧 TextDocument；仍显示旧内容且 conflict=true | **已实现但有缺陷**：会话复用不回绑当前文档 | 无草稿时绑定新对象/新模型；有草稿时保护并明确提示。原生 Extension Host 复验 close/reopen、重载、保存、冲突解除 |
| F07 | 普通 AND 已 false / OR 已 true 后，后续 `CHECKNAMELISTPOSITION` 仍清掉 P0，42 变 0、多出 P0 输入 | **参考源码差异已证实，客户端合同待验**：依赖发现与执行效果未分开，缺普通短路 | 先核定目标 GEE/LFM 版本。分开发现依赖与应用副作用；跳过 writer 保留 42，真正到达 writer 仍未知；阈值 `#IF(n)` 不被误短路 |

### F01：不是“实时数值不能离线读取”就可以显示旧数值

```text
[@main]
#ACT
MOV U101 42
GetPlayInfo Level U101
#SAY
<TEXT:U=<$STR(U101)>:30:30>
```

引擎：GEE/LFM 预览路径。按产品的离线输入契约，最后 writer 的在线值未知：Auto 应 `U=0` 并保留输入；手动 U101=6 应 `U=6`。实际都是 `U=42`，没有输入。自己引擎资料明确第 2 参数是输出，所以这不是纯推测。

位置：`src/ui-dialog/preview-command-outputs.ts:9/17`；`variable-resolver.ts:1723-1737`；`source-parser.ts:673-685`。完整同根因命令、资料和负例见 [语义专项](../../artifacts/ctrl-f12-deep-audit-20261002/semantics/findings.md)。

### F02：绝对与相对 IMG 的可重复对照

```text
[@main]
#ACT
MOV N0 1060
#SAY
<&IMG:<$STR(N0)>:1:50:50>
```

素材参数格式是 **N:F:X:Y**，不是 PLAYIMG 的 F:N 顺序。上例没有 `assetRef`，Provider 0 请求。去掉 `&` 后 Provider 请求 `{willIndex:1,imageIndex:1060}`；字面量 `<&IMG:1060:1:50:50>` 也正常请求。资源序号为已确定变量时也有相同差异。

根因在 `source-parser.ts:5192-5204`。因此现有 `preview-resolved-image.test.js` 的无 `&` 绿测，不能覆盖该问题。资料格式来自当前自身引擎 `img-absolute`/`img-relative` catalog；Provider 对照见 [root-provider-evidence.json](../../artifacts/ctrl-f12-deep-audit-20261002/root-provider-evidence.json)。独立复核在 GOM/GEE 两种引擎均复现，并保留本地输入不得请求素材的安全负例，见 [secondary-review.md](../../artifacts/ctrl-f12-deep-audit-20261002/host/secondary-review.md)。

### F03：条件输入不是已经“全兼容”

```text
[@main]
#IF
CHECKRENEWLEVEL = 1
#SAY
满足
#ELSESAY
不满足
```

GOM 与 996PC 模型均只有“不满足”，`previewInputs=[]`。用户没有能把转生设为 1 的控件。GOM CHECKITEM 的自身 catalog 已审核完整参数；996PC 转生/地图/对面性别自身 catalog 也有已审核格式。GOM 转生/地图目录尚有 legacy review 标记，实施时应补读其章节，不从别的引擎套规则。

位置：`preview-inputs.ts:82-88` 的数值别名、`:159-216` 的场景注册和 `:563-680` 求值；`variable-resolver.ts:735` 的 unknown→未满足回退。上述是代表例子，不把命令目录所有 CHECK 数量冒充全部可模拟/不兼容统计。

### F04：能解析、也有 DOM，仍然可能不完整且不可控

```text
[@main]
#SAY
<Text:WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW:780:50{FSIZE=30;FNAME=Arial;FBOLD=1}>
```

`source-parser.ts:6143/12151-12163` 用固定字宽按字号放大，未考虑字体与粗体。`media/npc-dialog-visual.js:1808-1809` 只对特定 local/client 字值扩展命中框；普通静态文字未扩展。`npc-dialog-visual.css:535-537` 隐藏越界。真实浏览器数据见 [visual/evidence.json](../../artifacts/ctrl-f12-deep-audit-20261002/visual/evidence.json)。

同类布局边界：源码坐标超过 4096 时仍生成可编辑模型，但 `source-parser.ts:88/12678-12679` 把画布封顶，元素可能完全在画布外。需要越界定位/虚拟视口/清晰提示，不应无界增大 DOM；本轮没有证明游戏客户端会显示 x4200。

## 4. 第二批：刷新、交互、性能和模拟精度

| ID | 当前不足 | 原因 / 可行方向 | 验收标准 |
| --- | --- | --- | --- |
| F08 | GlobalVal 默认从 40 改为 99，再按 Ctrl+F12 仍显示 40；工具栏重载才显示 99 | 已计算 fresh model，但 existing 分支丢弃；需要明确依赖新鲜度与草稿复用 | 无草稿采用新值；有草稿保留并提示；INI/数据库/偏移/补丁的刷新策略明确，不监听无关文件 |
| F09 | 点击 `/@next(42)` 后显示 42，零坐标改动点 Save，参数变预览文字，history 1→0 | 保存后用 preserveDrafts=false 清整个 previewPath；应拆“草稿”“场景/参数/历史” | 无改动保存不丢场景；有改动从新源重验证有效调用边；失效边才截断 |
| F10 | 同一轮 30 次文本事件开始 30 个 createModel，最终只发布 1 次 | revision 只防旧结果，没合并/取消工作 | 每会话 debounce / single-flight latest-wins；最终必须是最后状态；真实大项目测耗时/取消，不将分发次数当毫秒跑分 |
| F11 | 纯文字 0 个素材引用，两次 hydration 仍两次全归档目录扫描 | 在发现首个资源请求前就扫描全部客户端档案 | 纯文字零扫描；资源页按需、快照可失效/复用；ITEMSHOW MD5/数据库/源身份保护不可取消 |
| F12 | GEE `EQUAL S1 1` 把文本 001 算相等；ABC/abc 算不等，均与 GXX 相反 | 先 decimal 后 JS 相等，没有文本/引擎合同隔离；**目标客户端待补证** | 核定后覆盖文本前导零、大小写、中文、空串、数值变量、NOT；不改所有引擎公共规则 |
| F13 | PLAYIMG drawMode 主要保留 dataset/class；ITEMSHOW 发光的 plus-lighter 仍是近似 | GXX 已有明确 blend 因子可借鉴，不能再笼统说完全无公式；但需对应 profile | 精确像素矩阵 + 对应客户端/素材对照；mode0 不变；不把 GXX 映射推广 GOM/996PC |
| F14 | 源码 300 帧只加载 240；100ms 单遍约 24s 而非源码约 30s | 性能硬上限，完成/循环用截断后的 frames.length | 流式帧/LRU 保留源码完整时槽；241/300/1000 首尾、缺帧、取消、完成事件；或显著标记截断 |
| F15 | 已确定 MOV 的 PLAYIMG 帧数仍回退 1 首帧；纯 MOV 的 ITEMSHOW IDX 仍被限制 | 源参数安全门按动态来源保留，属于**可扩展但未实现的权限策略**，不应直接全部放开 | 帧数按非占位、有源证明的有界数值扩展；IDX 如扩展需显式资源/数据库证明；未知输入不能获得资源权限 |
| F16 | 已确定的流式 FCOLOR 实际黄色且 status=resolved-static，但仍留“不借用 MOV 当前值”警告 | 诊断未随字段最终状态重新归并 | resolved 字段不显示未知警告；真正未知/非法/缺素材分开；默认画布继续精简 |

F08-F11 的准确位置、事件顺序和替身测试边界见 [宿主专项](../../artifacts/ctrl-f12-deep-audit-20261002/host/findings.md)。F12 见语义专项，F13-F14 见 [视觉专项](../../artifacts/ctrl-f12-deep-audit-20261002/visual/findings.md)。

### F13：已经有公式，但实现和引擎对应还未闭环

GXX `FState.pas:14308-14360` 解析 PLAYIMG，第 7 参数非零设置 `Blend_SrcAlphaColor`，`:23834` 用该模式实际绘制。`HGE.pas:2828-2831` 使用 `SRCALPHA` / `INVSRCCOLOR`，RGB 公式：

`输出 = 源色 × 源Alpha + 底色 × (1 - 源色)`。

当前 ITEMSHOW 的 `plus-lighter` 不等于此公式。源色 0.5、Alpha 0.5、底色 0.5 时，该公式是 0.5，而 additive CSS 近似是 0.75。这说明“特效有图”“动画会播放”不能证明亮度/透明边缘正确。

可以按明确对应的 GXX兼容 profile 使用 WebGL/软件合成并比对；GEE/LFM 模式 2/3 的层级及其他引擎仍需要各自证据。完整只读源码片段和哈希在 [model-evidence.json](../../artifacts/ctrl-f12-deep-audit-20261002/visual/model-evidence.json)。

### F15：确定变量不是一律丢失，但覆盖不一致

```text
[@main]
#ACT
MOV N0 15
#SAY
<&PLAYIMG:1:1060:<$STR(N0)>:100:95:172>
```

模型 `frameCount=1`、`staticFirstFrameOnly=true`；字面量 15 模型是 15。合成 Provider 对照分别为 1 次请求与 16 次请求（后者包含基础资源请求和帧请求，并非 16 个独立动画帧）。

相反，已确定 TEXT 字号/字体/颜色，以及无 `&` IMG 已经可以恢复静态值，本轮正向对照通过。不能再写“一见动态表达式就全部不绘”。ITEMSHOW 目前只允许严格的直接数据库 IDX provenance；改进其纯 MOV 路径必须单独审计，不能把预览数字 0 或用户输入变成真实资源证明。

## 5. 仍属部分模拟或需要补证的能力

| 能力 | 目前能做 / 不能做 | 原因与可行性 |
| --- | --- | --- |
| 996PC UIModel | 绘确定的 StateItem 部件；没有裸模、头发、完整动作、完整内观特效 | **缺层实现 + 素材映射待补证**，不是缓存齐就自动补全；要用996PC自身资料，GXX不能代证 |
| GOM/GEE MONSTER | 已验证静态代表帧；不是按指定动作/方向完整播放 | **动作映射合同不足**；可继续查对应引擎源码/profile。SmartMonster 同Appr不唯一时还需要明确怪物身份 |
| 外部 AddDlg QFunction | 可以显示外部页面；当前坐标只读、local click/control/completion 目标被清空 | **可实现未扩展**：需纳入已有 source/event/coordinate authority，不是删 editable=false 就安全 |
| 九宫格、默认皮肤、ListView bounce | 显式素材/滚动已实现；九宫格有整图缩放近似，默认皮肤/回弹曲线不完全还原 | **参数/皮肤证据不足与部分实现**；可用引擎+版本+皮肤 profile，明确切片/默认素材后实现 |
| 背包/仓库格、ITEMBOX 内容 | 能绘格/框、筛选配置；没有真实玩家物品 | **运行时数据缺失**；可新增本地 IDX/数量/星级样本输入。不能声称从脚本自动知道库存 |
| 996PC GetListStringEx 多列 | 当前按整行，忽略第4分隔符 | 已确认参数未使用，但逐列输出槽命名/覆盖合同不足；先补自身资料，不编造精确结果 |
| 996PC public/ 直引图片 | 部分路径保留而不加载；绝对路径、穿越、协议等拒绝 | **可信资源根/客户端路径合同和安全边界**；可设计显式安全绑定，不开放任意文件读取 |
| 真实世界与服务器动作 | 本地条件/点击有限重放，不执行奖励、传送、持久化、在线查询 | **不能从离线代码自动恢复真实世界**。可以输入/模拟，不能把模拟宣传为真实执行 |
| 缺素材/数据库、未知密码、损坏档案 | 正确引用仍可能无法解出图片 | **环境/资源边界**；必须先证明 Provider 请求正确，再归因为环境。本轮没有覆盖所有用户PAK/JPK，不能称全兼容 |

本地路径/循环/递归/点击重放也有安全预算。预算是有界预览设计，不是“语法不能识别”；改善可做可见截断状态、分段预览，而不是无限运行用户脚本。

## 6. 为什么现有测试都绿，还会发现不足

`tests/npc-dialog-visual.test.js:4132` 的 `testEveryCatalogStatementBuildsADomModel` 当前主要断言：有一个 page、无 unsupportedStatements、elements.length>0。它能发现未识别，但占位、缺层、裁字、错误数据、不可命中都可能通过。

严格矩阵已经包含大量真实浏览器/Provider安全测试，不能笼统说“完全没测试”。本轮不足来自具体覆盖空洞：

- IMG 静态投影测试覆盖无 `&`，没有等价修饰符对照。
- writer 测试覆盖已注册命令，没有把所有 own-engine 输出合同做“旧证明撤销”的反例。
- 普通文本视觉测试没有覆盖真实宽字/字号/粗体超过估算框的完整命中范围。
- 会话测试缺少同 URI 的不同 TextDocument 对象、无所属工作区、零改动 Save 保留参数等边界。
- 条件输入没有按代表性的自身手册谓词逐项验“用户能否切到另一分支”。

下一轮每项验收至少要有：完整源码 → expected/actual → 生产模型 → 必要的 Provider请求 → 浏览器最终可见/命中 → 原生宿主或客户端边界说明。原生键鼠、WorkspaceEdit/Undo/GBK保存与真实客户端像素对照，本轮没有重新验收，仍需专项验证。

## 7. 建议实施顺序

1. **先保证来源与数值可信**：F01 writer、F05 工作区绑定、F06 文档会话回绑。把“错图/旧值”的风险先收住。
2. **补内容可见和用户可控**：F02 `&IMG`、F03 类型化条件、F04 字形/命中范围、F09 保存保留场景。验到最终可操作，不止模型计数。
3. **核定并修解释器契约**：F07 普通短路、F12 文本 EQUAL、GetListStringEx。先确认目标引擎版本，再做按引擎实现与源序回归。
4. **修刷新与性能闭环**：F08 新鲜度、F10 合并重建、F11 按需扫描。保留源身份、ITEMSHOW MD5、跨文件保护。
5. **提高客户端外观与长动画精度**：F13 混合、F14 流式帧、F15 有证明动态参数、F16 诊断归并。
6. **扩展模型/皮肤/库存能力**：MONSTER、UIModel、外部 QF 操作、九宫格、默认皮肤、本地样本库存。每个 profile 单独验收，不做跨引擎猜测。

先修前两批，才能明显改善“看不全、不能控、数值不准”。最后一批提升客户端还原度；真实在线世界仍应保持显式本地输入/模拟边界。不能用“全部测试绿”或一个兼容百分比代替这些验收。

## 8. 可复跑附件

附件位于维护者本地 `artifacts/`，不随公开仓库提交；历史附件整理后从外部归档恢复，不是 GitHub 下载链接。

在项目根运行，先 `npm run compile`：

```powershell
node artifacts/ctrl-f12-deep-audit-20261002/root-probe.js
node artifacts/ctrl-f12-deep-audit-20261002/host/probe.js
node artifacts/ctrl-f12-deep-audit-20261002/semantics/probe.js --expect-perfect
node artifacts/ctrl-f12-deep-audit-20261002/visual/model-probe.js
node artifacts/ctrl-f12-deep-audit-20261002/visual/probe.js
npm run test:npc-dialog-strict
```

语义 `--expect-perfect` 目前预期 exit 1，用来保留缺口。浏览器探针需本机 Chrome/Edge，不可把无DOM当SKIP。证据目录被 Git 忽略，仅本机存在；若要移交，必须连同探针/JSON/日志与源码基线一起复制，不只复制本报告。浏览器 profile 是临时诊断环境，不必移交。

专项：[语义](../../artifacts/ctrl-f12-deep-audit-20261002/semantics/findings.md) · [宿主](../../artifacts/ctrl-f12-deep-audit-20261002/host/findings.md) · [视觉](../../artifacts/ctrl-f12-deep-audit-20261002/visual/findings.md) · [完整矩阵日志](../../artifacts/ctrl-f12-deep-audit-20261002/strict-suite.log)。
