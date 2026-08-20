# 本地发布产物

此目录只保存当前版本的本地发布包，不参与扩展编译或 VSIX 打包。

- `releases/vscode-marketplace/`：Microsoft Visual Studio Marketplace 发布包。
- 历史版本、功能快照、研究文件和解包验证目录不得放入项目工作区。
- 整理前或高风险修改前的回滚包统一保存到工作区外的版本归档目录。

运行 `npm run package` 时，当前版本会写入 `releases/vscode-marketplace/`。打包先生成候选文件，再临时保留上一份同版本包，成功后才完成替换；任何一步失败都会恢复已有可用包。
