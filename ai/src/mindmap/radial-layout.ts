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

export function createLayoutEngine(kind: LayoutKind): LayoutEngine {
  switch (kind) {
    case 'tree':
      return {
        execute(graph: unknown, parent: unknown, root: unknown): void {
          const layout = new mxCompactTreeLayout(graph, true);
          layout.execute(parent, root);
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
