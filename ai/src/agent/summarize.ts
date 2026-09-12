/**
 * 导图/图表的「总结与优化建议」:把当前生成结果(树或图表槽位)序列化为
 * 纯文本,单发 LLM 产出 总结/要点/优化建议 三段评审,结果在 Agent 面板
 * 以 assistant 卡片展示。只读分析,不改画布。
 */

import { chatWithJsonFallback, type ChatFailureKind, type ChatMessage } from '../ai/client';
import type { MindmapTree } from '../ai/schema';
import type { AiProviderSettings } from '../settings/settings';

export type SummarizeResult =
  | { ok: true; text: string }
  | { ok: false; kind: ChatFailureKind; status?: number; detail: string };

/** 树 → 缩进文本(超上限截断;面板/模型共用此形状) */
export function serializeTree(root: MindmapTree, maxNodes = 160): string {
  const lines: string[] = [];
  let count = 0;
  const walk = (node: MindmapTree, depth: number): void => {
    if (count >= maxNodes) return;
    count++;
    lines.push(`${'  '.repeat(depth)}- ${node.label}`);
    for (const kid of node.children ?? []) walk(kid, depth + 1);
  };
  walk(root, 0);
  if (count >= maxNodes) lines.push('…(truncated)');
  return lines.join('\n');
}

export async function summarizeMap(
  settings: AiProviderSettings,
  apiKey: string,
  contentText: string,
  opts: { timeoutMs?: number; chat?: typeof chatWithJsonFallback } = {}
): Promise<SummarizeResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '[MM-STAGE:summarize]',
        'You are a senior thinking-map reviewer (资深思维导图评审).',
        'The user gives the current mind map / thinking chart as indented text or JSON.',
        'Reply in the SAME language as the map content, plain text, with EXACTLY these three sections, each on its own line as a header:',
        '总结: a 2-3 sentence paragraph on what the map covers.',
        '要点: 3-5 bullet lines ("- " prefix) distilling the key content.',
        '优化建议: 3-5 bullet lines ("- " prefix) of concrete, actionable improvements (structure, granularity, terminology, missing branches), referencing actual node labels.',
        'No markdown headers, no tables, no code fences.',
      ].join('\n'),
    },
    { role: 'user', content: contentText.slice(0, 6000) },
  ];
  const res = await chat(settings, apiKey, messages, { maxTokens: 1200, timeoutMs: opts.timeoutMs ?? 60000, temperature: 0.4 });
  if (!res.ok) {
    return { ok: false, kind: res.kind, status: res.status, detail: res.detail };
  }
  return { ok: true, text: res.content.trim() };
}
