# 回归测试

## 通用门禁

`npm run test:all` 按顺序运行缓存/资源、像素契约、消费者、语言、爆率、996PC、编辑器、NPC 严格矩阵、M2 队列和项目布局检查。需要先安装根目录声明的 npm 与 Python 测试依赖；浏览器用例使用本机 Chrome 或 Edge。

- `test:npc-dialog-strict`：NPC 模型、Provider 和浏览器组合。设置 `BOO_NPC_DIALOG_RUNTIME_ROOT` 可让支持该机制的测试加载最终 VSIX 解包内容。
- `test:conditional-drop`：三引擎爆率模型、外部 CALL、路径边界与只读源文件核验。
- `test:asset-consumers`、`test:pak-pixels`：资源/缓存快照与像素契约。
- `test:layout`：公开目录、README 和安装包运行依赖结构。
- `helpers/`：独立测试 oracle 和夹具工具，不是生产模块。
- `fixtures/`：可公开分发的固定或合成数据；例如 `gee2-native.json` 是合成协议夹具，其 password 是测试字符串，不是真实资源密码。

文件名含 `local` 不自动表示依赖本机语料：`pak-geepak2-local.test.py` 使用合成数据与已有 VM 做差分，因此纳入通用门禁。判断是否适合 CI，应查看实际输入来源。

## 环境专项

原生 VS Code smoke、`*-real*`、真实 PAK 语料和地图性能测试可能需要额外服务端、客户端素材、现有缓存、浏览器或受控密码环境。请按相应脚本中的环境变量配置，不把个人路径或密码写入代码。缺少输入时应明确报告未运行或 SKIP，而不是修改断言绕过。

`artifacts/` 下的截图、日志、测试宿主及解包目录是生成证据，不作为干净 checkout 的隐式生产依赖。历史证据归档不等于删除回归测试；测试和 helper 应保持在仓库中。
