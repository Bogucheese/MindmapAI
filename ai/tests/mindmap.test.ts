import { describe, expect, it } from 'vitest';
import { estimateNodeSize, fontSizeForDepth } from '../src/mindmap/node-size';
import { MM_MARKER, branchColor, branchVertexStyle, radialEdgeStyle, rootVertexStyle, treeEdgeStyle, treeVerticalEdgeStyle } from '../src/mindmap/styles';
import { detectLayoutKind } from '../src/mindmap/tree-model';

describe('node-size', () => {
  it('uses larger fonts for shallower levels', () => {
    expect(fontSizeForDepth(0)).toBe(16);
    expect(fontSizeForDepth(1)).toBe(14);
    expect(fontSizeForDepth(2)).toBe(12);
    expect(fontSizeForDepth(9)).toBe(12);
  });

  it('CJK labels are wider than latin labels of the same length', () => {
    const cjk = estimateNodeSize('新能源汽车产业链分析', 1);
    const latin = estimateNodeSize('A'.repeat(10), 1);
    expect(cjk.width).toBeGreaterThan(latin.width);
  });

  it('short labels fit on one line', () => {
    const s = estimateNodeSize('电池', 1);
    expect(s.width).toBeLessThanOrEqual(240);
    expect(s.height).toBeGreaterThan(0);
  });

  it('long labels wrap and grow taller, capped at max width', () => {
    const long = estimateNodeSize('正极材料：磷酸铁锂与三元锂的路线之争与成本平衡', 2);
    expect(long.width).toBe(240);
    const short = estimateNodeSize('正极材料', 2);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('width/height are always positive integers', () => {
    for (const label of ['', ' ', 'a', '新能源汽车产业链分析', 'x'.repeat(300)]) {
      for (const depth of [0, 1, 3]) {
        const s = estimateNodeSize(label, depth);
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
        expect(Number.isInteger(s.width)).toBe(true);
        expect(Number.isInteger(s.height)).toBe(true);
      }
    }
  });
});

describe('styles', () => {
  it('all styles carry the mindmapAI marker', () => {
    expect(rootVertexStyle()).toContain(MM_MARKER);
    expect(branchVertexStyle('#DAE8FC', '#6C8EBF', 14, true)).toContain(MM_MARKER);
    expect(radialEdgeStyle('#6C8EBF')).toContain(MM_MARKER);
    expect(treeEdgeStyle('#6C8EBF')).toContain(MM_MARKER);
  });

  it('branch colors cycle through the palette', () => {
    expect(branchColor(0)).toEqual(branchColor(6));
    expect(branchColor(1)).not.toEqual(branchColor(2));
  });

  it('radial edges are curved without arrows; tree edges are orthogonal with anchors', () => {
    expect(radialEdgeStyle('#fff')).toContain('curved=1');
    expect(radialEdgeStyle('#fff')).toContain('endArrow=none');
    expect(treeEdgeStyle('#fff')).toContain('orthogonalEdgeStyle');
    expect(treeEdgeStyle('#fff')).toContain('exitX=1');
  });
});

describe('detectLayoutKind', () => {
  const fakeGraph = (rootStyle: string): any => {
    const edge = { getStyle: () => rootStyle };
    return {
      getModel: () => ({
        getStyle: () => rootStyle,
        getOutgoingEdges: () => [edge],
      }),
    };
  };

  it('detects horizontal tree by exitX=1', () => {
    expect(detectLayoutKind(fakeGraph('edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;mindmapAI=1;'), {})).toBe('tree');
  });

  it('detects vertical tree by exitY=1', () => {
    expect(detectLayoutKind(fakeGraph('edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;mindmapAI=1;'), {})).toBe('tree-vertical');
  });

  it('detects radial for curved edges without anchors', () => {
    expect(detectLayoutKind(fakeGraph('edgeStyle=none;curved=1;mindmapAI=1;'), {})).toBe('radial');
  });
});

describe('treeVerticalEdgeStyle', () => {
  it('anchors parent bottom to child top', () => {
    const s = treeVerticalEdgeStyle('#fff');
    expect(s).toContain('orthogonalEdgeStyle');
    expect(s).toContain('exitY=1');
    expect(s).toContain('entryY=0;');
  });
});
