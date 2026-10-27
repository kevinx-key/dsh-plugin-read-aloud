# 发布到 DSH 插件市场

## 结论

可以发布，但需要先明确一件事：**当前 DSH 没有官方插件市场**。

DSH `0.2.1-rc.2` 的「插件 → 发现」是**自定义插件市场索引**：

- 没有内置官方商店；
- 用户需要先启用实验性的「自定义插件市场」组合包；
- 然后手动添加一个 HTTPS 上的 **format 1 JSON 索引源**；
- 「发现」只读取用户添加的索引，并调用 DSH 的 `pluginManager.installBundle` 安装其中的条目。

所以正确的发布路径是：

```
npm 包（或 Git 仓库）
  → 社区目录 / 自建 HTTPS 索引 market/index.json
  → 用户在「发现 → 添加索引源」中添加索引 URL
  → 安装
```

本仓库已经包含一份可直接托管的索引：[`market/index.json`](market/index.json)。

## 已准备好的发布条件

- `package.json` 已移除 `"private": true`；
- 声明了 `dsh` 兼容范围：`>=0.2.1-rc.2 <0.3.0`；
- 声明了 `dsh.bundle.patch`（`cordis.patch.yml`）和 `dsh.client`（浏览器入口）；
- Host 入口是自包含的 `lib/index.cjs`（把 `msedge-tts` / axios / ws 一起打包），**没有 `postinstall`，也不依赖 pnpm 构建脚本**；
- `lib/worker.ps1` 随包发布；
- npm 包名 `dsh-plugin-read-aloud` 当前未被占用；
- 干净 profile 的实际 tarball 安装已验证：只新增 1 个包，Host 能列出 61 个 Edge 音色 + 2 个 SAPI 音色。

## 1. 发布到 npm

当前机器使用 npmmirror 镜像，且未登录 npm。发布必须切到 npm 官方源：

```powershell
npm config set registry https://registry.npmjs.org/
npm login
npm whoami
```

确认包名和版本：

```powershell
npm view dsh-plugin-read-aloud version
npm pack --dry-run
```

`npm pack --dry-run` 应包含：

```
LICENSE
README.md
THIRD_PARTY_NOTICES.md
cordis.patch.yml
lib/client.js
lib/client.js.map
lib/index.cjs
lib/index.js
lib/worker.ps1
package.json
```

发布：

```powershell
npm publish
```

如果以后改用 scoped 包名（例如 `@your-name/dsh-plugin-read-aloud`）：

```powershell
npm publish --access public
```

然后把 `market/index.json` 里的 `plugins[].name` 同步改成 scoped 包名。

> npm 登录/2FA 必须由你在终端完成；当前会话没有 npm 凭据，不能代替你登录或发布。

## 2. 验证 npm 安装

先在一个一次性 profile 里验证，不要直接覆盖正在用的 desktop profile：

```powershell
dsh plugin --profile readaloud-npm add dsh-plugin-read-aloud@0.3.0
```

如果要启动 Web UI 验证 Host：

```powershell
dsh plugin --profile readaloud-npm add @deepseek-ai/dsh-web-app
dsh --profile readaloud-npm --no-open --port 1601
```

另一个终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:18767/health
```

应看到 `engine: "edge"`、`engines.edge: true`、`defaultVoice: "zh-CN-XiaoxiaoNeural"`。

验证完删除一次性 profile：

```powershell
Remove-Item -LiteralPath "$env:DSH_HOME\profiles\readaloud-npm" -Recurse -Force
```

## 3. 托管插件市场索引

`market/index.json` 是 format 1 索引，已经通过 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 校验。

把它放到**直接可访问、无重定向**的 HTTPS 地址，例如 GitHub Pages：

```
https://<你的用户名>.github.io/dsh-plugin-read-aloud/index.json
```

索引里的关键字段：

```json
{
  "format": 1,
  "plugins": [{
    "name": "dsh-plugin-read-aloud",
    "versions": [{
      "version": "0.3.0",
      "publishTimestamp": 1793084045,
      "source": { "type": "npm" },
      "engines": { "dsh": ">=0.2.1-rc.2 <0.3.0" }
    }]
  }]
}
```

`source.type` 也可以是 `git`，用于不经过 npm 的发布：

```json
"source": {
  "type": "git",
  "url": "https://github.com/<你>/dsh-plugin-read-aloud",
  "commit": "<40 位小写 commit SHA>"
}
```

Git 方式要求仓库里已经包含构建后的 `lib/`，因为包没有 `prepare` 脚本。

## 4. 用户在 DSH 里添加索引

1. 打开侧栏「插件」；
2. 在「实验性插件」旁点「更多」，启用「自定义插件市场」；
3. 进入「发现」标签页；
4. 点「添加索引源」，填入上面的 `index.json` URL；
5. 搜索「朗读助手」，点「安装」。

DSH 会显示索引由第三方提供。插件市场索引**没有签名**，实际安装内容以包自身的 `package.json` 为准。

## 5. 社区目录

DSH 没有官方商店，但社区有目录：

- [dshbase 插件目录](https://dshbase.com/zh/plugins/directory/)：收录 npm 上的 DSH 插件，提供安装命令和实测结果；
- GitHub 给仓库加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic，便于被社区目录和用户发现；
- 也可以在 README 顶部放 npm 包名和一行安装命令。

这些都不是 DeepSeek 官方市场。

## 6. 后续升级

DSH 当前**没有升级操作**：索引检测到新版本只会显示 `update-available`，升级仍要先卸载再安装。

发布新版本的顺序：

1. 修改 `package.json` 的 `version`；
2. 重新 `npm run build`、`npm test`；
3. `npm publish`；
4. 更新 `market/index.json` 的 `version`、`publishTimestamp` 和 `metadata.sortKeys.updated`；
5. 重新部署索引。

## 7. 发布前检查清单

- [ ] `npm test` 全绿（28 个测试）；
- [ ] `npm pack --dry-run` 包含 `lib/index.cjs`、`lib/index.js`、`lib/client.js`、`lib/worker.ps1`；
- [ ] 干净 profile 从 tarball 安装成功，无 `IGNORED_BUILDS`；
- [ ] Host `/health` 能返回 Edge 和 SAPI 音色；
- [ ] `market/index.json` 通过 `parseMarketIndex`；
- [ ] README 已说明 Edge 在线音色会把文字发送给 Microsoft；
- [ ] README 已说明 Windows SAPI 回退和本地 18766 端口；
- [ ] `THIRD_PARTY_NOTICES.md` 随包发布；
- [ ] 版本号、索引版本、`engines.dsh` 一致。

## 8. 已知限制

- 只有 Windows 有 SAPI 本地回退；其他平台依赖 Edge 在线音色。
- Edge 音色需要网络，文字会发送给 Microsoft；离线/隐私场景请选本地音色。
- Host 在 `127.0.0.1:18766–18777` 启动 loopback 服务，需要用户信任。
- 没有官方市场、没有索引签名、没有自动升级。
- 插件市场索引是第三方内容；安装前应检查包名、版本和来源。
