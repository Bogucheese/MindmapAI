/**
 * Electron 桥路径测试：mock window.electron.request，验证密钥 IPC 与
 * mmAiFetch 网络转发（成功/超时/IPC 错误三类），并确认未回退到 fetch。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiKey, getApiKey, setApiKey } from '../src/settings/secure-store';
import { generateMindmapTree, testConnection } from '../src/ai/client';
import { DEFAULT_GENERATION } from '../src/ai/prompts';

interface CapturedMsg {
  action: string;
  [key: string]: unknown;
}

type Responder = (msg: CapturedMsg) => unknown;

let captured: CapturedMsg[];
let responder: Responder | null;

function stubElectronWindow(): void {
  (globalThis as unknown as { window: unknown }).window = {
    electron: {
      request: (msg: CapturedMsg, cb: (data: unknown) => void, err: (msg: string) => void) => {
        captured.push(msg);
        if (responder == null) {
          err('no responder configured');
          return;
        }
        const data = responder(msg);
        if (data instanceof Error) {
          err(data.message);
        } else {
          cb(data);
        }
      },
    },
  };
}

const openaiBody = (content: string): string =>
  JSON.stringify({
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });

const goodTree = JSON.stringify({ label: 'Root', children: [{ label: 'A' }] });

const SETTINGS = { baseUrl: 'https://api.test', model: 'deepseek-chat', temperature: 1.0, fetchProxyPrefix: 'https://r.jina.ai/' };

describe('secure-store over electron bridge', () => {
  beforeEach(() => {
    captured = [];
    responder = null;
    stubElectronWindow();
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('setApiKey sends mmAiSetSecret and getApiKey reads it back', async () => {
    responder = (msg) => {
      if (msg.action === 'mmAiSetSecret') return { ok: true, encrypted: true };
      if (msg.action === 'mmAiGetSecret') return { apiKey: 'sk-abc', encrypted: true };
      return new Error('unexpected action ' + String(msg.action));
    };
    await setApiKey('sk-abc');
    expect(captured[0].action).toBe('mmAiSetSecret');
    expect(captured[0].apiKey).toBe('sk-abc');
    await expect(getApiKey()).resolves.toBe('sk-abc');
  });

  it('clearApiKey sends mmAiDeleteSecret', async () => {
    responder = () => ({ ok: true });
    await clearApiKey();
    expect(captured[0].action).toBe('mmAiDeleteSecret');
  });

  it('bridge errors reject the promise', async () => {
    responder = () => new Error('boom');
    await expect(setApiKey('x')).rejects.toThrow('boom');
  });
});

describe('client over electron bridge (mmAiFetch)', () => {
  beforeEach(() => {
    captured = [];
    responder = null;
    stubElectronWindow();
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('testConnection posts via mmAiFetch and reports success', async () => {
    responder = (msg) => {
      expect(msg.action).toBe('mmAiFetch');
      expect(msg.url).toBe('https://api.test/chat/completions');
      expect((msg.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      return { ok: true, status: 200, body: openaiBody('Hi') };
    };
    const r = await testConnection(SETTINGS, 'test-key');
    expect(r.ok).toBe(true);
    expect(r.model).toBe('deepseek-chat');
  });

  it('maps HTTP errors from the bridge body', async () => {
    responder = () => ({ ok: true, status: 401, body: JSON.stringify({ error: { message: 'bad key' } }) });
    const r = await testConnection(SETTINGS, 'bad');
    expect(r).toMatchObject({ ok: false, kind: 'http', status: 401 });
    expect(r.detail).toContain('bad key');
  });

  it('maps bridge timeouts', async () => {
    responder = () => ({ ok: false, timeout: true, detail: '' });
    const r = await generateMindmapTree(SETTINGS, 'k', 'T', DEFAULT_GENERATION);
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('maps IPC errors to network failures', async () => {
    responder = () => new Error('main process exploded');
    const r = await generateMindmapTree(SETTINGS, 'k', 'T', DEFAULT_GENERATION);
    expect(r).toMatchObject({ ok: false, kind: 'network' });
  });

  it('generates a full tree through the bridge', async () => {
    responder = () => ({ ok: true, status: 200, body: openaiBody(goodTree) });
    const r = await generateMindmapTree(SETTINGS, 'k', 'T', DEFAULT_GENERATION);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tree.label).toBe('Root');
  });
});
