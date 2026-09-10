# 开发指南

## 环境要求

- Node.js ≥ 20（`ai/` 构建、测试、mock 服务器与 `scripts/setup-upstream.mjs`）
- git（setup 脚本用它拉取上游源码）
- Python 3（浏览器版开发用的静态服务器，任何静态服务器均可）
- Windows 打包额外需要：Windows 侧 Node.js 与 Electron 构建环境（NSIS/MSI
  打包脚本依赖 Windows 原生工具链，WSL 内构建受限于 wine）

## 目录与构建模型

本仓库不分发上游源码。`scripts/setup-upstream.mjs` 按 `patches/pins.json`
固定的提交克隆上游到 `webapp/`、`desktop/`（gitignore，不入库），注入
`patches/` 里的接入点（全部带幂等标记，失配即报错），再构建插件 bundle：

```
node scripts/setup-upstream.mjs      # 首次/换机/升级 pins 后执行；幂等

ai/src/**  ──esbuild──▶  webapp/src/main/webapp/js/ai/mindmap-ai.js
                              ▲ 静态服务直出（浏览器版）
                              └ extraResources 打包（桌面版）
```

- `ai/` 是唯一的 AI 源码；`webapp/src/main/webapp/js/ai/mindmap-ai.js` 是构建
  产物，**修改 `ai/src` 后必须重新 `npm run build`**（并把 bootstrap.js 里的
  `?v=N` 提高一位绕过缓存，或 setup 时用 `--bundle-v N`）。
- 桌面版开发时用 `MM_WEBAPP_DIR` 环境变量把 Electron 指向 webapp 目录，无需
  初始化上游的 drawio submodule。
- 打包配置在 `patches/desktop/electron-builder-mindmapai-win.json`（setup 时
  注入到 desktop/）：webapp 经 `extraResources` 从 `../webapp/src/main/webapp`
  直装 `resources/webapp`。

## 常用命令

```bash
# 一键启动（首次自动执行 ⓪，然后起静态服务器并尝试打开浏览器）
node scripts/start.mjs            # Windows 可双击根目录 start.cmd；支持 --port/--host/--no-open

# ⓪ 首次准备：拉取上游（pinned）+ 注入接入点 + 构建插件（幂等，可反复执行）
node scripts/setup-upstream.mjs

# ① 浏览器端开发（在仓库根目录执行；改动 webapp 后刷新即可）
python3 -m http.server 8000 -d webapp/src/main/webapp
# 打开 http://localhost:8000/          prod 模式
#      http://localhost:8000/?dev=1    dev 模式（未打包源码调试）
#      http://localhost:8000/?lang=zh  指定中文

# ② 插件构建 / 类型检查 / 单元测试 / 监听模式（cd ai）
npm install
npm run build          # 产物 → webapp/src/main/webapp/js/ai/mindmap-ai.js
npm run typecheck      # tsc --noEmit
npm test               # vitest 全量单测（布局几何、管线、schema、持久化等）
npm run watch          # 监听模式增量构建
npm run build:prod     # 压缩版

# ③ 本地 mock LLM（不消耗真实配额的端到端联调）
node ai/dev-mock-server.mjs
# 然后 AI → 设置… 中把 Base URL 指向 http://127.0.0.1:8787
# 环境变量 MM_MOCK_CRITIQUE=revise 可强制触发评审回炉路径

# ④ 桌面端开发（cd desktop；Electron 二进制建议走镜像）
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
MM_WEBAPP_DIR=$(pwd)/../webapp/src/main/webapp npm start
# 加 --remote-debugging-port=9222 --disable-gpu 可用 CDP 驱动自动化验证

# ⑤ 本地抓取代理（网页链接模式的可选组件）
node ai/tools/local-fetch-proxy.mjs [端口]
# 设置 → 抓取代理 填 http://127.0.0.1:8788/ 即可
```

### 缓存注意

`webapp/src/main/webapp/js/bootstrap.js` 以 `js/ai/mindmap-ai.js?v=N` 的查询
参数加载插件。bundle 内容变化后，同步调高两处 `?v=N` 版本号以绕过浏览器启发式
缓存（条目按 URL 键控——要刷新的是页面实际引用的 URL，不一定是最新的版本号，
详见 DEVLOG「诊断方法论」一节）。

## 测试

- `cd ai && npm test`：全量单元测试（12 种图表布局几何零重叠断言、生成管线、
  schema 修复阶梯、设置持久化、Electron 桥、抓取与正文提取等）。
- mock 服务器全链路：菜单 → 生成对话框 → mock LLM → 画布，配合
  `MM_WEBAPP_DIR` 的桌面端或纯浏览器端均可验证。
- 打包版回归：`desktop/scripts/cdp-regression.mjs`（CDP 驱动，覆盖密钥
  round-trip 加密标记、AI 菜单位置、生成流、重启后偏好保留）。

## Windows 安装包

在 **Windows 侧原生构建**（NSIS 卸载器与 MSI/WiX 依赖 Windows 工具链）：

1. 准备一台 Windows 构建目录，放入：便携版 Node.js、本仓库克隆（并在其中跑过
   `node scripts/setup-upstream.mjs`，得到注入完成的 `desktop/` 与 `webapp/`）。
2. 在 `desktop/` 内执行 `npm ci`（Electron 下载建议设置
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。
3. 执行 `npm run release-mindmapai-win`，产物在 `desktop/dist/`：
   `MindmapAI-x.y.z-windows-installer.exe`（NSIS）与 `.msi`。
4. 打包版回归：先启动安装后的应用
   (`MindmapAI.exe --remote-debugging-port=9222`) 与 `ai/dev-mock-server.mjs`，
   再用 Windows 侧 Node 跑 `desktop/scripts/cdp-regression.mjs --flow`。

> 注意：安装包未做代码签名（SmartScreen 会告警）；应用图标为原创设计
> （`patches/assets/mindmapai-icon.svg`，setup 时注入替换上游品牌元素）。

## 架构约束（改代码前值得知道）

- 插件通过 `js/bootstrap.js` 注入（两条加载路径各一行 `mxscript`），不能在
  `index.html` 放静态 `<script>` 标签——defer 时序在它前面。
- 菜单注册必须传 `Menu` 实例且菜单 id 要有同名资源 key，否则菜单栏重建时
  抛 TypeError / 显示 key 原文；语言切换后菜单栏会重建，需要兜底重插。
- Electron 下渲染层 CSP 为 `connect-src 'self'`，所有外部请求走主进程
  `mmAiFetch` 通道；浏览器端直连受 CORS 限制，抓取场景走回退链/代理。
- 画布写入一律单事务（可整体撤销）；AI 生成内容带样式标记（`mindmapAI` /
  `mm-` 前缀），替换与重排只作用于标记内容，不碰手绘图形。
- 引文与 AI 参数写入单元格 Object 值属性（`mm-quotes` / `mm-slots`），随
  `.drawio` 文件持久化。

更多历史经验教训（CSP、缓存、布局几何迭代方法等）见
[DEVLOG](DEVLOG.md)；上游源码结构核对见 [VERIFIED](VERIFIED.md)。
