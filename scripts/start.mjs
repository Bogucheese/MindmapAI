#!/usr/bin/env node
/**
 * MindmapAI 一键启动（浏览器版）。
 *
 * 首次运行自动执行 scripts/setup-upstream.mjs（按 pinned 提交拉取上游源码 +
 * 注入接入点 + 构建插件 bundle，需联网）；之后用 Node 内置模块起一个零依赖
 * 静态服务器直接服务 webapp 编辑器，并尽力打开默认浏览器。Ctrl+C 退出。
 *
 * Usage:
 *   node scripts/start.mjs [options]
 *   Windows 下可直接双击仓库根目录的 start.cmd。
 *
 * Options:
 *   --port <n>     监听端口（默认 8000）
 *   --host <addr>  监听地址（默认 127.0.0.1）
 *   --no-open      不自动打开浏览器
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEBAPP_ROOT = path.resolve(REPO_ROOT, 'webapp', 'src', 'main', 'webapp');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(flag('port') ?? 8000);
const HOST = flag('host') ?? '127.0.0.1';
const OPEN = !argv.includes('--no-open');

const log = (msg) => console.log(`[start] ${msg}`);
const die = (msg) => {
  console.error(`[start] ERROR: ${msg}`);
  process.exit(1);
};

// 覆盖 drawio 静态资源涉及的类型；未列出的一律按二进制流处理
const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function contentType(file) {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return type.startsWith('text/') || type.includes('javascript') || type.includes('svg')
    ? `${type}; charset=utf-8`
    : type;
}

function ensureUpstream() {
  if (fs.existsSync(path.join(WEBAPP_ROOT, 'index.html'))) return;
  log('webapp/ 尚未初始化 — 执行 scripts/setup-upstream.mjs（首次需联网拉取上游，请耐心等待）…');
  const r = spawnSync(process.execPath, [path.join('scripts', 'setup-upstream.mjs')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0)
    die('setup-upstream 失败；网络受限时可查看 scripts/setup-upstream.mjs 的 --repo-* 镜像参数');
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  cmd.on('error', () => {}); // 打不开就算了，URL 始终打印在下方
  cmd.unref();
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.resolve(WEBAPP_ROOT, `.${path.posix.normalize(urlPath)}`);
  if (file !== WEBAPP_ROOT && !file.startsWith(WEBAPP_ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${urlPath}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE')
    die(`端口 ${PORT} 已被占用 — 换一个端口再试：node scripts/start.mjs --port 8001`);
  die(err.message);
});

ensureUpstream();
server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
  log(`MindmapAI 编辑器已就绪：${url}  （Ctrl+C 停止）`);
  log('首次使用请配置 AI：菜单 AI → 设置…（填入模型厂商端点与 API Key）');
  if (OPEN) openBrowser(url);
});
