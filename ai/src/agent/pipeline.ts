/**
 * 来源模式生成管线（agent 层）：INGEST → DISTILL → ARCHITECT → CRITIQUE
 * (不达标回炉一次) → RENDER。工具由管线代码确定性调用，LLM 只在阶段内
 * 做提炼/构造/评审——刻意不做自由 ReAct，保证可控、可测、可展示进度。
 *
 * 预算（P0 常量即预算）：单请求 maxTokens 4096、每块要点上限 12、
 * 要点总量上限 80、评审回炉至多 1 次、阶段间与分块间响应取消。
 */

import { chatWithJsonFallback, type ChatFailureKind, type ChatMessage } from '../ai/client';
import type { ChartElement } from '../charts/layout';
import { generateExtras, type ExtrasResult } from '../charts/extras-gen';
import { buildRepairPrompt, type GenerationConstraints, type OutputLanguage } from '../ai/prompts';
import { extractJson, parseMindmapTree, type MindmapTree } from '../ai/schema';
import type { AiProviderSettings } from '../settings/settings';
import {
  buildArchitectReviseUserPrompt,
  buildArchitectSystemPrompt,
  buildArchitectUserPrompt,
  buildAutotuneSystemPrompt,
  buildAutotuneUserPrompt,
  buildCritiqueSystemPrompt,
  buildCritiqueUserPrompt,
  buildDistillSystemPrompt,
  buildDistillUserPrompt,
} from './skills';
import type { CritiqueReport, DistilledNote, SourceDoc } from './types';

export type PipelineStage = 'ingest' | 'distill' | 'autotune' | 'architect' | 'critique' | 'render';

export interface PipelineProgress {
  stage: PipelineStage;
  current?: number;
  total?: number;
}

export interface PipelineOptions {
  onProgress?: (p: PipelineProgress) => void;
  /** 阶段间与分块间检查；为 true 时尽快以 kind 'cancelled' 返回 */
  isCancelled?: () => boolean;
  /** 单次请求超时（缺省 60s，与 generateMindmapTree 一致） */
  timeoutMs?: number;
  /** 关闭评审可提速（缺省开启） */
  critiqueEnabled?: boolean;
  /** 让 AI 在 ARCHITECT 前根据要点推荐 depth/maxChildren/maxNodes（缺省手动） */
  autoConstraints?: boolean;
  /** 详细模式:全部要点逐条成叶、引文成引用子节点,跳过合并与预算 */
  detailMode?: boolean;
  /** 测试注入：默认 chatWithJsonFallback */
  chat?: typeof chatWithJsonFallback;
}

export interface AutotuneChoice {
  depth: number;
  maxChildren: number;
  maxNodes: number;
  reason: string;
}

export type PipelineResult =
  | {
      ok: true;
      tree: MindmapTree;
      notes: DistilledNote[];
      critique: CritiqueReport | null;
      /** 复合画布 extras(详细模式 + 大来源时):支线小图/表格/关系图元素 */
      extras?: ChartElement[];
      stats: {
        chunks: number;
        chunkFailures: number;
        notes: number;
        /** CRITIQUE 触发的重构次数（0 或 1） */
        revisions: number;
        /** parseMindmapTree 报告的截断丢弃数 */
        dropped: number;
        /** 自动参数开启时的 AI 推荐（解析失败为 null，回退手动值） */
        autotune?: AutotuneChoice | null;
      };
    }
  | { ok: false; kind: ChatFailureKind | 'schema' | 'cancelled' | 'no-notes'; status?: number; detail: string; raw?: string };

const DISTILL_MAX_NOTES_PER_CHUNK = 16;
const MAX_NOTES_TOTAL = 120;
const ARCHITECT_MAX_TOKENS = 4096;
const CRITIQUE_MAX_TOKENS = 1024;
const MAX_QUOTE_CHARS = 300;
const MAX_CONTENT_CHARS = 200;
const CRITIQUE_REVISE_THRESHOLD = 70;

/** 宽容解析阶段 JSON：去围栏/截大括号/去尾逗号（复用 schema 的阶梯） */
export function parseJsonLoose(raw: string): unknown | null {
  const json = extractJson(raw);
  if (json == null) return null;
  try {
    return JSON.parse(json);
  } catch {
    try {
      return JSON.parse(json.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function clampScore(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : 0;
  return Math.min(100, Math.max(0, n));
}

/** 解析 CRITIQUE 阶段回复；形状不对返回 null（管线降级为"无评审"，不算失败） */
export function parseCritiqueReport(raw: string): CritiqueReport | null {
  const parsed = parseJsonLoose(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const scoresRaw = obj.scores;
  if (scoresRaw == null || typeof scoresRaw !== 'object' || Array.isArray(scoresRaw)) return null;
  const s = scoresRaw as Record<string, unknown>;
  const scores = {
    grounding: clampScore(s.grounding),
    coverage: clampScore(s.coverage),
    specificity: clampScore(s.specificity),
    structure: clampScore(s.structure),
  };
  const verdict = obj.verdict === 'revise' ? 'revise' : obj.verdict === 'pass' ? 'pass' : null;
  if (verdict == null) return null;
  const feedback = typeof obj.feedback === 'string' ? obj.feedback.slice(0, 500) : '';
  const values = Object.values(scores);
  const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { scores, overall, verdict, feedback };
}

/** 清洗单块要点：id 规范化（保留模型给的唯一 id，冲突时回退 cNnM）、截断、过滤空行 */
function sanitizeNotes(
  parsed: unknown,
  chunkId: string,
  headingPath: string | undefined,
  seenContents: Set<string>,
  usedIds: Set<string>
): DistilledNote[] {
  const notes: DistilledNote[] = [];
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return notes;
  const list = (parsed as Record<string, unknown>).notes;
  if (!Array.isArray(list)) return notes;
  for (let i = 0; i < list.length && notes.length < DISTILL_MAX_NOTES_PER_CHUNK; i++) {
    const item = list[i];
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content.replace(/\s+/g, ' ').trim() : '';
    if (content === '') continue;
    const key = content.toLowerCase();
    if (seenContents.has(key)) continue;
    const quote = typeof obj.quote === 'string' ? obj.quote.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS) : '';
    let id = typeof obj.id === 'string' && obj.id.trim() !== '' ? obj.id.trim() : '';
    if (id === '' || usedIds.has(id)) {
      id = `${chunkId}n${i + 1}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${chunkId}n${i + 1}_${suffix++}`;
      }
    }
    usedIds.add(id);
    seenContents.add(key);
    notes.push({
      id,
      content: content.slice(0, MAX_CONTENT_CHARS),
      quote,
      chunkId,
      headingPath: headingPath != null && headingPath !== '' ? headingPath : undefined,
    });
  }
  return notes;
}

/* ==================== 章节骨架（确定性，来自来源自身标题） ==================== */

export interface SkeletonNode {
  label: string;
  children: SkeletonNode[];
  /** 归属本章节(含后代折叠)的要点 */
  notes: DistilledNote[];
  /** 仅记录"因骨架压缩而直接折叠到本节点"的要点(装配合并叶用) */
  folded: DistilledNote[];
  depth: number;
}

export interface SkeletonStats {
  /** 缩进文本（每行 "- 路径 (要点数)"），供 prompt 使用 */
  text: string;
  /** 最深章节层级（headingPath 段数） */
  maxDepth: number;
  /** 不同章节数 */
  sectionCount: number;
  /** 一级章节数（每章叶子配额分配用） */
  topLevelCount: number;
  /** 全部章节段 label（公平裁剪的保护名单） */
  labels: Set<string>;
  /** 骨架树（装配用） */
  root: SkeletonNode;
}

/** 从要点的 headingPath 构建章节骨架：导图结构镜像来源目录，要点作叶子。
 *  大来源（章节数 > SKELETON_COMPRESS_ABOVE）只展开前 SKELETON_LEVELS 层，
 *  更深的章节折叠进父节点的要点计数——骨架本身有界，architect 才能
 *  在预算内完成"概览"而不是全文镜像。 */
export const SKELETON_COMPRESS_ABOVE = 12;
export const SKELETON_LEVELS = 2;

export function buildSkeleton(notes: DistilledNote[]): SkeletonStats {
  const full = buildSkeletonLevels(notes, 6);
  if (full.sectionCount > SKELETON_COMPRESS_ABOVE) {
    return buildSkeletonLevels(notes, SKELETON_LEVELS);
  }
  return full;
}

function buildSkeletonLevels(notes: DistilledNote[], maxLevels: number): SkeletonStats {
  interface Node {
    label: string;
    children: Map<string, Node>;
    notes: DistilledNote[];
    folded: DistilledNote[];
    depth: number;
  }
  // 若所有路径共享同一段首段(如整站名/文档题 H1),去掉——与根节点冗余
  const rootChildren = new Map<string, Node>();
  let maxDepth = 0;
  let sectionCount = 0;

  const insertPath = (path: string[], note: DistilledNote): void => {
    if (path.length === 0) return;
    let level = rootChildren;
    let depth = 0;
    let last: Node | null = null;
    for (let i = 0; i < path.length; i++) {
      // 超过展开层级:要点归属到最深已展开章节(装配时合并为叶子)
      if (depth >= maxLevels) {
        last!.notes.push(note);
        last!.folded.push(note);
        return;
      }
      depth++;
      const seg = path[i];
      let node = level.get(seg);
      if (node == null) {
        node = { label: seg, children: new Map(), notes: [], folded: [], depth };
        level.set(seg, node);
        sectionCount++;
        if (depth > maxDepth) maxDepth = depth;
      }
      node.notes.push(note);
      last = node;
      level = node.children;
    }
  };

  const pairs = notes
    .filter((n) => n.headingPath != null && n.headingPath !== '')
    .map((n) => ({ note: n, path: n.headingPath!.split(' > ') }));
  if (pairs.length > 1) {
    const first = pairs[0].path[0];
    // 仅当共享首段且该段是真正的父级(所有路径都还有后续层级)时归一化
    if (first != null && pairs.every((p) => p.path.length >= 2 && p.path[0] === first)) {
      for (const p of pairs) p.path.shift();
    }
  }
  for (const pair of pairs) {
    insertPath(pair.path, pair.note);
  }

  const toSkeletonNode = (node: Node): SkeletonNode => ({
    label: node.label,
    notes: node.notes,
    folded: node.folded,
    depth: node.depth,
    children: [...node.children.values()].map(toSkeletonNode),
  });
  const children = [...rootChildren.values()].map(toSkeletonNode);
  const labels = new Set<string>();
  const collect = (nodes: SkeletonNode[]): void => {
    for (const n of nodes) {
      labels.add(n.label);
      collect(n.children);
    }
  };
  collect(children);
  const lines: string[] = [];
  const walk = (nodes: SkeletonNode[], prefix: string): void => {
    for (const node of nodes) {
      const path = prefix === '' ? node.label : `${prefix} > ${node.label}`;
      lines.push(`- ${path} (${node.notes.length} point${node.notes.length > 1 ? 's' : ''})`);
      walk(node.children, path);
    }
  };
  walk(children, '');
  return {
    text: lines.join('\n'),
    maxDepth,
    sectionCount,
    topLevelCount: children.length,
    labels,
    root: { label: '', notes: [], folded: [], depth: 0, children },
  };
}

/** architect 叶子字典的解析与清洗：键 = 骨架章节路径原样,值 = 叶子数组 */
function parseArchitectLeaves(raw: string): Map<string, Array<{ label: string; noteIds: string[] }>> | null {
  const parsed = parseJsonLoose(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const leavesRaw = (parsed as Record<string, unknown>).leaves;
  if (leavesRaw == null || typeof leavesRaw !== 'object' || Array.isArray(leavesRaw)) return null;
  const map = new Map<string, Array<{ label: string; noteIds: string[] }>>();
  for (const [section, list] of Object.entries(leavesRaw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const key = section.trim();
    if (key === '') continue;
    const leaves: Array<{ label: string; noteIds: string[] }> = [];
    for (const item of list) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      const label = typeof obj.label === 'string' ? obj.label.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
      if (label === '') continue;
      let noteIds: string[] = [];
      if (obj.source != null && typeof obj.source === 'object' && !Array.isArray(obj.source)) {
        const ids = (obj.source as Record<string, unknown>).noteIds;
        if (Array.isArray(ids)) {
          noteIds = ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
        }
      }
      leaves.push({ label, noteIds });
    }
    map.set(key, leaves);
  }
  return map;
}

/**
 * 骨架装配。
 *  overview 模式(leavesMap 非 null):叶子来自模型(按配额截断,截掉的
 *  noteIds 并入末位叶子);
 *  detail 模式(leavesMap 为 null):全部要点逐条成叶,引文再成叶子的
 *  引用子节点——要点与细节完整展示,不调用 architect 合并。
 */
function assembleMindmap(
  skeletonRoot: SkeletonNode,
  leavesMap: Map<string, Array<{ label: string; noteIds: string[] }>> | null,
  quotaFor: (sectionNotes: number) => number,
  rootLabel: string
): { tree: MindmapTree; dropped: number } {
  let dropped = 0;
  const detail = leavesMap == null;
  const detailLeaf = (n: DistilledNote): MindmapTree => {
    const leaf: MindmapTree = { label: n.content, source: { noteIds: [n.id] } };
    if (n.quote !== '') {
      // 引文成为导图的引用部位(子节点)
      leaf.children = [{ label: `「${n.quote}」`, source: { noteIds: [n.id] } }];
    }
    return leaf;
  };
  const build = (node: SkeletonNode, path: string[]): MindmapTree => {
    const pathStr = path.join(' > ');
    const modelLeaves = detail ? [] : leavesMap!.get(pathStr) ?? [];
    const tree: MindmapTree = { label: path.length === 0 ? rootLabel : node.label };
    if (node.children.length > 0) {
      tree.children = node.children.map((child) => build(child, [...path, child.label]));
      if (path.length > 0 && node.folded.length > 0) {
        if (detail) {
          for (const n of node.folded) tree.children.push(detailLeaf(n));
        } else {
          tree.children.push({
            label: node.folded[0].content,
            source: { noteIds: node.folded.map((n) => n.id) },
          });
        }
      }
    } else if (path.length > 0) {
      if (detail) {
        tree.children = node.notes.map((n) => detailLeaf(n));
      } else {
        const quota = quotaFor(node.notes.length);
        const kept = modelLeaves.slice(0, Math.max(1, quota));
        const overflow = modelLeaves.slice(kept.length);
        dropped += overflow.length;
        if (overflow.length > 0 && kept.length > 0) {
          const last = kept[kept.length - 1];
          for (const o of overflow) {
            for (const id of o.noteIds) {
              if (!last.noteIds.includes(id)) last.noteIds.push(id);
            }
          }
        }
        if (kept.length > 0) {
          tree.children = kept.map((l) => ({ label: l.label, source: { noteIds: l.noteIds } }));
        } else if (node.notes.length > 0) {
          tree.children = [{ label: node.label, source: { noteIds: node.notes.map((n) => n.id) } }];
        }
      }
    }
    return tree;
  };
  const tree = build(skeletonRoot, []);
  return { tree, dropped };
}

/** 解析并钳位 AUTO-TUNE 推荐；形状不对返回 null（回退手动值，不算失败） */
export function parseAutotuneChoice(raw: string, manual: GenerationConstraints): AutotuneChoice | null {
  const parsed = parseJsonLoose(raw);
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const clampInt = (v: unknown, min: number, max: number, d: number): number =>
    typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
  const depth = clampInt(obj.depth, 1, 6, manual.depth);
  const maxChildren = clampInt(obj.maxChildren, 1, 10, manual.maxChildren);
  const maxNodes = clampInt(obj.maxNodes, depth * 2, 200, manual.maxNodes);
  const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '';
  const changed =
    depth !== manual.depth || maxChildren !== manual.maxChildren || maxNodes !== manual.maxNodes;
  if (!changed && reason === '') return null;
  return { depth, maxChildren, maxNodes, reason };
}

/** 供来源模式与图表生成共用的提炼阶段(单块失败跳过,全部失败/无要点才算失败) */
export interface DistillOutcome {
  ok: true;
  notes: DistilledNote[];
  chunkFailures: number;
}

export async function distillNotes(
  settings: AiProviderSettings,
  apiKey: string,
  doc: SourceDoc,
  language: OutputLanguage,
  opts: {
    isCancelled?: () => boolean;
    timeoutMs?: number;
    chat?: typeof chatWithJsonFallback;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<DistillOutcome | { ok: false; kind: ChatFailureKind | 'cancelled' | 'no-notes'; status?: number; detail: string }> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const isCancelled = () => opts.isCancelled?.() === true;
  const notes: DistilledNote[] = [];
  const seenContents = new Set<string>();
  const usedIds = new Set<string>();
  let chunkFailures = 0;
  let lastFailure: { kind: ChatFailureKind; status?: number; detail: string } | null = null;
  const chunks = doc.chunks;
  opts.onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled()) {
      return { ok: false, kind: 'cancelled', detail: '' };
    }
    opts.onProgress?.(i + 1, chunks.length);
    const messages: ChatMessage[] = [
      { role: 'system', content: buildDistillSystemPrompt(language, DISTILL_MAX_NOTES_PER_CHUNK) },
      { role: 'user', content: buildDistillUserPrompt(chunks[i]) },
    ];
    const res = await chat(settings, apiKey, messages, { maxTokens: 2048, timeoutMs, temperature: 0.5 });
    if (!res.ok) {
      chunkFailures++;
      lastFailure = { kind: res.kind, status: res.status, detail: res.detail };
      continue;
    }
    const parsed = parseJsonLoose(res.content);
    const batch = sanitizeNotes(parsed, chunks[i].id, chunks[i].headingPath, seenContents, usedIds);
    for (const n of batch) {
      if (notes.length >= MAX_NOTES_TOTAL) break;
      notes.push(n);
    }
    if (notes.length >= MAX_NOTES_TOTAL) break;
  }
  if (notes.length === 0) {
    if (lastFailure != null) {
      return { ok: false, kind: lastFailure.kind, status: lastFailure.status, detail: lastFailure.detail };
    }
    return { ok: false, kind: 'no-notes', detail: 'No knowledge points extracted.' };
  }
  return { ok: true, notes, chunkFailures };
}

export async function generateMindmapFromSource(
  settings: AiProviderSettings,
  apiKey: string,
  input: { topic: string; doc: SourceDoc },
  constraints: GenerationConstraints,
  opts: PipelineOptions = {}
): Promise<PipelineResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const critiqueEnabled = opts.critiqueEnabled !== false;
  const isCancelled = () => opts.isCancelled?.() === true;
  const onProgress = opts.onProgress ?? (() => {});
  const topic = input.topic.trim();

  // INGEST：粘贴文本模式下来源已在进入管线前构建完毕
  onProgress({ stage: 'ingest', total: input.doc.chunks.length });
  if (isCancelled()) {
    return { ok: false, kind: 'cancelled', detail: '' };
  }

  // DISTILL：逐块提炼（单块失败跳过，全部失败才算失败）
  const dist = await distillNotes(settings, apiKey, input.doc, constraints.language, {
    isCancelled,
    timeoutMs,
    chat,
    onProgress: (current, total) => onProgress({ stage: 'distill', current, total }),
  });
  if (!dist.ok) {
    return { ok: false, kind: dist.kind, status: dist.status, detail: dist.detail };
  }
  const notes = dist.notes;

  // 章节骨架（确定性，大来源自动压缩）：导图结构镜像来源目录。
  // depth 下限防裸分支（parse 截断的根因）；maxNodes 是硬预算——思维导图
  // 是概览而非全文镜像，architect 按预算把相关要点合并成叶子。
  const skeleton = buildSkeleton(notes);
  const depthFloor = Math.min(skeleton.maxDepth + 2, 6);
  let architectConstraints: GenerationConstraints = {
    ...constraints,
    depth: Math.max(constraints.depth, depthFloor),
  };
  let extrasPromise: Promise<ExtrasResult> | null = null;
  if (opts.detailMode === true) {
    // 详细模式:全部要点逐条成叶 + 引文成引用子节点。结构由骨架决定,
    // 不调用 autotune/architect;大来源由 AI 生成复合画布 extras。
    if (isCancelled()) {
      return { ok: false, kind: 'cancelled', detail: '' };
    }
    architectConstraints = {
      ...architectConstraints,
      maxNodes: skeleton.sectionCount + notes.length * 2 + 1,
    };
    if (notes.length >= 6) {
      extrasPromise = generateExtras(settings, apiKey, notes, skeleton, {
        isCancelled,
        timeoutMs,
        chat,
        onProgress: (stage: 'architect' | 'render') => onProgress({ stage: stage === 'architect' ? 'architect' : 'render' }),
      });
    }
    onProgress({ stage: 'architect' });
  }
  let autotune: AutotuneChoice | null = null;
  if (!opts.detailMode && opts.autoConstraints === true) {
    if (isCancelled()) {
      return { ok: false, kind: 'cancelled', detail: '' };
    }
    onProgress({ stage: 'autotune' });
    const res = await chat(settings, apiKey, [
      { role: 'system', content: buildAutotuneSystemPrompt() },
      { role: 'user', content: buildAutotuneUserPrompt(topic, notes, skeleton) },
    ], { maxTokens: 512, timeoutMs, temperature: 0.3 });
    if (res.ok) {
      autotune = parseAutotuneChoice(res.content, architectConstraints);
      if (autotune != null) {
        const depth = Math.max(autotune.depth, depthFloor);
        architectConstraints = { ...architectConstraints, depth, maxChildren: autotune.maxChildren, maxNodes: autotune.maxNodes };
        autotune = { ...autotune, depth };
      }
    }
  }

  // 每章叶子配额(按该章要点数加权,写进 prompt):要点多于预算时不裁素材,
  // 由 architect 合并——装配时再按配额确定性截断,天然有界且全覆盖。
  const leafBudget = Math.max(architectConstraints.maxNodes - skeleton.sectionCount - 1, 8);
  const totalNotes = Math.max(1, notes.length);
  const quotaFor = (sectionNotes: number): number =>
    Math.max(1, Math.round((leafBudget * sectionNotes) / totalNotes));
  const quotaLines = skeleton.root.children.map((sec) => {
    const q = quotaFor(sec.notes.length);
    const sub = sec.children.length > 0 ? ` (covers ${sec.children.length} sub-sections)` : '';
    return `- ${sec.label}${sub}: at most ${q} leaf children`;
  });
  const architectNotes = notes;

  // ARCHITECT：要点 → 候选树（parse 失败走一次重答，与主题模式同款）
  if (isCancelled()) {
    return { ok: false, kind: 'cancelled', detail: '' };
  }
  onProgress({ stage: 'architect' });
  const architectMessages = (): ChatMessage[] => [
    { role: 'system', content: buildArchitectSystemPrompt(architectConstraints, skeleton.text) },
    { role: 'user', content: buildArchitectUserPrompt(topic, architectNotes, skeleton.text, quotaLines.join('\n')) },
  ];
  const architectOnce = async (
    messages: ChatMessage[]
  ): Promise<{ ok: true; tree: MindmapTree; dropped: number; raw: string } | { ok: false; fail: PipelineResult } | { ok: false; raw: string }> => {
    const res = await chat(settings, apiKey, messages, { maxTokens: ARCHITECT_MAX_TOKENS, timeoutMs, temperature: 0.5 });
    if (!res.ok) {
      return { ok: false, fail: { ok: false, kind: res.kind, status: res.status, detail: res.detail, raw: '' } };
    }
    if (skeleton.text !== '') {
      // 骨架模式:解析叶子字典 → 确定性装配(结构有界且全覆盖)
      const leavesMap = parseArchitectLeaves(res.content);
      if (leavesMap == null) {
        return { ok: false, raw: res.content };
      }
      const { tree, dropped } = assembleMindmap(skeleton.root, leavesMap, quotaFor, topic);
      return { ok: true, tree, dropped, raw: res.content };
    }
    // 无骨架:旧式自由建树 + 公平裁剪兜底
    const parsed = parseMindmapTree(res.content, architectConstraints);
    if (parsed.ok) {
      return { ok: true, tree: parsed.tree, dropped: parsed.stats.dropped, raw: res.content };
    }
    return { ok: false, raw: res.content };
  };

  let built: { ok: true; tree: MindmapTree; dropped: number; raw: string } | { ok: false; fail: PipelineResult } | { ok: false; raw: string };
  if (opts.detailMode === true && skeleton.text !== '') {
    // 详细模式:跳过 architect,骨架 + 全部要点确定性装配
    onProgress({ stage: 'architect' });
    const det = assembleMindmap(skeleton.root, null, quotaFor, topic);
    built = { ok: true, tree: det.tree, dropped: det.dropped, raw: '' };
  } else {
    built = await architectOnce(architectMessages());
    if (!built.ok && 'fail' in built) return built.fail;
    if (!built.ok) {
      const repairMessages: ChatMessage[] = [
        ...architectMessages(),
        { role: 'assistant', content: built.raw.slice(0, 2000) },
        { role: 'user', content: buildRepairPrompt() },
      ];
      const repaired = await architectOnce(repairMessages);
      if (!repaired.ok && 'fail' in repaired) return repaired.fail;
      if (!repaired.ok) {
        return { ok: false, kind: 'schema', detail: 'Architect reply could not be parsed as a mind map.', raw: built.raw };
      }
      built = repaired;
    }
  }
  let tree = built.tree;
  let dropped = built.dropped;

  // CRITIQUE：rubric 评分；不达标（任一维度 <70）携反馈回炉一次
  let critique: CritiqueReport | null = null;
  let revisions = 0;
  if (critiqueEnabled) {
    if (isCancelled()) {
      return { ok: false, kind: 'cancelled', detail: '' };
    }
    onProgress({ stage: 'critique' });
    const critiqueMessages: ChatMessage[] = [
      { role: 'system', content: buildCritiqueSystemPrompt() },
      { role: 'user', content: buildCritiqueUserPrompt(topic, tree, architectNotes, skeleton.text) },
    ];
    const res = await chat(settings, apiKey, critiqueMessages, {
      maxTokens: CRITIQUE_MAX_TOKENS,
      timeoutMs,
      temperature: 0,
    });
    if (res.ok) {
      critique = parseCritiqueReport(res.content);
    }
    if (
      critique != null &&
      critique.verdict === 'revise' &&
      (critique.scores.grounding < CRITIQUE_REVISE_THRESHOLD ||
        critique.scores.coverage < CRITIQUE_REVISE_THRESHOLD ||
        critique.scores.specificity < CRITIQUE_REVISE_THRESHOLD ||
        critique.scores.structure < CRITIQUE_REVISE_THRESHOLD)
    ) {
      if (isCancelled()) {
        return { ok: false, kind: 'cancelled', detail: '' };
      }
      onProgress({ stage: 'architect' });
      const reviseUser = skeleton.text !== ''
        ? `${buildArchitectUserPrompt(topic, architectNotes, skeleton.text, quotaLines.join('\n'))}\n\nReviewer feedback you must address: ${critique.feedback.slice(0, 400)}`
        : buildArchitectReviseUserPrompt(topic, tree, critique.feedback);
      const revised = await architectOnce([
        { role: 'system', content: buildArchitectSystemPrompt(architectConstraints, skeleton.text) },
        { role: 'user', content: reviseUser },
      ]);
      if (revised.ok) {
        tree = revised.tree;
        dropped += revised.dropped;
        revisions = 1;
      }
      // 重构解析失败：保留原树（评审意见已尽力），不算失败
    }
  }

  onProgress({ stage: 'render' });
  let extras: ChartElement[] | undefined;
  if (extrasPromise != null) {
    try {
      const ex = await extrasPromise;
      if (ex.ok && ex.elements != null) {
        extras = ex.elements;
        console.info('[MindmapAI] extras built:', ex.elements.length, 'elements');
      } else {
        console.warn('[MindmapAI] extras skipped:', ex.detail ?? 'unknown');
      }
    } catch (err) {
      console.warn('[MindmapAI] extras failed:', err);
      // extras 失败不影响主图
    }
  }
  return {
    ok: true,
    tree,
    notes,
    critique,
    extras,
    stats: {
      chunks: input.doc.chunks.length,
      chunkFailures: dist.chunkFailures,
      notes: notes.length,
      revisions,
      dropped,
      autotune,
    },
  };
}
