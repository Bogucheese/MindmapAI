/**
 * 节点扩展（懒展开）：为既有导图的一个节点生成新的一层子节点。
 *
 * 输入带完整路径（根 > … > 节点）、兄弟与已有子节点（防重复）、以及
 * 来源模式的要点集（有则要求 grounding，子节点带 source.noteIds）。
 * 复用 parseMindmapTree 做形状校验（把回复当 depth=2 的小树解析），
 * 失败走一次"重答"修复；不做 CRITIQUE——扩展是用户驱动的小步操作，
 * 不合格再展开/撤销即可。
 */

import { chatWithJsonFallback, type ChatFailureKind, type ChatMessage } from '../ai/client';
import { buildRepairPrompt, type GenerationConstraints } from '../ai/prompts';
import { parseMindmapTree, type MindmapTree } from '../ai/schema';
import type { AiProviderSettings } from '../settings/settings';
import { buildExpandSystemPrompt, buildExpandUserPrompt } from './skills';
import type { DistilledNote } from './types';

export interface ExpandInput {
  /** 从根到目标节点的标签路径（含根与目标） */
  pathLabels: string[];
  /** 目标节点的兄弟标签（防横向重复） */
  siblings: string[];
  /** 目标节点已有的子节点标签（防重复生成） */
  existingChildren: string[];
  /** 来源模式的要点（无则按主题上下文自由扩展） */
  notes?: DistilledNote[];
}

export interface ExpandOptions {
  isCancelled?: () => boolean;
  timeoutMs?: number;
  /** 测试注入 */
  chat?: typeof chatWithJsonFallback;
}

export type ExpandResult =
  | { ok: true; children: MindmapTree[] }
  | { ok: false; kind: ChatFailureKind | 'schema' | 'cancelled'; status?: number; detail: string; raw?: string };

export async function expandNodeChildren(
  settings: AiProviderSettings,
  apiKey: string,
  input: ExpandInput,
  constraints: GenerationConstraints,
  opts: ExpandOptions = {}
): Promise<ExpandResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const timeoutMs = opts.timeoutMs ?? 60000;
  if (opts.isCancelled?.() === true) {
    return { ok: false, kind: 'cancelled', detail: '' };
  }
  const withNotes = input.notes != null && input.notes.length > 0;
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: buildExpandSystemPrompt(constraints, withNotes) },
    { role: 'user', content: buildExpandUserPrompt(input) },
  ];

  // 只解析一层新子节点：根 + 一层 children
  const localConstraints = {
    depth: 2,
    maxChildren: constraints.maxChildren,
    maxNodes: constraints.maxChildren + 1,
  };

  const attempt = async (
    msgs: ChatMessage[]
  ): Promise<{ ok: true; children: MindmapTree[] } | { ok: false; fail: ExpandResult } | { ok: false; raw: string }> => {
    const res = await chat(settings, apiKey, msgs, { maxTokens: 2048, timeoutMs, temperature: 0.5 });
    if (!res.ok) {
      return { ok: false, fail: { ok: false, kind: res.kind, status: res.status, detail: res.detail, raw: '' } };
    }
    const parsed = parseMindmapTree(res.content, localConstraints);
    if (parsed.ok) {
      return { ok: true, children: parsed.tree.children ?? [] };
    }
    return { ok: false, raw: res.content };
  };

  let attempt1 = await attempt(baseMessages);
  if (!attempt1.ok && 'fail' in attempt1) return attempt1.fail;
  if (!attempt1.ok) {
    const repairMessages: ChatMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: attempt1.raw.slice(0, 2000) },
      { role: 'user', content: buildRepairPrompt() },
    ];
    const attempt2 = await attempt(repairMessages);
    if (!attempt2.ok && 'fail' in attempt2) return attempt2.fail;
    if (!attempt2.ok) {
      return { ok: false, kind: 'schema', detail: 'Expand reply could not be parsed.', raw: attempt1.raw };
    }
    attempt1 = attempt2;
  }
  return { ok: true, children: attempt1.children };
}
