/**
 * Agent 事件流测试:注入假 chat,断言管线把各阶段真实中间产物
 * (要点原文+引文、autotune 理由、评审分数+评语、回炉原因、完成摘要)
 * 以自包含事件推送——侧边栏面板据此渲染"AI 思考过程"。
 */

import { describe, expect, it, vi } from 'vitest';
import { generateMindmapFromSource } from '../src/agent/pipeline';
import type { AgentEvent } from '../src/agent/events';
import type { ChatResult } from '../src/ai/client';
import { DEFAULT_GENERATION } from '../src/ai/prompts';
import type { SourceDoc } from '../src/agent/types';

const SETTINGS = { baseUrl: 'http://mock.local', model: 'test-model', temperature: 1.0, fetchProxyPrefix: '' };
const API_KEY = 'test-key';

type ChatFn = NonNullable<Parameters<typeof generateMindmapFromSource>[4]>['chat'];

function sequenceChat(script: Array<string>): { chat: ChatFn } {
  let calls = 0;
  const chat = vi.fn(async (): Promise<ChatResult> => {
    const content = script[Math.min(calls, script.length - 1)];
    calls += 1;
    return { ok: true, content, model: 'test-model' };
  }) as unknown as ChatFn;
  return { chat };
}

const doc2Chunks: SourceDoc = {
  title: 'Doc',
  chunks: [
    { id: 'c1', text: 'chunk one' },
    { id: 'c2', text: 'chunk two' },
  ],
};

describe('agent event stream', () => {
  it('emits distilled note content, autotune, critique and done summary', async () => {
    const { chat } = sequenceChat([
      JSON.stringify({ notes: [{ id: 'n1', content: 'Point A', quote: 'quote a' }] }),
      JSON.stringify({ notes: [{ id: 'n2', content: 'Point B', quote: 'quote b' }] }),
      JSON.stringify({ depth: 4, maxChildren: 6, maxNodes: 48, reason: 'dense source' }),
      JSON.stringify({ label: 'Root', children: [{ label: 'A', source: { noteIds: ['n1'] } }] }),
      JSON.stringify({ scores: { grounding: 90, coverage: 85, specificity: 80, structure: 88 }, overall: 86, verdict: 'pass', feedback: 'fine' }),
    ]);
    const events: AgentEvent[] = [];
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, {
      chat,
      autoConstraints: true,
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);

    // 阶段分组事件
    expect(events.some((e) => e.type === 'stage' && e.stage === 'distill')).toBe(true);
    expect(events.some((e) => e.type === 'stage' && e.stage === 'architect')).toBe(true);
    expect(events.some((e) => e.type === 'stage' && e.stage === 'critique')).toBe(true);

    // 提炼事件:每块一条,带要点原文与逐字引文
    const notesEvents = events.filter((e): e is Extract<AgentEvent, { type: 'notes' }> => e.type === 'notes');
    expect(notesEvents).toHaveLength(2);
    expect(notesEvents[0]).toMatchObject({ chunk: 1, total: 2, notes: [{ content: 'Point A', quote: 'quote a' }] });
    expect(notesEvents[1]).toMatchObject({ chunk: 2, notes: [{ content: 'Point B' }] });

    // autotune 事件带选择理由
    const autotune = events.find((e): e is Extract<AgentEvent, { type: 'autotune' }> => e.type === 'autotune');
    expect(autotune).toMatchObject({ depth: 4, maxChildren: 6, maxNodes: 48, reason: 'dense source' });

    // 评审事件:四维分数 + 结论 + 评语原文
    const critique = events.find((e): e is Extract<AgentEvent, { type: 'critique' }> => e.type === 'critique');
    expect(critique?.scores.structure).toBe(88);
    expect(critique?.verdict).toBe('pass');
    expect(critique?.feedback).toBe('fine');

    // 完成摘要
    const done = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done');
    expect(done?.summary).toMatch(/2 notes · \d+ nodes/);
  });

  it('emits a revise event carrying the reviewer feedback when verdict is revise', async () => {
    const { chat } = sequenceChat([
      JSON.stringify({ notes: [{ id: 'n1', content: 'Point A', quote: 'q' }] }),
      JSON.stringify({ notes: [] }),
      JSON.stringify({ label: 'Root', children: [{ label: 'A', source: { noteIds: ['n1'] } }] }),
      JSON.stringify({ scores: { grounding: 80, coverage: 60, specificity: 75, structure: 82 }, overall: 74, verdict: 'revise', feedback: 'missing a major theme' }),
      JSON.stringify({ label: 'Root', children: [{ label: 'A2', source: { noteIds: ['n1'] } }] }),
    ]);
    const events: AgentEvent[] = [];
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, {
      chat,
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    const revise = events.find((e): e is Extract<AgentEvent, { type: 'revise' }> => e.type === 'revise');
    expect(revise?.feedback).toBe('missing a major theme');
  });
});
