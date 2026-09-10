# NOTICE — MindmapAI

MindmapAI 是一个基于 [jgraph/drawio](https://github.com/jgraph/drawio) 与
[jgraph/drawio-desktop](https://github.com/jgraph/drawio-desktop) 二次开发的
AI 思维导图桌面应用。

**本仓库不分发上游源码。** 仓库内只有 MindmapAI 的原创代码；上游编辑器源码由
`scripts/setup-upstream.mjs` 在构建/开发环境准备阶段，按 `patches/pins.json`
中固定的提交从上游官方仓库拉取，再把本项目的接入点幂等地注入进去（上游随clone
携带的 Apache-2.0 许可证文件保持原样）。因此本仓库内容为 100% 原创代码。

## 上游拉取源（固定版本）

| 目录 | 上游仓库 | 固定提交 | 对应版本 |
|------|----------|----------|----------|
| `webapp/` | jgraph/drawio | `074a2ea4` | v31.4.2 |
| `desktop/` | jgraph/drawio-desktop | `d1fa65d8` | v31.4.2 之后的 `dev` 分支 |

升级上游 = 更新 `patches/pins.json` 中的提交号并重新运行 setup 脚本；任何注入
点失配时脚本会明确报错，不会静默打偏。

## setup 脚本注入的全部内容（对上游源码的修改）

### webapp/（jgraph/drawio，10 个文件 + 品牌资产替换）

- `src/main/webapp/js/ai/mindmap-ai.js` — **新增**（由本仓库 `ai/` 的 TypeScript
  源码经 esbuild 构建生成的插件 bundle；插件同时把窗口/标签页标题的
  `editor.appName` 设为 MindmapAI）。
- `src/main/webapp/js/bootstrap.js` — 注入两行插件加载调用（prod / dev 两条路径）。
- `src/main/webapp/index.html` — 修改：静态 `<title>` 改为 MindmapAI；loader
  脚本标签加 `?v=` 缓存版本号。
- `src/main/webapp/js/diagramly/Devel.js` — dev 模式 CSP `connect-src` 白名单
  追加一条（允许访问用户配置的 LLM 端点）。
- `src/main/webapp/js/diagramly/Pages.js`、`js/app.min.js` — 修改：底部标签栏
  右侧注入 MindmapAI 仓库徽标（自绘 SVG 图标，链接到本项目 GitHub 仓库），
  上游 ghLink（GitHub logo，链接到 jgraph/drawio 官方仓库）保持可见；
  源码与压缩产物各一处。
- `src/main/webapp/resources/dia.txt`、`dia_zh.txt` — 追加本插件的
  中英文资源 key（内容源文件在 `patches/webapp/`）。
- `src/main/webapp/test-article.html` — **新增**（链接抓取模式的端到端测试
  夹具，源文件在 `patches/webapp/`）。
- 品牌资产替换（内容层面，原创设计见 `patches/assets/mindmapai-icon.svg`）：
  覆盖 `favicon.ico`、`images/apple-touch-icon.png`、`images/icon-192.png`、
  `images/icon-512.png` 及两个 maskable 变体、`images/drawlogo128.png` 与
  `images/drawlogo256.png`（后两者保留上游文件名以匹配代码引用），并以
  `images/manifest.json` 品牌化版本整体替换（名称 MindmapAI、主题色
  `#6D28D9`）。

### desktop/（jgraph/drawio-desktop，8 个文件）

- `src/main/electron.js` — 注入：`MM_WEBAPP_DIR` 加载目录覆盖与打包态回退；
  4 个 IPC 通道 `mmAiGetSecret` / `mmAiSetSecret` / `mmAiDeleteSecret`
  （safeStorage 加密存储 API Key）与 `mmAiFetch`（主进程转发网络请求）；
  窗口图标路径改为注入的 `images/mindmapai256.png`。
  注入块源文件：`patches/desktop/electron.mindmapai-block.js`。
- `src/main/disableUpdate.js` — fork 版本号下禁用自动更新检查
  （避免误提示"更新到官方 drawio"；源文件 `patches/desktop/disableUpdate.js`）。
- `package.json` — 写入 `productName: MindmapAI`、版本与 2 个打包脚本。
- `electron-builder-mindmapai-win.json` — **新增**（MindmapAI 的 Windows 打包
  配置，webapp 经 extraResources 内置；源文件在 `patches/desktop/`）。
- `scripts/cdp-regression.mjs`、`scripts/cdp-set-and-close.mjs` — **新增**
  （基于 Chrome DevTools Protocol 的打包版回归脚本；源文件在 `patches/desktop/`）。
- `build/icon.ico`、`build/icon.png` — 覆盖为原创 MindmapAI 图标
  （exe / NSIS / MSI 快捷方式与 Linux dir 目标取用）。

以上每一处注入都带幂等标记：重复运行 setup 脚本不会重复注入；上游文件与预期
不符时脚本直接报错退出。

## 非商业声明

本项目由个人开发者以非商业目的维护与发布：不以营利为目的运营，不销售本应用
或其安装包，不内置广告、付费功能或任何收费服务。

本仓库内容以 Apache-2.0 发布。Apache-2.0 本身不区分使用目的（个人与非商业
使用、商业使用均被许可），因此上述声明是对本项目运营现状的说明，不构成对
许可证条款的额外限制；任何个人或组织使用、修改、再分发本仓库代码时，仍以
Apache-2.0 条款为准，并需自行遵守上游许可证与 JGraph 的商标政策。

本应用按「现状」提供，不附带任何形式的担保；开发者不对因使用本应用产生的
任何直接或间接损失承担责任（详见 LICENSE 第 7 条免责声明）。

## 商标声明

"draw.io"、"drawio" 及相关标识是 JGraph AG 的商标。本项目是独立的二次开发
发行版，产品名为 **MindmapAI**，与 JGraph AG 无关联，亦未获得其背书。
本项目的应用图标与品牌资产为原创设计（`patches/assets/mindmapai-icon.svg`），
不包含 JGraph 的任何图形元素。

## 隐私说明

本应用将用户配置的 LLM 服务商端点与 API Key 用于生成请求：

- 浏览器模式下，API Key 明文保存在浏览器 `localStorage`（界面有明示）；
- 桌面模式下，API Key 经 Electron `safeStorage`（Windows DPAPI）加密落盘，
  网络请求经主进程通道转发。

除用户主动配置的 LLM 端点与抓取目标页面（来源模式的链接抓取，可自选代理）
外，本应用不向任何第三方服务器发送用户数据。
