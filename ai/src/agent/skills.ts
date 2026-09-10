/**
 * 来源模式各阶段的 prompt 契约（skill 层）。
 *
 * - system prompt 首行带 [MM-STAGE:*] 标记：dev-mock-server.mjs 据此按阶段
 *   脚本化返回；真实模型会忽略该标记；
 * - 每阶段独立温度（distill/architect 0.5、critique 0）由 pipeline 传入；
 * - JSON 形状校验与修复阶梯复用 ai/schema.ts，本文件只负责"把话说清"。
 */

import { LANGUAGE_RULES, type GenerationConstraints, type OutputLanguage } from '../ai/prompts';
import type { MindmapTree } from '../ai/schema';
import { CHART_SHAPES, SHAPE_CATALOG_PROMPT } from '../charts/shapes';
import { type ChartTypeMeta } from '../charts/catalog';
import type { DistilledNote, SourceChunk } from './types';
import type { ExpandInput } from './expand';

export function buildDistillSystemPrompt(language: OutputLanguage, maxNotes: number): string {
  const languageRule =
    language === 'auto'
      ? 'Write each content in the same language as the source text.'
      : LANGUAGE_RULES[language];
  return [
    '[MM-STAGE:distill]',
    'You are a meticulous senior research analyst extracting knowledge points from a source text — precise, skeptical of filler, and terminologically disciplined.',
    'Return strict JSON: {"notes": [{"id": string, "content": string, "quote": string}]}.',
    'Rules:',
    '- Extract as many notes as the content deserves (hard cap ' + maxNotes + ', typically 3-10): never pad to reach a count, never omit a distinct fact; skip filler text (ads, navigation, calls to action).',
    '- "content" is one condensed knowledge point (under 25 words); keep concrete facts, definitions, distinctions, and numbers.',
    '- Extract each bullet, table row, and named example that carries a distinct fact as a SEPARATE note — never merge several facts into one note.',
    '- "quote" is a VERBATIM excerpt (under 40 words) copied from the given text that supports the content.',
    '- Terminology: use ONE consistent term for the same entity across notes (pick a single name — never both "Agent" and "AI Agent").',
    '- "id" must be "n1", "n2", ... in order.',
    `- ${languageRule}`,
    'If the text contains nothing worth keeping, reply {"notes": []}.',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
}

export function buildDistillUserPrompt(chunk: SourceChunk): string {
  const heading = chunk.headingPath != null ? `Section: ${chunk.headingPath}\n` : '';
  return `${heading}Source text:\n"""\n${chunk.text}\n"""`;
}

/**
 * ARCHITECT v3:结构确定性化——骨架树由管线构建,模型只回答
 * "每个最深层章节放哪些叶子"(leaves 字典,键 = 骨架行原样的章节路径)。
 * 装配、配额截断、覆盖保证全部在管线侧确定性完成,模型不再自由建树。
 */
export function buildArchitectSystemPrompt(c: GenerationConstraints, skeletonText?: string): string {
  if (skeletonText == null || skeletonText === '') {
    // 无骨架(无标题结构的粘贴文本):退回旧式自由建树
    return [
      '[MM-STAGE:architect]',
      'You are a senior information designer with 20 years of experience crafting publication-quality mind maps for professional audiences.',
      'Given a topic and extracted knowledge points (each with an id), organize them into a mind map as strict JSON:',
      '{"label": string, "source": {"noteIds": [string]}, "children": [<same shape, optional>]}.',
      'The root object represents the topic itself. Every non-root node MUST carry "source": {"noteIds": [...]}.',
      `- Maximum depth: ${c.depth}; maximum ${c.maxChildren} children per node; at most ${c.maxNodes} nodes in total.`,
      '- Labels are concise (preferably under 20 characters), no numbering, no trailing punctuation.',
      '- Terminology: use ONE consistent term for the same concept everywhere (never "Agent" in one node and "AI Agent" in another).',
      '- Sibling nodes must belong to the SAME dimension (all components, all kinds, or all steps). Never place a contrasting or auxiliary item (e.g. "traditional software" when the siblings are system components) among structural siblings.',
      '- No duplicates: the same fact or concept appears in exactly ONE node; merge repeated content instead of restating it in another branch.',
      '- Weight: top-level branches are the major themes of the topic; meta information (audience, reading advice, background remarks) is nested under a fitting theme or dropped, never a top-level branch.',
      '- Group long lists: when a node would exceed ' + c.maxChildren + ' leaf children, introduce intermediate category nodes instead of one flat list.',
      '- Completeness: produce a COMPLETE, content-rich map in ONE pass — every branch carries concrete leaf content, no placeholder or to-be-filled nodes. Later node expansion (right-click) is only for drilling deeper, never for basic completeness.',
      '- Do NOT invent knowledge that is absent from the notes.',
      `- ${LANGUAGE_RULES[c.language]}`,
      'Reply with the JSON object ONLY: no markdown fences, no explanations, no comments.',
    ].join('\n');
  }
  return [
    '[MM-STAGE:architect]',
    'You are a senior information designer with 20 years of experience crafting publication-quality mind maps. The mind map STRUCTURE is already fixed by a section skeleton (derived from the source headings). You ONLY decide which LEAF nodes go under each deepest section.',
    'Return strict JSON: {"leaves": {"<section path>": [ {"label": string, "source": {"noteIds": [string]}} ]}}.',
    'Rules:',
    '- Keys are section paths COPIED VERBATIM from the skeleton lines (the part before " (n points)"), e.g. "定义 AI 代理 > 什么是 AI 代理？".',
    '- Each leaf: {"label": concise (under 20 characters, no numbering), "source": {"noteIds": [...]} referencing the knowledge points it merges. One leaf MAY merge several related notes; when notes enumerate concrete items use the items as separate leaves.',
    '- Per-section leaf budgets are given in the user prompt — do not exceed them.',
    '- Terminology: use ONE consistent term for the same concept across ALL sections (never both "Agent" and "AI Agent").',
    '- Leaves under one section are same-dimension items; never mix a contrasting item into a component list.',
    '- Completeness: fill every deepest section with concrete leaves in this single pass — no empty or placeholder sections; expansion later is for depth, not completeness.',
    '- No duplicates: the same concept is placed in exactly ONE section; do not restate it under another.',
    '- Do NOT invent knowledge that is absent from the notes.',
    `- ${LANGUAGE_RULES[c.language]}`,
    'Reply with the JSON object ONLY: no markdown fences, no explanations, no comments.',
  ].join('\n');
}

export function buildArchitectUserPrompt(
  topic: string,
  notes: DistilledNote[],
  skeletonText?: string,
  perSectionQuotas?: string
): string {
  const noteLines = notes.map((n) =>
    n.headingPath != null ? `- [${n.id}] (${n.headingPath}) ${n.content}` : `- [${n.id}] ${n.content}`
  );
  const skeleton =
    skeletonText != null && skeletonText !== ''
      ? `\n\nSection skeleton (structure is fixed; ONLY produce leaves for its deepest sections — copy section paths verbatim):\n${skeletonText.slice(0, 1500)}`
      : '';
  const budget =
    perSectionQuotas != null && perSectionQuotas !== ''
      ? `\n\nLeaf budget per deepest section (merge related points into one leaf whose "source" lists several noteIds):\n${perSectionQuotas}`
      : '';
  return `Topic: ${topic.trim()}\nKnowledge points:\n${noteLines.join('\n').slice(0, 6000)}${skeleton}${budget}`;
}

export function buildArchitectReviseUserPrompt(topic: string, tree: MindmapTree, feedback: string): string {
  return (
    `Topic: ${topic.trim()}\n\n` +
    'Your previous mind map JSON:\n' +
    JSON.stringify(tree, null, 1).slice(0, 4000) +
    '\n\nReviewer feedback you must address:\n' +
    feedback.slice(0, 800) +
    '\n\nReturn the FULL revised mind map JSON in the same schema. Reply with the JSON object ONLY.'
  );
}

export function buildCritiqueSystemPrompt(): string {
  return [
    '[MM-STAGE:critique]',
    'You are a strict senior editor judging whether a mind map faithfully represents a source — you sign your name on every map you approve.',
    'You receive: the topic, the mind map JSON (nodes may carry source.noteIds), the extracted knowledge points, and possibly a section skeleton derived from the source headings.',
    'Return strict JSON: {"scores": {"grounding": number, "coverage": number, "specificity": number, "structure": number}, "verdict": "pass"|"revise", "feedback": string}.',
    'Scoring 0-100:',
    '- grounding: are node labels supported by the referenced notes? Penalize nodes with no/unknown noteIds or distorted claims.',
    '- coverage: does every top-level skeleton section have a branch? A missing top-level section is a serious defect. Detail depth may be reduced to fit the node budget — condensed leaves are expected, NOT defects; only report missing sections or completely bare branches.',
    '- specificity: are leaf nodes concrete? A leaf that is a vague category word ("concepts", "其他") loses points.',
    '- structure: balanced depth and branching, no duplicated branches. Structure ALSO loses points for: two different names for the same concept (e.g. "Agent" and "AI Agent" mixed); the same content restated in different branches; siblings mixing dimensions (a contrast object placed among system components); and flat lists of more than 8 leaves without intermediate grouping. If an "Auto-checker findings" section is provided, weigh each finding here.',
    'verdict "revise" when any score is below 70; otherwise "pass".',
    'feedback: one or two concrete, actionable sentences (same language as the labels).',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
}

export function buildCritiqueUserPrompt(
  topic: string,
  tree: MindmapTree,
  notes: DistilledNote[],
  skeletonText?: string,
  autoFindings?: string[]
): string {
  const noteLines = notes.map((n) => `- [${n.id}] ${n.content}${n.quote !== '' ? ` (quote: ${n.quote.slice(0, 80)})` : ''}`);
  const skeleton =
    skeletonText != null && skeletonText !== ''
      ? `\n\nSection skeleton (branches must mirror this; bare branches are defects):\n${skeletonText.slice(0, 1200)}`
      : '';
  const findings =
    autoFindings != null && autoFindings.length > 0
      ? `\n\nAuto-checker findings (deterministic; factor these into the structure score):\n- ${autoFindings.join('\n- ')}`
      : '';
  return (
    `Topic: ${topic.trim()}\n\n` +
    'Mind map JSON:\n' +
    JSON.stringify(tree, null, 1).slice(0, 5000) +
    '\n\nKnowledge points:\n' +
    noteLines.join('\n').slice(0, 5000) +
    skeleton +
    findings
  );
}

export function buildExpandSystemPrompt(c: GenerationConstraints, withNotes: boolean): string {
  return [
    '[MM-STAGE:expand]',
    'You are a senior information designer. The user is drilling down into ONE node of an existing mind map.',
    'Return strict JSON: {"label": string, "children": [{"label": string, "source": {"noteIds": [string]}}]}.',
    'The root "label" repeats the node being expanded; "children" are its NEW children (single level, no nested "children").',
    'Rules:',
    `- At most ${c.maxChildren} children.`,
    '- Child labels are concise (preferably under 20 characters), with no numbering and no trailing punctuation.',
    '- Reuse the EXACT terms the mind map already uses for the same concepts; do not introduce variant names.',
    '- Do not repeat sibling nodes or existing children of the node; go deeper, not sideways.',
    withNotes
      ? '- Knowledge points are provided: ground each child where possible and set "source": {"noteIds": [...]} to the supporting ids; omit "source" when a child is structural.'
      : '- Stay consistent with the meaning of the node path.',
    `- ${LANGUAGE_RULES[c.language]}`,
    'Reply with the JSON object ONLY: no markdown fences, no explanations, no comments.',
  ].join('\n');
}

export function buildExpandUserPrompt(input: ExpandInput): string {
  const node = input.pathLabels[input.pathLabels.length - 1] ?? '';
  const lines: string[] = [`Mind map path: ${input.pathLabels.join(' > ')}`];
  if (input.siblings.length > 0) {
    lines.push(`Sibling nodes (do not repeat): ${input.siblings.join(', ')}`);
  }
  if (input.existingChildren.length > 0) {
    lines.push(`Existing children (avoid duplicates): ${input.existingChildren.join(', ')}`);
  }
  if (input.notes != null && input.notes.length > 0) {
    lines.push(
      'Knowledge points:\n' +
        input.notes.map((n) => `- [${n.id}] ${n.content}`).join('\n')
    );
  }
  lines.push(`Generate the new children of the node "${node}".`);
  return lines.join('\n\n');
}

export function buildAutotuneSystemPrompt(): string {
  return [
    '[MM-STAGE:autotune]',
    'You are a senior information designer. Given the topic, the extracted knowledge points and the section skeleton (from the source\'s own headings), choose the BEST structure parameters.',
    'Return strict JSON: {"depth": number, "maxChildren": number, "maxNodes": number, "reason": string}.',
    'Rules:',
    '- A mind map is an OVERVIEW, not a mirror of the source. maxNodes is the hard total budget: keep it within 30-90 regardless of how many knowledge points exist — related points merge into single leaves later.',
    '- Scale within the band: broad multi-theme sources (many top-level sections) justify 60-90; a narrow or single-theme source needs 30-50.',
    '- A map with BARE branches (a section node with no children while its skeleton shows points) is a defect. depth must let the deepest skeleton sections carry leaf children: depth is at least (deepest skeleton depth + 1) unless that exceeds 6.',
    '- maxChildren: 2-8, chosen to group sections and notes evenly.',
    '- reason: one short sentence (same language as the knowledge points) explaining the choice.',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
}

export function buildAutotuneUserPrompt(
  topic: string,
  notes: DistilledNote[],
  skeleton?: { text: string; maxDepth: number }
): string {
  const lines = [`Topic: ${topic.trim()}`, `Knowledge points (${notes.length}).`];
  if (skeleton != null && skeleton.text !== '') {
    lines.push(
      `Section skeleton (deepest section depth: ${skeleton.maxDepth}):\n${skeleton.text.slice(0, 1200)}`
    );
  }
  return lines.join('\n\n').slice(0, 5500);
}

/* ==================== 图表生成(12 种思考图) ==================== */

export function buildChartSystemPrompt(meta: ChartTypeMeta): string {
  const shapeCatalog = meta.id === 'flow' ? `\n可用形状部件(槽位 "shape" 字段取其 key):${SHAPE_CATALOG_PROMPT}。按语义选择:开始/结束用 terminator,判断用 decision,输入输出用 data,存档用 document,存储用 database,准备用 preparation,人工输入用 manualInput,人工操作用 manualOperation,延迟用 delay,展示用 display,普通步骤用 process。充分但合理地使用部件。` : '';
  const arrowSemantics =
    meta.id === 'flow' || meta.id === 'multiFlow' || meta.id === 'bridge'
      ? '- Arrow semantics: arrows express sequence or cause-effect ONLY. A part-whole / membership relation is expressed by grouping or hierarchy, never by an arrow; a contrast is expressed by parallel placement, never by an arrow.'
      : '';
  return [
    '[MM-STAGE:chart]',
    `You are a senior professional chart maker (资深专业图表制作者) who produces clean, semantically precise diagrams. The user wants a "${meta.name}" (a thinking map type).`,
    `Definition: ${meta.definition}`,
    `Strengths / when to use: ${meta.pros}`,
    `Return strict JSON with EXACTLY this shape: ${meta.slots}`,
    `Example: ${meta.example}`,
    '- Labels concise (under 20 characters), concrete, no numbering, no trailing punctuation.',
    '- Terminology: use ONE consistent term for the same concept across all labels (never both "Agent" and "AI Agent").',
    '- No duplicate nodes: the same concept appears exactly once.',
    arrowSemantics,
    '- Do NOT invent knowledge that is absent from the user content; when the content is thin, produce fewer but meaningful items within the minimum ranges.',
    '- Write labels in the same language as the user content.',
    shapeCatalog,
    'Reply with the JSON object ONLY: no markdown fences, no explanations, no comments.',
  ].filter((l) => l !== '').join('\n');
}

export function buildChartUserPrompt(topic: string, notes: DistilledNote[], chartMeta: ChartTypeMeta): string {
  const notesBlock =
    notes.length > 0
      ? `\n\nExtracted knowledge points from the source (ground your output in them):\n${notes
          .map((n) => `- ${n.content}`)
          .join('\n')
          .slice(0, 4000)}`
      : '';
  return `Topic: ${topic.trim()}${notesBlock}\n\nProduce the ${chartMeta.name} JSON now.`;
}


/* ==================== 部件示例图 ==================== */

export function buildShapeGalleryPrompt(): string {
  const catalog = Object.values(CHART_SHAPES)
    .map((sh) => `${sh.key}(${sh.name})`)
    .join('; ');
  return [
    '[MM-STAGE:shape-gallery]',
    'You are a senior professional chart maker. For EACH shape part in the catalog below, invent ONE typical usage example.',
    'Return strict JSON: {"items": [{"shape": "<catalog key>", "label": "<example label, under 12 chars>", "note": "<one-line usage scenario, under 16 chars>"}]}.',
    `Shape catalog: ${catalog}`,
    'Rules: cover EVERY catalog key exactly once; labels must match the part semantics (e.g. decision → "是否通过?"); use Chinese.',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
}
