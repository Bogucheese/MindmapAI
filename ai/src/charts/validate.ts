/**
 * 图表槽位校验:按图类型检查必需字段;返回错误说明(null = 通过)。
 * 校验是语义最低门槛(字段存在、非空、数量范围),几何与部件在 layout 层兜底。
 */

import type { ChartTypeId } from './catalog';
import type { ChartSlots } from './layout';

const strArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Spec {
  requiredStrings?: string[];
  requiredArrays?: Array<{ key: string; min: number; max?: number }>;
  min?: number;
  max?: number;
}

const SPECS: Partial<Record<ChartTypeId, Spec>> = {
  circle: { requiredStrings: ['center'], requiredArrays: [{ key: 'outer', min: 3, max: 10 }] },
  bubble: { requiredStrings: ['center'], requiredArrays: [{ key: 'bubbles', min: 3, max: 8 }] },
  doubleBubble: {
    requiredStrings: ['left', 'right'],
    requiredArrays: [
      { key: 'shared', min: 1, max: 5 },
      { key: 'leftOnly', min: 1, max: 5 },
      { key: 'rightOnly', min: 1, max: 5 },
    ],
  },
  tree: { requiredStrings: ['root'], requiredArrays: [{ key: 'branches', min: 2, max: 6 }] },
  flow: { requiredStrings: ['title'], requiredArrays: [{ key: 'steps', min: 3, max: 10 }] },
  multiFlow: {
    requiredStrings: ['event'],
    requiredArrays: [
      { key: 'causes', min: 2, max: 5 },
      { key: 'effects', min: 2, max: 5 },
    ],
  },
  brace: { requiredStrings: ['whole'], requiredArrays: [{ key: 'parts', min: 2, max: 8 }] },
  venn: { requiredArrays: [{ key: 'shared', min: 1, max: 5 }] },
  fishbone: { requiredStrings: ['problem'], requiredArrays: [{ key: 'categories', min: 2, max: 6 }] },
  timeline: { requiredArrays: [{ key: 'events', min: 3, max: 10 }] },
  bridge: { requiredArrays: [{ key: 'pairs', min: 2, max: 4 }] },
  org: { requiredStrings: ['root'], requiredArrays: [{ key: 'branches', min: 2, max: 6 }] },
};

export function validateChartSlots(type: ChartTypeId, slots: ChartSlots): string | null {
  if (slots == null || typeof slots !== 'object' || Array.isArray(slots)) {
    return '槽位不是 JSON 对象。';
  }
  const spec = SPECS[type];
  if (spec == null) return null;
  const totalNodes =
    (spec.requiredArrays ?? []).reduce((sum, a) => sum + Math.min(strArr(slots[a.key]).length, a.max ?? 99), 0) +
    (spec.requiredStrings ?? []).length + 1;
  if (spec.min != null && totalNodes < spec.min) {
    return `内容太少(约 ${totalNodes} 个节点),请提供更丰富的主题或来源。`;
  }
  if (spec.max != null && totalNodes > spec.max) {
    return `内容太多(约 ${totalNodes} 个节点),超过图表上限 ${spec.max},请收窄来源。`;
  }
  for (const key of spec.requiredStrings ?? []) {
    const v = slots[key];
    if (typeof v !== 'string' || v.trim() === '') {
      return `缺少必需字段 "${key}"。`;
    }
  }
  for (const a of spec.requiredArrays ?? []) {
    const arr = strArr(slots[a.key]);
    if (arr.length < a.min) {
      return `字段 "${a.key}" 至少需要 ${a.min} 项,当前 ${arr.length} 项。`;
    }
    // 超上限不报错:layout 层按 max 截断(模型偶尔多给一两条属正常)
  }
  if (type === 'flow') {
    // 显式连线:步骤 id 唯一;edges 只引用已渲染(前 10 个)步骤的 id
    const steps = strArr(slots.steps).slice(0, 10);
    const ids = new Set<string>();
    for (const s of steps) {
      const o = s as Record<string, unknown> | null;
      if (o == null || typeof o !== 'object') continue;
      const id = typeof o.id === 'string' ? o.id.trim() : '';
      if (id === '') continue;
      if (ids.has(id)) return `步骤 id "${id}" 重复。`;
      ids.add(id);
    }
    if (Array.isArray(slots.edges)) {
      for (const e of slots.edges as unknown[]) {
        const o = e as Record<string, unknown> | null;
        if (o == null || typeof o !== 'object' || Array.isArray(o)) return 'edges 项必须是对象。';
        const from = typeof o.from === 'string' ? o.from.trim() : '';
        const to = typeof o.to === 'string' ? o.to.trim() : '';
        if (from === '' || !ids.has(from)) return `edges 引用了不存在的步骤 id "${from}"。`;
        if (to === '' || !ids.has(to)) return `edges 引用了不存在的步骤 id "${to}"。`;
      }
    }
  }
  return null;
}

export function chartNodeEstimate(type: ChartTypeId, slots: ChartSlots): number {
  const spec = SPECS[type];
  if (spec == null) return 1;
  return (
    1 +
    (spec.requiredStrings ?? []).length +
    (spec.requiredArrays ?? []).reduce((sum, a) => sum + Math.min(strArr(slots[a.key]).length, a.max ?? 99), 0)
  );
}

/* ---------- 用户规模上限(每张图元素上限,0 = 不限制) ---------- */

/** 各类型的"主集合"字段:上限作用于它们;嵌套/次级集合仍由布局层默认值收敛 */
const PRIMARY_ARRAYS: Partial<Record<ChartTypeId, string[]>> = {
  circle: ['outer'],
  bubble: ['bubbles'],
  doubleBubble: ['shared', 'leftOnly', 'rightOnly'],
  tree: ['branches'],
  flow: ['steps'],
  multiFlow: ['causes', 'effects'],
  brace: ['parts'],
  venn: ['shared'],
  fishbone: ['categories'],
  timeline: ['events'],
  bridge: ['pairs'],
  org: ['branches'],
};

/** venn 的左右集合是嵌套结构(left/right.items),单独处理 */
const NESTED_ITEM_PATHS: Partial<Record<ChartTypeId, string[][]>> = {
  venn: [['left', 'items'], ['right', 'items']],
};

/**
 * 按用户上限截断主集合(0 = 原样)。截断不低于该校验最小值,避免出现
 * "截完验不过"的自相矛盾;嵌套集合按同上限处理。
 */
export function capSlotsItems(type: ChartTypeId, slots: ChartSlots, maxItems: number): ChartSlots {
  if (maxItems <= 0) return slots;
  const spec = SPECS[type];
  const capFor = (key: string): number => {
    const min = spec?.requiredArrays?.find((a) => a.key === key)?.min ?? 1;
    return Math.max(min, maxItems);
  };
  const out: ChartSlots = { ...slots };
  for (const key of PRIMARY_ARRAYS[type] ?? []) {
    const arr = strArr(out[key]);
    const cap = capFor(key);
    if (arr.length > cap) out[key] = arr.slice(0, cap);
  }
  for (const path of NESTED_ITEM_PATHS[type] ?? []) {
    const [parentKey, childKey] = path;
    const parent = out[parentKey];
    if (parent == null || typeof parent !== 'object') continue;
    const items = (parent as Record<string, unknown>)[childKey];
    if (!Array.isArray(items)) continue;
    const cap = Math.max(1, maxItems);
    if (items.length > cap) {
      out[parentKey] = { ...(parent as Record<string, unknown>), [childKey]: items.slice(0, cap) };
    }
  }
  return out;
}
