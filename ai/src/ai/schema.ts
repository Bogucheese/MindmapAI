/**
 * LLM 输出的导图 JSON 树解析与修复阶梯：
 *   去 ``` 围栏 → 截取首尾大括号 → JSON.parse →（失败时去尾逗号重试）→
 *   根级数组容错 → 递归形状校验/清洗 → maxChildren/maxNodes/depth 截断。
 * 每一步的丢弃都计入 stats.dropped，界面层据此决定是否提示用户；
 * 解析彻底失败时返回原文（raw），由调用方决定是否走"重答"修复或展示。
 */

export interface MindmapTree {
  label: string;
  children?: MindmapTree[];
  /**
   * 溯源信息（来源模式生成时由模型回填）：支撑该节点的要点 id 列表。
   * 解析时只做形状校验与清洗，未知 id 留给界面层决定如何提示。
   */
  source?: { noteIds: string[] };
}

export interface TreeConstraints {
  /** 最大层级，根为第 1 层 */
  depth: number;
  /** 每个节点最大子节点数 */
  maxChildren: number;
  /** 总节点数上限 */
  maxNodes: number;
}

export type ParseMindmapResult =
  | { ok: true; tree: MindmapTree; stats: { nodes: number; dropped: number } }
  | { ok: false; reason: 'empty' | 'unparseable' | 'invalid-shape'; raw: string };

const MAX_LABEL_LENGTH = 100;

/** 从 LLM 原文里提取 JSON 候选串；找不到结构化内容时返回 null */
export function extractJson(raw: string): string | null {
  let text = raw.trim();
  if (text === '') return null;

  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?\s*```$/);
  if (fenced != null) {
    text = fenced[1].trim();
  } else if (text.startsWith('```')) {
    // 开头有围栏但结尾没有（常见于 token 截断）：剥掉首行围栏
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  }

  if (text.startsWith('{') || text.startsWith('[')) return text;
  // 杂文包裹："Here is your mind map: {...} hope it helps"
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return null;
}

function cleanLabel(value: unknown): string | null {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else {
    return null;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length > MAX_LABEL_LENGTH ? text.slice(0, MAX_LABEL_LENGTH) : text;
}

/** 递归估算子树节点数（截断计数用，容忍任何形状） */
function subtreeSize(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, v) => sum + subtreeSize(v), 0);
  }
  if (value == null || typeof value !== 'object') return 0;
  const obj = value as Record<string, unknown>;
  return 1 + (Array.isArray(obj.children) ? subtreeSize(obj.children) : 0);
}

interface CleanContext {
  count: number;
  dropped: number;
}

/** nodeIds 清洗上限：单节点引用的要点数 */
const MAX_NOTE_IDS = 8;

/** 校验并清洗 source.noteIds：非字符串元素/空值丢弃，去重保序 */
function cleanNoteIds(value: unknown): string[] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>).noteIds;
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id === '' || seen.has(id) || seen.size >= MAX_NOTE_IDS) continue;
    seen.add(id);
  }
  return [...seen];
}

function cleanNode(
  value: unknown,
  depth: number,
  c: TreeConstraints,
  ctx: CleanContext
): { node: MindmapTree; count: number } | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    ctx.dropped++;
    return null;
  }
  if (ctx.count >= c.maxNodes) {
    ctx.dropped++;
    return null;
  }
  const obj = value as Record<string, unknown>;
  const label = cleanLabel(obj.label ?? obj.name ?? obj.text);
  if (label == null) {
    ctx.dropped++;
    return null;
  }

  const node: MindmapTree = { label };
  const noteIds = cleanNoteIds(obj.source);
  if (noteIds.length > 0) {
    node.source = { noteIds };
  }
  let count = 1;
  ctx.count++;

  if (Array.isArray(obj.children)) {
    if (depth < c.depth) {
      let kept = 0;
      for (const child of obj.children) {
        if (kept >= c.maxChildren || ctx.count >= c.maxNodes) {
          ctx.dropped += subtreeSize(child);
          continue;
        }
        const cleaned = cleanNode(child, depth + 1, c, ctx);
        if (cleaned != null) {
          if (node.children == null) node.children = [];
          node.children.push(cleaned.node);
          kept++;
          count += cleaned.count;
        }
      }
    } else {
      // 超出深度上限：整层截断
      ctx.dropped += subtreeSize(obj.children);
    }
  }

  return { node, count };
}

export function parseMindmapTree(
  raw: string,
  c: TreeConstraints
): ParseMindmapResult {
  if (raw.trim() === '') {
    return { ok: false, reason: 'empty', raw };
  }

  const json = extractJson(raw);
  if (json == null) {
    return { ok: false, reason: 'unparseable', raw };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    try {
      // 宽容修复：LLM 常见的尾逗号
      parsed = JSON.parse(json.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return { ok: false, reason: 'unparseable', raw };
    }
  }

  // 根级数组容错：取第一个对象元素当根（多余部分不计入精确 dropped）
  if (Array.isArray(parsed)) {
    const firstObject = parsed.find(
      (e) => e != null && typeof e === 'object' && !Array.isArray(e)
    );
    if (firstObject == null) {
      return { ok: false, reason: 'invalid-shape', raw };
    }
    parsed = firstObject;
  }

  const ctx: CleanContext = { count: 0, dropped: 0 };
  const cleaned = cleanNode(parsed, 1, c, ctx);
  if (cleaned == null) {
    return { ok: false, reason: 'invalid-shape', raw };
  }
  return { ok: true, tree: cleaned.node, stats: { nodes: cleaned.count, dropped: ctx.dropped } };
}
