# npm 发布维护

`npm run package:npm` 构建 Host 和 Web，生成 `release/npm`。
根工作区继续保持私有。分发包名 `kooyu`，版本默认跟随根 package.json；
预览版本由 `KOOYU_NPM_VERSION=X.Y.Z-preview.N` 指定。

仅收录编译输出、两个内置私有工作区包、许可和用户说明。
第三方模块通过普通 npm dependencies 安装，原生二进制由目标系统选择；
不会上传开发电脑的 node_modules、Node/Electron、账户、配对信息或数据库。

```sh
npm run package:npm
npm run verify:npm
cd release/npm
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org/
```

验收从真实 tgz 全新安装，检查命令参数、Host、网页资源、API、数据目录锁和更新限制。
验收安装及隔离数据留在系统临时目录，并输出绝对路径；可通过 `KOOYU_NPM_TEST_ROOT` 指定目录。
默认不使用源码目录的 node_modules，也不会访问用户的 Host 数据目录。

首次发布使用已登录的包维护者账号；若 npm 要求双重验证，由维护者在官方登录页面确认。
首次发布后，在 npm 包 Settings → Trusted publishing 中绑定：

- Provider: GitHub Actions
- Owner: sh2001sh
- Repository: Kooyu
- Workflow: npm-publish.yml
- Environment: 留空（本流程未设置 GitHub Environment）

无需向 GitHub 添加 npm Token。身份验证通过工作流的 `id-token: write` 完成。

`.github/workflows/npm-publish.yml` 在 Native application releases 成功后打包并执行
Windows、Linux、macOS 安装验收，通过后将同一个 tgz 上传 npm。
仅接受本仓库 main 或与根版本一致的 vX.Y.Z 标签；main 发布 `X.Y.Z-preview.N` 到 `next`，
正式标签发布 `X.Y.Z` 到 `latest`。npm 版本不可覆盖，已发布的版本不能重复上传。
也可在 main 手动运行工作流，选择 next 或 latest。

npm 只更新程序文件。用户数据放在系统 Host 数据目录，更新前应停止 Host；
先备份数据再升级可能迁移数据库的新版本。浏览器显示 npm 更新指令，禁止用桌面安装器更新 npm Host。
