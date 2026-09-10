/**
 * 复合画布 extras 生成:AI 基于要点提出支线小图/要点表格/关键关系,
 * 管线确定性布局(详见 layoutExtras)。
 */

import { chatWithJsonFallback, type ChatMessage } from '../ai/client';
import type { AiProviderSettings } from '../settings/settings';
import type { DistilledNote } from '../agent/types';
import type { SkeletonStats } from '../agent/pipeline';
import { parseExtrasSlots, layoutExtras } from './extras';
import type { ChartElement } from './layout';
import type { AgentEmitter } from '../agent/events';

export interface ExtrasOptions {
  isCancelled?: () => boolean;
  /** Agent 事件流:复合画布产物摘要 */
  onEvent?: AgentEmitter;
  timeoutMs?: number;
  chat?: typeof chatWithJsonFallback;
  onProgress?: (stage: 'architect' | 'render') => void;
}

export interface ExtrasResult {
  ok: boolean;
  elements?: ChartElement[];
  detail?: string;
  raw?: string;
}

export function buildExtrasPrompt(notes: DistilledNote[], skeletonText: string): string {
  const noteLines = notes.map((n) => `- ${n.content}`).join('\n').slice(0, 4000);
  return [
    `Source skeleton (sections):`,
    skeletonText.slice(0, 800),
    ``,
    `Knowledge points:`,
    noteLines,
  ].join('\n');
}

export function buildExtrasSystemPrompt(): string {
  return [
    '[MM-STAGE:extras]',
    'You are a senior professional chart maker. Alongside a main mind map, propose SUPPLEMENTARY views that add value: mini mind maps for satellite topics, one summary table, and key relationships.',
    'Return strict JSON:',
    '{"minimaps": [{"title": string, "items": [string]}],',
    ' "table": {"title": string, "headers": [string, string, string], "rows": [[string, string, string]]},',
    ' "relations": [{"from": string, "label": string, "to": string}]}',
    'Rules:',
    '- Terminology: use ONE consistent term for the same concept across minimaps, table and relations (identical labels — never both "Agent" and "AI Agent").',
    '- Each extra covers its OWN angle: do not restate the same content in two extras. When the same collection (e.g. tools, resources) is relevant to several extras, reference the same grouped categories instead of re-enumerating different subsets.',
    '- minimaps: 1-3 items; each is a satellite topic that deserves its own deep-dive (title under 14 chars, 3-6 items under 14 chars each). Items inside one minimap are same-dimension, grouped by kind or difficulty when natural.',
    '- table: compare/categorize key knowledge; 3 columns, 4-8 rows; cell text under 16 chars. For a comparison table use rich, non-overlapping dimensions (e.g. execution model, core logic, output, flexibility, typical scenarios, maintenance cost, analogy) — do not stop at 2-3 obvious ones.',
    '- relations: 2-5 cause-effect / depends-on / contrasts-with relations between concepts, label under 8 chars. A relation arrow NEVER expresses part-whole membership — put components inside a minimap grouping instead. "from"/"to" must reuse the exact labels used elsewhere.',
    '- Progression: extras should read as deep-dive → comparison → relations of the SAME story, not as unrelated islands; keep shared lists consistent across them.',
    '- Treat the knowledge points as raw material: reorganize and generalize freely; never contradict the source facts.',
    '- Write in the same language as the knowledge points.',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
}

export async function generateExtras(
  settings: AiProviderSettings,
  apiKey: string,
  notes: DistilledNote[],
  skeleton: SkeletonStats,
  opts: ExtrasOptions = {}
): Promise<ExtrasResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  if (opts.isCancelled?.() === true) {
    return { ok: false, detail: 'cancelled' };
  }
  opts.onProgress?.('architect');
  const messages: ChatMessage[] = [
    { role: 'system', content: buildExtrasSystemPrompt() },
    { role: 'user', content: buildExtrasPrompt(notes, skeleton.text) },
  ];
  const res = await chat(settings, apiKey, messages, { maxTokens: 1536, timeoutMs: opts.timeoutMs ?? 60000, temperature: 0.4 });
  if (!res.ok) {
    return { ok: false, detail: res.detail };
  }
  const slots = parseExtrasSlots(res.content);
  if (slots == null) {
    return { ok: false, detail: 'extras 回复无法解析。', raw: res.content };
  }
  opts.onProgress?.('render');
  if (opts.onEvent != null) {
    opts.onEvent({
      type: 'extras',
      minimaps: slots.minimaps.map((m) => ({ title: m.title, items: m.items.length })),
      tableRows: slots.table.rows.length,
      relations: slots.relations.length,
    });
  }
  return { ok: true, elements: layoutExtras(slots) };
}
