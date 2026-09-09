/**
 * 链接抓取工具测试（P1）。
 * - githubRawUrl / buildSourceDocFromUrl（.md 路径）：纯 node 环境即可；
 * - extractReadableText 依赖 DOMParser，放 happy-dom 环境的独立用例。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSourceDocFromUrl, githubRawUrl } from '../src/agent/tools';

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
