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
