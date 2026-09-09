/**
 * 图表布局纯函数测试:各类布局在代表性输入下必须零重叠(几何保证)。
 */

import { describe, expect, it } from 'vitest';
import { layoutChart, type ChartElement } from '../src/charts/layout';
import { parseExtrasSlots } from '../src/charts/extras';

function countOverlaps(elements: ChartElement[]): number {
  const verts = elements.filter((e) => e.kind === 'vertex');
  let overlap = 0;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const a = verts[i], b = verts[j];
      const ox = Math.min(a.x! + a.w!, b.x! + b.w!) - Math.max(a.x!, b.x!);
      const oy = Math.min(a.y! + a.h!, b.y! + b.h!) - Math.max(a.y!, b.y!);
      if (ox > 0 && oy > 0) overlap++;
    }
  }
  return overlap;
}

describe('chart layouts are overlap-free', () => {
  it('fishbone: alternating columns keep causes clear', () => {
    const els = layoutChart('fishbone', {
      problem: '网站慢',
      categories: [
        { name: '资源', causes: ['图片未压缩', '脚本过大', 'CSS阻塞'] },
        { name: '网络', causes: ['无CDN', 'DNS慢'] },
        { name: '服务器', causes: ['带宽不足', '配置低'] },
        { name: '前端', causes: ['渲染重'] },
      ],
    });
    expect(countOverlaps(els)).toBe(0);
  });

  it('fishbone: six categories still clear', () => {
    const els = layoutChart('fishbone', {
      problem: '质量差',
      categories: Array.from({ length: 6 }, (_, i) => ({ name: `类${i}`, causes: [`因${i}a`, `因${i}b`] })),
    });
    expect(countOverlaps(els)).toBe(0);
  });

  it('circle / bubble: ring layout clear', () => {
    for (const type of ['circle', 'bubble'] as const) {
      const els = layoutChart(type, { center: 'T', outer: Array.from({ length: 10 }, (_, i) => `P${i}`), bubbles: Array.from({ length: 10 }, (_, i) => `P${i}`) });
      expect(countOverlaps(els)).toBe(0);
    }
  });

  it('timeline: alternating events clear', () => {
    const els = layoutChart('timeline', {
      title: 'AI 发展',
      events: Array.from({ length: 8 }, (_, i) => ({ time: `t${i}`, label: `事件${i}` })),
    });
    expect(countOverlaps(els)).toBe(0);
  });

  it('doubleBubble: three columns clear', () => {
    const els = layoutChart('doubleBubble', {
      left: 'A', right: 'B',
      shared: ['s1', 's2', 's3', 's4'],
      leftOnly: ['a1', 'a2', 'a3'],
      rightOnly: ['b1', 'b2', 'b3'],
    });
    expect(countOverlaps(els)).toBe(0);
  });

  it('flow / org / multiFlow / brace / bridge: clear', () => {
    const flow = layoutChart('flow', { title: 'T', steps: Array.from({ length: 8 }, (_, i) => ({ label: `S${i}`, shape: 'process' })) });
    expect(countOverlaps(flow)).toBe(0);
    const org = layoutChart('org', { root: 'CEO', branches: Array.from({ length: 5 }, (_, i) => ({ label: `D${i}`, members: [`M${i}a`, `M${i}b`] })) });
    expect(countOverlaps(org)).toBe(0);
    const mf = layoutChart('multiFlow', { event: 'E', causes: ['c1', 'c2', 'c3', 'c4'], effects: ['e1', 'e2', 'e3'] });
    expect(countOverlaps(mf)).toBe(0);
    const brace = layoutChart('brace', { whole: 'W', parts: Array.from({ length: 8 }, (_, i) => ({ label: `P${i}` })) });
    expect(countOverlaps(brace)).toBe(0);
    const bridge = layoutChart('bridge', { relation: 'R', pairs: Array.from({ length: 4 }, (_, i) => ({ top: `T${i}`, bottom: `B${i}` })) });
    expect(countOverlaps(bridge)).toBe(0);
  });
});

describe('parseExtrasSlots (tolerant parsing)', () => {

  it('parses fenced JSON with trailing commas', () => {
    const raw = '```json\n{"minimaps":[{"title":"支线A","items":["x","y"]}],"table":{"title":"T","headers":["a","b","c"],"rows":[["1","2","3"]]},"relations":[{"from":"A","label":"导致","to":"B"}],}\n```';
    const s = parseExtrasSlots(raw);
    expect(s).not.toBeNull();
    expect(s!.minimaps[0].title).toBe('支线A');
    expect(s!.table.rows.length).toBe(1);
    expect(s!.relations[0].to).toBe('B');
  });

  it('returns null on garbage', () => {
    expect(parseExtrasSlots('no json here')).toBeNull();
  });
});
