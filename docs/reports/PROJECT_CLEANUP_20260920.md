# 2026-09-20 项目整理与源码同步

版本保持 V4.3.5。本次整理不删除或重写正在使用的生产功能，保留近期 NPC 预览、爆率分析、地图/资源缓存、语言数据以及 PAK 冻结运行时更新。

## 整理范围

- 新增 [开发与目录约定](../../CONTRIBUTING.md) 和 [测试说明](../../tests/README.md)，补齐文档与工具导航。
- 更新 CHANGELOG，保留 README 已采用的功能分类；版本增量由独立 CHANGELOG 维护，相应更新文档结构测试。
- 将根项目报告标为 2026-09-05 历史快照，避免旧统计被误读为当前状态。
- 81 份未跟踪的本地过程报告、175 项历史 artifact 和 2 个本地测试缓存目录迁入工作区外的可恢复归档。归档保留 `docs/` 与 `artifacts/` 相对结构、已有公共文档副本、迁移清单和整理前 tracked diff；没有永久删除历史材料。
- 项目内保留当前正式 VSIX；本轮验证输出保存在忽略目录中。`node_modules/`、`out/` 和 `data/audit-report/` 保留，不按废弃源码处理。
- 一次性 2026-09-05 语言数据迁移放入 `tools/data-maintenance/archive/`，修正回归引用；默认运行不改数据，显式 `--apply` 才写入。
- 新增生产模块、测试、helper 和合成 fixture 与调用方一起纳入提交，避免本机借用 untracked 文件而干净 checkout 失败。

## 验证边界

整理前完整 `npm run test:all` 通过，包含 NPC 严格矩阵 198/198。整理后的源码提交 `b2011875aeaf21012a2d650865323c8d58bb2a06` 在独立干净 checkout 中重新 `npm ci`，完整 `test:all` 与打包均退出 0；最终 VSIX 解包后依赖校验通过，指定包内运行时的 NPC 严格矩阵 198/198。此后的报告更新不改变生产输入；远端结果以最终提交 SHA 对应的 GitHub Actions 为准。

使用 Python 3.12 将 PAK 冻结运行时的五个核心 code object 与源码对比，全部一致（忽略构建路径元数据）。冻结目录限定为 Git binary 属性，保留上游许可证原始字节；干净 checkout 的 326 个冻结文件与工作区逐文件 SHA-256 一致。最终包核对 513 个生产文件，0 差异；扩展根级 src/tests/docs/artifacts/test-artifacts/.pytest_cache 混入 0。

最终本地包仍为 `artifacts/releases/vscode-marketplace/boo-ngom-editor-4.3.5.vsix`：20,683,815 字节，ZIP 1,438 条目，extension 1,436 文件 / 56,976,083 字节；SHA-256 为 `dc3fd76e4ea1a4c21037aca28c3ceaf72dec4972e12ee5d7e8434a952e349671`。本地日志位于忽略目录 `artifacts/verification-20260920/`，不作为公开下载链接。

上述计数是自动回归覆盖，不是全部游戏脚本兼容率。真实客户端逐像素对照、原生交互或外部语料专项测试的历史结论不能作为本次新通过项。

## 发布边界

本次授权是整理并推送 GitHub。只推送源码分支，不创建版本 tag、不触发 Marketplace/Open VSX 发布、不替换默认已安装扩展。VSIX 与本地历史证据不作为源码文件上传；CI 的 `vsix` artifact 是与具体提交绑定的构建产物。
