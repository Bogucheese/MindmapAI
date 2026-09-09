/**
 * 来源工具：粘贴文本（P0）与链接抓取（P1）。
 *
 * 分块策略：
 * 1. 按 Markdown 标题行（#…）切出章节，标题栈记录 headingPath；
 * 2. 超过 MAX_CHUNK_CHARS 的章节按空行段落装箱再分；
 * 3. 无标题结构的文本直接按段落装箱，纯长段按换行硬切兜底；
 * 4. 分块总数超过 MAX_CHUNKS 时截断（truncated 标记，界面提示）。
 * 确定性、无网络、可单测——fetch/github_raw 也产出 SourceDoc，
 * 复用同一套分块逻辑。
 *
 * 链接抓取：GitHub 链接统一转 raw.githubusercontent.com（CORS 开放，
 * 浏览器模式也能直连）；其余 URL 浏览器模式受 CORS 限制，桌面端经
 * mmAiFetch 主进程通道抓取。HTML 用 DOMParser 做轻量正文提取，
 * 标题转 Markdown 标记行以喂给分块器。
 */

import { transportGet } from '../ai/client';
import type { SourceChunk, SourceDoc } from './types';

export const MAX_CHUNK_CHARS = 4000;
export const MAX_CHUNKS = 12;

/** 规范化文本：统一换行、压掉 3+ 连续空行 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Section {
  headingPath?: string;
  /** 章节内不含标题行的正文 */
  body: string;
}

/** 按标题行切章节（顶层调用前已 normalize）；
 *  约定：首个一级标题是文档标题，不进入 headingPath */
function splitByHeadings(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  const headingStack: { level: number; title: string }[] = [];
  let titleSeen = false;
  let current: Section = { body: '' };

  const push = (): void => {
    if (current.body.trim() !== '') {
      sections.push(current);
    }
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m != null) {
      push();
      const level = m[1].length;
      if (level === 1 && !titleSeen && headingStack.length === 0) {
        titleSeen = true;
        current = { body: '' };
        continue;
      }
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title: m[2] });
      current = { headingPath: headingStack.map((h) => h.title).join(' > '), body: '' };
    } else {
      current.body += line + '\n';
    }
  }
  push();
  return sections;
}

/** 段落装箱：把章节正文按空行段落装进 ≤maxChars 的块；无段落边界的硬切 */
function packParagraphs(body: string, maxChars: number): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  const packed: string[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf.trim() !== '') packed.push(buf.trim());
    buf = '';
  };
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      flush();
      // 硬切兜底：优先换行处断开，避免破坏词句
      for (const piece of hardSlice(p, maxChars)) {
        packed.push(piece);
      }
      continue;
    }
    if (buf !== '' && buf.length + p.length + 2 > maxChars) {
      flush();
    }
    buf += (buf === '' ? '' : '\n\n') + p;
  }
  flush();
  return packed;
}

function hardSlice(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}

export function buildSourceDocFromText(rawTitle: string, rawText: string): SourceDoc {
  const text = normalizeText(rawText);
  let title = rawTitle.trim();
  if (title === '') {
    const firstHeading = text.split('\n').find((l) => /^#{1,6}\s+/.test(l.trim()));
    title = firstHeading != null
      ? firstHeading.replace(/^#{1,6}\s+/, '').trim()
      : (text.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 60);
  }

  const sections = splitByHeadings(text);
  const chunks: SourceChunk[] = [];
  let truncated = false;
  const appendChunks = (headingPath: string | undefined, body: string): void => {
    for (const piece of packParagraphs(body, MAX_CHUNK_CHARS)) {
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true;
        return;
      }
      chunks.push({ id: `c${chunks.length + 1}`, headingPath, text: piece });
    }
  };
  if (sections.length === 0) {
    appendChunks(undefined, text);
  } else {
    for (const s of sections) {
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true;
        break;
      }
      appendChunks(s.headingPath, s.body);
    }
  }
  return { title: title !== '' ? title : 'Untitled', chunks, truncated: truncated || undefined };
}

/* ==================== 链接抓取（P1） ==================== */

/**
 * GitHub 链接 → raw.githubusercontent.com 直链（返回 null 表示非 GitHub 或
 * 已无需转换）。转换规则：
 *   github.com/{o}/{r}/blob/{branch}/path  → raw.githubusercontent.com/{o}/{r}/{branch}/path
 *   github.com/{o}/{r}/raw/{branch}/path   → raw.githubusercontent.com/{o}/{r}/{branch}/path
 *   github.com/{o}/{r}（仓库根）           → raw.githubusercontent.com/{o}/{r}/HEAD/README.md
 *   raw.githubusercontent.com/...          → 原样返回
 */
export function githubRawUrl(input: string): string | null {
  const url = input.trim();
  if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(url)) return url;
  const m = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)(?:\/(blob|raw)(?:\/([^/\s]+))?(\/[^\s]*)?)?\/?$/i);
  if (m == null) return null;
  const [, owner, repo, kind, branch, path] = m;
  if (kind != null) {
    // blob/raw：缺 branch 时（路径形如 /blob/main/… 不会缺）按根 README 处理
    if (branch == null || path == null) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${path}`;
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`;
}

const STRIP_SELECTORS = 'script, style, noscript, svg, iframe, nav, header, footer, aside, form, button, link, meta';

/** 单行化：折叠空白 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 轻量正文提取：DOMParser 解析 → 剪掉导航/脚本/页头尾 → 找主内容容器 →
 * 标题转 Markdown 标记行、段落/列表项转正文行。返回的 text 直接可进
 * buildSourceDocFromText 的分块器。供浏览器/桌面渲染层使用（依赖 DOMParser）。
 */
export function extractReadableText(html: string): { title: string; text: string } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const el of Array.from(parsed.querySelectorAll(STRIP_SELECTORS))) {
    el.remove();
  }
  const docTitle = oneLine(parsed.title ?? '');
  const container =
    parsed.querySelector('main') ??
    parsed.querySelector('article') ??
    parsed.querySelector('[role="main"]') ??
    parsed.querySelector('#main-content, #content, .main-content, .content') ??
    parsed.body;

  const lines: string[] = [];
  const seen = new Set<string>();
  const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th, figcaption, dd, dt';
  for (const el of Array.from(container.querySelectorAll(BLOCKS))) {
    // 跳过"容器型"命中（内部还有更细的块），避免 td/p 嵌套重复计数
    if (el.querySelector(BLOCKS) != null) continue;
    const tag = el.tagName.toLowerCase();
    const text = oneLine(el.textContent ?? '');
    if (text.length < 2) continue;
    let line: string;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      line = `${'#'.repeat(level)} ${text}`;
    } else if (tag === 'li') {
      line = `- ${text}`;
    } else {
      line = text;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 2000) break;
  }

  return { title: docTitle, text: lines.join('\n\n') };
}

export type FetchDocResult =
  | { ok: true; doc: SourceDoc; finalUrl: string }
  | { ok: false; kind: 'http' | 'network' | 'timeout'; status?: number; detail: string };

const FETCH_TIMEOUT_MS = 30000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
/** 正文低于该字符数视为"抓得太薄",触发公共抓取代理兜底 */
const MIN_TEXT_CHARS = 300;

/** 默认公共抓取代理:返回页面的 Markdown 正文(含标题),可绕过
 *  大多数反爬与 CORS 限制。免费但有限流;URL 会发送给第三方服务。
 *  可在设置中替换为自建代理(境内建议),留空禁用。 */

/** 解析 r.jina.ai 输出:Title: … / URL Source: … / Markdown Content: … */
function parseJinaMarkdown(body: string): { title: string; text: string } {
  const titleMatch = body.match(/^Title:\s*(.+)$/m);
  const title = titleMatch != null ? oneLine(titleMatch[1]).slice(0, 120) : '';
  const marker = body.indexOf('Markdown Content:');
  const text = marker >= 0 ? body.slice(marker + 'Markdown Content:'.length).trim() : body.trim();
  return { title, text };
}

/** B 站视频页:提取 BV 号;公开 view API 可拿标题/简介(字幕需登录,不在范围) */
function bilibiliBvid(url: string): string | null {
  const m = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i);
  return m != null ? m[1] : null;
}

interface FetchedBody {
  ok: boolean;
  kind?: 'http' | 'network' | 'timeout';
  status?: number;
  detail?: string;
  body?: string;
  via: 'direct' | 'proxy';
  finalUrl: string;
}

async function fetchWithFallback(
  targetUrl: string,
  timeoutMs: number,
  allowProxy: boolean,
  proxyPrefix: string
): Promise<FetchedBody> {
  const direct = await transportGet(targetUrl, timeoutMs);
  const directUsable =
    direct.ok && direct.status < 400 && direct.body.trim().length >= MIN_TEXT_CHARS;
  const directHttpError = direct.ok && direct.status >= 400;
  // 明确的 HTTP 错误(404/5xx)不触发代理——抓错误页没有意义
  if (directUsable || directHttpError || !allowProxy) {
    if (directHttpError) {
      return {
        ok: false,
        kind: 'http',
        status: direct.status,
        detail: direct.body.slice(0, 300),
        via: 'direct',
        finalUrl: targetUrl,
      };
    }
    return {
      ok: direct.ok,
      body: direct.ok ? direct.body : undefined,
      via: 'direct',
      finalUrl: targetUrl,
    };
  }
  // 兜底:公共抓取代理(返回 Markdown 正文)
  const proxied = await transportGet(proxyPrefix + targetUrl, timeoutMs + 15000);
  if (proxied.ok && proxied.status < 400 && proxied.body.trim().length >= MIN_TEXT_CHARS / 2) {
    return { ok: true, body: proxied.body, via: 'proxy', finalUrl: proxyPrefix + targetUrl };
  }
  // 两者都失败:优先汇报直连的错误(更有诊断价值),代理信息附加
  if (!direct.ok) {
    return { ok: false, kind: direct.kind, detail: direct.detail, via: 'direct', finalUrl: targetUrl };
  }
  return {
    ok: false,
    kind: 'http',
    detail: `直连内容过薄且代理抓取失败(${proxied.ok ? `HTTP ${proxied.status}` : proxied.kind ?? '未知错误'})`,
    via: 'proxy',
    finalUrl: targetUrl,
  };
}

/**
 * 抓取链接 → SourceDoc。抓取链:
 *   1. GitHub 链接转 raw 直连(CORS 开放);
 *   2. 其余 URL 直连(浏览器受 CORS 限制,桌面版无碍);
 *   3. 直连失败或正文过薄 → r.jina.ai 公共代理(返回 Markdown 正文)。
 * B 站视频页特判:合并 view API 元数据(标题/简介,字幕不在抓取范围)。
 */
export async function buildSourceDocFromUrl(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  proxyPrefix: string = 'https://r.jina.ai/'
): Promise<FetchDocResult> {
  const trimmed = url.trim();
  const bvid = bilibiliBvid(trimmed);
  const raw = githubRawUrl(trimmed);
  const finalUrl = raw ?? trimmed;
  const isMarkdown = raw != null || /\.md($|[?#])/i.test(finalUrl);

  const allowProxy = proxyPrefix.trim() !== '';
  const fetched = await fetchWithFallback(finalUrl, timeoutMs, allowProxy, proxyPrefix.trim());
  if (!fetched.ok) {
    return { ok: false, kind: fetched.kind ?? 'http', status: fetched.status, detail: fetched.detail ?? '' };
  }
  const body = fetched.body != null && fetched.body.length > MAX_HTML_BYTES
    ? fetched.body.slice(0, MAX_HTML_BYTES)
    : fetched.body ?? '';

  let title = '';
  let text: string;
  if (fetched.via === 'proxy') {
    // 代理返回的是 Markdown(含 Title: 头)
    const parsed = parseJinaMarkdown(body);
    title = parsed.title;
    text = parsed.text;
  } else if (isMarkdown) {
    text = body;
    const firstHeading = body.split('\n').find((l) => /^#{1,6}\s+/.test(l.trim()));
    if (firstHeading != null) title = oneLine(firstHeading.replace(/^#{1,6}\s+/, '')).slice(0, 120);
  } else {
    const extracted = extractReadableText(body);
    title = extracted.title;
    text = extracted.text;
  }

  // B 站视频:合并 view API 元数据(标题/简介/UP 主)
  if (bvid != null) {
    const apiRes = await transportGet(`${proxyPrefix}https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, timeoutMs);
    if (apiRes.ok && apiRes.status < 400) {
      try {
        const json = JSON.parse(apiRes.body) as { data?: { title?: string; desc?: string; owner?: { name?: string } } };
        const vTitle = json.data?.title != null ? String(json.data.title) : '';
        const desc = json.data?.desc != null ? String(json.data.desc) : '';
        const owner = json.data?.owner?.name != null ? String(json.data.owner.name) : '';
        if (title === '' && vTitle !== '') title = `${vTitle} (${owner})`;
        if (desc !== '') text = `${vTitle}\n\n${desc}\n\n${text}`.trim();
      } catch {
        // API 响应非 JSON:忽略,继续用页面内容
      }
    }
  }

  if (text.trim() === '') {
    return { ok: false, kind: 'http', status: fetched.status, detail: 'No readable content extracted.' };
  }
  const host = (() => {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return 'Untitled';
    }
  })();
  const doc = buildSourceDocFromText(title !== '' ? title : host, text);
  doc.url = trimmed;
  return { ok: true, doc, finalUrl };
}
