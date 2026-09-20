# 开发工具

- `data-maintenance/`：三引擎语言数据生成、分类、核对和维护工具。
- `data-maintenance/archive/`：保留已实施的一次性数据迁移与回归引用；2026-09-05 迁移默认只提示，只有显式 `--apply` 才写入当前目录数据。
- `M2Reloader/`：M2 定向重载的原生源码、构建脚本与发布运行时。
- `PakBridge/`：特殊 PAK 格式的兼容解析源码、自包含运行时和验证工具。
- `release/`：VSIX 构建与解包后依赖完整性验证工具。

编译中间文件、Python 缓存和一次性研究输出不进入 Git；被回归引用的迁移工具需要保留并标明写入开关。PAK 的 `bin/` 是必要运行时，不等于可随意清除的中间文件。

PAK 使用 Python 3.12 构建到独立 staging 后验证，源码/冻结模块一致性检查为 `python -B tools/PakBridge/verify-frozen-source.py <bin目录>`。构建依赖和入口见 `PakBridge/build_runtime.py`，通用启动检查见 `npm run verify:pak-runtime`；这些检查不替代各格式真实样本验收。
