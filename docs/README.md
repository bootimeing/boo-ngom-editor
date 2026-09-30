# 文档目录

项目功能总览见[README](../README.md)。本目录将当前使用说明、开发参考和历史验收分开；历史报告的日期、候选包和已知限制不自动代表当前发布状态。

## 使用指南

- [验证资源包全部图片](user-guide/ARCHIVE_VERIFICATION.md)
- [查看素材原图、状态、偏移与连续帧](user-guide/ARCHIVE_IMAGE_INSPECTION.md)
- [补丁资源工作台：浏览、导出、偏移和资源编辑](user-guide/PATCH_RESOURCE_WORKBENCH.md)
- [只读检查 PAK 原始结构（开发诊断）](user-guide/PAK_STRUCTURE_INSPECTION.md)

## 开发与维护

- [开发与目录约定](../CONTRIBUTING.md)
- [测试分类与验收边界](../tests/README.md)
- [开发工具](../tools/README.md)
- [PAK 可追溯结构规范](specifications/PAK_STRUCTURE_CONTRACTS_20260925.md)
- [补丁资源工作台实施计划](plans/PATCH_RESOURCE_EDITOR_PLAN_20260926.md)
- [2026-09-27 跟进清单](plans/FOLLOWUP_20260927.md)

## 版本与交付

- [V4.3.7 本地发布包与源码交付核验](releases/V4.3.7_RELEASE_20260930.md)
- [V4.3.6 项目整理与发布核验](releases/V4.3.6_RELEASE_20260927.md)
- [V4.3.5 / V4.3.6 更新内容](releases/V4.3.5-V4.3.6_UPDATES_20260927.md)
- [完整版本记录](../CHANGELOG.md)
- [Open VSX 首次发布说明](releases/OPENVSX_FIRST_PUBLISH.md)

## 历史验收参考

- [素材工作台使用问题修复](reports/PAK_WORKBENCH_FIX_20260927.md)
- [NPC 缺失脚本跳转与创建](reports/MERCHANT_SCRIPT_LINK_FIX_20260927.md)
- [资源工作台 P6 验收与未开放边界](reports/PATCH_RESOURCE_EDITOR_P6_20260927.md)
- [大包压力测试及规模边界](reports/ARCHIVE_LARGE_PACKAGE_STRESS_20260926.md)
- [PAK 展示和进度条优化](reports/PAK_COMPLETION_20260926.md)
- [紧凑素材目录、选择器与 WIL/WZL 坏槽](reports/PAK_SCALE_COMPLETION_20260926.md)
- [2026-09-20 项目整理与同步](reports/PROJECT_CLEANUP_20260920.md)

## 目录边界

- `user-guide/`：当前操作指南。
- `specifications/`：本项目维护的格式合同与证据索引，不存放厂商源码。
- `plans/`：架构、兼容、性能方案及明确标注状态的任务清单。
- `reports/`：按日期保留的调查与验收记录。
- `releases/`：版本摘要、交付核验和商店发布说明。

真实游戏数据、密码、厂商帮助原件和本地研究副本不作为公开源码提交。报告中 `artifacts/` 路径只表示维护者本地证据，不是 GitHub 下载链接；公开获取安装包请使用实际发布的商店版本、Release 附件或对应提交的 CI artifact。
