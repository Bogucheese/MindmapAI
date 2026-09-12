/**
 * 思考图规模上限(capSlotsItems)与类型显示名 i18n 测试。
 */

import { describe, expect, it } from 'vitest';
import { capSlotsItems } from '../src/charts/validate';
import { chartTypeName } from '../src/charts/catalog';
import type { ChartSlots } from '../src/charts/layout';

describe('capSlotsItems', () => {
  it('caps flow steps at the user limit', () => {
    const slots = {
      title: 't',
      steps: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `step${i}` })),
    } as unknown as ChartSlots;
    const capped = capSlotsItems('flow', slots, 5) as { steps: unknown[] };
    expect(capped.steps).toHaveLength(5);
  });

  it('never truncates below the validation minimum (avoids self-conflict)', () => {
    const slots = {
      title: 't',
      steps: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `step${i}` })),
    } as unknown as ChartSlots;
    // flow steps 最小 3:上限 2 应被抬到 3
    const capped = capSlotsItems('flow', slots, 2) as { steps: unknown[] };
    expect(capped.steps).toHaveLength(3);
  });

  it('caps circle outer and double-bubble side lists', () => {
    const circle = { center: 'c', outer: ['1', '2', '3', '4', '5', '6', '7'] } as unknown as ChartSlots;
    expect((capSlotsItems('circle', circle, 4) as { outer: string[] }).outer).toHaveLength(4);
    const db = {
      left: 'A', right: 'B',
      shared: ['1', '2', '3'], leftOnly: ['1', '2', '3', '4'], rightOnly: ['1'],
    } as unknown as ChartSlots;
    const capped = capSlotsItems('doubleBubble', db, 2) as { shared: string[]; leftOnly: string[]; rightOnly: string[] };
    expect(capped.shared).toHaveLength(2);
    expect(capped.leftOnly).toHaveLength(2);
    expect(capped.rightOnly).toHaveLength(1);
  });

  it('caps venn nested left/right items', () => {
    const slots = {
      left: { title: 'A', items: ['1', '2', '3', '4'] },
      right: { title: 'B', items: ['1', '2', '3'] },
      shared: ['1', '2'],
    } as unknown as ChartSlots;
    const capped = capSlotsItems('venn', slots, 2) as {
      left: { items: string[] }; right: { items: string[] }; shared: string[];
    };
    expect(capped.left.items).toHaveLength(2);
    expect(capped.right.items).toHaveLength(2);
    expect(capped.shared).toHaveLength(2);
  });

  it('leaves slots untouched when maxItems is 0 and does not mutate the input', () => {
    const slots = { title: 't', steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }] } as unknown as ChartSlots;
    expect(capSlotsItems('flow', slots, 0)).toBe(slots);
    const before = JSON.stringify(slots);
    capSlotsItems('flow', slots, 2);
    expect(JSON.stringify(slots)).toBe(before);
  });
});

describe('chartTypeName', () => {
  it('falls back to the catalog constant without mxResources, honors i18n when present', () => {
    // 无 mxResources(node 环境)→ 目录中文常量兜底
    expect(chartTypeName('flow')).toBe('流程图');
    const g = globalThis as { mxResources?: { get: (k: string, d: unknown, fb: string) => string } };
    g.mxResources = { get: () => 'Flowchart' };
    try {
      expect(chartTypeName('flow')).toBe('Flowchart');
    } finally {
      delete g.mxResources;
    }
    expect(chartTypeName('flow')).toBe('流程图');
  });
});
