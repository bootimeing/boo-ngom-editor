# 开发与目录约定

## 从源码构建

推荐 Windows、Node.js 20 和 Python 3.12，与 GitHub Actions 保持一致。

```powershell
npm ci
python -m pip install -r requirements-test.txt
npm run compile
npm run lint
npm run test:all
npm run package
```

VSIX 生成在 `artifacts/releases/vscode-marketplace/`。打包会运行 lint、TypeScript 编译和 PAK 运行时检查；最终包仍需解压后验证：

```powershell
npm run verify:packaged-dependencies -- "<解包后的 extension 目录>"
$env:BOO_NPC_DIALOG_RUNTIME_ROOT = '<解包后的 extension 目录>'
npm run test:npc-dialog-strict
Remove-Item Env:BOO_NPC_DIALOG_RUNTIME_ROOT
```

指定包根的测试与旧版 workspace-only 测试共同组成严格矩阵，不能将其总数称为全部用例完全隔离。浏览器回归不替代原生 VS Code 手势、真实服务端或游戏客户端验收。

## 文件应该放在哪里

| 内容 | 目录 | 是否进入 Git |
| --- | --- | --- |
| 扩展源码 | `src/` | 是 |
| 运行数据、页面、语法、主题和图标 | `data/`、`media/`、`syntaxes/`、`themes/`、`resources/` | 是 |
| 自动测试、合成夹具和辅助代码 | `tests/` | 是 |
| 公共设计、维护说明和最终报告 | `docs/` | 是 |
| 构建、数据维护和发布脚本 | `tools/` | 是 |
| 必需的 PAK/M2 自包含运行时 | `tools/PakBridge/bin/`、`tools/M2Reloader/runtime/` | 是，不按普通编译缓存删除 |
| npm 依赖、TypeScript 输出 | `node_modules/`、`out/` | 否 |
| 当前安装包、解包、截图和日志 | `artifacts/` | 否，仅目录说明进入 Git |
| 历史候选、研究副本、隔离安装与过程报告 | 工作区外的归档目录 | 否 |

`data/audit-report/` 包含测试需要的基线，不能整目录当缓存清走。`out/` 不进 Git，但它是 VSIX 实际运行代码；TypeScript 不会自动删除孤立输出。`.gitignore` 与 `.vscodeignore` 分别控制仓库和安装包，必须分别检查。

## 测试分类

见 [测试说明](tests/README.md)。`test:all` 是可用于干净 checkout 的主门禁；需要本地客户端、服务端、缓存或密码的专项验收应单独执行，并明确记录缺样本或凭据时的边界。不要提交真实游戏数据、私人脚本或凭据来使 CI 通过。

## PAK 运行时

维护说明见 [工具目录](tools/README.md)。重新构建需要 Python 3.12、cx_Freeze、pycryptodome 和 unicorn；先构建到独立 staging、验证，再更新 `bin/`。用 Python 3.12 运行 `tools/PakBridge/verify-frozen-source.py <bin目录>` 可以核对核心冻结模块与源码。不要在清理时把二进制与其依赖拆开，也不要将源码编译通过当成冻结运行时已更新。

## 提交与发布

先检查 diff 和未跟踪生产模块，显式暂存文件或已核对的目录。提交应包括导入的模块、测试 helper、合成 fixture 和所需运行时，排除本地生成物。源码推送到 `main` 会触发构建、测试与 VSIX artifact；`v*` tag 还会触发商店发布，只有明确要求商店发布时才创建 tag。推送后按完整提交 SHA 核验对应 CI。
