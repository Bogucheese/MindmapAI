/**
 * 全景画布:12 种思考图一次生成到同一画布。
 *
 * 每张图先经 layoutChart 得到各自的 ChartElement[](图内相对坐标,边的
 * from/to 是图内下标),这里做三件事:
 * 1. 计算每张图的包围盒;
 * 2. 网格拼版(3 列,图上带标题,列宽/行高取该列/该行最大值);
 * 3. 拼接为单一 ChartElement[] 时整体平移坐标、并把边的下标重映射到
 *    全局数组(否则 buildChartElements 的按下标连线会连错图)。
 */

import type { ChartElement } from './layout';

export interface GalleryChart {
  /** 图类型 id(用于标题兜底) */
  type: string;
  /** 展示标题(图类型中文名) */
  title: string;
  elements: ChartElement[];
}

const MARGIN = 40;
const COL_GAP = 140;
const ROW_GAP = 90;
const TITLE_H = 34;
const COLS = 3;

function bbox(elements: ChartElement[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const el of elements) {
    if (el.kind !== 'vertex') continue;
    w = Math.max(w, (el.x ?? 0) + (el.w ?? 160));
    h = Math.max(h, (el.y ?? 0) + (el.h ?? 60));
  }
  return { w: Math.max(w, 320), h: Math.max(h, 160) };
}

export function layoutGallery(charts: GalleryChart[]): ChartElement[] {
  const boxes = charts.map((c) => ({ chart: c, box: bbox(c.elements) }));
  const colW = Math.max(...boxes.map((b) => b.box.w));
  const out: ChartElement[] = [];

  const rows = Math.ceil(boxes.length / COLS);
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    const rowBoxes = boxes.slice(r * COLS, (r + 1) * COLS);
    rowHeights.push(Math.max(...rowBoxes.map((b) => b.box.h)));
  }

  boxes.forEach(({ chart, box }, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const x = MARGIN + col * (colW + COL_GAP);
    const y =
      MARGIN +
      rowHeights.slice(0, row).reduce((acc, h) => acc + h + ROW_GAP + TITLE_H, 0);
    // 标题
    out.push({
      kind: 'vertex',
      label: chart.title,
      style: 'text;html=1;align=left;verticalAlign=middle;fontStyle=1;fontSize=14;fontColor=#1E293B;',
      x,
      y,
      w: box.w,
      h: 24,
    });
    const offsetY = y + TITLE_H;
    const base = out.length;
    for (const el of chart.elements) {
      if (el.kind === 'vertex') {
        out.push({ ...el, x: (el.x ?? 0) + x, y: (el.y ?? 0) + offsetY });
      } else {
        out.push({
          ...el,
          from: el.from != null ? el.from + base : el.from,
          to: el.to != null ? el.to + base : el.to,
        });
      }
    }
  });
  return out;
}
