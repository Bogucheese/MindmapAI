/**
 * 本地抓取代理(零依赖):自建「抓取代理」的最简单方案。
 *
 *   node tools/local-fetch-proxy.mjs [端口]     # 默认 8788
 *
 * 然后在 AI 设置的「抓取代理」里填 http://127.0.0.1:8788/
 *
 * 用法与 r.jina.ai 相同:GET /https://目标网址 → 返回
 *   Title: 页面标题
 *
 *   Markdown Content:
 *   <正文(标题/段落/列表转 Markdown,剥离脚本/样式/导航)>
 *
 * 原理:本机直接请求目标页面(无 CORS 限制),做轻量正文提取后回传;
 * JSON 接口(如 B 站 view API)原样透传。境内站点(头条/知乎/B站)从
 * 本机通常直接可达——网页版之前的失败只是浏览器的 CORS 限制。
 */

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 8788);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_BYTES = 3 * 1024 * 1024;

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function stripChrome(doc) {
  for (const el of doc.querySelectorAll('script, style, noscript, svg, iframe, nav, header, footer, aside, form, button, link, meta')) {
    el.remove();
  }
}

function extractReadable(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  stripChrome(doc);
  const container =
    doc.querySelector('main') ??
    doc.querySelector('article') ??
    doc.querySelector('[role="main"]') ??
    doc.querySelector('#main-content, #content, .main-content, .content, .article-content') ??
    doc.body;
  const title = oneLine(doc.title ?? '');
  const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th, figcaption, dd, dt';
  const lines = [];
  const seen = new Set();
  for (const el of Array.from(container.querySelectorAll(BLOCKS))) {
    if (el.querySelector(BLOCKS) != null) continue;
    const tag = el.tagName.toLowerCase();
    const text = oneLine(el.textContent ?? '');
    if (text.length < 2) continue;
    let line;
    if (/^h[1-6]$/.test(tag)) line = `${'#'.repeat(Number(tag[1]))} ${text}`;
    else if (tag === 'li') line = `- ${text}`;
    else line = text;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    // 过滤内联脚本残留(window.xxx=…、var …、JSON-LD 等)
    if (/^(window\.|var\s|\{"@|"!function|function\s*\()/.test(line)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 2000) break;
  }
  return { title, text: lines.join('\n\n') };
}

function htmlToMarkdown(html) {
  try {
    return extractReadable(html);
  } catch (e) {
    return { title: '', text: oneLine(String(html).replace(/<[^>]+>/g, ' ')).slice(0, 5000) };
  }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = (req.url ?? '').slice(1);
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('用法: GET /https://目标网址');
    return;
  }

  console.log(`[proxy] ${target}`);
  fetch(target, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  })
    .then(async (resp) => {
      const contentType = resp.headers.get('content-type') ?? '';
      const raw = (await resp.text()).slice(0, MAX_BYTES);

      if (!resp.ok) {
        res.writeHead(resp.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`上游返回 HTTP ${resp.status}`);
        return;
      }

      // JSON 接口(如 B 站 view API)原样透传
      if (contentType.includes('json')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(raw);
        return;
      }

      const { title, text } = contentType.includes('html') ? htmlToMarkdown(raw) : { title: '', text: raw };
      // 反爬挑战页检测:正文近乎全是混淆 JS 时明确报错,不污染导图
      if (text.length < 300 || /_\$jsvmprt|_0x[a-f0-9]{4,}|acw_sc__v2/.test(text.slice(0, 1500))) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('目标站点返回了反爬保护页(需要真实浏览器环境),本地代理无法获取正文');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Title: ${title}\n\nMarkdown Content:\n${text}`);
    })
    .catch((err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`抓取失败: ${err instanceof Error ? err.message : String(err)}`);
    });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地抓取代理 http://127.0.0.1:${PORT}/ 已启动 — 在 AI 设置的「抓取代理」填入此地址`);
});
