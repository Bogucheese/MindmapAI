#!/usr/bin/env node
/**
 * MindmapAI upstream setup.
 *
 * 本仓库只包含 MindmapAI 的原创代码。上游编辑器源码不随仓库分发：
 * 运行本脚本，按 patches/pins.json 里固定的提交拉取 jgraph/drawio 与
 * jgraph/drawio-desktop，再把 MindmapAI 的接入点（插件加载、i18n、
 * Electron IPC 桥、打包配置）幂等地注入进去，最后构建插件 bundle。
 *
 * Usage:
 *   node scripts/setup-upstream.mjs [options]
 *
 * Options:
 *   --skip-build        跳过 ai/ 插件构建
 *   --webapp-dir <dir>  覆盖 webapp 目录（默认 ./webapp）
 *   --desktop-dir <dir> 覆盖 desktop 目录（默认 ./desktop）
 *   --repo-webapp <url>   覆盖 webapp 上游地址（镜像场景）
 *   --repo-desktop <url>  覆盖 desktop 上游地址（镜像场景）
 *   --bundle-v <N>      覆盖插件 bundle 的 ?v= 缓存版本号（默认取 pins.json）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATCHES = path.join(REPO_ROOT, 'patches');
const pins = JSON.parse(fs.readFileSync(path.join(PATCHES, 'pins.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SKIP_BUILD = argv.includes('--skip-build');
const WEBAPP_DIR = path.resolve(REPO_ROOT, flag('webapp-dir') ?? 'webapp');
const DESKTOP_DIR = path.resolve(REPO_ROOT, flag('desktop-dir') ?? 'desktop');
const BUNDLE_V = Number(flag('bundle-v') ?? pins.webapp.bundleV);
const BOOTSTRAP_V = Number(flag('bootstrap-v') ?? pins.webapp.bootstrapV);

const log = (msg) => console.log(`[setup] ${msg}`);
const die = (msg) => {
  console.error(`[setup] ERROR: ${msg}`);
  process.exit(1);
};

// ---------- tiny op engine ----------

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);
const assertOnce = (hay, needle, where) => {
  const n = hay.split(needle).length - 1;
  if (n !== 1) die(`anchor not unique (${n}) in ${where}: ${JSON.stringify(needle.slice(0, 60))}`);
};

/** Skip if marker present; otherwise replace exactly one occurrence. */
function replaceOnce(file, { marker, from, to, label }) {
  if (!fs.existsSync(file)) die(`${label}: file missing: ${file}`);
  let s = read(file);
  if (marker != null && s.includes(marker)) {
    log(`skip (already applied): ${label}`);
    return;
  }
  assertOnce(s, from, `${label} (${file})`);
  write(file, s.replace(from, to));
  log(`applied: ${label}`);
}

/** Skip if marker present; otherwise insert block after the (unique) regex match. */
function insertAfterRegex(file, { marker, regex, block, label }) {
  if (!fs.existsSync(file)) die(`${label}: file missing: ${file}`);
  let s = read(file);
  if (marker != null && s.includes(marker)) {
    log(`skip (already applied): ${label}`);
    return;
  }
  const m = s.match(regex);
  if (m == null) die(`${label}: anchor not found in ${file}`);
  s = s.replace(regex, (_match, kept) => `${kept}\n\n${block}\n\n`);
  write(file, s);
  log(`applied: ${label}`);
}

/** i18n 追加:逐行确保存在——即使旧仓库已注入过整块,新增文案行也能补上。 */
function ensureI18nLines(file, block, label) {
  const existing = read(file);
  const missing = block.split('\n').filter((line) => line.trim() !== '' && !existing.includes(line));
  if (missing.length === 0) {
    log(`skip (already applied): ${label}`);
    return;
  }
  let s = existing;
  if (!s.endsWith('\n')) s += '\n';
  write(file, s + missing.join('\n') + '\n');
  log(`applied: ${label} (+${missing.length} lines)`);
}

function copyFile(src, dest, label) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  log(`copied: ${label}`);
}

// ---------- MindmapAI content (original code injected into upstream files) ----------

const mmBlock = read(path.join(PATCHES, 'desktop', 'electron.mindmapai-block.js')).replace(/\n$/, '');

const IPC_CASES = [
  "\t\tcase 'mmAiGetSecret':",
  '\t\t\tret = await mmGetSecret();',
  '\t\t\tbreak;',
  "\t\tcase 'mmAiSetSecret':",
  "\t\t\treqStr(args.apiKey, 'apiKey');",
  '\t\t\tret = await mmSetSecret(args.apiKey);',
  '\t\t\tbreak;',
  "\t\tcase 'mmAiDeleteSecret':",
  '\t\t\tret = await mmDeleteSecret();',
  '\t\t\tbreak;',
  "\t\tcase 'mmAiFetch':",
  "\t\t\treqStr(args.url, 'url');",
  '\t\t\tret = await mmAiFetch(args.url, args.headers, args.body, args.timeoutMs, args.method);',
  '\t\t\tbreak;',
].join('\n');

const BOOTSTRAP_DEV_BLOCK = [
  '    // MindmapAI (AI mind map plugin). Draws resources from window.Draw with',
  '    // its own retry, so exact ordering versus the async Devel.js chain is safe.',
  '    // ?v= busts the browser\'s heuristic cache whenever the bundle is redeployed.',
  `    mxscript('js/ai/mindmap-ai.js?v=${BUNDLE_V}');`,
].join('\n');

const BOOTSTRAP_PROD_BLOCK = [
  '                // MindmapAI (AI mind map plugin). Queued after app.min.js;',
  '                // registers via window.Draw.loadPlugin with its own retry.',
  '                // ?v= busts the browser\'s heuristic cache whenever the bundle is redeployed.',
  `                mxscript('js/ai/mindmap-ai.js?v=${BUNDLE_V}');`,
].join('\n');

const CODEDIR_BLOCK = [
  '// MindmapAI: allow loading our forked webapp instead of the bundled drawio',
  '// submodule during development. e.g. MM_WEBAPP_DIR=/path/to/webapp/src/main/webapp',
  '// Packaged builds carry the MindmapAI webapp in resources/webapp (extraResources',
  '// in electron-builder-mindmapai-win.json); the drawio submodule path below only',
  '// resolves in a dev checkout with the submodule initialized.',
  'const mmBundledWebappDir = app.isPackaged ?',
  "\tpath.join(process.resourcesPath, 'webapp') : null;",
  "const codeDir = (process.env.MM_WEBAPP_DIR != null && process.env.MM_WEBAPP_DIR !== '') ?",
  '\tpath.resolve(process.env.MM_WEBAPP_DIR) :',
  '\t(mmBundledWebappDir != null &&',
  "\t\tfs.existsSync(path.join(mmBundledWebappDir, 'index.html')) ?",
  '\t\tmmBundledWebappDir :',
  "\t\tpath.join(__dirname, '/../../drawio/src/main/webapp'));",
].join('\n');

const DEVEL_CSP_TO = [
  "\t\t\t'https://*.google.com https://fonts.gstatic.com https://fonts.googleapis.com https://api.anthropic.com ' +",
  '\t\t\t// MindmapAI: DeepSeek API for browser (?dev=1) testing; prod has no CSP',
  "\t\t\t'https://api.deepseek.com; ' +",
].join('\n');

const DISABLE_UPDATE_BASELINE = 'export function disableUpdate() { return false;}';
const disableUpdatePayload = read(path.join(PATCHES, 'desktop', 'disableUpdate.js'));

// ---------- upstream fetching ----------

function ensureUpstream(dir, cfg, repoOverride, label, layoutProbe) {
  if (fs.existsSync(path.join(dir, '.git'))) {
    log(`${label}: git repo already present at ${dir} — clone skipped (idempotent inject will verify markers)`);
    return;
  }
  if (fs.existsSync(dir)) {
    if (fs.existsSync(path.join(dir, layoutProbe))) {
      log(`${label}: ${dir} present (not a git repo) — clone skipped`);
      return;
    }
    // 半截拉取的残留（无 .git 也无完整布局）：清掉重拉
    log(`${label}: incomplete ${dir} without .git — removing and re-fetching`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const repo = repoOverride ?? cfg.repo;
  log(`${label}: fetching ${repo} (pinned: ${cfg.commit}) — this downloads upstream source`);
  // 优先浅获取固定提交（运行应用不需要上游历史，下载量小得多）；失败再回退全量克隆
  const shallowSteps = [
    ['init', '-q', dir],
    ['-C', dir, 'remote', 'add', 'origin', repo],
    ['-C', dir, 'fetch', '--depth', '1', 'origin', cfg.commit],
  ];
  const shallowOk = shallowSteps.every(
    (args) => spawnSync('git', args, { stdio: 'inherit' }).status === 0,
  ) && spawnSync('git', ['-C', dir, 'checkout', '--detach', cfg.commit], { stdio: 'inherit' }).status === 0;
  if (!shallowOk) {
    log(`${label}: shallow fetch failed — falling back to full clone`);
    fs.rmSync(dir, { recursive: true, force: true });
    const r = spawnSync('git', ['clone', repo, dir], { stdio: 'inherit' });
    if (r.status !== 0)
      die(`${label}: git clone failed (network? GitHub 直连不稳时可加镜像参数，如 --repo-${label} https://ghproxy.net/https://github.com/jgraph/${label === 'webapp' ? 'drawio' : 'drawio-desktop'}.git)`);
  }
  const c = spawnSync('git', ['checkout', '--detach', cfg.commit], { cwd: dir, stdio: 'inherit' });
  if (c.status !== 0) die(`${label}: checkout of pinned commit ${cfg.commit} failed`);
}

// ---------- desktop/package.json ordered edit ----------

function editDesktopPackageJson(file) {
  const raw = read(file);
  const pkg = JSON.parse(raw);
  if (pkg.productName === 'MindmapAI' && pkg.scripts['release-mindmapai-win']) {
    log('skip (already applied): desktop/package.json');
    return;
  }
  const wanted = {
    name: pkg.name,
    productName: 'MindmapAI',
    version: '0.1.0',
    description: 'MindmapAI — AI mind map maker based on drawio (MindmapAI fork of drawio-desktop)',
  };
  const out = {};
  out.name = wanted.name;
  out.productName = wanted.productName;
  out.version = wanted.version;
  out.description = wanted.description;
  for (const [k, v] of Object.entries(pkg)) {
    if (k === 'name' || k === 'productName' || k === 'version' || k === 'description') continue;
    if (k === 'scripts') {
      out.scripts = {
        ...v,
        'release-mindmapai-win': 'electron-builder --win --config electron-builder-mindmapai-win.json --publish never',
        'release-mindmapai-linux-dir': 'electron-builder --linux --dir --config electron-builder-mindmapai-win.json --publish never',
      };
      continue;
    }
    out[k] = v;
  }
  write(file, JSON.stringify(out, null, 2) + '\n');
  log('applied: desktop/package.json');
}

// ---------- main ----------

function applyWebapp() {
  const app = path.join(WEBAPP_DIR, 'src', 'main', 'webapp');
  if (!fs.existsSync(path.join(app, 'index.html'))) die(`webapp layout unexpected: ${app} (clone first)`);

  insertAfterRegex(path.join(app, 'js', 'bootstrap.js'), {
    marker: 'MindmapAI (AI mind map plugin). Draws resources',
    regex: /(mxscript\(drawDevUrl \+ 'js\/diagramly\/Devel\.js'\);)[ \t]*\n[ \t]*\n/,
    block: BOOTSTRAP_DEV_BLOCK,
    label: 'webapp/bootstrap.js dev-path plugin load',
  });
  insertAfterRegex(path.join(app, 'js', 'bootstrap.js'), {
    marker: 'MindmapAI (AI mind map plugin). Queued after app.min.js',
    regex: /(checkAllLoaded\(\);)[ \t]*\n[ \t]*\n/,
    block: BOOTSTRAP_PROD_BLOCK,
    label: 'webapp/bootstrap.js prod-path plugin load',
  });
  replaceOnce(path.join(app, 'index.html'), {
    marker: 'bootstrap.js?v=',
    from: '\t<script src="js/bootstrap.js"></script>\n',
    to: `\t<!-- ?v= busts the browser cache for the loader itself (dev servers send no Cache-Control) -->\n\t<script src="js/bootstrap.js?v=${BOOTSTRAP_V}"></script>\n`,
    label: 'webapp/index.html loader cache-bust',
  });
  replaceOnce(path.join(app, 'js', 'diagramly', 'Devel.js'), {
    marker: 'MindmapAI: DeepSeek API for browser',
    from: "\t\t\t'https://*.google.com https://fonts.gstatic.com https://fonts.googleapis.com https://api.anthropic.com; ' +\n",
    to: DEVEL_CSP_TO + '\n',
    label: 'webapp/Devel.js dev CSP entry',
  });
  ensureI18nLines(path.join(app, 'resources', 'dia.txt'), read(path.join(PATCHES, 'webapp', 'dia.extra.txt')), 'webapp/dia.txt i18n (EN)');
  ensureI18nLines(path.join(app, 'resources', 'dia_zh.txt'), read(path.join(PATCHES, 'webapp', 'dia_zh.extra.txt')), 'webapp/dia_zh.txt i18n (ZH)');
  copyFile(path.join(PATCHES, 'webapp', 'test-article.html'), path.join(app, 'test-article.html'), 'webapp/test-article.html fixture');

  // brand: original MindmapAI artwork replaces upstream icons (see patches/assets/mindmapai-icon.svg)
  copyFile(path.join(PATCHES, 'webapp', 'favicon.ico'), path.join(app, 'favicon.ico'), 'webapp/favicon.ico');
  const img = (name) => path.join(app, 'images', name);
  for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-192-maskable.png',
    'icon-512-maskable.png', 'drawlogo128.png', 'mindmapai256.png']) {
    copyFile(path.join(PATCHES, 'webapp', f), img(f), `webapp/images/${f}`);
  }
  copyFile(path.join(PATCHES, 'webapp', 'manifest.json'), img('manifest.json'), 'webapp/images/manifest.json');

  // brand: page titles and the tab-bar github badge
  replaceOnce(path.join(app, 'index.html'), {
    marker: '<title>MindmapAI</title>',
    from: '<title>Flowchart Maker &amp; Online Diagram Software</title>',
    to: '<title>MindmapAI</title>',
    label: 'webapp/index.html static title',
  });
  // 底部标签栏右侧徽标：上游 ghLink（GitHub logo → jgraph/drawio，保持可见）
  // 之后再注入 MindmapAI 仓库徽标（自绘 SVG data-URI，原创图形）。旧版注入
  // 曾隐藏 ghLink，此处先做幂等迁移清理。
  const pagesJs = path.join(app, 'js', 'diagramly', 'Pages.js');
  const legacyPages = "\n\t\tghLink.style.display = 'none';";
  if (read(pagesJs).includes(legacyPages)) {
    write(pagesJs, read(pagesJs).split(legacyPages).join(''));
    log('migrated: removed legacy ghLink hide (Pages.js)');
  }
  const appMinPath = path.join(app, 'js', 'app.min.js');
  const legacyMin = 'opacity:0.5;flex-shrink:0";l.style.display="none";';
  if (read(appMinPath).includes(legacyMin)) {
    write(appMinPath, read(appMinPath).split(legacyMin).join('opacity:0.5;flex-shrink:0";'));
    log('migrated: removed legacy ghLink hide (app.min.js)');
  }
  const badgeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>' +
    '<circle cx="12" cy="12" r="10" fill="url(#g)"/>' +
    '<g stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none">' +
    '<path d="M12 12L7 7.5"/><path d="M12 12l6.5-1.5"/><path d="M12 12l-2.5 6.5"/><path d="M12 12l5 4"/></g>' +
    '<circle cx="12" cy="12" r="2.4" fill="#FBBF24"/>' +
    '<circle cx="7" cy="7.5" r="1.7" fill="#fff"/>' +
    '<circle cx="18.5" cy="10.5" r="1.7" fill="#fff"/>' +
    '<circle cx="9.5" cy="18.5" r="1.7" fill="#fff"/>' +
    '<circle cx="17" cy="16" r="1.7" fill="#fff"/></svg>';
  const badgeUri = 'data:image/svg+xml,' + encodeURIComponent(badgeSvg);
  replaceOnce(pagesJs, {
    marker: "var mmLink = document.createElement('a');",
    from: '\t\tthis.tabContainer.appendChild(ghLink);\n',
    to: `\t\tthis.tabContainer.appendChild(ghLink);\n` +
      `\t\tvar mmLink = document.createElement('a');\n` +
      `\t\tmmLink.href = 'https://github.com/Bogucheese/MindmapAI';\n` +
      `\t\tmmLink.target = '_blank';\n` +
      `\t\tmmLink.style.cssText = 'display:flex;align-items:center;' +\n` +
      `\t\t\t'padding:0 8px;opacity:0.5;flex-shrink:0';\n` +
      `\t\tvar mmBadge = document.createElement('img');\n` +
      `\t\tmmBadge.src = '${badgeUri}';\n` +
      `\t\tmmBadge.style.cssText = 'width:18px;height:18px';\n` +
      `\t\tmmBadge.setAttribute('title', 'Bogucheese/MindmapAI');\n` +
      `\t\tmmLink.appendChild(mmBadge);\n` +
      `\t\tmxEvent.addListener(mmLink, 'mouseenter', function()\n` +
      `\t\t{\n` +
      `\t\t\tmmLink.style.opacity = '1';\n` +
      `\t\t});\n` +
      `\t\tmxEvent.addListener(mmLink, 'mouseleave', function()\n` +
      `\t\t{\n` +
      `\t\t\tmmLink.style.opacity = '0.5';\n` +
      `\t\t});\n` +
      `\t\tthis.tabContainer.appendChild(mmLink);\n`,
    label: 'webapp/Pages.js MindmapAI badge link (dev source)',
  });
  replaceOnce(appMinPath, {
    marker: 'mmLinkEl',
    from: 'this.tabContainer.appendChild(l);null!=q&&q.classList.add("geActivePage")',
    to: 'this.tabContainer.appendChild(l);var mmLinkEl=document.createElement("a");' +
      'mmLinkEl.href="https://github.com/Bogucheese/MindmapAI";mmLinkEl.target="_blank";' +
      'mmLinkEl.style.cssText="display:flex;align-items:center;padding:0 8px;opacity:0.5;flex-shrink:0";' +
      'var mmBadgeEl=document.createElement("img");mmBadgeEl.src="' + badgeUri + '";' +
      'mmBadgeEl.style.cssText="width:18px;height:18px";mmBadgeEl.setAttribute("title","Bogucheese/MindmapAI");' +
      'mmLinkEl.appendChild(mmBadgeEl);' +
      'mxEvent.addListener(mmLinkEl,"mouseenter",function(){mmLinkEl.style.opacity="1"});' +
      'mxEvent.addListener(mmLinkEl,"mouseleave",function(){mmLinkEl.style.opacity="0.5"});' +
      'this.tabContainer.appendChild(mmLinkEl);null!=q&&q.classList.add("geActivePage")',
    label: 'webapp/app.min.js MindmapAI badge link (prod)',
  });
}

function applyDesktop() {
  const electronJs = path.join(DESKTOP_DIR, 'src', 'main', 'electron.js');
  if (!fs.existsSync(electronJs)) die(`desktop layout unexpected: ${electronJs} (clone first)`);

  replaceOnce(electronJs, {
    marker: "safeStorage} from 'electron';",
    from: "BrowserWindow} from 'electron';",
    to: "BrowserWindow, safeStorage} from 'electron';",
    label: 'desktop/electron.js electron import (+safeStorage)',
  });
  replaceOnce(electronJs, {
    marker: 'MM_WEBAPP_DIR',
    from: "const codeDir = path.join(__dirname, '/../../drawio/src/main/webapp');",
    to: CODEDIR_BLOCK,
    label: 'desktop/electron.js MM_WEBAPP_DIR override',
  });
  replaceOnce(electronJs, {
    marker: '==================== MindmapAI end ====================',
    from: '\nipcMain.on("rendererReq"',
    to: `\n${mmBlock}\n\nipcMain.on("rendererReq"`,
    label: 'desktop/electron.js secrets + fetch bridge block',
  });
  replaceOnce(electronJs, {
    marker: "case 'mmAiGetSecret':",
    from: "\t\tcase 'isFullscreen':\n\t\t\tret = BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false;\n\t\t\tbreak;\n",
    to: `\t\tcase 'isFullscreen':\n\t\t\tret = BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false;\n\t\t\tbreak;\n${IPC_CASES}\n`,
    label: 'desktop/electron.js IPC cases',
  });

  const disableUpdate = path.join(DESKTOP_DIR, 'src', 'main', 'disableUpdate.js');
  const du = read(disableUpdate);
  if (du.includes('return true')) {
    log('skip (already applied): desktop/disableUpdate.js');
  } else if (du.trim() === DISABLE_UPDATE_BASELINE.trim()) {
    write(disableUpdate, disableUpdatePayload);
    log('applied: desktop/disableUpdate.js (update checks off for fork versions)');
  } else {
    die(`desktop/disableUpdate.js has unexpected content; refusing to overwrite`);
  }

  editDesktopPackageJson(path.join(DESKTOP_DIR, 'package.json'));

  copyFile(path.join(PATCHES, 'desktop', 'electron-builder-mindmapai-win.json'),
    path.join(DESKTOP_DIR, 'electron-builder-mindmapai-win.json'), 'desktop/electron-builder-mindmapai-win.json');
  copyFile(path.join(PATCHES, 'desktop', 'cdp-regression.mjs'),
    path.join(DESKTOP_DIR, 'scripts', 'cdp-regression.mjs'), 'desktop/scripts/cdp-regression.mjs');
  copyFile(path.join(PATCHES, 'desktop', 'cdp-set-and-close.mjs'),
    path.join(DESKTOP_DIR, 'scripts', 'cdp-set-and-close.mjs'), 'desktop/scripts/cdp-set-and-close.mjs');

  // brand: original MindmapAI artwork (see patches/assets/mindmapai-icon.svg)
  replaceOnce(electronJs, {
    marker: 'images/mindmapai256.png',
    from: 'images/drawlogo256.png',
    to: 'images/mindmapai256.png',
    label: 'desktop/electron.js window icon path',
  });
  copyFile(path.join(PATCHES, 'desktop', 'icon.ico'), path.join(DESKTOP_DIR, 'build', 'icon.ico'), 'desktop/build/icon.ico');
  copyFile(path.join(PATCHES, 'desktop', 'icon.png'), path.join(DESKTOP_DIR, 'build', 'icon.png'), 'desktop/build/icon.png');
}

function buildPlugin() {
  if (SKIP_BUILD) {
    log('build skipped (--skip-build)');
    return;
  }
  const aiDir = path.join(REPO_ROOT, 'ai');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (!fs.existsSync(path.join(aiDir, 'node_modules'))) {
    log('ai/: installing dev dependencies (esbuild, typescript, vitest, happy-dom)...');
    const r = spawnSync(npmCmd, ['install'], { cwd: aiDir, stdio: 'inherit' });
    if (r.status !== 0) die('ai/: npm install failed');
  }
  log('ai/: building plugin bundle → webapp/src/main/webapp/js/ai/mindmap-ai.js');
  const r = spawnSync(npmCmd, ['run', 'build'], { cwd: aiDir, stdio: 'inherit' });
  if (r.status !== 0) die('ai/: build failed');
}

function main() {
  log(`pins: webapp ${pins.webapp.upstreamVersion} @ ${pins.webapp.commit.slice(0, 9)}, desktop ${pins.desktop.ref} @ ${pins.desktop.commit.slice(0, 9)}`);
  ensureUpstream(WEBAPP_DIR, pins.webapp, flag('repo-webapp'), 'webapp', path.join('src', 'main', 'webapp', 'index.html'));
  ensureUpstream(DESKTOP_DIR, pins.desktop, flag('repo-desktop'), 'desktop', path.join('src', 'main', 'electron.js'));
  applyWebapp();
  applyDesktop();
  buildPlugin();
  log('done. Next steps:');
  console.log(`
  # 浏览器版
  python3 -m http.server 8000 -d webapp/src/main/webapp     # http://localhost:8000/

  # 桌面版（首次需要安装 Electron 依赖）
  cd desktop && ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
  MM_WEBAPP_DIR=$(pwd)/../webapp/src/main/webapp npm start

  # AI 设置：AI → 设置…（可用 node ai/dev-mock-server.mjs 做零成本联调）
`);
}

main();
