<div align="center">

**English** | [简体中文](README.md)

</div>

<p align="center">
  <img src="docs/icon.png" width="118" alt="MindmapAI">
</p>

<h1 align="center">MindmapAI</h1>

<p align="center">
  <b>AI-powered mind mapping — built on drawio</b><br>
  <sub>AI 思维导图制作器 · 基于 drawio 二次开发</sub>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2563EB"></a>&nbsp;
  <img alt="Platform: Windows | Browser" src="https://img.shields.io/badge/platform-Windows%20%7C%20Browser-8B5CF6">&nbsp;
  <img alt="Charts: 12 types" src="https://img.shields.io/badge/thinking%20charts-12%20types-F59E0B">&nbsp;
  <a href="NOTICE.md"><img alt="Upstream: drawio v31.4.2" src="https://img.shields.io/badge/upstream-drawio%20v31.4.2-lightgrey"></a>
</p>

> Give it a **topic**, a piece of **text**, or a **web link**, and it generates well-structured, fully traceable, editable mind maps and thinking charts — with the complete drawio editor experience preserved.

MindmapAI injects AI generation capabilities into drawio as a plugin, and ships as a standalone desktop app packaged with Electron. This repository **contains only MindmapAI's own code**: the upstream editor source is pulled from the official repositories at pinned versions by `scripts/setup-upstream.mjs`, which then injects the integration points automatically (see [NOTICE.md](NOTICE.md)). It is not distributed in this repo.

| | |
|---|---|
| ![Detail mode & composite canvas](docs/test-detail-extras.png) | ![Real-model session: node expansion](docs/test-deepseek-final.png) |
| ![Thinking chart: tree](docs/test-chart-tree.png) | ![Thinking chart: fishbone](docs/test-chart-fishbone.png) |

## Highlights

### AI mind map generation

- **Three content sources**: topic only / pasted text / web link. Link mode auto-converts GitHub pages to raw URLs, parses Bilibili video metadata, and falls back gracefully (direct → custom proxy → public fetch proxies), with a zero-dependency [local fetch proxy](ai/tools/local-fetch-proxy.mjs) built in.
- **Review pipeline**: distill → architect → auto-review; when any of the four quality dimensions scores too low, the map is automatically rebuilt once. Generation can be cancelled at any time.
- **Deterministic quality checks**: duplicate concepts under the same parent are auto-merged; cross-branch duplicates and over-long flat lists are reported to the reviewer; prompts enforce terminology consistency, single-dimension siblings, and grouped hierarchies.
- **AI auto-tuning**: depth, branching factor, and node budget are chosen by AI based on content density — or set them manually (depth 1-6 / children 1-10 / max nodes 5-200).
- **Detail mode**: every point becomes a leaf, with verbatim quotes placed on the canvas as citation nodes; large sources additionally get satellite mini-maps, a summary table, and a relation chart (composite canvas).
- **Node expansion**: right-click any node to generate one more level with full context; Ctrl+Z undoes it in a single step.
- **Full traceability**: hover any node to see its source quote; quotes persist inside the `.drawio` file and survive reopening.

### 12 thinking charts

Circle map / bubble map / double bubble map / tree map / flow map / multi-flow map / brace map / Venn diagram / fishbone diagram / timeline / bridge map / org chart — switch with one click in the generation dialog; every type ships with a definition and usage guidance.

- AI picks from 15 drawio shape parts (capsule, diamond, cylinder, swimlane, person, note…) by semantics instead of only using rectangles.
- All charts use **deterministic geometric layouts**; layout functions are unit-tested for zero overlap.
- **"AI-edit this chart"**: append natural-language revision instructions to an existing chart; changes are validated and redrawn incrementally.

### Layout & editing experience

- Radial / vertical tree / horizontal tree layouts; tree, flow, and org charts can switch direction; after replacing or expanding nodes, the layout type is recognized from edge styles and the whole map is re-arranged automatically.
- Single-transaction building: Ctrl+Z undoes the entire generated map in one step; AI-generated content carries style markers, so replacements never touch hand-drawn content.
- Generation options (dialog values, provider, keys) are remembered automatically.

### Multi-provider model access

12 provider presets built in (selecting one auto-fills the endpoint and default model): DeepSeek, Volcengine Ark (pay-as-you-go / Coding Plan), Zhipu GLM, OpenAI, Kimi For Coding, Moonshot, Qwen, MiniMax, SiliconFlow, OpenRouter, and Ollama (local). Any OpenAI-compatible endpoint can be configured manually.

Debug without spending quota: `ai/dev-mock-server.mjs` provides a local mock LLM with per-stage scripted responses.

### Two flavors

- **Desktop** (Windows NSIS installer + MSI): API keys are encrypted at rest via Electron `safeStorage`; network requests are forwarded through the main process, so web fetching is not limited by browser CORS.
- **Browser**: runs on any static server; configure a proxy for fetches outside the CSP.
- Both include the full drawio editor: complete shape libraries, sketch style, VSDX/PNG/PDF/SVG import & export, and more.

## Getting started

### Install the desktop app (Windows)

Download `MindmapAI-x.y.z-windows-installer.exe` or `.msi` from [Releases](../../releases). The installer is not code-signed, so SmartScreen will warn on first run — choose "Run anyway".

First use: menu **AI → Settings…**, pick a provider preset, fill in the API key, press "Test connection", then start generating via **AI → Generate mind map…** (or right-click the empty canvas).

### Browser (dev mode)

```bash
# One-click start (first run automatically fetches upstream, injects and builds; then
# starts a local server and opens the browser)
node scripts/start.mjs
# On Windows you can simply double-click start.cmd in the repo root
```

Manual steps (equivalent):

```bash
# 0. Fetch the upstream editor source (pinned) and inject integration points + build the plugin (first time only)
node scripts/setup-upstream.mjs

# 1. Serve statically (from the repo root)
python3 -m http.server 8000 -d webapp/src/main/webapp

# 2. Open http://localhost:8000/
```

### Desktop dev mode

```bash
node scripts/setup-upstream.mjs          # skip if already done (the script is idempotent)
cd desktop && ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
MM_WEBAPP_DIR=$(pwd)/../webapp/src/main/webapp npm start
```

### Debug without burning quota

```bash
node ai/dev-mock-server.mjs
# Then point the Base URL in AI → Settings… to http://127.0.0.1:8787
```

## Architecture

```
┌────────────────────────────────────────────────────┐
│  desktop/  Electron shell (slimmed upstream         │
│            drawio-desktop)                          │
│    IPC: safeStorage key store · main-process fetch  │
├────────────────────────────────────────────────────┤
│  webapp/   drawio editor (slimmed upstream drawio)  │
│    └─ js/ai/mindmap-ai.js   ← plugin bundle (build) │
├────────────────────────────────────────────────────┤
│  ai/       TypeScript plugin source (esbuild+vitest)│
│    agent/   3-stage pipeline (distill→arch→review)  │
│    charts/  12 thinking charts: catalog/shapes/     │
│             layout/assembly                         │
│    mindmap/ tree model/node sizing/radial layout    │
│    ui/      menus, dialogs, context actions         │
│    settings/ config persistence & key store         │
│             (browser/Electron dual channel)         │
└────────────────────────────────────────────────────┘
```

All AI code lives in `ai/` (pure TypeScript, independently testable). The plugin touches only 10 upstream editor files and 8 Electron shell files (plugin loading, title & branding, i18n resources, IPC bridge, packaging config), all injected automatically by the setup script with idempotent markers — itemized in [NOTICE.md](NOTICE.md); the injected content's source files live in `patches/`.

## Repository layout

```
.
├── ai/                 # AI plugin TypeScript source & tests (this project's code)
├── patches/            # Injection sources & upstream pins (pins.json)
│   ├── webapp/         # i18n blocks, test fixtures, brand assets
│   └── desktop/        # Electron injection block, packaging config, CDP regression scripts
├── scripts/            # setup-upstream.mjs: fetch upstream + inject + build; start.mjs: one-click run
├── docs/               # Design docs, dev log, acceptance screenshots
│   ├── DEVELOPING.md   # Dev environment & common commands (Chinese)
│   └── DEVLOG.md       # Dev log, milestones M0-M8 (Chinese)
├── webapp/             # Upstream editor source — fetched by the setup script at runtime, not committed
├── desktop/            # Electron shell source — same as above, not committed
├── LICENSE             # Apache-2.0
└── NOTICE.md           # Upstream pins, injection inventory, trademark notice (Chinese)
```

## Development

Environment requirements and common commands (build, tests, CDP regression, Windows packaging) are documented in [docs/DEVELOPING.md](docs/DEVELOPING.md) (Chinese); the milestone-by-milestone dev log lives in [docs/DEVLOG.md](docs/DEVLOG.md) (Chinese).

```bash
cd ai && npm run typecheck && npm test && npm run build
```

## Roadmap

- [x] MVP: topic/text/link generation, review pipeline, 12 thinking charts, desktop packaging
- [x] Original app icon & PWA branding (replacing upstream brand assets, see `patches/assets/mindmapai-icon.svg`)
- [ ] Conversational sidebar, map optimization & summarization
- [ ] Document-to-map (Markdown / Word / PDF), bidirectional Markdown editing
- [ ] XMind / Freeplane / OPML import
- [ ] macOS / Linux packaging, installer code signing

## License & acknowledgements

- This project is released under the [Apache-2.0](LICENSE) license.
- The upstream sources pulled at runtime (jgraph/drawio and jgraph/drawio-desktop, both Apache-2.0) are not distributed in this repository; their license files travel with the upstream clones untouched. All injections made to that (undistributed) upstream source are declared item by item in [NOTICE.md](NOTICE.md).
- "draw.io" and "drawio" are trademarks of JGraph AG. This project is an independent derivative distribution, not affiliated with or endorsed by JGraph AG.
- **Non-commercial statement**: this is a personal, non-profit project — run for no profit, selling neither the app nor installers, with no ads or paid features; provided "as is", without warranty of any kind.
- Privacy: the app only sends network requests to the LLM endpoint you configure and the pages you ask it to fetch — no built-in telemetry. See the privacy section in [NOTICE.md](NOTICE.md) (Chinese).
