/**
 * 节点扩展测试：注入假 chat 验证 prompt 装配（路径/兄弟/要点）、
 * 解析约束（maxChildren 截断）、重答修复与取消。
 */

import { describe, expect, it, vi } from 'vitest';
import { expandNodeChildren, type ExpandInput } from '../src/agent/expand';
import type { ChatResult } from '../src/ai/client';
import { DEFAULT_GENERATION } from '../src/ai/prompts';

const SETTINGS = { baseUrl: 'http://mock.local', model: 'test-model', temperature: 1.0, fetchProxyPrefix: 'https://r.jina.ai/' };

type ChatFn = NonNullable<Parameters<typeof expandNodeChildren>[4]>['chat'];

function sequenceChat(script: string[]): { chat: ChatFn; calls: Array<{ messages: unknown[]; opts: unknown }> } {
  const calls: Array<{ messages: unknown[]; opts: unknown }> = [];
  const chat = vi.fn(async (_s: unknown, _k: unknown, messages: unknown[], opts: unknown) => {
    calls.push({ messages, opts });
    const content = script[Math.min(calls.length - 1, script.length - 1)];
    return { ok: true, content, model: 'test-model' } as ChatResult;
  }) as unknown as ChatFn;
  return { chat, calls };
}

const INPUT: ExpandInput = {
  pathLabels: ['AI Agents 第一课', '方案三要素'],
  siblings: ['定义与类型', '适用场景'],
  existingChildren: [],
  notes: [{ id: 'n4', content: 'Agentic 方案三要素', quote: 'Agent Development, Patterns, Frameworks', chunkId: 'c4' }],
};

describe('expandNodeChildren', () => {
  it('builds expand prompt with path, siblings and notes', async () => {
    const { chat, calls } = sequenceChat([
      JSON.stringify({ label: '方案三要素', children: [{ label: '开发平台', source: { noteIds: ['n4'] } }] }),
    ]);
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, { chat });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.children.map((c) => c.label)).toEqual(['开发平台']);
    expect(r.children[0].source?.noteIds).toEqual(['n4']);
    const sys = (calls[0].messages as Array<{ role: string; content: string }>)[0].content;
    const user = (calls[0].messages as Array<{ role: string; content: string }>)[1].content;
    expect(sys).toContain('[MM-STAGE:expand]');
    expect(user).toContain('AI Agents 第一课 > 方案三要素');
    expect(user).toContain('定义与类型');
    expect(user).toContain('[n4]');
    expect((calls[0].opts as { temperature?: number }).temperature).toBe(0.5);
  });

  it('repairs once when the first reply is unparseable', async () => {
    const { chat } = sequenceChat([
      'not json at all',
      JSON.stringify({ label: 'X', children: [{ label: 'A' }, { label: 'B' }] }),
    ]);
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, { chat });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.children.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('truncates children beyond maxChildren via schema constraints', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `C${i}` }));
    const { chat } = sequenceChat([JSON.stringify({ label: 'X', children: many })]);
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, { chat });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.children.length).toBe(DEFAULT_GENERATION.maxChildren);
  });

  it('reports schema failure after a failed repair', async () => {
    const { chat } = sequenceChat(['nope', 'still nope']);
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, { chat });
    expect(r).toMatchObject({ ok: false, kind: 'schema' });
  });

  it('returns children empty when the node has none', async () => {
    const { chat } = sequenceChat([JSON.stringify({ label: 'X' })]);
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, { chat });
    expect(r).toMatchObject({ ok: true, children: [] });
  });

  it('respects cancellation before the call', async () => {
    const chat = vi.fn(async () => ({ ok: true, content: '{}', model: 'm' } as ChatResult)) as unknown as ChatFn;
    const r = await expandNodeChildren(SETTINGS, 'key', INPUT, DEFAULT_GENERATION, {
      chat,
      isCancelled: () => true,
    });
    expect(r).toMatchObject({ ok: false, kind: 'cancelled' });
  });
});
