import { describe, expect, it } from 'vitest';
import type { ChartElement } from '../src/charts/layout';
import { layoutGallery, type GalleryChart } from '../src/charts/gallery';
import { ICON_SHAPE_KEYS, CHART_SHAPES } from '../src/charts/shapes';

const v = (label: string, x: number, y: number, w = 100, h = 40): ChartElement => ({
  kind: 'vertex', label, style: '', x, y, w, h,
});
const e = (from: number, to: number): ChartElement => ({ kind: 'edge', label: '', style: '', from, to });

const chart = (type: string, title: string, elements: ChartElement[]): GalleryChart => ({ type, title, elements });

describe('layoutGallery', () => {
  it('places charts in a 3-column grid with titles', () => {
    const charts = Array.from({ length: 5 }, (_, i) =>
      chart(`t${i}`, `图${i}`, [v('a', 0, 0), v('b', 200, 100)]));
    const out = layoutGallery(charts);
    // 每张图 1 标题 + 2 顶点
    expect(out).toHaveLength(5 * 3);
    const titles = out.filter((el) => el.label.startsWith('图'));
    expect(titles).toHaveLength(5);
    // 前三张同一行(y 相同),第 4-5 张换行(y 更大)
    const y0 = titles[0].y ?? 0;
    const y3 = titles[3].y ?? 0;
    expect(titles[1].y).toBe(y0);
    expect(titles[2].y).toBe(y0);
    expect(y3).toBeGreaterThan(y0);
    // 列 x 递增
    expect((titles[1].x ?? 0)).toBeGreaterThan(titles[0].x ?? 0);
  });

  it('offsets vertices and remaps edge indices per chart', () => {
    const charts = [
      chart('a', '图A', [v('a1', 0, 0), v('a2', 300, 0), e(0, 1)]),
      chart('b', '图B', [v('b1', 0, 0), v('b2', 300, 0), e(0, 1)]),
    ];
    const out = layoutGallery(charts);
    const edges = out.filter((el) => el.kind === 'edge');
    expect(edges).toHaveLength(2);
    // 全局下标:图A=标题0,a1=1,a2=2,边(1→2);图B=标题4,b1=5,b2=6,边(5→6)
    expect(edges[0].from).toBe(1);
    expect(edges[0].to).toBe(2);
    expect(edges[1].from).toBe(5);
    expect(edges[1].to).toBe(6);
    // 第二张图的顶点坐标被平移,不与第一张重叠
    const b1 = out.find((el) => el.label === 'b1');
    expect((b1?.x ?? 0)).toBeGreaterThan(0);
  });
});

describe('icon shape parts', () => {
  it('registers icon keys in the catalog with data-URI image styles', () => {
    for (const key of ICON_SHAPE_KEYS) {
      const shape = CHART_SHAPES[key];
      expect(shape, key).toBeDefined();
      expect(shape.style).toContain('shape=image;');
      expect(shape.style).toContain('image=data:image/svg+xml,');
      // data-URI 必须无分号,否则破坏 drawio 样式串
      expect(shape.style.includes('data:image/svg+xml,') &&
        shape.style.split('image=')[1].split(';')[0].includes(';')).toBe(false);
    }
  });

  it('includes icon parts in the prompt catalog', async () => {
    const { SHAPE_CATALOG_PROMPT } = await import('../src/charts/shapes');
    expect(SHAPE_CATALOG_PROMPT).toContain('robot');
    expect(SHAPE_CATALOG_PROMPT).toContain('group');
  });
});
