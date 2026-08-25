# 第三方组件与资源声明

BOO 自有源代码按根目录 `LICENSE` 中的 MIT License 发布。下列第三方组件、运行库和兼容资源不因进入本仓库而改变原有权利归属或许可条件。

## 生产依赖

| 组件 | 当前版本 | 许可 |
| --- | --- | --- |
| iconv-lite | 0.7.2 | MIT |
| mdb-reader | 3.2.0 | MIT |
| sql.js | 1.14.1 | MIT |
| SheetJS xlsx | 0.20.3 | Apache-2.0 |

这些组件的直接及传递依赖由 `package-lock.json` 固定。VSIX 只打入运行所需文件，并保留相应包内许可证文件。

## 测试依赖

`requirements-test.txt` 固定以下源码测试依赖，仅用于 PAK 密钥派生回归和 GitHub Actions，不进入 VSIX：

- PyCryptodome 3.23.0，按其上游 BSD / Public Domain 声明使用。
- Unicorn 2.1.4，按其上游 BSD License 声明使用。

## Webview 组件

`media/vendor/tabulator/` 使用 Tabulator 6.5.2，版权归 Oli Folkerd 及其贡献者所有，按该目录中的 MIT License 使用。

## PakBridge 自包含运行时

`tools/PakBridge/bin/` 包含 BOO PAK 兼容程序、Python 冻结运行环境、cx_Freeze 启动组件和 Microsoft Visual C++ Runtime 文件。相关许可证保存在：

- `tools/PakBridge/bin/frozen_application_license.txt`
- `tools/PakBridge/bin/share/licenses/vc_redist/LICENSE.txt`
- `tools/PakBridge/bin/share/licenses/vc_redist/LICENSE.RTF`

## NPC 兼容展示素材

`tests/fixtures/npc-looks/*.webp` 仅用于地图 Webview 的离线布局测试，不进入扩展发布包。原始地图运行时会读取用户已选择客户端中的 PAK/JPK/WIL/WZL，不再使用这些测试图片。测试图片不随 BOO 源码重新授权，也不包含在根目录 MIT License 的授权范围内。使用者只能在拥有相应权利或已经取得合法授权的情况下使用、修改或再分发这些素材。

## 不包含的资料

公开源码不包含引擎厂商原始帮助文件、用户服务端、客户端补丁、测试 PAK/JPK/WIL/WZL、补丁密码或其他第三方项目发布包。需要真实资源的兼容测试必须通过环境变量显式指定已获授权的本地样本。
