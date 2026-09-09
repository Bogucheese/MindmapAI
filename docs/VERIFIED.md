# M0 源码核对结果（docs/VERIFIED.md）

核对日期：2026-09-06。webapp = jgraph/drawio @ `074a2ea4`（v31.4.2），desktop = jgraph/drawio-desktop @ dev 分支，其 `drawio/` submodule 指向**同一提交** 074a2ea4。

路径约定：`$W` = `webapp/src/main/webapp/`。

## 1. 启动机制（与原计划不同，重要）

- `index.html` 只加载 `js/bootstrap.js`（head）和 `js/main.js`（body 尾），**没有直接的 app.min.js 标签，也没有 CSP meta**。
- prod 分支：`js/bootstrap.js:321-389` — localhost 时 `mxscript('js/PreConfig.js')` → **`mxscript('js/app.min.js')` @ bootstrap.js:333** → `PostConfig.js`。
- dev 分支（`?dev=1`）：bootstrap.js:278-320 加载 Init.js / mxClient.js / Devel.js（后者 document.write ~200 个源文件）。
- **脚本注入点：`js/bootstrap.js`**（两条路径各加一行 `mxscript('js/ai/mindmap-ai.js')`）。不能在 index.html 放静态标签 —— defer 脚本执行时序在它前面。
- `js/main.js:10-21`：prod 在 `window load` 后 `App.main()`；dev 立即调用。

## 2. app.min.js 已提交 ✅（无需 Ant）

`git ls-files` 含 `src/main/webapp/js/app.min.js`。构建用 `etc/build/build.xml` + 内置 `compiler.jar`（Closure）。我们零核心改动 → 不需要跑构建。

## 3. CSP（关键约束）

- index.html 无 CSP meta。
- dev=1：`js/diagramly/Devel.js:13-42` 注入 CSP，connect-src 白名单**不含 api.deepseek.com** → dev 模式浏览器端直接 fetch 会被拦。需在 Devel.js:16-21 加 `https://api.deepseek.com`。
- 静态 serving prod 模式（localhost）：**无 CSP 注入** → fetch 直接可用。
- Electron：主进程在 `desktop/src/main/electron.js:646-666` 对所有响应强制 `connect-src 'self'` → **Electron 下渲染层无法直接调 DeepSeek**，必须走主进程 IPC。

## 4. Service worker

注册点 `js/diagramly/App.js`（~890-960）；启用门槛 `Editor.js:209-212`：仅 `?enableSW=1`/`?offline=1` 或 diagrams.net 域名。**localhost 默认不注册**；`?dev=1` 时还会主动卸载。dev 缓存风险低。

## 5. 插件机制（Draw.loadPlugin）✅

- `js/diagramly/App.js:1637`：`Draw.loadPlugin = fn => App.DrawPlugins.push(fn)`；App 构造函数（App.js:139-168）中逐个调用，回调收到 `ui` 实例。官方注释称这是"唯一长期支持的 EditorUi 访问入口"。
- 最佳参考插件：**`$W/plugins/import.js`（Freemind 导入 —— 本身就是思维导图类功能！）**；对话框参考 `plugins/replay.js:177`；侧栏 palette 参考 `plugins/rackF5.js:1667`。

## 6. mxSettings

- `js/diagramly/Settings.js:8`；key = `Editor.settingsKey`（默认 `.drawio-config`，Editor.js:158）。
- `save()` 序列化**整个** settings 对象；`parse()` 整体赋值 + 补默认值 → **未知自定义字段能幸存 round-trip**（前提 configVersion 匹配，Settings.js:369-373 会整体重置）。
- 决策维持：偏好仍存独立 key `mindmapAI.settings.v1`（不受 configVersion 重置影响）。

## 7. 扩展点 API（与原计划签名有出入，以此为准）

- **注册 action：`ui.actions.addAction(key, funct, enabled, iconCls, shortcut, visible)`**（`js/grapheditor/Actions.js:2084`）。label = mxResources key（`Action.getTitle`）。没有 `EditorUi.prototype.addAction`。
- **顶部菜单：`ui.menubar.addMenu(label, fn, before)`**（grapheditor/Menus.js:1965），import.js:206 有完整示例（含 insertBefore 控制位置）。
- **右键菜单：`Menus.prototype.createPopupMenu(menu, cell, evt)`** @ grapheditor/Menus.js:1575（原型方法，经 `ui.menus` 实例分发 @ grapheditor/EditorUi.js:804-808）→ 插件按实例覆盖 `ui.menus.createPopupMenu` 并链调原方法。vertex 判定参考 `addPopupMenuCellItems`（Menus.js:1734）。
- **Extras 菜单**：diagramly/Menus.js:5251 起，末尾有"给插件追加项"的尾部分隔符（:5298 注释）。
- **对话框：`ui.showDialog(elt, w, h, modal, closable, onClose, noScroll, ...)`**（grapheditor/EditorUi.js:6620）；DOM 用 `geDialog` 类 + `mxUtils.button`；模板 = FilenameDialog（grapheditor/Editor.js:3396）。
- 快捷键：`ui.keyHandler.bindAction(code, control, actionKey, shift)`（grapheditor/EditorUi.js:7803）。
- i18n：`mxResources.parse('key=value')` 运行时注册（import.js:12 先例）；缺 key 时 `mxResources.get` 返回 defaultValue 而非 key 本身。
- **资源文件是 `.txt` 不是 `.properties`**：`resources/dia.txt` + `dia_zh.txt`，**UTF-8 裸中文**（非 \uXXXX）。单一 `dia` bundle（RESOURCE_BASE = 'resources/dia'，diagramly/Init.js:79-80）。

## 8. 布局 API ✅

- `mxRadialTreeLayout.execute(parent, root)` — **支持指定根**（$W/mxgraph/src/layout/mxRadialTreeLayout.js:155）；`levelDistance=120`、`nodeDistance=10`。
- `mxCompactTreeLayout(graph, horizontal, invert)` — horizontal 默认 true（mxCompactTreeLayout.js:24-27）。
- `EditorUi.prototype.executeLayout(exec, animate, post)` 存在（grapheditor/EditorUi.js:7206），exec 在事务内执行。
- mxGraph 助手全部确认：insertVertex/insertEdge/fit/updateCellSize/getPreferredSizeForCell/setSelectionCells（mxgraph/src/view/mxGraph.js）。

## 9. Electron 桥（desktop 侧）

- `desktop/drawio/` 是 **git submodule**（.gitmodules → jgraph/drawio dev），当前克隆未初始化（空目录），pin 在 074a2ea4 = 我们的 webapp HEAD。
- main 入口 `desktop/src/main/electron.js`；窗口 `loadURL(file://…/drawio/src/main/webapp/index.html)`（:456，codeDir @ :204）—— **没有 dev-server 模式**，桌面端永远加载 submodule 内的 webapp。
- **preload = `desktop/src/main/electron-preload.js`**（根目录 preload.js 是死代码）。contextBridge 暴露 4 个成员（:58-92）：`request(msg, cb, err)` / `registerMsgListener` / `sendMessage` / `listenOnce`；另暴露 `window.process = {type, versions}`。
- 主进程 IPC 分发器：`ipcMain.on('rendererReq')` @ electron.js:3849（switch(args.action)，有 validateSender 校验）。**新增 AI 相关动作直接往这个 switch 加 case，复用 request/response(reqId) 机制，无需改 preload**。
- Electron 版本 ^44.1.1（safeStorage 可用，目前未使用）。electron-builder Windows 目标：nsis x64 + msi（electron-builder-win.json）。
- localStorage 走默认 session，持久化到 `%APPDATA%\draw.io`，跨重启保留 ✅。
- **Electron 渲染层被 `connect-src 'self'` 拦死 → AI 请求必须在主进程加 case（如 `mmAiFetch`），用 Node/主进程 fetch 转发**。这正是计划中 ElectronIpcTransport 的落地方式，且比原设想更简单（复用现有 request 通道）。

## 10. 对计划的影响汇总

1. 脚本注入点从 index.html 改为 `js/bootstrap.js` 两处（dev 分支 + prod 分支）。
2. i18n 文件是 `resources/dia.txt` / `dia_zh.txt`（UTF-8）。
3. action 注册用 `ui.actions.addAction`；菜单用 `ui.menubar.addMenu`。
4. dev=1 需在 Devel.js connect-src 加 api.deepseek.com（3 行改动，属构建配置而非核心逻辑）。
5. Electron 传输无需改 preload —— 复用 `electron.request` + 主进程 rendererReq switch 加 case。
6. M7 的 webapp 注入方式 = submodule URL 改指我们的 fork（或本地路径），替代 CI 下载 release zip 的假设。
7. 插件参考样板：plugins/import.js（Freemind 思维导图导入，含 menu/action/dialog 完整链路）。
