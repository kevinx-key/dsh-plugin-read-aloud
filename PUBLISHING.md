# 发布到 DSH 插件市场（无需 npm 账号）

## 结论

可以发布，但需要先明确：**当前 DSH 没有官方插件市场**。

DSH `0.2.1-rc.2` 的「插件 → 发现」是**自定义插件市场索引**：

- 没有内置官方商店；
- 用户需要先启用实验性的「自定义插件市场」组合包；
- 然后手动添加一个 HTTPS 上的 **format 1 JSON 索引源**；
- 「发现」只读取用户添加的索引，并调用 `pluginManager.installBundle` 安装条目。

没有 npm 账号也可以发布：**用 GitHub 仓库作为安装源，用 GitHub Pages 托管索引**。

```
GitHub 仓库（含构建后的 lib/）
  → GitHub Pages: docs/index.json
  → 用户在「发现 → 添加索引源」填入 Pages URL
  → 安装 git+https://...#<commit>
```

本仓库已经准备好：

- 源码和构建产物都提交在 GitHub；
- [`market/index.json`](market/index.json) 是本地索引；
- [`docs/index.json`](docs/index.json) 是 GitHub Pages 要托管的同一份索引；
- 安装源固定到 Git commit，不需要 npm。

## 1. 为什么 Git 安装可行

`package.json` 已经：

- 移除 `"private": true`；
- 声明 `dsh.bundle.patch`（`cordis.patch.yml`）和 `dsh.client`（浏览器入口）；
- 声明 `engines.dsh: ">=0.2.1-rc.2 <0.3.0"`；
- 把 Host 构建成自包含的 `lib/index.cjs`，`msedge-tts` / axios / ws 都在里面；
- 提交了构建后的 `lib/`。

因此 DSH 安装 Git 仓库时不需要 `npm install`、不需要 `prepare`、不会触发 `msedge-tts` 的构建脚本，也不会出现 `IGNORED_BUILDS`。

已在全新 profile 里实测：

```powershell
dsh plugin --profile readaloud-git add "git+https://github.com/kevinx-key/dsh-plugin-read-aloud.git"
```

只安装 1 个包；Host 返回 61 个 Edge 音色 + 2 个 SAPI 音色。

## 2. GitHub Pages 托管索引

本仓库的 Pages 配置为：

- 分支：`main`
- 目录：`/docs`
- 索引文件：`docs/index.json`
- 页面 URL：

```text
https://kevinx-key.github.io/dsh-plugin-read-aloud/index.json
```

`docs/.nojekyll` 已提交，避免 Jekyll 处理这个目录。

如果以后换账号或仓库名，需要同步修改：

- `docs/index.json` 里的 Git 源 URL；
- `market/index.json`；
- `package.json` 的 `repository` / `homepage`。

### 用 CLI 启用 Pages

仓库所有者可以在 GitHub 网页里设置：

> Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` → Folder: `/docs`

也可以用 GitHub CLI：

```powershell
@'
{
  "source": {
    "branch": "main",
    "path": "/docs"
  }
}
'@ | Set-Content -Encoding utf8 pages.json

gh api -X POST repos/kevinx-key/dsh-plugin-read-aloud/pages --input pages.json
```

查询部署状态：

```powershell
gh api repos/kevinx-key/dsh-plugin-read-aloud/pages
```

首次部署通常需要几十秒到几分钟。索引地址必须直接返回 JSON，不能经过重定向。

## 3. 索引里的 Git 安装源

`docs/index.json` 的版本条目使用：

```json
"source": {
  "type": "git",
  "url": "https://github.com/kevinx-key/dsh-plugin-read-aloud",
  "commit": "2760f5638185782f9b6c707a5fe1a039580a25fe"
}
```

DSH 会把它转换成：

```text
git+https://github.com/kevinx-key/dsh-plugin-read-aloud.git#2760f5638185782f9b6c707a5fe1a039580a25fe
```

这个 commit 必须包含可用的 `lib/`。**发布新版本时**：

1. 提交并推送代码；
2. 用 `git rev-parse HEAD` 取新的完整 40 位 SHA；
3. 更新 `docs/index.json` 和 `market/index.json` 里的 `commit`；
4. 更新 `version`、`publishTimestamp`、`metadata.sortKeys.updated`；
5. 再提交一次 `docs/index.json`，等待 Pages 重新部署。

注意：索引文件本身的提交可以晚于它指向的代码 commit；索引指向的 commit 只需要包含可安装的包。

## 4. 用户在 DSH 里添加索引

1. 打开侧栏「插件」；
2. 在「实验性插件」旁点「更多」，启用「自定义插件市场」；
3. 进入「发现」；
4. 「添加索引源」，填入：

   ```text
   https://kevinx-key.github.io/dsh-plugin-read-aloud/index.json
   ```

5. 搜索「朗读助手」，点「安装」。

安装对话框里会显示 Git 源和固定 commit。DSH 会提示索引由第三方提供；索引没有签名，实际安装内容以包自身的 `package.json` 为准。

## 5. 直接安装（不经过索引）

在 DSH 里也可以直接装 Git 仓库：

```powershell
dsh plugin --profile desktop add "git+https://github.com/kevinx-key/dsh-plugin-read-aloud.git"
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-plugin-read-aloud
```

## 6. 没有 npm 账号时的社区目录

- [dshbase 插件目录](https://dshbase.com/zh/plugins/directory/) 主要围绕 npm 包和 GitHub 仓库索引；没有 npm 包时，Git 安装和 GitHub topic 仍然有效；
- 给仓库加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic（已添加）；
- 在 README 里提供 Git 安装命令（已添加）。

如果以后想发布到 npm，再注册账号并执行：

```powershell
npm config set registry https://registry.npmjs.org/
npm login
npm publish
```

然后把索引的 `source` 从 `git` 改成 `npm`。这不是必须的。

## 7. 升级

DSH 当前没有升级操作：索引显示 `update-available` 后，仍需先卸载再安装。

Git 源的每次升级都要更新索引里的 `commit`，否则用户装到的还是旧版本。

## 8. 发布前检查清单

- [ ] `npm test` 全绿（28 个测试）；
- [ ] `lib/index.cjs`、`lib/index.js`、`lib/client.js`、`lib/worker.ps1` 已提交；
- [ ] `git rev-parse HEAD` 与索引里的 `commit` 一致（或索引指向一个包含这些文件的有效 commit）；
- [ ] GitHub Pages 返回 200 和 JSON，不是重定向；
- [ ] `docs/index.json` 能通过 `parseMarketIndex`；
- [ ] README 已说明 Edge 在线音色会把文字发送给 Microsoft；
- [ ] README 已说明 Windows SAPI 回退和本地 18766 端口；
- [ ] `THIRD_PARTY_NOTICES.md` 随包发布；
- [ ] 版本号、索引版本、`engines.dsh` 一致。

## 9. 已知限制

- 只有 Windows 有 SAPI 本地回退；其他平台依赖 Edge 在线音色。
- Edge 音色需要网络，文字会发送给 Microsoft。
- Host 在 `127.0.0.1:18766–18777` 启动 loopback 服务，需要用户信任。
- 没有官方市场、没有索引签名、没有自动升级。
- Git 源固定 commit，升级需要手动更新索引。

