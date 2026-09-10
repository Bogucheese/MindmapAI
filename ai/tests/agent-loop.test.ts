/**
 * Agent 循环测试:注入脚本化 chatWithTools + chatWithJsonFallback,
 * 断言模型自主装配的树、事件流、自检修正轮与硬上限行为。
 */

import { describe, expect, it, vi } from 'vitest';
import { runAgentGeneration } from '../src/agent/agent-loop';
import type { AgentEvent } from '../src/agent/events';
import type { ChatResult } from '../src/ai/client';
import type { SourceDoc } from '../src/agent/types';

const SETTINGS = { baseUrl: 'http://mock.local', model: 'test-model', temperature: 0.5, fetchProxyPrefix: '' };
const API_KEY = 'test-key';

const doc1: SourceDoc = {
  title: 'Doc',
  chunks: [{ id: 'c1', text: 'chunk one' }],
};

interface Step {
  name: string;
  args: Record<string, unknown>;
}

function toolsChat(script: Array<Step[]>): { chat: ReturnType<typeof vi.fn>; calls: () => number } {
  let calls = 0;
  const chat = vi.fn(async (): Promise<ChatResult & { toolCalls: never[] }> => {
    throw new Error('placeholder');
  });
  // 重新赋值以拿到正确类型签名(chatWithTools 的返回含 toolCalls)
  const impl = async (): Promise<{ ok: true; content: string; toolCalls: Array<{ id: string; name: string; arguments: string }>; model: string }> => {
    const step = script[Math.min(calls, script.length - 1)];
    calls += 1;
    return {
      ok: true,
      content: '',
      toolCalls: step.map((c, i) => ({ id: `c${calls}-${i}`, name: c.name, arguments: JSON.stringify(c.args) })),
      model: 'test-model',
    };
  };
  (chat as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(impl);
  return { chat, calls: () => calls };
}

const BASE_OPTS = {
  depth: 4,
  maxChildren: 8,
  maxNodes: 60,
  language: 'auto' as const,
};

describe('runAgentGeneration', () => {
  it('lets the model assemble the tree node by node and emits node/tool events', async () => {
    const { chat } = toolsChat([
      [{ name: 'read_notes', args: { query: 'point' } }],
      [{ name: 'add_node', args: { parent: null, label: 'Root' } }],
      [{ name: 'add_node', args: { parent: 'a1', label: 'Point A', noteIds: ['n1'] } }],
      [{ name: 'finish_map', args: { summary: 'built a small map' } }],
    ]);
    const distillChat = vi.fn(async (): Promise<ChatResult> => ({
      ok: true,
      content: JSON.stringify({ notes: [{ id: 'n1', content: 'Point A content', quote: 'q1' }] }),
      model: 'test-model',
    }));
    const events: AgentEvent[] = [];
    const result = await runAgentGeneration(SETTINGS, API_KEY, { topic: 'T', doc: doc1 }, {
      ...BASE_OPTS,
      chat: chat as unknown as typeof import('../src/ai/client').chatWithTools,
      distillChat: distillChat as unknown as Parameters<typeof runAgentGeneration>[3]['distillChat'],
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.label).toBe('Root');
    expect(result.tree.children).toHaveLength(1);
    expect(result.tree.children![0]).toMatchObject({ label: 'Point A' });
    expect(result.tree.children![0].source).toEqual({ noteIds: ['n1'] });
    expect(result.stats.nodes).toBe(2);
    expect(result.summary).toBe('built a small map');
    // 事件流:要点原文 / 节点放置 / 工具调用都可见
    expect(events.some((e) => e.type === 'notes' && e.notes[0]?.content === 'Point A content')).toBe(true);
    expect(events.some((e) => e.type === 'node' && e.label === 'Point A' && e.depth === 1)).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.name === 'read_notes')).toBe(true);
    expect(events.some((e) => e.type === 'done' && e.summary.includes('built'))).toBe(true);
  });

  it('auto-merges same-parent duplicates and runs a self-fix round on cross-branch duplicates', async () => {
    // 同级同名由去重自动合并;跨分支重复(两个分支下都有"记忆")触发修正轮
    const { chat } = toolsChat([
      [{ name: 'add_node', args: { parent: null, label: 'Root' } }],
      [
        { name: 'add_node', args: { parent: 'a1', label: '组成' } },
        { name: 'add_node', args: { parent: 'a1', label: '能力' } },
      ],
      [
        { name: 'add_node', args: { parent: 'a2', label: '记忆' } },
        { name: 'add_node', args: { parent: 'a3', label: '记忆' } },
      ],
      [{ name: 'finish_map', args: { summary: 'draft' } }],
      [{ name: 'finish_map', args: { summary: 'fixed' } }],
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgentGeneration(SETTINGS, API_KEY, { topic: 'T' }, {
      ...BASE_OPTS,
      chat: chat as unknown as typeof import('../src/ai/client').chatWithTools,
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.children).toHaveLength(2);
    expect(result.stats.autoFixRounds).toBe(1);
    expect(events.some((e) => e.type === 'info' && e.text.includes('fix'))).toBe(true);
    expect(events.some((e) => e.type === 'done' && e.summary.includes('fixed'))).toBe(true);
  });
  it('stops at the tool-call cap and still returns the partial map', async () => {
    let call = 0;
    const scriptChat = vi.fn(async (): Promise<{ ok: true; content: string; toolCalls: Array<{ id: string; name: string; arguments: string }>; model: string }> => {
      const isRoot = call === 0;
      const step = [
        { id: `t${call}`, name: 'add_node', arguments: JSON.stringify(isRoot ? { parent: null, label: 'Root' } : { parent: 'a1', label: `Node ${call}` }) },
      ];
      call += 1;
      return { ok: true, content: '', toolCalls: step, model: 'test-model' };
    });
    const result = await runAgentGeneration(SETTINGS, API_KEY, { topic: 'T' }, {
      ...BASE_OPTS,
      maxNodes: 5,
      maxToolCalls: 12,
      chat: scriptChat as unknown as typeof import('../src/ai/client').chatWithTools,
    });
    // cap 生效:强制收尾并返回部分成果
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.nodes).toBeLessThanOrEqual(5);
    expect(result.stats.toolCalls).toBeLessThanOrEqual(12);
  });
});
