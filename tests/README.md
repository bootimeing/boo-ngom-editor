# 回归测试

## 通用门禁

`npm run test:all` 按顺序运行缓存/资源、像素契约、消费者、语言、爆率、996PC、编辑器、NPC 严格矩阵、M2 队列和项目布局检查。需要先安装根目录声明的 npm 与 Python 测试依赖；浏览器用例使用本机 Chrome 或 Edge。

- `test:npc-dialog-strict`：NPC 模型、Provider 和浏览器组合。设置 `BOO_NPC_DIALOG_RUNTIME_ROOT` 可让支持该机制的测试加载最终 VSIX 解包内容。
- `test:conditional-drop`：三引擎爆率模型、外部 CALL、路径边界与只读源文件核验。
- `test:asset-consumers`、`test:pak-pixels`：资源/缓存快照与像素契约。
- `test:asset-consumers`还包括只读素材查看器的真实Chromium DOM回归：10000槽虚拟窗口、ID定位、负偏移/原点、背景/像素缩放、未知坐标、关闭/切包后的过期回调及键盘隔离。使用合成素材和事件，不是原生VS Code或真实大包压力验收。
- `test:pak-variants`：HXM/PACK4像素与缓存、V0四种色深和raw/RLE/zlib、V1普通独立alpha、只读结构检查、GOM/GEE3相邻块边界、有界解压，以及坏槽/空槽经Worker与资源接口的区分及旧缓存隔离。新增HXM布局属于合成验证，不等于真实V0客户端验收。
- `test:archive-verification`：按需逐槽状态持久化、新进程/并发、恢复/坏图、取消/继续、代次与源/配套SHA失效、基础设施故障，以及补丁管理实际Provider/Worker和真实Chromium DOM按钮回归。Edge未返回DOM时可用本机Chrome，日志记录实际浏览器；真实断言失败不通过换浏览器绕过。不是安装后的原生VS Code验收。
- `test:layout`：公开目录、README 和安装包运行依赖结构。
- `test:language` 包含 `merchant-script-reference`：NPC 第一列路径与创建目标一致、中文子目录、可选扩展名、地图前缀、同工作区多服务端隔离、既有文件回退及路径/junction 越界拒绝。该测试可通过 `BOO_SCRIPT_RUNTIME_ROOT` 指向解包候选；原生 VS Code 的链接、确认创建及 Ctrl+Q 命令测试另行记录，不把纯路径测试当作鼠标验收。
- `test:language` 的 `variable-list` / `variable-list-provider` 覆盖中文完整变量名、小写编号、GBK/UTF-8/BOM、大小写扩展名、工作区层级/重叠/多根、扫描器文档快照、分析缓存与外部依赖、地图编号过滤、个人标志/嵌套推导、同名文件身份，以及侧栏保存触发、草稿隔离、后台更新保留旧树、重载与过期扫描丢弃。使用真实扫描器与 Provider、隔离文件夹和 VS Code API 替身，不等同安装后的原生界面验收。
- `variable-utag-flags` 对 GOM/GEE 各3000个 UTAG 编号变量和1024个标志逐项核对计数、文件、行号及候选占用；另外覆盖 NOT CHECK、RESET、动态前缀、直接占位符、前导零、注释、越界及996PC标志边界。`variable-candidate-command` 执行实际候选命令+扫描器，检查动态提示以及读失败/空扫描不推荐空闲编号。
- `test:ui-window`：编译后生产面板的 ready/单实例/关闭重开/过期任务/独立窗口失败回退，以及真实 Chromium 中背景锁定、普通控件移动、导入恢复和整页销毁/重建后的画布像素、动画/按钮图源、文字与代码草稿。测试还检查连续拖动合并写入和动画不写快照；窗口生命周期/状态 API 使用替身，浏览器使用合成输入。安装候选的真实辅助窗口验收另见专项报告。
- 该组的 `ui-appearance-browser` 在 1440×960、1100×800、900×700 下检查两层工具栏、画布空间、侧栏滚动、六类素材弹窗、100项/ID定位、代码展开和键盘焦点；设置 `BOO_UI_APPEARANCE_ARTIFACTS` 可保存截图及布局结果。素材是合成夹具，键盘焦点通过 Chromium CDP 输入验证，不等同原生 VS Code 验收。
- `test:asset-consumers`新增动画固定原点/缺帧/64MiB缓存、实时状态协议、2万槽进度条100项分页/图片复用/历史ID/恢复图/键盘焦点回归。`progress-bar-browser`使用实时CDP驱动，避免虚拟时钟不调度requestAnimationFrame造成假失败。
- 该组还覆盖紧凑目录构建、生产宿主发送函数、百万槽完整 HTML 的有界对象/IPC/尾定位、五类选择器 100 项分页、LRU 后重复及乱序状态、旧源回调/拖拽和关闭最后包。浏览器输入为合成事件，不等同原生键鼠。
- `archive-id-navigation-browser`覆盖六类素材弹窗的100项分页、ID跳页定位/高亮/实际可见性、邻项保留、名称筛选、无效及未命中ID、重复ID选包、定位防抖期间翻页及Enter重定位；也覆盖百万槽尾页和主素材栏原有定位语义。
- `test:archive-verification`新增结构化错误白名单、逐图有界状态读取、生产宿主消息分派及WZL有界解压/PNG块校验；未识别异常保持unknown，不写入损坏账本。
- `wil-wzl-rejected-slots` 覆盖 19 组非零坏槽、合法别名和空哨兵，检查 direct/Worker/重开/全量验证及源 pair 双哈希；合法空槽与索引损坏不混淆。
- 大包压力工具需显式运行 `node tools/pak/archive-stress.js --run --report=<新JSON路径>`，可传 `--runtime=<解包扩展目录>`；使用百万槽稀疏包与3万图合成包，不访问用户缓存，不进入普通全套回归。
- `helpers/`：独立测试 oracle 和夹具工具，不是生产模块。
- `fixtures/`：可公开分发的固定或合成数据；例如 `gee2-native.json` 是合成协议夹具，其 password 是测试字符串，不是真实资源密码。

文件名含 `local` 不自动表示依赖本机语料：`pak-geepak2-local.test.py` 使用合成数据与已有 VM 做差分，因此纳入通用门禁。判断是否适合 CI，应查看实际输入来源。

## 环境专项

原生 VS Code smoke、`*-real*`、真实 PAK 语料和地图性能测试可能需要额外服务端、客户端素材、现有缓存、浏览器或受控密码环境。请按相应脚本中的环境变量配置，不把个人路径或密码写入代码。缺少输入时应明确报告未运行或 SKIP，而不是修改断言绕过。

`artifacts/` 下的截图、日志、测试宿主及解包目录是生成证据，不作为干净 checkout 的隐式生产依赖。历史证据归档不等于删除回归测试；测试和 helper 应保持在仓库中。
