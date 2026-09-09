/**
 * mock server 集成测试：不需要真实 key（真实 key 联调在 M6）。
 * 覆盖：正常生成、json_object 400 回退、schema 失败重答、重答后仍失败、
 * 超时、HTTP 401。mock 端口随机分配，避免固定端口冲突。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateMindmapTree, testConnection } from '../src/ai/client';
import { DEFAULT_GENERATION } from '../src/ai/prompts';

const SETTINGS = { baseUrl: '', model: 'deepseek-chat', temperature: 1.0, fetchProxyPrefix: 'https://r.jina.ai/' };
const API_KEY = 'test-key-123';

interface RecordedCall {
  auth: string | undefined;
  body: {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    max_tokens?: number;
    response_format?: { type: string };
  };
}

let server: Server;
let baseUrl: string;
let calls: RecordedCall[];
/** 每个请求按序消费一个 handler；耗尽后复用最后一个 */
let handlers: Array<(call: RecordedCall, res: ServerResponse) => void>;

function respondJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function chatPayload(content: string): unknown {
  return {
    id: 'mock',
    object: 'chat.completion',
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

beforeEach(async () => {
  calls = [];
  handlers = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const call: RecordedCall = {
        auth: req.headers.authorization,
        body: raw !== '' ? JSON.parse(raw) : {},
      };
      calls.push(call);
      const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
      handler(call, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  SETTINGS.baseUrl = baseUrl;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('testConnection (mock server)', () => {
  it('reports success with model echo and sends the API key', async () => {
    handlers.push((call, res) => {
      expect(call.body.max_tokens).toBe(1);
      respondJson(res, 200, chatPayload('Hi'));
    });
    const r = await testConnection(SETTINGS, API_KEY);
    expect(r.ok).toBe(true);
    expect(r.model).toBe('deepseek-chat');
    expect(calls[0].auth).toBe(`Bearer ${API_KEY}`);
  });

  it('classifies HTTP 401 with server detail', async () => {
    handlers.push((_call, res) => {
      respondJson(res, 401, { error: { message: 'Authentication Fails' } });
    });
    const r = await testConnection(SETTINGS, 'wrong-key');
    expect(r).toMatchObject({ ok: false, kind: 'http', status: 401 });
    expect(r.detail).toContain('Authentication Fails');
  });
});

describe('generateMindmapTree (mock server)', () => {
  const goodJson = JSON.stringify({
    label: 'Coffee',
    children: [{ label: 'Beans' }, { label: 'Brewing' }],
  });

  it('generates a tree in json_object mode', async () => {
    handlers.push((call, res) => {
      expect(call.body.response_format).toEqual({ type: 'json_object' });
      expect(call.body.messages![0].role).toBe('system');
      expect(call.body.messages![1].content).toContain('Coffee supply chain');
      respondJson(res, 200, chatPayload(goodJson));
    });
    const r = await generateMindmapTree(
      SETTINGS,
      API_KEY,
      'Coffee supply chain',
      DEFAULT_GENERATION
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.label).toBe('Coffee');
      expect(r.stats.nodes).toBe(3);
    }
  });

  it('retries without response_format when the provider rejects it', async () => {
    handlers.push((_call, res) => {
      respondJson(res, 400, { error: { message: 'response_format is not supported' } });
    });
    handlers.push((call, res) => {
      expect(call.body.response_format).toBeUndefined();
      respondJson(res, 200, chatPayload(goodJson));
    });
    const r = await generateMindmapTree(SETTINGS, API_KEY, 'T', DEFAULT_GENERATION);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('re-asks once on schema failure and parses the repaired reply', async () => {
    handlers.push((_call, res) => {
      respondJson(res, 200, chatPayload('Sorry, I cannot help with that.'));
    });
    handlers.push((call, res) => {
      const messages = call.body.messages!;
      expect(messages).toHaveLength(4);
      expect(messages[2].role).toBe('assistant');
      expect(messages[2].content).toContain('Sorry');
      expect(messages[3].role).toBe('user');
      expect(messages[3].content).toContain('ONLY the JSON object');
      respondJson(res, 200, chatPayload(goodJson));
    });
    const r = await generateMindmapTree(SETTINGS, API_KEY, 'T', DEFAULT_GENERATION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tree.label).toBe('Coffee');
  });

  it('fails with kind schema and raw output when the repair also fails', async () => {
    handlers.push((_call, res) => {
      respondJson(res, 200, chatPayload('nope'));
    });
    const r = await generateMindmapTree(SETTINGS, API_KEY, 'T', DEFAULT_GENERATION);
    expect(r).toMatchObject({ ok: false, kind: 'schema', detail: 'unparseable' });
    if (!r.ok) expect(r.raw).toBe('nope');
    expect(calls).toHaveLength(2); // 恰好一次重答，不无限重试
  });

  it('classifies timeouts', async () => {
    handlers.push((_call, res) => {
      setTimeout(() => respondJson(res, 200, chatPayload(goodJson)), 2000);
    });
    const r = await generateMindmapTree(SETTINGS, API_KEY, 'T', DEFAULT_GENERATION, 300);
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('propagates HTTP errors without a repair round', async () => {
    handlers.push((_call, res) => {
      respondJson(res, 402, { error: { message: 'Insufficient Balance' } });
    });
    const r = await generateMindmapTree(SETTINGS, API_KEY, 'T', DEFAULT_GENERATION);
    expect(r).toMatchObject({ ok: false, kind: 'http', status: 402 });
    if (!r.ok) expect(r.detail).toContain('Insufficient Balance');
    expect(calls).toHaveLength(1);
  });
});
