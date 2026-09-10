/**
 * ChartElement[] → 画布单元格(单事务;替换/落点与导图同规则)。
 */

import type { ChartElement } from './layout';

export interface BuildChartOptions {
  replaceExisting?: boolean;
  origin?: { x: number; y: number };
}

export interface BuildChartResult {
  vertexCount: number;
  edgeCount: number;
  /** 按放置顺序排列的单元格(顶点在前、边在后)——供逐个放置动画使用 */
  placedCells: unknown[];
}

export function buildChartElements(
  ui: DrawioPluginApi,
  elements: ChartElement[],
  options: BuildChartOptions
): BuildChartResult {
  const graph = ui.editor.graph;
  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  let vertexCount = 0;
  let edgeCount = 0;
  const placedCells: unknown[] = [];

  model.beginUpdate();
  try {
    if (options.replaceExisting) {
      const stale = findMindmapCellsPublic(graph);
      if (stale.length > 0) graph.removeCells(stale);
    }
    const dx = options.origin != null ? options.origin.x : 40;
    const dy = options.origin != null ? options.origin.y : 40;
    const cellIds: unknown[] = [];
    for (const el of elements) {
      if (el.kind === 'vertex') {
        const cell = graph.insertVertex(
          parent, null, el.label,
          (el.x ?? 0) + dx, (el.y ?? 0) + dy, el.w ?? 160, el.h ?? 60,
          el.style
        );
        cellIds.push(cell);
        placedCells.push(cell);
        vertexCount++;
      } else {
        cellIds.push(null); // 边占位,第二遍连
      }
    }
    // 第二遍:边(此时顶点 cell 都已建好,按下标映射)
    elements.forEach((el) => {
      if (el.kind !== 'edge') return;
      const fromCell = el.from != null ? cellIds[el.from] : null;
      const toCell = el.to != null ? cellIds[el.to] : null;
      if (fromCell == null || toCell == null) return;
      placedCells.push(graph.insertEdge(parent, null, el.label ?? '', fromCell, toCell, el.style));
      edgeCount++;
    });
  } finally {
    model.endUpdate();
  }
  graph.fit();
  return { vertexCount, edgeCount, placedCells };
}

/** 复用 tree-model 的 marker 识别(避免循环依赖,内联一份) */
function findMindmapCellsPublic(graph: any): any[] {
  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  const cells = [...graph.getChildVertices(parent), ...graph.getChildEdges(parent)];
  return cells.filter((cell: any) => String(model.getStyle(cell) || '').includes('mindmapAI=1'));
}
