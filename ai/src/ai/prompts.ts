/**
 * 导图生成的 prompt 构造。system prompt 用英文书写（模型遵循度最好），
 * 但通过 language 规则约束**输出标签**的语言：auto 跟随主题语言，
 * 或强制 en/zh。schema 与全部硬约束都写进 prompt，配合客户端的
 * response_format: json_object 双保险。
 */

import type { TreeConstraints } from './schema';

export type OutputLanguage = 'auto' | 'en' | 'zh';

export interface GenerationConstraints extends TreeConstraints {
  language: OutputLanguage;
}

/** M6 生成对话框的默认值（沿用总体计划的 depth 3 / 5 分支 / ≤60 节点） */
export const DEFAULT_GENERATION: GenerationConstraints = {
  depth: 3,
  maxChildren: 5,
  maxNodes: 60,
  language: 'auto',
};

const LANGUAGE_RULES: Record<OutputLanguage, string> = {
  auto: "Write every label in the same language as the user's topic.",
  en: 'Write every label in English.',
  zh: '所有节点标签一律使用中文。',
};

/** agent/skills 复用同一套输出语言约束 */
export { LANGUAGE_RULES };

export function buildSystemPrompt(c: GenerationConstraints): string {
  return [
    'You are a mind map design expert.',
    "Given a topic, produce a mind map as strict JSON using this schema: {\"label\": string, \"children\": [<same shape, optional>]}.",
    'Leaf nodes omit "children". The root object represents the topic itself.',
    'Rules:',
    `- Maximum depth: ${c.depth} (the root counts as level 1).`,
    `- Maximum ${c.maxChildren} children per node.`,
    `- At most ${c.maxNodes} nodes in total.`,
    '- Labels are concise (preferably under 20 characters), with no numbering and no trailing punctuation.',
    '- Prefer meaningful depth: use the allowed depth so leaves are concrete details, not vague category words. A branch whose children are still vague categories should be expanded further.',
    `- ${LANGUAGE_RULES[c.language]}`,
    'Reply with the JSON object ONLY: no markdown fences, no explanations, no comments.',
  ].join('\n');
}

export function buildUserPrompt(topic: string): string {
  return `Create a mind map for this topic:\n${topic.trim()}`;
}

export function buildRepairPrompt(): string {
  return (
    'Your previous reply was not valid JSON matching the required schema. ' +
    'Reply again with ONLY the JSON object itself: no markdown fences, no explanations.'
  );
}
