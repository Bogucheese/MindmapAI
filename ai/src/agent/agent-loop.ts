/**
 * Agent 模式:LLM 用工具自主装配导图的循环——控制流在模型手里。
 *
 * 与快速管线的本质区别:管线由代码编排(提炼→架构→评审,固定顺序,模型
 * 只答题);这里模型自己决定先读哪些要点、按什么顺序放节点、何时完成,
 * 代码只提供工具、执行动作、兜底硬上限(工具调用数/节点数/深度)。
 *
 * 流程:提炼(代码,产出要点注册表)→ 工具循环(模型自主装配)→ finish_map
 * → 确定性自检(同级去重 + 结构报告)→ 发现问题则给模型一轮修正机会
 * → 汇出 MindmapTree。
 *
 * 模型不做几何布局(确定性布局引擎保留),tool calling 走 OpenAI 兼容格式。
 */

import {
  chatWithTools,
  type ToolLoopMessage,
  type ToolSpec,
} from '../ai/client';
import type { MindmapTree } from '../ai/schema';
import { t } from '../i18n/keys';
import { fetchWithRelay } from './tools';
import { dedupeSiblingLabels, findStructureIssues } from './validate';
import type { AgentEmitter } from './events';
import type { AiProviderSettings } from '../settings/settings';
import { chatWithJsonFallback } from '../ai/client';
import { distillNotes } from './pipeline';
import type { DistilledNote, SourceDoc } from './types';
import { LANGUAGE_RULES, type OutputLanguage } from '../ai/prompts';

export interface AgentLoopNode {
  id: string;
  label: string;
  noteIds: string[];
  children: AgentLoopNode[];
  parent: AgentLoopNode | null;
  depth: number;
}

export interface AgentLoopOptions {
  depth: number;
  maxChildren: number;
  maxNodes: number;
  language: OutputLanguage;
  maxToolCalls?: number;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  onEvent?: AgentEmitter;
  chat?: typeof chatWithTools;
  /** 测试注入:提炼阶段的 chat(与工具循环分开) */
  distillChat?: typeof chatWithJsonFallback;
}

export type AgentLoopResult =
  | {
      ok: true;
      tree: MindmapTree;
      notes: DistilledNote[];
      summary: string;
      stats: { nodes: number; toolCalls: number; autoFixRounds: number; notes: number };
    }
  | { ok: false; kind: 'cancelled' | 'http' | 'network' | 'timeout' | 'schema'; status?: number; detail: string };

const MAX_DEPTH = 6;

function buildToolSpecs(): ToolSpec[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_notes',
        description: 'Read the knowledge points extracted from the source. Ground every content node on them via noteIds.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional substring filter (case-insensitive).' },
            offset: { type: 'integer', description: 'Skip the first N matching notes (default 0).' },
            limit: { type: 'integer', description: 'Return at most N notes (default 30).' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_node',
        description: 'Place one node on the map. Call with parent=null exactly once to place the ROOT first; then attach children depth by depth, preferring depth-first order (finish one branch before the next).',
        parameters: {
          type: 'object',
          properties: {
            parent: { type: ['string', 'null'], description: 'Parent node id, or null for the root.' },
            label: { type: 'string', description: 'Concise node label, under 20 characters, no numbering.' },
            noteIds: { type: 'array', items: { type: 'string' }, description: 'Supporting note ids from read_notes.' },
          },
          required: ['parent', 'label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_node',
        description: 'Change an existing node\u2019s label and/or its noteIds.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            noteIds: { type: 'array', items: { type: 'string' } },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remove_node',
        description: 'Remove a node AND its whole subtree (the root cannot be removed).',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
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
        name: 'fetch_url',
        description: 'Fetch a web page as plain text when the knowledge points are thin. Use at most twice.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'http(s) URL' } },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish_map',
        description: 'Declare the map complete. Call this exactly when the map satisfies the quality rules.',
        parameters: {
          type: 'object',
          properties: { summary: { type: 'string', description: 'One-sentence summary of what you built.' } },
          required: ['summary'],
        },
      },
    },
  ];
}

const AGENT_SYSTEM_PROMPT = [
  '[MM-STAGE:agent]',
  'You are a senior information designer acting as an AUTONOMOUS mind-map agent.',
  'You build the map YOURSELF by calling tools, one node at a time — you decide the reading order, the structure and when you are done. The code only executes your tool calls.',
  '',
  'Workflow:',
  '1. Call read_notes to study the knowledge points (use query to narrow down; repeat as needed).',
  '2. If the points are thin and the topic clearly needs outside facts, call fetch_url sparingly (at most twice).',
  '3. Place nodes with add_node: root first (parent=null), then children depth by depth, preferring depth-first (finish one branch before starting the next).',
  '4. Ground content nodes via noteIds from read_notes where possible. The notes are raw material, not a cage: reorganize, merge, generalize and add common-sense structure whenever it makes the map clearer — but never contradict the source facts.',
  '5. Call inspect_map anytime to check the current structure; correct yourself with update_node / remove_node.',
  '6. When the map is complete per the rules below, call finish_map with a one-sentence summary. NEVER answer in prose without calling a tool.',
  '',
  'Quality rules (hard):',
  '- ONE consistent term per concept everywhere (never both "Agent" and "AI Agent").',
  '- Siblings belong to the SAME dimension; never place a contrast object among components.',
  '- No duplicate concepts; group lists longer than 8 with intermediate category nodes.',
  '- Top-level branches are major themes; meta information (audience, reading advice) is nested or dropped.',
  '- Labels: concise (under 20 characters), no numbering, no trailing punctuation, <language>.',
  '- Respect the caps: at most <maxNodes> nodes, depth at most <maxDepth>, at most <maxChildren> children per node.',
].join('\n');

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

function toolOk(payload: unknown): string {
  return JSON.stringify(payload);
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function runAgentGeneration(
  settings: AiProviderSettings,
  apiKey: string,
  input: { topic: string; doc?: SourceDoc },
  opts: AgentLoopOptions
): Promise<AgentLoopResult> {
  const chat = opts.chat ?? chatWithTools;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const maxToolCalls = opts.maxToolCalls ?? 80;
  const isCancelled = () => opts.isCancelled?.() === true;
  const onEvent = opts.onEvent;

  // ---------- 要点注册表(代码先跑提炼,Agent 通过 read_notes 消费) ----------
  let notes: DistilledNote[] = [];
  if (input.doc != null && input.doc.chunks.length > 0) {
    const dist = await distillNotes(settings, apiKey, input.doc, opts.language, {
      isCancelled,
      timeoutMs,
      onEvent,
      chat: opts.distillChat,
    });
    if (!dist.ok) {
      return dist.kind === 'no-notes'
        ? { ok: false, kind: 'schema', detail: dist.detail }
        : { ok: false, kind: dist.kind, status: dist.status, detail: dist.detail };
    }
    notes = dist.notes;
  }
  if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };

  onEvent?.({ type: 'stage', stage: 'agent', label: t('aiStageAgent', 'Agent is assembling the map...') });

  // ---------- 工具状态 ----------
  let idCounter = 0;
  let root: AgentLoopNode | null = null;
  const nodesById = new Map<string, AgentLoopNode>();
  let fetchCount = 0;
  let finished = false;
  let finishSummary = '';

  const findNode = (id: string): AgentLoopNode | undefined => nodesById.get(id);

  const executeTool = (name: string, rawArgs: string): string => {
    const args = parseArgs(rawArgs);
    switch (name) {
      case 'read_notes': {
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
        const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;
        const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 30;
        let matched = notes.filter((n) => query === '' || n.content.toLowerCase().includes(query));
        matched = matched.slice(offset, offset + limit);
        return toolOk({
          total: notes.length,
          notes: matched.map((n) => ({ id: n.id, content: n.content, ...(n.quote !== '' ? { quote: n.quote } : {}) })),
        });
      }
      case 'add_node': {
        const label = typeof args.label === 'string' ? args.label.trim().slice(0, 80) : '';
        if (label === '') return toolError('label is required');
        const parentArg = args.parent;
        if (parentArg == null) {
          if (root != null) return toolError('root already exists; pass a parent id');
          idCounter += 1;
          const node: AgentLoopNode = { id: `a${idCounter}`, label, noteIds: [], children: [], parent: null, depth: 0 };
          root = node;
          nodesById.set(node.id, node);
          onEvent?.({ type: 'node', id: node.id, label, depth: 0, total: nodesById.size });
          return toolOk({ id: node.id, depth: 0, totalNodes: nodesById.size });
        }
        const parent = typeof parentArg === 'string' ? findNode(parentArg) : undefined;
        if (parent == null) return toolError(`unknown parent id: ${String(parentArg)}`);
        if (parent.depth + 1 > Math.min(MAX_DEPTH, opts.depth)) {
          return toolError(`depth cap reached (${Math.min(MAX_DEPTH, opts.depth)}); place this node shallower`);
        }
        if (parent.children.length >= opts.maxChildren) {
          return toolError(`parent already has ${opts.maxChildren} children (cap); group with category nodes or finish another branch`);
        }
        if (nodesById.size >= opts.maxNodes) {
          return toolError(`node cap reached (${opts.maxNodes}); call finish_map`);
        }
        const noteIds = Array.isArray(args.noteIds)
          ? (args.noteIds as unknown[]).filter((id): id is string => typeof id === 'string' && notes.some((n) => n.id === id))
          : [];
        idCounter += 1;
        const node: AgentLoopNode = {
          id: `a${idCounter}`, label,
          noteIds: Array.from(new Set(noteIds)),
          children: [], parent, depth: parent.depth + 1,
        };
        parent.children.push(node);
        nodesById.set(node.id, node);
        onEvent?.({ type: 'node', id: node.id, label, depth: node.depth, total: nodesById.size });
        return toolOk({ id: node.id, depth: node.depth, totalNodes: nodesById.size });
      }
      case 'update_node': {
        const id = typeof args.id === 'string' ? args.id : '';
        const node = findNode(id);
        if (node == null) return toolError(`unknown id: ${id}`);
        if (typeof args.label === 'string' && args.label.trim() !== '') node.label = args.label.trim().slice(0, 80);
        if (Array.isArray(args.noteIds)) {
          node.noteIds = (args.noteIds as unknown[]).filter(
            (nid): nid is string => typeof nid === 'string' && notes.some((n) => n.id === nid),
          );
        }
        onEvent?.({ type: 'node', id: node.id, label: node.label, depth: node.depth, total: nodesById.size, updated: true });
        return toolOk({ id: node.id, label: node.label, noteIds: node.noteIds });
      }
      case 'remove_node': {
        const id = typeof args.id === 'string' ? args.id : '';
        const node = findNode(id);
        if (node == null) return toolError(`unknown id: ${id}`);
        if (node.parent == null) return toolError('the root cannot be removed');
        const list = node.parent.children;
        list.splice(list.indexOf(node), 1);
        const stack = [node];
        while (stack.length > 0) {
          const cur = stack.pop() as AgentLoopNode;
          nodesById.delete(cur.id);
          for (const child of cur.children) stack.push(child);
        }
        return toolOk({ removed: true, totalNodes: nodesById.size });
      }
      case 'inspect_map': {
        const lines: string[] = [];
        const walk = (node: AgentLoopNode, indent: string): void => {
          lines.push(`${indent}${node.id}: ${node.label}${node.noteIds.length > 0 ? ` [${node.noteIds.join(',')}]` : ''}`);
          for (const child of node.children) walk(child, `${indent}  `);
        };
        if (root != null) walk(root, '');
        return toolOk({ map: lines.join('\n'), totalNodes: nodesById.size });
      }
      case 'fetch_url':
        // 实际抓取在循环里特判执行(需要 await),这里只做预算与参数校验
        return toolOk({ accepted: true });
      case 'finish_map': {
        finished = true;
        finishSummary = typeof args.summary === 'string' ? args.summary.slice(0, 300) : '';
        return toolOk({ accepted: true, totalNodes: nodesById.size });
      }
      default:
        return toolError(`unknown tool: ${name}`);
    }
  };

  // ---------- 循环 ----------
  const messages: ToolLoopMessage[] = [
    {
      role: 'system',
      content: AGENT_SYSTEM_PROMPT.replace('<language>', LANGUAGE_RULES[opts.language] ?? 'Match the source language.').replace('<maxNodes>', String(opts.maxNodes)).replace('<maxDepth>', String(Math.min(MAX_DEPTH, opts.depth))).replace('<maxChildren>', String(opts.maxChildren)),
    },
    {
      role: 'user',
      content: [
        `Topic: ${input.topic}`,
        input.doc != null ? `Source: "${input.doc.title}" (${input.doc.chunks.length} chunks, ${notes.length} knowledge points extracted).` : 'No source text — build from your own knowledge, staying factual and neutral.',
        'Start now. Place the root with add_node(parent=null).',
      ].join('\n'),
    },
  ];

  const specs = buildToolSpecs();
  let toolCallsUsed = 0;
  let noToolStreak = 0;

  const runLoop = async (cap: number): Promise<{ ok: true } | { ok: false; kind: 'cancelled' | 'http' | 'network' | 'timeout'; status?: number; detail: string }> => {
    while (toolCallsUsed < cap) {
      if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
      if (finished) return { ok: true };
      const res = await chat(settings, apiKey, messages, specs, {
        maxTokens: 1024,
        timeoutMs,
        temperature: 0.4,
      });
      if (!res.ok) return { ok: false, kind: res.kind, status: res.status, detail: res.detail };
      if (res.toolCalls.length === 0) {
        noToolStreak += 1;
        if (noToolStreak >= 2) {
          finished = true;
          finishSummary = res.content.slice(0, 300);
          return { ok: true };
        }
        messages.push({ role: 'assistant', content: res.content });
        messages.push({ role: 'user', content: 'Respond by calling a tool (add_node / read_notes / finish_map), not in prose.' });
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
        let result: string;
        if (call.name === 'fetch_url') {
          const url = (parseArgs(call.arguments).url as string) ?? '';
          if (!/^https?:\/\//i.test(url)) {
            result = toolError('url must start with http(s)://');
          } else if (fetchCount >= 2) {
            result = toolError('fetch budget exhausted (max 2)');
          } else {
            fetchCount += 1;
          onEvent?.({ type: 'tool', name: call.name, detail: url });
          const fetched = await fetchWithRelay(url, timeoutMs);
          const text = fetched.ok && fetched.status === 200
            ? fetched.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)
            : `fetch failed (${fetched.ok ? `HTTP ${fetched.status}` : fetched.kind})`;
          result = fetched.ok && fetched.status === 200 ? toolOk({ text }) : toolError(text);
          }
        } else {
          result = executeTool(call.name, call.arguments);
        }
        onEvent?.({ type: 'tool', name: call.name, detail: result.length > 160 ? `${result.slice(0, 160)}…` : result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
        if (finished) return { ok: true };
      }
    }
    if (!finished) {
      finished = true;
      finishSummary = t('aiAgentForcedStop', 'Tool-call cap reached; finalized with the current map.');
      onEvent?.({ type: 'warn', text: finishSummary });
    }
    return { ok: true };
  };

  const first = await runLoop(maxToolCalls);
  if (!first.ok) return first;
  if (root == null) {
    return { ok: false, kind: 'schema', detail: 'Agent never placed a root node.' };
  }

  // ---------- 确定性自检 + 一轮自修正 ----------
  const toMindmapTree = (node: AgentLoopNode): MindmapTree => ({
    label: node.label,
    ...(node.noteIds.length > 0 ? { source: { noteIds: node.noteIds } } : {}),
    children: node.children.map(toMindmapTree),
  });

  let autoFixRounds = 0;
  let tree: MindmapTree = toMindmapTree(root);
  const deduped = dedupeSiblingLabels(tree);
  tree = deduped.tree;
  if (deduped.merged > 0) {
    onEvent?.({ type: 'info', stage: 'agent', text: `${t('aiAgentDeduped', 'Auto-merged duplicate sibling nodes')}: ${deduped.merged}` });
  }
  const issues = findStructureIssues(tree);
  if (issues.length > 0 && !isCancelled() && toolCallsUsed < maxToolCalls) {
    onEvent?.({ type: 'info', stage: 'agent', text: t('aiAgentFixing', 'Self-check found issues; giving the agent one round to fix them...') });
    messages.push({
      role: 'user',
      content: `Auto-checker findings on the map you built:\n- ${issues.join('\n- ')}\nFix them with update_node / remove_node / add_node, then call finish_map again.`,
    });
    const before = toolCallsUsed;
    finished = false; // 复位:修正轮结束后由模型的 finish_map 再次收尾
    const fix = await runLoop(Math.min(before + 15, maxToolCalls));
    if (!fix.ok) return fix;
    autoFixRounds = 1;
    // 用修正后的节点状态重新汇出 + 再去重
    tree = dedupeSiblingLabels(toMindmapTree(root as AgentLoopNode)).tree;
  }

  onEvent?.({
    type: 'done',
    summary: `${finishSummary} · ${nodesById.size} ${t('aiAgentNodesWord', 'nodes')}${autoFixRounds > 0 ? ` · ${t('aiAgentReviewRevised', 'revised after review')}` : ''}`,
  });
  return {
    ok: true,
    tree,
    notes,
    summary: finishSummary,
    stats: { nodes: nodesById.size, toolCalls: toolCallsUsed, autoFixRounds, notes: notes.length },
  };
}
