/**
 * Agent 命令:用户在侧边栏输入框对当前画布上的导图下达自然语言指令,
 * Agent 用工具(改标签/加节点/删子树)修改后返回新树与答复文本。
 *
 * 作用域:最近一次 AI 生成的导图树(面板上下文),不是画布上的手工编辑——
 * 重建画布会以上下文树为准。多轮历史 v1 不持久化,当前树本身就是上下文。
 */

import { chatWithTools, type ToolLoopMessage, type ToolSpec } from '../ai/client';
import type { MindmapTree } from '../ai/schema';
import { t } from '../i18n/keys';
import type { AgentEmitter } from './events';
import type { DistilledNote } from './types';
import { dedupeSiblingLabels } from './validate';

interface CmdNode {
  id: string;
  label: string;
  noteIds: string[];
  parent: CmdNode | null;
  children: CmdNode[];
}

export interface AgentCommandOptions {
  onEvent?: AgentEmitter;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  maxToolCalls?: number;
  chat?: typeof chatWithTools;
}

export type AgentCommandResult =
  | { ok: true; tree: MindmapTree; reply: string; stats: { changed: number } }
  | { ok: false; kind: 'cancelled' | 'http' | 'network' | 'timeout' | 'schema'; status?: number; detail: string };

/** 给树节点分配稳定 id(根 r,其余 n1/n2…按 DFS 序)并回填 parent 指针 */
function assignIds(tree: MindmapTree): { root: CmdNode; byId: Map<string, CmdNode> } {
  const byId = new Map<string, CmdNode>();
  let seq = 0;
  const walk = (node: MindmapTree, parent: CmdNode | null): CmdNode => {
    seq += 1;
    const cmd: CmdNode = {
      id: parent == null ? 'r' : `n${seq}`,
      label: node.label,
      noteIds: node.source?.noteIds ?? [],
      parent,
      children: [],
    };
    byId.set(cmd.id, cmd);
    for (const child of node.children ?? []) {
      cmd.children.push(walk(child, cmd));
    }
    return cmd;
  };
  const root = walk(tree, null);
  return { root, byId };
}

function toTree(root: CmdNode): MindmapTree {
  return {
    label: root.label,
    ...(root.noteIds.length > 0 ? { source: { noteIds: root.noteIds } } : {}),
    children: root.children.map(toTree),
  };
}

const indent = (root: CmdNode): string => {
  const lines: string[] = [];
  const walk = (node: CmdNode, pad: string): void => {
    lines.push(`${pad}${node.id}: ${node.label}`);
    for (const child of node.children) walk(child, `${pad}  `);
  };
  walk(root, '');
  return lines.join('\n');
};

export async function runAgentCommand(
  settings: Parameters<typeof chatWithTools>[0],
  apiKey: string,
  input: { instruction: string; tree: MindmapTree; notes: DistilledNote[] },
  opts: AgentCommandOptions = {}
): Promise<AgentCommandResult> {
  const chat = opts.chat ?? chatWithTools;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const maxToolCalls = opts.maxToolCalls ?? 30;
  const isCancelled = () => opts.isCancelled?.() === true;
  const onEvent = opts.onEvent;

  const { root, byId } = assignIds(input.tree);
  let seq = 0;
  let changed = 0;
  let reply = '';
  let finished = false;

  const executeTool = (name: string, rawArgs: string): string => {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
    switch (name) {
      case 'inspect_map':
        return JSON.stringify({ map: indent(root) });
      case 'read_notes':
        return JSON.stringify({
          total: input.notes.length,
          notes: input.notes.slice(0, 60).map((n) => ({ id: n.id, content: n.content })),
        });
      case 'update_node': {
        const node = typeof args.id === 'string' ? byId.get(args.id) : undefined;
        if (node == null) return JSON.stringify({ error: `unknown id: ${String(args.id)}` });
        if (typeof args.label === 'string' && args.label.trim() !== '') {
          node.label = args.label.trim().slice(0, 80);
          changed += 1;
        }
        return JSON.stringify({ id: node.id, label: node.label });
      }
      case 'add_node': {
        const parent = typeof args.parent === 'string' ? byId.get(args.parent) : undefined;
        if (parent == null) return JSON.stringify({ error: `unknown parent id: ${String(args.parent)}` });
        const label = typeof args.label === 'string' ? args.label.trim().slice(0, 80) : '';
        if (label === '') return JSON.stringify({ error: 'label is required' });
        const noteIds = Array.isArray(args.noteIds)
          ? (args.noteIds as unknown[]).filter(
              (id): id is string => typeof id === 'string' && input.notes.some((n) => n.id === id),
            )
          : [];
        seq += 1;
        const node: CmdNode = { id: `n${seq}`, label, noteIds: Array.from(new Set(noteIds)), parent, children: [] };
        byId.set(node.id, node);
        parent.children.push(node);
        changed += 1;
        return JSON.stringify({ id: node.id });
      }
      case 'remove_node': {
        const node = typeof args.id === 'string' ? byId.get(args.id) : undefined;
        if (node == null) return JSON.stringify({ error: `unknown id: ${String(args.id)}` });
        if (node.parent == null) return JSON.stringify({ error: 'the root cannot be removed' });
        node.parent.children.splice(node.parent.children.indexOf(node), 1);
        changed += 1;
        return JSON.stringify({ removed: true });
      }
      case 'finish_changes': {
        finished = true;
        reply = typeof args.reply === 'string' ? args.reply.slice(0, 500) : '';
        return JSON.stringify({ accepted: true });
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  };

  const specs: ToolSpec[] = [
    {
      type: 'function',
      function: {
        name: 'inspect_map',
        description: 'See the current map as an indented tree with node ids.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_notes',
        description: 'Read the knowledge points extracted when the map was generated.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_node',
        description: 'Rename a node.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' }, label: { type: 'string' } },
          required: ['id', 'label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_node',
        description: 'Add a child node under the given parent id.',
        parameters: {
          type: 'object',
          properties: {
            parent: { type: 'string' },
            label: { type: 'string' },
            noteIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['parent', 'label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remove_node',
        description: 'Remove a node and its subtree (root cannot be removed).',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish_changes',
        description: 'Declare the requested changes complete; reply is shown to the user.',
        parameters: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
      },
    },
  ];

  const messages: ToolLoopMessage[] = [
    {
      role: 'system',
      content: [
        '[MM-STAGE:agent-command]',
        'You are a senior information designer editing an existing mind map on a user\u2019s request.',
        'Use the tools to apply exactly the requested changes (plus minimal collateral edits for consistency, e.g. terminology).',
        'Quality rules: ONE term per concept; siblings same-dimension; no duplicates; labels under 20 characters.',
        'When done, call finish_changes with a one-sentence reply (same language as the user).',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Instruction: ${input.instruction}\n\nCurrent map:\n${indent(root)}`,
    },
  ];

  let toolCallsUsed = 0;
  let noToolStreak = 0;
  while (toolCallsUsed < maxToolCalls && !finished) {
    if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
    const res = await chat(settings, apiKey, messages, specs, { maxTokens: 1024, timeoutMs, temperature: 0.3 });
    if (!res.ok) return { ok: false, kind: res.kind, status: res.status, detail: res.detail };
    if (res.toolCalls.length === 0) {
      noToolStreak += 1;
      if (noToolStreak >= 2) {
        reply = res.content.slice(0, 500);
        break;
      }
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: 'Respond by calling a tool, not in prose.' });
      continue;
    }
    noToolStreak = 0;
    messages.push({
      role: 'assistant',
      content: res.content !== '' ? res.content : null,
      tool_calls: res.toolCalls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments },
      })),
    });
    for (const call of res.toolCalls) {
      toolCallsUsed += 1;
      const result = executeTool(call.name, call.arguments);
      onEvent?.({ type: 'tool', name: call.name, detail: result.length > 160 ? `${result.slice(0, 160)}…` : result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      if (finished) break;
    }
  }
  if (!finished && reply === '') {
    reply = t('aiAgentForcedStop', 'Tool-call cap reached; finalized with the current map.');
  }

  const finalTree = dedupeSiblingLabels(toTree(root)).tree;
  return { ok: true, tree: finalTree, reply, stats: { changed } };
}
