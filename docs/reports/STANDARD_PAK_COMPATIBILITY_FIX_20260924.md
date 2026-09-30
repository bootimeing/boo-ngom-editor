# 标准 PAK 样本兼容修复报告

> 后续交付：用户要求升版后，已生成 V4.3.6。见 [V4.3.6 本地交付记录](../releases/V4.3.6_20260924.md)。下文保留本次兼容修复时的 4.3.5 测试证据。

日期：2026-09-24。版本维持 4.3.5；本轮交付独立兼容测试包，不是商店发布或默认安装替换。

## 结论

用户提供的标准 PAK 样本目录中，此前失败的三个文件现已通过正式读取路径的全槽验证，原有两个文件保持通过。

| 文件 | 读取分支 | 原始槽位 | 有图 | 空槽 | 结果 |
|---|---|---:|---:|---:|---|
| 龙族-LZM2-LEG3.pak | HXM2 / Lz V1 | 1200 | 832 | 368 | 新增兼容，通过 |
| LEG-360-APPLE.pak | PACK4.0 明文 BGRA | 1200 | 832 | 368 | 新增兼容，通过 |
| leg-ksf.pak | PACK4.0 KSF XOR / BGRA | 1200 | 832 | 368 | 新增兼容，通过 |
| GOM.pak | GAMEOFMIR2 | 1200 | 832 | 368 | 回归通过 |
| gee-V8-翎风.pak | GEEPAK3 | 1200 | 832 | 368 | 回归通过 |

源码运行时和最终 VSIX 解包运行时分别验证五包共 6000 个槽位，逐槽比较直读 PNG、旧 PNG 缓存、真实后台 Worker 返回值，以及尺寸、偏移和空槽。每个包的异常/丢弃图片与压缩校验恢复数均为 0，原文件 SHA-256 全部前后不变。

新增三个文件的完整 PNG 槽位序列摘要均与同组 GOM 文件相同：

```text
5ff48fb3fbf758a5263f5a6bf990e7a7816fbda8902b16c4ffd8b3072ba9eb42
```

GEE 样本保留原有像素/透明色约定，未为追求跨格式一致而修改。它的 PNG 序列摘要保持上一轮基线：

```text
05f37d03f6281d99cf376149565336c00c17884e4a215881c7753984e89f465e
```

## 根因及处理

### HXM2：缺少独立格式及解密路径

- 参照本机 GXX `ReadResources/Pak.pas` 的 Lz V1 结构和 `Common/UnitDes.pas` 的反馈算法。
- 五字节签名、256 字节加密头、262 字节总头长；V1 使用 4 字节逻辑偏移，零偏移保持为空槽。
- CP936 密码派生、20 字节 DES 反馈处理，不是标准 DES-CBC；索引、校验字段、每个图片头分别恢复初始反馈状态。
- 图片头保留真实宽高、带符号 X/Y、色深、独立 alpha 标志和压缩长度。原始/zlib 读取均受布局与边界检查。
- 真实样本的 832 张图全部为无独立 alpha 的未压缩 BGR24；先由独立 Python 解密实验读出原始像素，再与生产 TS 及同组 GOM PNG 交叉验证。
- 底向上的 DIB 行序和黑色透明参照 GXX `DxCanvas.pas`。独立 alpha 不被黑色透明逻辑覆盖，32 位独立 alpha 平面不误当内嵌 alpha。

### PACK4.0：尾部索引、尺寸和像素行序不同

- 使用文件末尾完整 zlib 索引，不扫描图片后重新编号。
- 解压后前 40 字节是不参与图片编号的不透明前缀，其后才是 `slotCount × 4` 的逻辑偏移表。
- 图片记录长 23 字节；宽高低 4 位不是尺寸，需要右移 4 位。
- 两个真实样本均使用 type 3 原始 BGRA，行序从上到下，不能套用 GEE/HXM 的上下翻转。
- 验证索引长度、完整 zlib 消费、总槽数、偏移唯一性、文件边界、相邻图块重叠、图片负载大小。
- 头内 offset 40 字段低位存在变体混淆，本轮未宣称还原其全部算法。已验收 profile 依据明确尾部长度定位索引，并验证完整流和全部逻辑偏移；不是任意全文件扫描。

### KSF：额外 XOR 范围及缓存重开

- 分别处理完整索引、图片头前 16 字节、像素前 128 字节的 XOR；短图按实际长度处理。
- 密码经 CP936 编码；错误密码无法通过完整索引解压和结构验证。
- 直读缓存仅保存每张图解码后的前 128 字节，不保存原始密码或 XOR 密钥，剩余像素继续按需读原包。
- 前缀按逻辑图序保存并做 SHA-256 校验，重开时发现损坏会安全重建。
- 本样本 832 张图的额外前缀缓存为 106496 字节，不需要转换后再缓存一份完整 PAK。

### 密码边界

真实密码仅经 stdin / 受控进程内存传入测试，没有写入测试脚本、报告或 VSIX。`LEG-360-APPLE.pak` 的已验收 profile 的索引和像素未使用密码加密，不把它打开成功写成“密码验证通过”。HXM2 和 KSF 已分别测试错误密码拒绝。未知加密/压缩 profile 不退回扫描模式。

## 实现位置

- `src/utils/hxm-reader.ts`：HXM2 V1 索引、密码和像素布局。
- `src/utils/pack4-reader.ts`：两个已验收的 PACK4.0 profile。
- `src/utils/gom-reader.ts`：导出原有 DES 反馈辅助函数供 HXM 复用，原 GOM 算法不变。
- `src/utils/pak-reader.ts`：检测、完整解码、legacy PNG 缓存。
- `src/utils/archive-index.ts`：直读、Worker、前缀缓存及重开。
- `src/utils/archive-types.ts`、`src/utils/patch-cache.ts`：类型及缓存恢复白名单。

保留工作区已有的脚本预览、地图、JPK 等未提交改动；没有重置、暂存或提交它们。

## 回归证据

新增 `tests/pak-hxm-pack4.test.js`，纳入 `test:pak-variants` 和 `test:all`。夹具不含真实素材/真实密码；期望 RGBA 独立生成，覆盖：

- 三个 profile、物理块顺序与逻辑 ID 不同、首中尾空槽。
- 中文及错误密码、尺寸低位、负偏移、行序、透明黑、部分透明。
- HXM24 的原始/zlib、DWORD 对齐和独立 alpha；32 位独立 alpha 像素向量。
- KSF 小于/大于 128 字节的图片及前缀处理范围。
- direct/legacy/Worker 像素一致、缓存命中/枚举、前缀损坏后重建。
- 重复/越界索引、截断、不支持的版本/布局、压缩索引多余尾字节拒绝。

源码及包内运行时均通过上述测试。原有通过测试包括 `pak-format`、`gom-reader-tolerance`、`archive-index`、`patch-cache`、`pak-pixel-contract`、`pak-inflate`、`pak-slots`、`pak-index`、`pak-password`、`jpk-reader`、`patch-cache-snapshot-async`、`patch-cache-snapshot-performance`、`patch-manager`、`cache-storage`、`item-image`，以及 `test:asset-consumers` 四个测试。

编译通过；Lint 为 0 errors / 27 warnings，均在既有函数中，未删除/关闭规则。

测试过程的两项环境记录：

1. 首次命令误引用不存在的 `archive-image-worker-pool.test.js`，未计作通过。真实 Worker 由 `archive-index`、新增夹具及五包全量测试覆盖。
2. 项目结构检查发现本轮 Python 诊断生成的 `gm_offline_crypto.cpython-314.pyc`；已将对应目录移至 `artifacts/standard-pak-impl-20260924/probe-bytecode-backup` 保留，诊断脚本关闭字节码写入，没有删除用户文件。

归位后 `test:layout` 三项全部通过：项目目录、Marketplace README 结构、包内 NPC 运行时闭包。

## 可安装测试包

`artifacts/standard-pak-impl-20260924/boo-ngom-editor-4.3.5-pak-compat.vsix`

- 大小：20692993 字节，约 19.73 MiB；比上一轮 JPK 候选增加 7109 字节。
- ZIP 条目 1440；`extension/` 内文件 1438，总字节 57003659。
- 包内 `out/`、`media/` 与当前构建结果逐文件一致，差异 0。
- 依赖闭包验证通过：60 个生产包、Ctrl+F12 62 文件本地闭包。
- 无根级源码、测试、报告、artifacts、test-artifacts 或 pytest 缓存进包。
- 最终包内运行时通过三 profile 合成测试和五包全槽测试。

SHA-256：

```text
3f41f332a2508796cea989925a48e693d10ae65ace3ff2ba4b9a15005e356e2c
```

安装：VS Code 扩展面板 → 从 VSIX 安装 → 选择此文件 → 重新加载窗口 → 重新读取这几个 PAK。无需先用 GM 工具箱转换。本轮未修改用户当前安装的扩展或 VS Code 本体，也未覆盖正式包。

## 尚未验收的边界

- 完成的是这三个指定包及对应 profile，不是所有同名引擎历史变体的无限兼容。
- HXM2 V0、pf15bit、特殊 SD 4-bit alpha 未在本轮实现。真实 HXM 样本只验收到 BGR24；不能把公共布局/合成向量支持写成全色深真实客户端验收。
- PACK4.0 非 type 3、压缩图片或不同索引结构仍需新样本，当前明确拒绝而非猜图。
- 本轮未在原 GM GUI、游戏客户端或用户已安装的 VS Code 中执行原生点击/快捷键验收。证据是包内读取、真实 Worker、PNG 和源码对照，不称客户端实测。
- 未写回原包、执行同格式转换、清用户缓存、修改默认安装、提交 Git、推送或商店发布。

## 本地证据文件

- [源码全槽结果](../../artifacts/standard-pak-impl-20260924/all-runtime-results.json)
- [最终包内全槽结果](../../artifacts/standard-pak-impl-20260924/packaged-results.json)
- [HXM 独立元数据与像素摘要](../../artifacts/standard-pak-impl-20260924/hxm-blocks.json)
- [三格式回归测试](../../tests/pak-hxm-pack4.test.js)
- [上一轮未兼容基线](STANDARD_PAK_COMPATIBILITY_AUDIT_20260923.md)
