/**
 * 流程图布局回归测试:泳道内节点不得越出容器边界;连线必须带定向
 * 连接点;跨泳道连线用虚线区分(用户实测反馈的缺陷固化)。
 */

import { describe, expect, it } from 'vitest';
import { layoutChart, type ChartSlots } from '../src/charts/layout';

describe('flow lane containment', () => {
  const slots: ChartSlots = {
    title: '发布流程',
    lanes: ['开发', '测试'],
    steps: [
      { label: '编码', shape: 'process', lane: 0 },
      { label: '提交', shape: 'process', lane: 0 },
      { label: '评审', shape: 'decision', lane: 1 },
      { label: '发布', shape: 'terminator', lane: 1 },
    ],
  } as unknown as ChartSlots;

  const els = layoutChart('flow', slots, 'vertical');

  it('keeps every step node inside its lane container', () => {
    // 前两个元素是两个泳道容器(swimlane 样式),其后是步骤节点
    const lanesEls = els.filter((e) => e.kind === 'vertex' && (e.style ?? '').includes('swimlane'));
    expect(lanesEls).toHaveLength(2);
    const stepsEls = els.filter((e) => e.kind === 'vertex' && !(e.style ?? '').includes('swimlane'));
    expect(stepsEls).toHaveLength(4);
    const lane0 = { x: 40, w: 260 };
    const lane1 = { x: 380, w: 260 };
    for (const v of stepsEls) {
      const inLane0 = (v.x ?? 0) >= lane0.x && (v.x ?? 0) + (v.w ?? 0) <= lane0.x + lane0.w;
      const inLane1 = (v.x ?? 0) >= lane1.x && (v.x ?? 0) + (v.w ?? 0) <= lane1.x + lane1.w;
      expect(inLane0 || inLane1, `node "${v.label}" escapes its lane`).toBe(true);
    }
  });

  it('gives edges directional connection points and dashes cross-lane links', () => {
    const edges = els.filter((e) => e.kind === 'edge');
    expect(edges.length).toBeGreaterThanOrEqual(3);
    for (const e of edges) {
      expect(e.style ?? '').toContain('exitX=');
      expect(e.style ?? '').toContain('entryX=');
    }
    // 步骤 2(评审,泳道1)与步骤 1(提交,泳道0)之间是跨泳道 → 虚线
    expect(edges.some((e) => (e.style ?? '').includes('dashed=1'))).toBe(true);
  });
});
