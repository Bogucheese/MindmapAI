/**
 * 流程图布局回归测试:泳道内节点不得越出容器边界;连线必须带定向
 * 连接点、一律正交路由(不再有斜直线);虚线只表达语义(用户实测反馈的
 * 缺陷固化:斜直线跨泳道连线不规范 → 改全正交)。
 */

import { describe, expect, it } from 'vitest';
import { layoutChart, type ChartSlots } from '../src/charts/layout';
import { validateChartSlots } from '../src/charts/validate';

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
    // 步骤节点 = 非泳道、非标题文本(text; 开头)的顶点
    const stepsEls = els.filter(
      (e) => e.kind === 'vertex' && !(e.style ?? '').includes('swimlane') && !(e.style ?? '').startsWith('text;')
    );
    expect(stepsEls).toHaveLength(4);
    const lane0 = { x: 40, w: 260 };
    const lane1 = { x: 380, w: 260 };
    for (const v of stepsEls) {
      const inLane0 = (v.x ?? 0) >= lane0.x && (v.x ?? 0) + (v.w ?? 0) <= lane0.x + lane0.w;
      const inLane1 = (v.x ?? 0) >= lane1.x && (v.x ?? 0) + (v.w ?? 0) <= lane1.x + lane1.w;
      expect(inLane0 || inLane1, `node "${v.label}" escapes its lane`).toBe(true);
    }
  });

  it('gives edges directional connection points and orthogonal routing everywhere', () => {
    const edges = els.filter((e) => e.kind === 'edge');
    expect(edges.length).toBeGreaterThanOrEqual(3);
    for (const e of edges) {
      expect(e.style ?? '').toContain('exitX=');
      expect(e.style ?? '').toContain('entryX=');
      expect(e.style ?? '').toContain('edgeStyle=orthogonalEdgeStyle');
      expect(e.style ?? '').not.toContain('edgeStyle=none');
    }
    // 未标注 dashed 的步骤连线保持实线;跨泳道也是正交实线
    expect(edges.some((e) => (e.style ?? '').includes('dashed=1'))).toBe(false);
  });
});

describe('flow explicit edges (branches & loops)', () => {
  const slots: ChartSlots = {
    title: 'AI Agent 工作流程',
    lanes: ['用户', 'Agent', '工具'],
    steps: [
      { id: 's1', label: '提出目标', shape: 'terminator', lane: 0 },
      { id: 's2', label: '规划任务', shape: 'process', lane: 1 },
      { id: 's3', label: '调用工具', shape: 'process', lane: 2 },
      { id: 's4', label: '目标达成?', shape: 'decision', lane: 1 },
      { id: 's5', label: '输出结果', shape: 'terminator', lane: 1 },
    ],
    edges: [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 's4' },
      { from: 's4', to: 's5', label: '是' },
      { from: 's4', to: 's2', label: '否', dashed: true },
    ],
  } as unknown as ChartSlots;

  const els = layoutChart('flow', slots, 'vertical');
  const edges = els.filter((e) => e.kind === 'edge');

  it('draws exactly the explicit edges with labels', () => {
    expect(edges).toHaveLength(5);
    expect(edges.filter((e) => e.label === '是')).toHaveLength(1);
    expect(edges.filter((e) => e.label === '否')).toHaveLength(1);
  });

  it('keeps every edge orthogonal; dashed only when marked', () => {
    for (const e of edges) {
      expect(e.style ?? '').toContain('edgeStyle=orthogonalEdgeStyle');
      expect(e.style ?? '').not.toContain('edgeStyle=none');
    }
    const noEdge = edges.find((e) => e.label === '否');
    const yesEdge = edges.find((e) => e.label === '是');
    expect(noEdge?.style).toContain('dashed=1');
    expect(yesEdge?.style).not.toContain('dashed=1');
  });

  it('routes the loop-back edge out the side, not through nodes', () => {
    // s4(泳道1,seq1 下方) → s2(泳道1,seq0 上方):同列回退 → 右侧出/右侧入
    const back = edges.find((e) => e.label === '否');
    expect(back?.style).toContain('exitX=1');
    expect(back?.style).toContain('entryX=1');
  });

  it('falls back to the sequential chain when every explicit edge dangles', () => {
    const bad: ChartSlots = {
      title: 't',
      steps: [
        { id: 'a', label: 'x' },
        { id: 'b', label: 'y' },
        { id: 'c', label: 'z' },
      ],
      edges: [{ from: 'a', to: 'ghost' }],
    } as unknown as ChartSlots;
    const out = layoutChart('flow', bad, 'vertical');
    expect(out.filter((e) => e.kind === 'edge')).toHaveLength(2); // x→y, y→z
  });

  it('renders the required title as a vertex', () => {
    const titleEl = els.find((e) => e.kind === 'vertex' && e.label === 'AI Agent 工作流程');
    expect(titleEl).toBeDefined();
  });
});

describe('flow slots validation', () => {
  const base = {
    title: 't',
    steps: [
      { id: 's1', label: 'a' },
      { id: 's2', label: 'b' },
      { id: 's3', label: 'c' },
    ],
  };

  it('accepts explicit edges referencing existing step ids', () => {
    const r = validateChartSlots('flow', {
      ...base,
      edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's1', label: '否' }],
    } as unknown as ChartSlots);
    expect(r).toBeNull();
  });

  it('rejects edges referencing unknown step ids', () => {
    const r = validateChartSlots('flow', {
      ...base,
      edges: [{ from: 's1', to: 'nope' }],
    } as unknown as ChartSlots);
    expect(r).toContain('nope');
  });

  it('rejects duplicate step ids', () => {
    const r = validateChartSlots('flow', {
      title: 't',
      steps: [
        { id: 's1', label: 'a' },
        { id: 's1', label: 'b' },
        { id: 's3', label: 'c' },
      ],
    } as unknown as ChartSlots);
    expect(r).toContain('s1');
  });
});
