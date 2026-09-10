/**
 * Agent 扩展测试:图表 Agent 循环(submit_chart 校验反馈)与命令 Agent
 * (工具修改当前树)。
 */

import { describe, expect, it, vi } from 'vitest';
import { runAgentChart } from '../src/agent/agent-chart';
import { runAgentCommand } from '../src/agent/agent-command';
import type { AgentEvent } from '../src/agent/events';
import type { ChatResult } from '../src/ai/client';
import type { ToolCallRequest } from '../src/ai/client';
import type { MindmapTree } from '../src/ai/schema';
import type { SourceDoc } from '../src/agent/types';

const SETTINGS = { baseUrl: 'http://mock.local', model: 'test-model', temperature: 0.5, fetchProxyPrefix: '' };
const API_KEY = 'test-key';

type ToolsChat = (typeof import('../src/ai/client').chatWithTools);

function toolsChat(script: Array<Array<{ name: string; args: Record<string, unknown> }>>): ToolsChat {
  let calls = 0;
  return vi.fn(async (): Promise<{ ok: true; content: string; toolCalls: ToolCallRequest[]; model: string }> => {
    const step = script[Math.min(calls, script.length - 1)];
    calls += 1;
    return {
      ok: true,
      content: '',
      toolCalls: step.map((c, i) => ({ id: `c${calls}-${i}`, name: c.name, arguments: JSON.stringify(c.args) })),
      model: 'test-model',
    };
  }) as unknown as ToolsChat;
}

function distillChatWith(notes: Array<{ id: string; content: string }>): unknown {
  return vi.fn(async (): Promise<ChatResult> => ({
    ok: true,
    content: JSON.stringify({ notes: notes.map((n) => ({ ...n, quote: 'q' })) }),
    model: 'test-model',
  }));
}

const doc1: SourceDoc = { title: 'Doc', chunks: [{ id: 'c1', text: 'chunk' }] };

describe('runAgentChart', () => {
  it('reads notes then submits valid slots; invalid submissions get feedback', async () => {
    const chat = toolsChat([
      [{ name: 'read_notes', args: { query: 'x' } }],
      [{ name: 'submit_chart', args: { slots: { center: 'X', outer: ['只有一项'] } } }],
      [{ name: 'submit_chart', args: { slots: { center: 'X', outer: ['a', 'b', 'c', 'd', 'e', 'f'] } } }],
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgentChart(SETTINGS, API_KEY, 'circle', { topic: 'T', doc: doc1 }, {
      distillChat: distillChatWith([{ id: 'n1', content: 'x content' }]) as never,
      chat,
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.elements.filter((e) => e.kind === 'vertex').length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === 'notes' && e.notes[0]?.content === 'x content')).toBe(true);
    expect(events.filter((e) => e.type === 'tool' && e.name === 'submit_chart')).toHaveLength(2);
    expect(events.some((e) => e.type === 'done' && e.summary.includes('圆圈图'))).toBe(true);
  });
});

describe('runAgentCommand', () => {
  const tree: MindmapTree = {
    label: 'Root',
    children: [{ label: 'A' }, { label: 'B' }],
  };

  it('applies the requested rename via update_node', async () => {
    const chat = toolsChat([
      [{ name: 'update_node', args: { id: 'n2', label: 'A2' } }],
      [{ name: 'finish_changes', args: { reply: 'renamed' } }],
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgentCommand(SETTINGS, API_KEY, { instruction: '把 A 改名为 A2', tree, notes: [] }, {
      chat,
      onEvent: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.children![0].label).toBe('A2');
    expect(result.reply).toBe('renamed');
    expect(events.some((e) => e.type === 'tool' && e.name === 'update_node')).toBe(true);
  });

  it('adds and removes nodes; root removal is rejected', async () => {
    const chat = toolsChat([
      [{ name: 'add_node', args: { parent: 'r', label: 'C' } }],
      [
        { name: 'remove_node', args: { id: 'n2' } },
        { name: 'remove_node', args: { id: 'r' } },
      ],
      [{ name: 'finish_changes', args: { reply: 'ok' } }],
    ]);
    const result = await runAgentCommand(SETTINGS, API_KEY, { instruction: 'restructure', tree, notes: [] }, { chat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.children!.map((c) => c.label)).toContain('C');
    expect(result.tree.children!.map((c) => c.label)).not.toContain('A');
  });
});
