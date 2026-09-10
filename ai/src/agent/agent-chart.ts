/**
 * Agent 模式(思考图):12 种思考图的工具循环。
 *
 * 思考图的"手"是槽位协议——确定性几何布局要求一次性拿到完整槽位,所以
 * 模型的自主性体现在:自己决定读哪些要点/要不要抓网页,提交槽位后由
 * 代码校验,失败把校验错误喂回去让它自己修(最多 3 次提交)。
 * 这与导图 Agent(add_node 逐个放)是同一控制流哲学:决策在模型,几何在代码。
 */

import { chatWithJsonFallback, chatWithTools, transportGet, type ToolLoopMessage, type ToolSpec } from '../ai/client';
import type { ChartTypeId } from '../charts/catalog';
import { CHART_TYPES } from '../charts/catalog';
import { layoutChart, type ChartElement, type ChartSlots, type ChartDirection } from '../charts/layout';
import { chartNodeEstimate, validateChartSlots } from '../charts/validate';
import type { AgentEmitter } from './events';
import { distillNotes } from './pipeline';
import { parseJsonLoose } from './pipeline';
import type { DistilledNote, SourceDoc } from './types';
import { t } from '../i18n/keys';

export interface AgentChartOptions {
  direction?: ChartDirection;
  isCancelled?: () => boolean;
  timeoutMs?: number;
  maxToolCalls?: number;
  onEvent?: AgentEmitter;
  chat?: typeof chatWithTools;
  distillChat?: typeof chatWithJsonFallback;
}

export type AgentChartResult =
  | { ok: true; type: ChartTypeId; elements: ChartElement[]; slots: ChartSlots; stats: { notes: number; nodes: number } }
  | { ok: false; kind: 'cancelled' | 'http' | 'network' | 'timeout' | 'schema'; status?: number; detail: string; raw?: string };



export async function runAgentChart(
  settings: Parameters<typeof chatWithTools>[0],
  apiKey: string,
  chartType: ChartTypeId,
  input: { topic: string; doc?: SourceDoc },
  opts: AgentChartOptions = {}
): Promise<AgentChartResult> {
  const chat = opts.chat ?? chatWithTools;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const maxToolCalls = opts.maxToolCalls ?? 20;
  const isCancelled = () => opts.isCancelled?.() === true;
  const onEvent = opts.onEvent;
  const meta = CHART_TYPES[chartType];

  let notes: DistilledNote[] = [];
  if (input.doc != null && input.doc.chunks.length > 0) {
    const dist = await distillNotes(settings, apiKey, input.doc, 'auto', {
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

  onEvent?.({ type: 'stage', stage: 'agent', label: t('aiStageAgentChart', 'Agent is designing the chart...') });

  const MAX_SUBMITS = 3;
  let fetchCount = 0;
  let submits = 0;
  let accepted: ChartSlots | null = null;

  const parseArgs = (raw: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  const executeTool = (name: string, rawArgs: string): string => {
    const args = parseArgs(rawArgs);
    switch (name) {
      case 'read_notes': {
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
        const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;
        const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 30;
        const matched = notes
          .filter((n) => query === '' || n.content.toLowerCase().includes(query))
          .slice(offset, offset + limit);
        return JSON.stringify({
          total: notes.length,
          notes: matched.map((n) => ({ id: n.id, content: n.content, ...(n.quote !== '' ? { quote: n.quote } : {}) })),
        });
      }
      case 'fetch_url': {
        const url = typeof args.url === 'string' ? args.url.trim() : '';
        if (!/^https?:\/\//i.test(url)) return JSON.stringify({ error: 'url must start with http(s)://' });
        if (fetchCount >= 2) return JSON.stringify({ error: 'fetch budget exhausted (max 2)' });
        fetchCount += 1;
        return 'ASYNC_FETCH';
      }
      case 'submit_chart': {
        const slots = args.slots ?? args;
        const parsed = parseJsonLoose(JSON.stringify(slots)) as ChartSlots | null;
        if (parsed == null || typeof parsed !== 'object') return JSON.stringify({ error: 'slots must be an object' });
        if (submits >= MAX_SUBMITS) return JSON.stringify({ error: 'submission budget exhausted (max 3); call finish or answer in prose' });
        const invalid = validateChartSlots(chartType, parsed);
        if (invalid != null) return JSON.stringify({ error: `slots invalid: ${invalid}` });
        submits += 1;
        accepted = parsed;
        return JSON.stringify({ accepted: true, nodes: chartNodeEstimate(chartType, parsed) });
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  };

  const specs: ToolSpec[] = [
    {
      type: 'function',
      function: {
        name: 'read_notes',
        description: 'Read the knowledge points extracted from the source. Ground your chart content on them.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            offset: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch a web page as plain text when the knowledge points are thin. Use at most twice.',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'submit_chart',
        description: `Submit the complete chart slots. Protocol: ${meta.slots}. Terminology must be consistent; no duplicate nodes; sibling items same-dimension. Re-submit to fix validation errors.`,
        parameters: {
          type: 'object',
          properties: { slots: { type: 'object', description: 'The complete slots object' } },
          required: ['slots'],
        },
      },
    },
  ];

  const messages: ToolLoopMessage[] = [
    {
      role: 'system',
      content: [
        '[MM-STAGE:agent-chart]',
        'You are a senior professional chart maker acting as an autonomous agent.',
        `Design a "${meta.name}" for the topic. Definition: ${meta.definition}. When to use: ${meta.pros}`,
        'Study the knowledge points with read_notes first (repeat with queries as needed), then call submit_chart with the complete slots.',
        'If a submission fails validation, read the error and fix your slots, then submit again.',
        'Never answer in prose without calling a tool.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Topic: ${input.topic}\nKnowledge points available: ${notes.length}. Start now.`,
    },
  ];

  let toolCallsUsed = 0;
  let noToolStreak = 0;
  while (toolCallsUsed < maxToolCalls && accepted == null) {
    if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
    const res = await chat(settings, apiKey, messages, specs, { maxTokens: 3072, timeoutMs, temperature: 0.4 });
    if (!res.ok) return { ok: false, kind: res.kind, status: res.status, detail: res.detail };
    if (res.toolCalls.length === 0) {
      noToolStreak += 1;
      if (noToolStreak >= 2) break;
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: 'Respond by calling a tool (read_notes / submit_chart), not in prose.' });
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
          result = JSON.stringify({ error: 'url must start with http(s)://' });
        } else if (fetchCount >= 2) {
          result = JSON.stringify({ error: 'fetch budget exhausted (max 2)' });
        } else {
          fetchCount += 1;
          onEvent?.({ type: 'tool', name: call.name, detail: url });
          const fetched = await transportGet(url, timeoutMs);
          const text = fetched.ok && fetched.status === 200
            ? fetched.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000)
            : `fetch failed (${fetched.ok ? `HTTP ${fetched.status}` : fetched.kind})`;
          result = fetched.ok && fetched.status === 200 ? JSON.stringify({ text }) : JSON.stringify({ error: text });
        }
      } else {
        result = executeTool(call.name, call.arguments);
      }
      onEvent?.({ type: 'tool', name: call.name, detail: result.length > 160 ? `${result.slice(0, 160)}…` : result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
    }
  }

  if (accepted == null) {
    return { ok: false, kind: 'schema', detail: submits > 0 ? '槽位未能通过校验。' : 'Agent 未提交图表槽位。' };
  }

  const elements = layoutChart(chartType, accepted, opts.direction ?? 'vertical');
  if (elements.filter((e) => e.kind === 'vertex').length < 3) {
    return { ok: false, kind: 'schema', detail: '图表内容过少。' };
  }
  const nodes = chartNodeEstimate(chartType, accepted);
  onEvent?.({ type: 'done', summary: `${meta.name} · ${nodes} ${t('aiAgentNodesWord', 'nodes')}` });
  return {
    ok: true,
    type: chartType,
    elements,
    slots: accepted,
    stats: { notes: notes.length, nodes },
  };
}
