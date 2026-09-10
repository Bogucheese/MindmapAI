/**
 * 图表生成管线:来源(可选)→ distill 复用 → 槽位协议 architect → 校验 →
 * 确定性几何布局。结构与部件由 catalog/layout 决定,模型只填内容。
 */

import { chatWithJsonFallback, type ChatFailureKind, type ChatMessage } from '../ai/client';
import { distillNotes } from '../agent/pipeline';
import { parseJsonLoose } from '../agent/pipeline';
import type { AiProviderSettings } from '../settings/settings';
import type { DistilledNote, SourceDoc } from '../agent/types';
import { CHART_TYPES, CHART_TYPE_ORDER, type ChartTypeId } from './catalog';
import { CHART_SHAPES } from './shapes';
import { layoutChart, type ChartElement, type ChartSlots, type ChartDirection } from './layout';
import { layoutGallery } from './gallery';
import { validateChartSlots, chartNodeEstimate } from './validate';
import { buildChartSystemPrompt, buildChartUserPrompt, buildShapeGalleryPrompt } from '../agent/skills';
import type { AgentEmitter } from '../agent/events';
import { t } from '../i18n/keys';

export interface ChartGenerationOptions {
  isCancelled?: () => boolean;
  /** Agent 事件流:提炼要点/每张图完成等真实产物 */
  onEvent?: AgentEmitter;
  timeoutMs?: number;
  chat?: typeof chatWithJsonFallback;
  direction?: ChartDirection;
  onProgress?: (stage: 'distill' | 'architect' | 'render', current?: number, total?: number) => void;
}

export type ChartGenerationResult =
  | { ok: true; type: ChartTypeId; elements: ChartElement[]; slots: ChartSlots; stats: { notes: number; nodes: number } }
  | { ok: false; kind: ChatFailureKind | 'cancelled' | 'schema' | 'no-notes'; status?: number; detail: string; raw?: string };

export async function generateChart(
  settings: AiProviderSettings,
  apiKey: string,
  chartType: ChartTypeId,
  input: { topic: string; doc?: SourceDoc },
  opts: ChartGenerationOptions = {}
): Promise<ChartGenerationResult> {
  const notes = await distillForInput(settings, apiKey, input, opts);
  if ('fail' in notes) return notes.fail;
  if (opts.isCancelled?.() === true) {
    return { ok: false, kind: 'cancelled', detail: '' };
  }
  const result = await chartFromNotes(settings, apiKey, chartType, input.topic, notes.value, opts);
  if (result.ok && opts.onEvent != null) {
    opts.onEvent({ type: 'done', summary: `${CHART_TYPES[chartType].name} · ${result.stats.nodes} ${t('aiAgentNodesWord', 'nodes')}` });
  }
  return result;
}

/** 有来源时提炼(与导图共用同一阶段);无来源返回空要点。 */
async function distillForInput(
  settings: AiProviderSettings,
  apiKey: string,
  input: { topic: string; doc?: SourceDoc },
  opts: ChartGenerationOptions
): Promise<{ value: DistilledNote[] } | { fail: { ok: false; kind: ChatFailureKind | 'cancelled' | 'schema' | 'no-notes'; status?: number; detail: string } }> {
  if (input.doc == null || input.doc.chunks.length === 0) return { value: [] };
  const dist = await distillNotes(settings, apiKey, input.doc, 'auto', {
    isCancelled: opts.isCancelled,
    timeoutMs: opts.timeoutMs ?? 60000,
    chat: opts.chat,
    onProgress: (current, total) => opts.onProgress?.('distill', current, total),
    onEvent: opts.onEvent,
  });
  if (!dist.ok) {
    return { fail: { ok: false, kind: dist.kind, status: dist.status, detail: dist.detail } };
  }
  return { value: dist.notes };
}

/** 单图:槽位协议 architect → 校验 → 确定性布局(提炼已完成,不再重复调用) */
async function chartFromNotes(
  settings: AiProviderSettings,
  apiKey: string,
  chartType: ChartTypeId,
  topic: string,
  notes: DistilledNote[],
  opts: ChartGenerationOptions
): Promise<ChartGenerationResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const timeoutMs = opts.timeoutMs ?? 60000;

  // 槽位协议 architect
  opts.onProgress?.('architect');
  const messages: ChatMessage[] = [
    { role: 'system', content: buildChartSystemPrompt(CHART_TYPES[chartType]) },
    {
      role: 'user',
      content: `${buildChartUserPrompt(topic, notes, CHART_TYPES[chartType])}\n\n节点数预算:大约 ${chartNodeBudget(chartType)} 个。`,
    },
  ];
  const res = await chat(settings, apiKey, messages, { maxTokens: 2048, timeoutMs, temperature: 0.5 });
  if (!res.ok) {
    return { ok: false, kind: res.kind, status: res.status, detail: res.detail, raw: '' };
  }
  const slots = parseJsonLoose(res.content) as ChartSlots | null;
  if (slots == null || typeof slots !== 'object') {
    return { ok: false, kind: 'schema', detail: '图表回复无法解析为 JSON。', raw: res.content };
  }
  const invalid = validateChartSlots(chartType, slots);
  if (invalid != null) {
    return { ok: false, kind: 'schema', detail: invalid, raw: res.content };
  }

  // 确定性布局
  opts.onProgress?.('render');
  const elements = layoutChart(chartType, slots, opts.direction ?? 'vertical');
  if (elements.filter((e) => e.kind === 'vertex').length < 3) {
    return { ok: false, kind: 'schema', detail: '图表内容过少。', raw: res.content };
  }
  const nodes = chartNodeEstimate(chartType, slots);
  if (opts.onEvent != null) {
    opts.onEvent({ type: 'chart', name: CHART_TYPES[chartType].name, nodes });
  }
  return {
    ok: true,
    type: chartType,
    elements,
    slots,
    stats: { notes: notes.length, nodes },
  };
}

function chartNodeBudget(type: ChartTypeId): number {
  const budgets: Partial<Record<ChartTypeId, number>> = {
    circle: 12, bubble: 10, doubleBubble: 16, tree: 20, flow: 10,
    multiFlow: 12, brace: 10, venn: 14, fishbone: 20, timeline: 10, bridge: 8, org: 20,
  };
  return budgets[type] ?? 20;
}


/* ==================== 全景画布:一次生成全部思考图 ==================== */

export interface ChartGalleryResult {
  ok: true;
  /** 拼版后的全部元素(一次 buildChartElements 入画布) */
  elements: ChartElement[];
  charts: Array<{ type: ChartTypeId; elements: ChartElement[] }>;
  /** 单图失败清单(不影响其余图,部分成功即可用) */
  failed: Array<{ type: ChartTypeId; detail: string }>;
  stats: { notes: number };
}

/** 全景画布:提炼一次,12 种思考图逐张生成(单张失败跳过),网格拼版到同一画布。 */
export async function generateChartGallery(
  settings: AiProviderSettings,
  apiKey: string,
  input: { topic: string; doc?: SourceDoc },
  opts: ChartGenerationOptions = {}
): Promise<{ ok: false; kind: ChatFailureKind | 'cancelled' | 'schema' | 'no-notes'; status?: number; detail: string; raw?: string } | ChartGalleryResult> {
  const isCancelled = () => opts.isCancelled?.() === true;
  const notes = await distillForInput(settings, apiKey, input, opts);
  if ('fail' in notes) return notes.fail;
  if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };

  const charts: Array<{ type: ChartTypeId; title: string; elements: ChartElement[] }> = [];
  const failed: Array<{ type: ChartTypeId; detail: string }> = [];
  for (let i = 0; i < CHART_TYPE_ORDER.length; i++) {
    const type = CHART_TYPE_ORDER[i];
    if (isCancelled()) return { ok: false, kind: 'cancelled', detail: '' };
    opts.onProgress?.('architect', i + 1, CHART_TYPE_ORDER.length);
    const r = await chartFromNotes(settings, apiKey, type, input.topic, notes.value, opts);
    if (r.ok) {
      charts.push({ type, title: CHART_TYPES[type].name, elements: r.elements });
    } else if (r.kind === 'cancelled') {
      return { ok: false, kind: 'cancelled', detail: '' };
    } else {
      failed.push({ type, detail: r.detail });
      console.warn('[MindmapAI] gallery chart failed:', type, r.detail);
      opts.onEvent?.({ type: 'warn', text: `${CHART_TYPES[type].name}: ${r.detail}` });
    }
  }
  if (charts.length === 0) {
    return { ok: false, kind: 'schema', detail: '全部图型生成失败。' };
  }
  opts.onProgress?.('render');
  if (opts.onEvent != null) {
    opts.onEvent({ type: 'info', stage: 'render', text: t('aiGalleryLayingOut', 'Laying out panorama canvas...') });
  }
  const elements = layoutGallery(charts);
  if (opts.onEvent != null) {
    opts.onEvent({ type: 'done', summary: `${charts.length}/${CHART_TYPE_ORDER.length} ${t('aiGalleryChartsWord', 'charts')} · ${notes.value.length} ${t('aiAgentNotesWord', 'notes')}` });
  }
  return {
    ok: true,
    elements,
    charts: charts.map(({ type, elements: els }) => ({ type, elements: els })),
    failed,
    stats: { notes: notes.value.length },
  };
}



/* ==================== AI 修改已有图表 ==================== */

export interface ChartEditResult {
  ok: boolean;
  slots?: ChartSlots;
  elements?: ChartElement[];
  detail?: string;
  raw?: string;
}

export async function editChart(
  settings: AiProviderSettings,
  apiKey: string,
  chartType: ChartTypeId,
  currentSlots: ChartSlots,
  instruction: string,
  direction: ChartDirection,
  opts: { timeoutMs?: number; chat?: typeof chatWithJsonFallback } = {}
): Promise<ChartEditResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const meta = CHART_TYPES[chartType];
  const system = [
    '[MM-STAGE:chart-edit]',
    `You are editing an existing "${meta.name}" (a thinking map).`,
    `Definition: ${meta.definition}`,
    `Target slot shape: ${meta.slots}`,
    "You receive the CURRENT chart JSON and the user's edit instruction. Apply the instruction and return the FULL modified chart JSON (same slot shape).",
    'Rules: keep everything the user did not ask to change; keep labels concise; do not invent unrelated content.',
    'Reply with the JSON object ONLY: no markdown fences, no explanations.',
  ].join('\n');
  const user = `Current chart JSON:\n${JSON.stringify(currentSlots).slice(0, 5000)}\n\nUser instruction: ${instruction.trim().slice(0, 500)}\n\nReturn the modified JSON now.`;
  const res = await chat(settings, apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { maxTokens: 2048, timeoutMs: opts.timeoutMs ?? 60000, temperature: 0.3 });
  if (!res.ok) {
    return { ok: false, detail: res.detail };
  }
  const slots = parseJsonLoose(res.content) as ChartSlots | null;
  if (slots == null || typeof slots !== 'object') {
    return { ok: false, detail: '回复无法解析为 JSON。', raw: res.content };
  }
  const invalid = validateChartSlots(chartType, slots);
  if (invalid != null) {
    return { ok: false, detail: invalid, raw: res.content };
  }
  const elements = layoutChart(chartType, slots, direction);
  return { ok: true, slots, elements };
}


/* ==================== 部件示例图(AI 为全部部件生成实例) ==================== */

export interface ShapeGalleryItem {
  shape: string;
  label: string;
  note: string;
}

/** 内置兜底:AI 缺漏的部件用默认示例补齐 */
const GALLERY_FALLBACK: Record<string, { label: string; note: string }> = {
  process: { label: '处理事务', note: '流程中的标准步骤' },
  terminator: { label: '开始/结束', note: '流程起点与终点' },
  decision: { label: '是否通过?', note: '二选一的判断分支' },
  data: { label: '提交表单', note: '数据的输入与输出' },
  document: { label: '生成报告', note: '文档类产出' },
  database: { label: '存储记录', note: '持久化数据源' },
  preparation: { label: '准备阶段', note: '前置准备工作' },
  manualInput: { label: '人工录入', note: '手工输入信息' },
  manualOperation: { label: '人工复核', note: '需要人工操作的环节' },
  delay: { label: '等待审核', note: '流程中的等待期' },
  display: { label: '大屏展示', note: '结果对外展示' },
  ellipse: { label: '主题气泡', note: '环绕主题的属性' },
  card: { label: '部门卡片', note: '组织架构单元' },
  text: { label: '标注说明', note: '补充说明文字' },
  actor: { label: '项目负责人', note: '组织成员' },
  triangle: { label: '风险提示', note: '需要警示的环节' },
  note: { label: '备注便签', note: '临时备注信息' },
};

export interface ShapeGalleryResult {
  ok: boolean;
  elements?: ChartElement[];
  detail?: string;
  raw?: string;
}

export async function generateShapeGallery(
  settings: AiProviderSettings,
  apiKey: string,
  opts: { timeoutMs?: number; chat?: typeof chatWithJsonFallback } = {}
): Promise<ShapeGalleryResult> {
  const chat = opts.chat ?? chatWithJsonFallback;
  const res = await chat(settings, apiKey, [
    { role: 'system', content: buildShapeGalleryPrompt() },
    { role: 'user', content: '为全部形状部件生成示例。' },
  ], { maxTokens: 2048, timeoutMs: opts.timeoutMs ?? 60000, temperature: 0.5 });
  if (!res.ok) {
    return { ok: false, detail: res.detail };
  }
  const parsed = parseJsonLoose(res.content) as { items?: unknown } | null;
  if (parsed == null || !Array.isArray(parsed.items)) {
    return { ok: false, detail: '回复无法解析。', raw: res.content };
  }
  // 白名单化 + 缺漏补齐
  const items: ShapeGalleryItem[] = [];
  const seen = new Set<string>();
  for (const item of parsed.items) {
    if (item == null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const shape = typeof o.shape === 'string' ? o.shape : '';
    if (CHART_SHAPES[shape] == null || seen.has(shape)) continue;
    seen.add(shape);
    items.push({
      shape,
      label: typeof o.label === 'string' && o.label.trim() !== '' ? o.label.trim().slice(0, 14) : GALLERY_FALLBACK[shape]?.label ?? shape,
      note: typeof o.note === 'string' && o.note.trim() !== '' ? o.note.trim().slice(0, 18) : GALLERY_FALLBACK[shape]?.note ?? '',
    });
  }
  for (const key of Object.keys(CHART_SHAPES)) {
    if (!seen.has(key)) {
      items.push({ shape: key, label: GALLERY_FALLBACK[key]?.label ?? key, note: GALLERY_FALLBACK[key]?.note ?? '' });
    }
  }

  // 网格布局:每行 4 格,每格 = 部件形状(示例标签)+ 部件名标注
  const elements: ChartElement[] = [];
  const cols = 4;
  const cellW = 240;
  const cellH = 150;
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 60 + col * cellW;
    const y = 60 + row * cellH;
    const shapeStyle = CHART_SHAPES[item.shape].style;
    elements.push({
      kind: 'vertex', label: item.label, style: `${shapeStyle}fillColor=#DAE8FC;strokeColor=#6C8EBF;`,
      x: x + 20, y: y + 10, w: 170, h: 70,
    });
    elements.push({
      kind: 'vertex', label: `${CHART_SHAPES[item.shape].name}${item.note !== '' ? `\n${item.note}` : ''}`,
      style: `text;html=1;align=center;verticalAlign=top;fontSize=10;fontColor=#666666;mindmapAI=1;`,
      x: x + 10, y: y + 88, w: 190, h: 44,
    });
  });
  return { ok: true, elements };
}
