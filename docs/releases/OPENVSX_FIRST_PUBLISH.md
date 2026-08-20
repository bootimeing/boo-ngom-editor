# Open VSX 首次发布

首次回填 Open VSX 的 4.1.8 必须使用归档目录中的：

`boo-NGOM-editor-4.1.8-Marketplace-backfill.vsix`

- 文件大小：`28,840,083` 字节
- SHA256：`939E6CAC5A56805F49E9510697F25CECB145B2139D26FCBF447BF6821D3A90F9`
- 该文件与 Microsoft Visual Studio Marketplace 当前公开的 4.1.8 完全一致。

不要把插件工程根目录下 SHA256 为 `D3242472...` 的开发包继续按 4.1.8 发布。它包含商店发布后的新改动，必须先将扩展版本升级为 4.1.9，再用同一个 VSIX 同时发布到两个商店。

发布前需由发布者本人完成 Open VSX 的 Eclipse 账号关联、Publisher Agreement、`boo1213` 命名空间创建及访问令牌生成。令牌应放入当前 PowerShell 进程的 `OVSX_PAT` 环境变量，不要写进源码：

```powershell
npx --yes ovsx@1.0.2 publish `
  '.\artifacts\releases\open-vsx\boo-NGOM-editor-4.1.8-Marketplace-backfill.vsix' `
  -p $env:OVSX_PAT
```

发布完成后应等待扩展状态变为 Active，再验证匿名查询和下载。
