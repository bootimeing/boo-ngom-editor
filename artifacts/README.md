# 本地发布产物

此目录保存当前版本的本地发布包和可再生成的本轮验证输出，不参与扩展编译或 VSIX 打包；仅此说明文件进入 Git。

- `releases/vscode-marketplace/`：Microsoft Visual Studio Marketplace 发布包。
- 当轮测试可生成日志、截图与解包目录；结束后将需留存的历史版本、功能快照、研究文件和隔离安装归档到工作区外。
- 整理前或高风险修改前的回滚包统一保存到工作区外的版本归档目录。

运行 `npm run package` 时，当前版本会写入 `releases/vscode-marketplace/`。打包先生成候选文件，再临时保留上一份同版本包，成功后才完成替换；任何一步失败都会恢复已有可用包。
