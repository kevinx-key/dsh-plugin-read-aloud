# dsh-plugin-read-aloud

在 DSH 的每条正式助手回复下方，复制 / 点赞按钮旁增加一个喇叭按钮。点击后：

- 从当前回复的第一段开始，按从上到下的顺序朗读；
- 尚未朗读的文字用蓝色背景标出，读到后逐段清除；
- 自动把当前朗读的句子滚动到视野内；
- 选中会话中的文字后右键，菜单里有「朗读」和「复制」；点「朗读」立刻朗读选中内容，并出现底部迷你播放条，可暂停/继续/停止/切换语速；
- 弹出「朗读设置」浮窗，可调整 **0.5×–2×** 倍速、暂停 / 继续 / 停止 / 从头朗读，并切换自然/本地音色；
- 语速和音色会记住，下次会话继续使用；
- 暂停后从**当前音频位置**继续，不再从本句或全文开头重读。

默认使用 **Microsoft Edge 在线自然语音**（Xiaoxiao、Yunxi、Yunjian、Xiaoyi 等），音色明显比 SAPI5 自然；网络不可用或 Edge 失败时自动回退到本机 SAPI5（Huihui Desktop / Zira Desktop），再失败才回退浏览器 Web Speech。高亮使用 CSS Custom Highlight API，不修改 React DOM。

## 环境

- DSH Desktop `0.2.x`（Web GUI 使用 Chromium，支持 `::highlight()` 与 Web Audio）。
- **自然音色需要联网**：Edge Read Aloud 会把当前句子的文字发送给 Microsoft。介意隐私或需要离线时，在音色下拉里选择带 `· 本地` 的 SAPI 音色。
- Windows 本机 fallback 需要至少一个可用的 SAPI5 语音；当前机器上是 `Microsoft Huihui Desktop` / `Microsoft Zira Desktop`。`Kangkang / Huihui / Yaoyao` 这类 OneCore 音色会被 Chromium 列出但 `speak()` 失败。
- 插件启动时会让 Host 逐个试音并过滤掉不可用的 SAPI 音色，因此本地音色下拉里只会出现真正能出声的音色。
- Host 会在 `127.0.0.1` 的 `18766–18777` 端口范围启动一个仅本机可访问的合成服务；不需要手动开端口。Edge 音色通过 Host 的 Node WebSocket 调用，SAPI 通过常驻 PowerShell worker 调用。

## 使用

1. 完全退出并重新打开 DSH Desktop，让新插件进入 profile。
2. 打开任意已有正式答复的会话。
3. 把鼠标移到答复底部的操作栏，点击复制按钮右侧的喇叭图标。
4. 朗读开始后，浮窗会自动出现；再次点击喇叭会暂停并保留浮窗，浮窗里的播放键可继续。
5. 浮窗内可切换音色、拖动语速滑杆，或点 `0.75× / 1× / 1.25× / 1.5× / 2×` 快捷倍速。

关闭浮窗不会停止朗读；点浮窗外的区域或按 `Esc` 只关闭浮窗。

### 划词朗读

1. 在会话正文中按住鼠标选中一个词/一段话；
2. 右键，选择「朗读」；
3. 插件立即朗读选中内容，底部出现迷你播放条；可暂停、继续、停止，按钮上的 `1×` 可循环切换语速；
4. 选中文字本身会保持浏览器原生蓝色选区，读完或停止后自动清除。

也可以选中文字后按 `Alt+R` 直接朗读，作为右键菜单之外的快捷方式。

## 安装 / 卸载

插件已通过 DSH 的 profile 插件管理器安装到 `desktop` profile：

```powershell
dsh plugin --profile desktop add "link:<仓库所在的绝对路径>"
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-plugin-read-aloud
```

卸载或升级后同样需要重启 DSH Desktop。profile 清单备份在
`~/.dsh/profiles/desktop/package.json.bak-readaloud-*`。

## 设计

- **入口**：注册到 `conversation.chat.assistant-actions`，`order: 5`，因此位于内置复制按钮之后、点赞/点踩之前。
- **正文定位**：从喇叭按钮所在的 `[data-turn-tail]` 向上找到会话流，再取该 Turn 中 tail 之前最后一个 `assistant-step` 行；只读正式答复，跳过 `Think` 推理、按钮、代码块工具条等 chrome。
- **文本模型**：`TreeWalker` 遍历文本节点，折叠空白并记录“规范化字符 → 原 DOM 文本节点偏移”的映射；用 `Intl.Segmenter` 按句切分，过长句再按标点/空格切短。
- **高亮**：用 `new Highlight()` + `CSS.highlights.set('dsh-read-aloud-pending', …)` 给“当前偏移到文末”的所有 Range 上蓝色背景，完全不改 React 的 DOM。Web Speech 用 `boundary` 事件推进偏移；Host 音频后端按句推进，读到句尾清除该句。
- **Edge 自然语音**：Host 半用 `msedge-tts` 连接 Microsoft Edge Read Aloud，按句合成 MP3；SSML 文本先做 XML 转义。语速作为 Edge prosody `rate` 传入，所以改语速会从当前句重新合成，但音高自然。
- **本地 SAPI 合成**：Host 半用常驻 PowerShell worker 调用 `System.Speech` 生成 WAV；启动时对每个音色做一次极短试音，只保留能成功合成的 `Desktop` 音色。浏览器半用 `fetch` 取音频、Web Audio `decodeAudioData` 播放。
- **暂停/继续**：不再依赖 `AudioContext.suspend`。暂停时记录 `AudioBufferSourceNode` 已播放的 buffer 秒数并停止 source；继续时用同一个 `AudioBuffer` 从该 offset 新建 source，因此精确到当前的音频位置。SAPI 的倍速用 `playbackRate` 实时调整；Edge 的倍速在重新合成当前句后生效。
- **划词朗读**：全局 overlay 监听会话正文里的 `contextmenu`，`preventDefault` 后渲染自己的「朗读 / 复制」菜单；「朗读」把选中文字送入同一个 `chunks + AudioBuffer` 音频管线，所以暂停 offset、倍速、音色、Edge/SAPI 自动回退全部复用；底部迷你播放条由同一个 controller 快照驱动。
- **朗读**：一次只播一句；改音色会从当前句重新合成，同一句内的暂停/继续不会重新请求网络或重新合成。语速滑杆在松手/按键结束时才提交，避免拖动过程中连续重启；Edge 的语速作为 SSML `prosody rate` 发到 Host，SAPI 的语速直接改 `playbackRate`。
- **滚动**：朗读到新句子时把该句滚到会话滚动容器的中间偏上位置；用户用滚轮/触摸手动滚动后，自动跟随暂停 6 秒，避免抢滚动。
- **状态**：一个 `ReadAloudController` 由插件 `apply` 创建，通过 `hooks.readAloud` 注入所有消息按钮；同一时间只朗读一条回复。

## 目录

```
src/doc.js         正文提取、句子切分、Range 映射、Turn 定位
src/controller.js  Edge/SAPI/Web Speech 三后端、音色、倍速、高亮、滚动、持久化
src/ui.jsx         操作栏按钮、设置浮窗
src/styles.js      注入的 ::highlight 与组件样式
src/client.js      浏览器插件入口（注册 slot）
src/index.js       Host 半：loopback HTTP 服务（Edge + SAPI）
src/worker.ps1     常驻 PowerShell SAPI 合成 worker
cordis.patch.yml   bundle 层，插入 read-aloud 行
lib/               构建产物（index.cjs 为自包含 Host；client.js 由 __ModuleLoader__ 包装）
tests/             jsdom、Edge/SAPI 服务与客户端三后端测试
```

## 开发

```powershell
cd dsh-plugin-read-aloud
npm install
npm test        # 先构建，再跑 28 个测试（含真实 Edge/SAPI 合成 smoke）
npm run build
```

构建产物 `lib/client.js` 的格式是 DSH Client Module Loader 要求的
`window.__ModuleLoader__.load({ id, factory: (require) => … })` 包装；`react`、
`react-dom`、`react-dom/client`、`react/jsx-runtime` 由宿主模块表提供，不重复打包。

Host 构建成 CommonJS 的 `lib/index.cjs`：`msedge-tts` 依赖的 axios/ws 内部有动态
`require`，放进 ESM bundle 会触发 `Dynamic require of "util" is not supported`；CJS bundle
把依赖一起打包，再由 119 字节的 ESM `lib/index.js` 转出 `apply` / `SapiSpeechService`。
这样 npm 安装不会执行任何依赖构建脚本。

## 排查

- 浮窗底部正常会显示「Microsoft Edge 在线自然语音」；也可以下拉选择「本地 SAPI 语音引擎」。如果显示「浏览器语音引擎」，说明 Host 服务没有连上。
- 在 PowerShell 里检查 Host 服务：

  ```powershell
  Invoke-RestMethod http://127.0.0.1:18766/health
  ```

  正常应返回 `ready: true`，`engines.edge` / `engines.sapi` 至少一个为 true；`voices` 里会同时有 Edge 自然音色和 `Microsoft Huihui Desktop`。
- Edge 失败时会自动切到本地 SAPI，并在浮窗提示「在线自然音色失败，已切换到本地音色」；常见原因是网络/代理阻止了 `speech.platform.bing.com`。
- `engines.sapi: false` 时看 DSH 日志里的 `[read-aloud] SAPI worker unavailable`；常见原因是 PowerShell 被执行策略或安全软件拦截。
- `ready: true` 但听不到声音时，检查 Windows 默认输出设备、音量，以及 DSH 是否被静音。

## 开源参考

选型调研时对比了以下项目（均为 MIT）：

- [ken107/read-aloud](https://github.com/ken107/read-aloud)：浏览器 TTS 扩展，支持音色/语速/高亮，交互最接近本需求。
- [swrdfish/Narro](https://github.com/swrdfish/Narro)：句子级高亮、悬浮播放器、0.5×–3×，支持 Kokoro/Piper 等本地模型与云音色，功能更强，但它是 Chrome 扩展的 offscreen + service worker 架构，不能直接嵌入 DSH。
- [MashdorDev/readfollow](https://github.com/MashdorDev/readfollow)：在 Read Aloud 基础上做逐词高亮。

本项目没有直接 fork 这些扩展，而是按 DSH 的 slot / client-module 契约重写了一个轻量插件：
默认用 Microsoft Edge 的在线神经音色解决“SAPI 太机械”的问题，网络不可用时回退到本机 SAPI5，
再用 CSS Custom Highlight 保证不改 React DOM，用按句切分保证中文也能稳定地“读一段、清一段”。
音频播放与暂停位置由 Web Audio `AudioBufferSourceNode` 管理。

Edge 引擎使用 MIT 许可的 [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS) 包。它和 axios/ws 一起打包进
Host 的 `lib/index.cjs`，因此 npm 安装时不需要 `postinstall` 或 pnpm 构建脚本；前端 bundle 不包含这些代码。
第三方许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。Edge Read Aloud 是 Microsoft 的在线服务，
使用时当前句文字会发送给 Microsoft。

## 发布

DSH 当前没有官方插件市场；「发现」读取的是用户添加的自定义索引。npm 发布、format 1 索引、
社区目录和安装验证步骤见 [`PUBLISHING.md`](PUBLISHING.md)，可直接托管的索引在
[`market/index.json`](market/index.json)。
