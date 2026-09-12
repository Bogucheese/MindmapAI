/**
 * 链接抓取工具测试（P1）。
 * - githubRawUrl / buildSourceDocFromUrl（.md 路径）：纯 node 环境即可；
 * - extractReadableText 依赖 DOMParser，放 happy-dom 环境的独立用例。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSourceDocFromUrl, fetchWithRelay, githubRawUrl } from '../src/agent/tools';

describe('githubRawUrl', () => {
  it('converts blob URLs', () => {
    expect(githubRawUrl('https://github.com/microsoft/ai-agents-for-beginners/blob/main/01-intro-to-ai-agents/README.md')).toBe(
      'https://raw.githubusercontent.com/microsoft/ai-agents-for-beginners/main/01-intro-to-ai-agents/README.md'
    );
  });

  it('converts repo root to HEAD README', () => {
    expect(githubRawUrl('https://github.com/microsoft/ai-agents-for-beginners')).toBe(
      'https://raw.githubusercontent.com/microsoft/ai-agents-for-beginners/HEAD/README.md'
    );
    expect(githubRawUrl('https://github.com/microsoft/ai-agents-for-beginners/')).toBe(
      'https://raw.githubusercontent.com/microsoft/ai-agents-for-beginners/HEAD/README.md'
    );
  });

  it('converts /raw/ URLs and passes raw.githubusercontent through', () => {
    expect(githubRawUrl('https://github.com/o/r/raw/main/docs/a.md')).toBe(
      'https://raw.githubusercontent.com/o/r/main/docs/a.md'
    );
    expect(githubRawUrl('https://raw.githubusercontent.com/o/r/main/README.md')).toBe(
      'https://raw.githubusercontent.com/o/r/main/README.md'
    );
  });

  it('returns null for non-GitHub URLs', () => {
    expect(githubRawUrl('https://learn.microsoft.com/en-us/shows/ai-agents-for-beginners/')).toBeNull();
    expect(githubRawUrl('not a url')).toBeNull();
  });
});

describe('buildSourceDocFromUrl (local http server, markdown path)', () => {
  let server: Server;
  let baseUrl: string;
  const MARKDOWN = [
    '# Lesson One',
    '',
    '## Defining AI Agents',
    '',
    'AI agents are systems that let LLMs act in an environment, with sensors, actuators, tools and memory.',
    'They differ from plain chatbots because they can plan multi-step work and call external capabilities.',
    '',
    '## When to Use',
    '',
    'Agents shine for open-ended problems and multi-step tool-using processes, where a single completion is not enough.',
    'They also fit systems that must improve over time with feedback and memory.',
    'For narrow single-turn tasks a plain LLM call is simpler, cheaper and easier to test than an agent loop.',
  ].join('\n');

  beforeEach(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/lesson.md') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(MARKDOWN);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('nope');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches markdown, derives title and chunks by headings', async () => {
    const r = await buildSourceDocFromUrl(`${baseUrl}/lesson.md`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.title).toBe('Lesson One');
    expect(r.doc.chunks.map((c) => c.headingPath)).toEqual(['Defining AI Agents', 'When to Use']);
    expect(r.doc.chunks[0].text).toContain('act in an environment');
    expect(r.doc.url).toBe(`${baseUrl}/lesson.md`);
  });

  it('maps 404 to an http failure with status', async () => {
    const r = await buildSourceDocFromUrl(`${baseUrl}/missing.md`);
    expect(r).toMatchObject({ ok: false, kind: 'http', status: 404 });
  });
});

describe('buildSourceDocFromUrl (same-origin relay fallback)', () => {
  let server: Server;
  let baseUrl: string;
  let hostile: Server;
  let deadPort: number;
  let relayHits: number;
  let relayMode: 'ok' | '404';
  const MARKDOWN = [
    '# Relay Lesson',
    '',
    '## Relay Section',
    '',
    'The same-origin relay is served by the local start.mjs server and relays the raw upstream body.',
    'Direct browser fetches to the target fail, so the relay response is what gets chunked here.',
    'The body must exceed the minimum usable length threshold, otherwise the fetch chain treats it',
    'as too thin and keeps falling through to the public proxy fallback instead of using it.',
  ].join('\n');

  beforeEach(async () => {
    relayHits = 0;
    relayMode = 'ok';
    // 直连目标:持续监听但立即断连——端口保持占用(不会被 listen(0) 复用),
    // 连接建立即被切断,等效于浏览器 CORS 拦截(transport 层表现为 network 失败)
    hostile = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.destroy();
    });
    await new Promise<void>((resolve) => hostile.listen(0, '127.0.0.1', resolve));
    deadPort = (hostile.address() as AddressInfo).port;

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/target.md') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(MARKDOWN);
        return;
      }
      if (url.pathname === '/mm-fetch-proxy') {
        relayHits++;
        if (relayMode === '404') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('no relay here');
          return;
        }
        expect(url.searchParams.get('url')).toBe(`http://127.0.0.1:${deadPort}/target.md`);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(MARKDOWN);
        return;
      }
      if ((req.url ?? '').startsWith('/proxy/')) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Title: Proxied Title\n\nMarkdown Content:\n${MARKDOWN}`);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('nope');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => hostile.close(() => resolve()));
  });

  it('falls back to the same-origin relay when direct fetch fails', async () => {
    const r = await buildSourceDocFromUrl(
      `http://127.0.0.1:${deadPort}/target.md`,
      undefined,
      `${baseUrl}/proxy/`,
      baseUrl
    );
    expect(relayHits).toBe(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.title).toBe('Relay Lesson');
    expect(r.doc.chunks.map((c) => c.headingPath)).toEqual(['Relay Section']);
    expect(r.doc.url).toBe(`http://127.0.0.1:${deadPort}/target.md`);
  });

  it('skips the relay when the direct fetch succeeds', async () => {
    const r = await buildSourceDocFromUrl(`${baseUrl}/target.md`, undefined, `${baseUrl}/proxy/`, baseUrl);
    expect(relayHits).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('falls through to the public proxy when the relay is unavailable (404)', async () => {
    relayMode = '404';
    const r = await buildSourceDocFromUrl(
      `http://127.0.0.1:${deadPort}/target.md`,
      undefined,
      `${baseUrl}/proxy/`,
      baseUrl
    );
    expect(relayHits).toBe(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.title).toBe('Proxied Title');
  });

  it('fetchWithRelay: returns the relay body when the direct fetch fails', async () => {
    const r = await fetchWithRelay(`http://127.0.0.1:${deadPort}/target.md`, 5000, baseUrl);
    expect(r).toMatchObject({ ok: true, status: 200 });
    if (!r.ok) return;
    expect(r.body).toContain('Relay Lesson');
  });

  it('fetchWithRelay: keeps the direct error when the relay is unusable', async () => {
    relayMode = '404';
    const r = await fetchWithRelay(`http://127.0.0.1:${deadPort}/target.md`, 5000, baseUrl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('network');
  });
});
