/**
 * 布局引擎接口 + drawio 内置布局的两个包装。
 * - radial：mxRadialTreeLayout（放射/发散，默认）——execute 支持指定根
 *   （VERIFIED §8，mxRadialTreeLayout.js:155）；
 * - tree：mxCompactTreeLayout 横向树（备选）。
 * 自定义径向算法后续按本接口接入，调用方无感。
 */

export type LayoutKind = 'radial' | 'tree' | 'tree-vertical';

export interface LayoutEngine {
  execute(graph: unknown, parent: unknown, root: unknown): void;
}

interface TunableLayout {
  execute(parent: unknown, root: unknown): void;
  levelDistance: number;
  nodeDistance: number;
}

/**
 * 按目标宽高比微调层间距/兄弟间距:tree(横向)宽度由层间距决定、高度由
 * 兄弟间距决定;tree-vertical 相反。首轮布局后量 bounds,偏离目标则调整
 * 间距重排,最多两轮。radial 天然近圆形,不参与调参。
 */
function tuneAspect(
  graph: unknown,
  layout: TunableLayout,
  parent: unknown,
  root: unknown,
  aspect: number,
  kind: 'tree' | 'tree-vertical',
): void {
  const g = graph as { getGraphBounds?: () => { width: number; height: number } | null };
  if (typeof g.getGraphBounds !== 'function') return;
  for (let i = 0; i < 2; i++) {
    const bounds = g.getGraphBounds();
    if (bounds == null || bounds.width <= 0 || bounds.height <= 0) return;
    const current = bounds.width / bounds.height;
    if (current > aspect * 0.85 && current < aspect * 1.2) return;
    const tooTall = current < aspect;
    if (kind === 'tree-vertical') {
      layout.nodeDistance = tooTall
        ? Math.min(400, layout.nodeDistance * 1.4)
        : Math.max(16, layout.nodeDistance * 0.8);
      layout.levelDistance = tooTall
        ? Math.max(30, layout.levelDistance * 0.8)
        : Math.min(400, layout.levelDistance * 1.3);
    } else {
      layout.levelDistance = tooTall
        ? Math.min(500, layout.levelDistance * 1.4)
        : Math.max(30, layout.levelDistance * 0.8);
      layout.nodeDistance = tooTall
        ? Math.max(16, layout.nodeDistance * 0.8)
        : Math.min(400, layout.nodeDistance * 1.3);
    }
    layout.execute(parent, root);
  }
}

export function createLayoutEngine(kind: LayoutKind, aspect?: number): LayoutEngine {
  switch (kind) {
    case 'tree':
      return {
        execute(graph: unknown, parent: unknown, root: unknown): void {
          const layout = new mxCompactTreeLayout(graph, true);
          layout.execute(parent, root);
          if (aspect != null) tuneAspect(graph, layout as unknown as TunableLayout, parent, root, aspect, 'tree');
        },
      };
    case 'tree-vertical':
      return {
        execute(graph: unknown, parent: unknown, root: unknown): void {
          // horizontal=false:根在顶部,层级自上而下展开
          const layout = new mxCompactTreeLayout(graph, false);
          layout.levelDistance = 60; // 层间距(纵向)
          layout.nodeDistance = 30; // 同层节点间距(横向)
          layout.execute(parent, root);
          if (aspect != null) tuneAspect(graph, layout as unknown as TunableLayout, parent, root, aspect, 'tree-vertical');
        },
      };
    case 'radial':
    default:
      return {
        execute(graph: unknown, parent: unknown, root: unknown): void {
          const layout = new mxRadialTreeLayout(graph);
          // mxRadialTreeLayout 按叶子数分角度、对节点宽度不敏感；近中心环
          // 弧长小，levelDistance 必须够大才能容纳宽 CJK 标签（实测 220 起）
          layout.levelDistance = 300;
          layout.nodeDistance = 120;
          layout.execute(parent, root);
        },
      };
  }
}
