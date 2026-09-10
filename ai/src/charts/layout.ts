/**
 * 图表槽位 → ChartElement[](确定性几何布局)。
 * ChartElement 是与 mxGraph 无关的中间表示(kind/type/label/style/x/y/w/h),
 * 由 charts/assemble.ts 统一写入画布。
 */

import { resolveShape, swimlaneStyle, ICON_SHAPE_KEYS } from './shapes';
import type { ChartTypeId } from './catalog';

export interface ChartElement {
  kind: 'vertex' | 'edge';
  /** 顶点:标签;边:连线标注(可空) */
  label: string;
  style: string;
  /** 顶点几何 */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** 边:按源/目标引用顶点下标 */
  from?: number;
  to?: number;
}

export type ChartSlots = Record<string, unknown>;

const V = (label: string, style: string, x: number, y: number, w: number, h: number): ChartElement => ({
  kind: 'vertex', label, style, x, y, w, h,
});
const E = (from: number, to: number, label = '', style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#6C8EBF;'): ChartElement => ({
  kind: 'edge', from, to, label, style,
});

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;

const FILL_BLUE = 'fillColor=#DAE8FC;strokeColor=#6C8EBF;';
const FILL_GREEN = 'fillColor=#D5E8D4;strokeColor=#82B366;';
const FILL_ORANGE = 'fillColor=#FFE6CC;strokeColor=#D79B00;';
const FILL_YELLOW = 'fillColor=#FFF2CC;strokeColor=#D6B656;';
const FILL_RED = 'fillColor=#F8CECC;strokeColor=#B85450;';
const FILL_PURPLE = 'fillColor=#E1D5E7;strokeColor=#9673A6;';
const FILL_GRAY = 'fillColor=#F5F5F5;strokeColor=#666666;fontColor=#333333;';

export type ChartDirection = 'vertical' | 'horizontal';

export function layoutChart(type: ChartTypeId, slots: ChartSlots, direction: ChartDirection = 'vertical'): ChartElement[] {
  switch (type) {
    case 'circle': return layoutCircle(slots, false);
    case 'bubble': return layoutCircle(slots, true);
    case 'doubleBubble': return layoutDoubleBubble(slots);
    case 'tree': return layoutTree(slots, false, direction);
    case 'org': return layoutTree(slots, true, direction);
    case 'flow': return layoutFlow(slots, direction);
    case 'multiFlow': return layoutMultiFlow(slots);
    case 'brace': return layoutBrace(slots);
    case 'venn': return layoutVenn(slots);
    case 'fishbone': return layoutFishbone(slots);
    case 'timeline': return layoutTimeline(slots);
    case 'bridge': return layoutBridge(slots);
  }
}

/* ---------------- 圆圈图 / 气泡图:中心 + 环绕 ---------------- */
function layoutCircle(slots: ChartSlots, bubble: boolean): ChartElement[] {
  const center = str(slots.center, '主题');
  const outer = strArr(bubble ? slots.bubbles : slots.outer).slice(0, 10);
  const els: ChartElement[] = [];
  const cx = 480, cy = 320;
  els.push(V(center, `${resolveShape('ellipse', 'ellipse')}${FILL_BLUE}`, cx - 90, cy - 55, 180, 110));
  const n = Math.max(outer.length, 1);
  const rx = 360, ry = 230;
  outer.forEach((label, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + rx * Math.cos(angle) - 80;
    const y = cy + ry * Math.sin(angle) - 35;
    const fill = bubble ? FILL_YELLOW : FILL_GREEN;
    const idx = els.push(V(label, `${resolveShape('ellipse', 'ellipse')}${fill}`, x, y, 160, 70)) - 1;
    els.push(E(idx, 0, '', 'endArrow=none;endFill=0;strokeWidth=1;strokeColor=#999999;html=1;'));
  });
  return els;
}

/* ---------------- 双重气泡图:左/中/右三列 ---------------- */
function layoutDoubleBubble(slots: ChartSlots): ChartElement[] {
  const left = str(slots.left, 'A');
  const right = str(slots.right, 'B');
  const shared = strArr(slots.shared).slice(0, 5);
  const leftOnly = strArr(slots.leftOnly).slice(0, 5);
  const rightOnly = strArr(slots.rightOnly).slice(0, 5);
  const els: ChartElement[] = [];
  els.push(V(left, `${resolveShape('ellipse', 'ellipse')}${FILL_BLUE}`, 140, 300, 200, 110));
  const rightIdx = els.length;
  els.push(V(right, `${resolveShape('ellipse', 'ellipse')}${FILL_ORANGE}`, 860, 300, 200, 110));
  const mid = (i: number, n: number): number => 90 + (i * 460) / Math.max(1, n - 1 || 1);
  shared.forEach((label, i) => {
    els.push(V(label, `${resolveShape('ellipse', 'ellipse')}${FILL_GREEN}`, mid(i, shared.length), 200, 150, 60));
  });
  leftOnly.forEach((label, i) => {
    els.push(V(label, `${resolveShape('ellipse', 'ellipse')}${FILL_BLUE}`, 60, 480 + i * 90, 170, 60));
  });
  rightOnly.forEach((label, i) => {
    els.push(V(label, `${resolveShape('ellipse', 'ellipse')}${FILL_ORANGE}`, 970, 480 + i * 90, 170, 60));
  });
  // 连线:中心 ↔ 各气泡
  const sharedIdx = els.length - (shared.length + leftOnly.length + rightOnly.length);
  for (let i = 0; i < shared.length; i++) {
    els.push(E(0, sharedIdx + i), E(sharedIdx + i, rightIdx));
  }
  for (let i = 0; i < leftOnly.length; i++) {
    els.push(E(0, sharedIdx + shared.length + i));
  }
  for (let i = 0; i < rightOnly.length; i++) {
    els.push(E(rightIdx, sharedIdx + shared.length + leftOnly.length + i));
  }
  return els;
}

/* ---------------- 树形图 / 组织结构图:竖向分层 ---------------- */
function layoutTree(slots: ChartSlots, org: boolean, direction: ChartDirection): ChartElement[] {
  interface TNode { label: string; kids: TNode[] }
  const rootLabel = str(slots.root ?? slots.whole ?? slots.title, '主题');
  const root: TNode = { label: rootLabel, kids: [] };
  if (org) {
    for (const b of Array.isArray(slots.branches) ? slots.branches : []) {
      const o = b as Record<string, unknown>;
      const branch: TNode = { label: str(o.label, '部门'), kids: [] };
      for (const m of strArr(o.members)) branch.kids.push({ label: m, kids: [] });
      root.kids.push(branch);
    }
  } else {
    for (const b of Array.isArray(slots.branches) ? slots.branches : []) {
      const o = b as Record<string, unknown>;
      const branch: TNode = { label: str(o.label, '分类'), kids: [] };
      for (const l of strArr(o.leaves)) branch.kids.push({ label: l, kids: [] });
      root.kids.push(branch);
    }
  }
  const els: ChartElement[] = [];
  const nodeIdx = new Map<TNode, number>();
  const horizontal = direction === 'horizontal';
  const pushV = (label: string, x: number, y: number, w: number, h: number, fill: string, isLeaf: boolean): number => {
    // 组织结构:部门=卡片,成员=小人形;树形图:圆角矩形
    const style = org
      ? isLeaf
        ? `${resolveShape('actor', 'process')}${fill}`
        : `${resolveShape('card', 'process')}${fill}`
      : `${resolveShape('process', 'process')}${fill}rounded=1;arcSize=20;`;
    els.push(V(label, style, x, y, w, h));
    return els.length - 1;
  };
  // 水平:层沿 x 推进(根在左);垂直:层沿 y 推进(根在上)
  const levelNodes: TNode[][] = [[root], root.kids, root.kids.flatMap((b) => b.kids)];
  const span = Math.max(240, ...levelNodes.map((nodes) => nodes.length * 160));
  const layoutLevel = (nodes: TNode[], level: number, fill: string): void => {
    nodes.forEach((nd, i) => {
      const along = ((i + 0.5) * span) / nodes.length - 80;
      const across = level * 170;
      const isLeaf = nd.kids.length === 0 && level > 0;
      const x = horizontal ? across : along;
      const y = horizontal ? along : across;
      nodeIdx.set(nd, pushV(nd.label, x, y, 160, 60, fill, isLeaf));
    });
  };
  layoutLevel([root], 0, FILL_BLUE);
  layoutLevel(root.kids, 1, FILL_GREEN);
  layoutLevel(root.kids.flatMap((b) => b.kids), 2, FILL_YELLOW);
  const link = (parent: TNode): void => {
    for (const kid of parent.kids) {
      els.push(E(nodeIdx.get(parent)!, nodeIdx.get(kid)!, '',
        horizontal
          ? 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#6C8EBF;exitX=1;exitY=0.5;entryX=0;entryY=0.5;'
          : 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#6C8EBF;'));
      link(kid);
    }
  };
  link(root);
  return els;
}

/* ---------------- 流程图:纵向步骤 + 语义形状 ---------------- */
function layoutFlow(slots: ChartSlots, direction: ChartDirection): ChartElement[] {
  const steps = (Array.isArray(slots.steps) ? slots.steps : []) as Array<Record<string, unknown>>;
  const lanes = strArr(slots.lanes).slice(0, 4);
  const horizontal = direction === 'horizontal';
  const els: ChartElement[] = [];
  const byIndex: number[] = [];

  // 泳道(容器部件):每个泳道一列/一行,步骤按 lane 归位
  const laneOrigin = (laneIdx: number): { x: number; y: number } => {
    const lane = lanes.length > 0 ? laneIdx : 0;
    return horizontal ? { x: 60, y: 60 + lane * 340 } : { x: 60 + lane * 340, y: 60 };
  };
  const laneCellCounts: number[] = lanes.length > 0 ? lanes.map(() => 0) : [0];
  const laneOrder: number[] = [];

  steps.slice(0, 10).forEach((st, i) => {
    const label = str(st.label, `步骤${i + 1}`);
    const shapeKey = str(st.shape, 'process');
    // 图标部件自带图形与下方标签,不再叠加填充色,占位小一号
    const isIcon = ICON_SHAPE_KEYS.has(shapeKey);
    const fill =
      isIcon ? '' :
      shapeKey === 'terminator' ? FILL_GRAY :
      shapeKey === 'decision' ? FILL_YELLOW :
      shapeKey === 'data' ? FILL_PURPLE :
      shapeKey === 'document' || shapeKey === 'note' ? FILL_GREEN : '';
    const w = shapeKey === 'decision' ? 180 : isIcon ? 90 : 200;
    const h = shapeKey === 'decision' ? 100 : isIcon ? 64 : 60;
    const laneIdxRaw = typeof st.lane === 'number' ? st.lane : 0;
    const laneIdx = lanes.length > 0 ? Math.max(0, Math.min(lanes.length - 1, laneIdxRaw)) : 0;
    laneOrder[laneIdx] = laneOrder[laneIdx] ?? -1;
    laneCellCounts[laneIdx] = (laneCellCounts[laneIdx] ?? 0) + 1;
    const seq = laneCellCounts[laneIdx] - 1;
    const origin = laneOrigin(laneIdx);
    const step = seq * 130;
    const x = horizontal ? origin.x + step : origin.x + 70;
    const y = horizontal ? origin.y + 90 : origin.y + step;
    els.push(V(label, resolveShape(shapeKey, 'process') + fill, x, y, w, h));
    byIndex.push(els.length - 1);
  });

  // 泳道容器:标题 + 大背景(先算尺寸再插入到头部,保证渲染在最底层)
  if (lanes.length > 0) {
    lanes.forEach((name, li) => {
      const count = laneCellCounts[li] ?? 1;
      const spanLen = Math.max(count * 130 + 60, 260);
      const origin = laneOrigin(li);
      const style = swimlaneStyle();
      const el: ChartElement = horizontal
        ? V(name, style, origin.x - 20, origin.y + 30, spanLen, 240)
        : V(name, style, origin.x - 20, origin.y - 30, 260, spanLen);
      els.unshift(el);
      // unshift 会移动下标,修正 byIndex
      for (let k = 0; k < byIndex.length; k++) byIndex[k] += 1;
    });
  }

  for (let i = 0; i < byIndex.length - 1; i++) {
    const arrow = str(steps[i + 1]?.arrow, '');
    const dashed = steps[i + 1]?.dashed === true;
    const style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#6C8EBF;' + (dashed ? 'dashed=1;dashPattern=6 4;' : '');
    els.push(E(byIndex[i], byIndex[i + 1], arrow, style));
  }
  return els;
}

/* ---------------- 多重流程图:原因列 → 事件 → 结果列 ---------------- */
function layoutMultiFlow(slots: ChartSlots): ChartElement[] {
  const event = str(slots.event, '事件');
  const causes = strArr(slots.causes).slice(0, 5);
  const effects = strArr(slots.effects).slice(0, 5);
  const els: ChartElement[] = [];
  const eventIdx = els.push(V(event, `${resolveShape('process', 'process')}${FILL_RED}rounded=1;`, 440, 320, 200, 90)) - 1;
  const col = (items: string[], x: number, fill: string): number[] => {
    const idxs: number[] = [];
    items.forEach((label, i) => {
      const y = 120 + (i * 480) / Math.max(1, items.length);
      idxs.push(els.push(V(label, `${resolveShape('process', 'process')}${fill}`, x, y, 190, 60)) - 1);
    });
    return idxs;
  };
  const causeIdx = col(causes, 100, FILL_BLUE);
  const effectIdx = col(effects, 820, FILL_ORANGE);
  causeIdx.forEach((i) => els.push(E(i, eventIdx, '因为')));
  effectIdx.forEach((i) => els.push(E(eventIdx, i, '导致')));
  return els;
}

/* ---------------- 括号图:整体 + 大括号 + 部件 ---------------- */
function layoutBrace(slots: ChartSlots): ChartElement[] {
  const whole = str(slots.whole, '整体');
  const parts = (Array.isArray(slots.parts) ? slots.parts : []) as Array<Record<string, unknown>>;
  const els: ChartElement[] = [];
  const n = Math.max(parts.length, 1);
  const braceH = Math.max(460, n * 84); // 卡片高 64 + 间距,随数量扩展
  const wholeIdx = els.push(V(whole, `${resolveShape('process', 'process')}${FILL_BLUE}`, 80, 300, 180, 90)) - 1;
  // 大括号:drawio curlyBracket,竖向
  const braceIdx = els.push(V('', `shape=curlyBracket;rounded=1;${'whiteSpace=wrap;html=1;'}direction=north;${FILL_GRAY}`, 300, 120, 60, braceH)) - 1;
  parts.slice(0, 8).forEach((p, i) => {
    const label = str(p.label, `部件${i + 1}`);
    const detail = str(p.detail, '');
    const y = 120 + (i * braceH) / n;
    const idx = els.push(V(detail !== '' ? `${label}\n${detail}` : label, `${resolveShape('card', 'process')}${FILL_GREEN}`, 420, y, 220, 64)) - 1;
    els.push(E(braceIdx, idx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=1;strokeColor=#666666;'));
  });
  els.push(E(wholeIdx, braceIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=1;strokeColor=#666666;'));
  return els;
}

/* ---------------- 韦恩图:两个交叠圆 ---------------- */
function layoutVenn(slots: ChartSlots): ChartElement[] {
  const left = slots.left as Record<string, unknown> | undefined;
  const right = slots.right as Record<string, unknown> | undefined;
  const leftTitle = str(left?.title, '集合A');
  const rightTitle = str(right?.title, '集合B');
  const leftItems = strArr(left?.items).slice(0, 5);
  const rightItems = strArr(right?.items).slice(0, 5);
  const shared = strArr(slots.shared).slice(0, 5);
  const els: ChartElement[] = [];
  const semi = (fill: string): string => `${fill}opacity=60;`;
  const leftIdx = els.push(V('', `${resolveShape('ellipse', 'ellipse')}${semi(FILL_BLUE)}`, 200, 160, 340, 340)) - 1;
  const rightIdx = els.push(V('', `${resolveShape('ellipse', 'ellipse')}${semi(FILL_ORANGE)}`, 460, 160, 340, 340)) - 1;
  const label = (text: string, x: number, y: number, w: number, fill: string): number =>
    els.push(V(text, `${resolveShape('text', 'text')}${fill}`, x, y, w, 30)) - 1;
  label(leftTitle, 240, 200, 120, FILL_BLUE);
  label(rightTitle, 640, 200, 120, FILL_ORANGE);
  const listText = (items: string[]): string => items.join('\n');
  label(listText(leftItems), 250, 280, 140, '');
  label(listText(rightItems), 610, 280, 140, '');
  if (shared.length > 0) {
    els.push(V(listText(shared), `${resolveShape('text', 'text')}${FILL_GREEN}`, 455, 300, 90, 120));
  }
  void leftIdx; void rightIdx;
  return els;
}

/* ---------------- 鱼骨图:主骨 + 类别骨 + 原因 ---------------- */
function layoutFishbone(slots: ChartSlots): ChartElement[] {
  const problem = str(slots.problem, '问题');
  const categories = (Array.isArray(slots.categories) ? slots.categories : []) as Array<Record<string, unknown>>;
  const els: ChartElement[] = [];
  const problemIdx = els.push(V(problem, `${resolveShape('process', 'process')}${FILL_RED}rounded=1;`, 900, 300, 180, 80)) - 1;
  // 主骨:横线
  const spineStart = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, 80, 335, 20, 20)) - 1;
  const spineEnd = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, 865, 335, 20, 20)) - 1;
  els.push(E(spineStart, spineEnd, '', 'endArrow=none;endFill=0;html=1;strokeWidth=3;strokeColor=#333333;'));

  // 类别交替上下排布;每类的原因在同一列纵向堆叠(列宽 130 < 同侧类别
  // 间距 2*步长),数学上保证零重叠
  const n = Math.max(1, categories.length);
  categories.slice(0, 6).forEach((c, i) => {
    const name = str(c.name, `类别${i + 1}`);
    const causes = strArr(c.causes).slice(0, 4);
    const up = i % 2 === 0;
    const x = n === 1 ? 400 : 200 + (i * 600) / (n - 1);
    const catY = up ? 195 : 380;
    const catIdx = els.push(V(name, `${resolveShape('preparation', 'preparation')}${FILL_GREEN}`, x - 75, catY, 150, 50)) - 1;
    els.push(E(catIdx, problemIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=2;strokeColor=#333333;'));
    causes.forEach((cause, j) => {
      const cyy = up ? catY - 55 - j * 45 : catY + 60 + j * 45;
      const cIdx = els.push(V(cause, `${resolveShape('text', 'text')}${FILL_YELLOW}`, x - 65, cyy, 130, 30)) - 1;
      els.push(E(cIdx, catIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=1;strokeColor=#666666;'));
    });
  });
  return els;
}

function MM_LABEL_ONLY(): string {
  return 'mindmapAI=1;';
}

/* ---------------- 时间线:横轴 + 上下交替事件 ---------------- */
function layoutTimeline(slots: ChartSlots): ChartElement[] {
  const title = str(slots.title, '');
  const events = (Array.isArray(slots.events) ? slots.events : []) as Array<Record<string, unknown>>;
  const els: ChartElement[] = [];
  if (title !== '') {
    els.push(V(title, `${resolveShape('text', 'text')}${FILL_BLUE}`, 480, 20, 240, 40));
  }
  const axisStart = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, 80, 340, 20, 20)) - 1;
  const axisEnd = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, 1120, 340, 20, 20)) - 1;
  els.push(E(axisStart, axisEnd, '', 'endArrow=block;endFill=1;html=1;strokeWidth=3;strokeColor=#333333;'));
  const n = Math.max(1, events.length);
  events.slice(0, 10).forEach((ev, i) => {
    const time = str(ev.time, `#${i + 1}`);
    const label = str(ev.label, '');
    const x = 120 + (i * 920) / n;
    const up = i % 2 === 0;
    const timeIdx = els.push(V(time, `${resolveShape('terminator', 'terminator')}${FILL_BLUE}`, x, up ? 280 : 390, 120, 40)) - 1;
    const dot = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, x + 55, 340, 10, 10)) - 1;
    els.push(E(dot, timeIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=1.5;strokeColor=#333333;'));
    if (label !== '') {
      const labelIdx = els.push(V(label, `${resolveShape('card', 'card')}${FILL_GREEN}`, x - 10, up ? 170 : 460, 150, 60)) - 1;
      els.push(E(labelIdx, timeIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=1;strokeColor=#666666;'));
    }
  });
  return els;
}

/* ---------------- 桥状图:横线上下的类比对 ---------------- */
function layoutBridge(slots: ChartSlots): ChartElement[] {
  const relation = str(slots.relation, '类比关系');
  const pairs = (Array.isArray(slots.pairs) ? slots.pairs : []) as Array<Record<string, unknown>>;
  const els: ChartElement[] = [];
  els.push(V(`关系:${relation}`, `${resolveShape('text', 'text')}${FILL_BLUE}`, 60, 20, 220, 40));
  let prevTopIdx: number | null = null;
  pairs.slice(0, 4).forEach((p, i) => {
    const top = str(p.top, `上${i + 1}`);
    const bottom = str(p.bottom, `下${i + 1}`);
    const x = 320 + i * 260;
    const topIdx = els.push(V(top, `${resolveShape('ellipse', 'ellipse')}${FILL_GREEN}`, x, 160, 160, 70)) - 1;
    // 横线(上下分界)
    const lineIdx = els.push(V('', `text;html=1;${MM_LABEL_ONLY()}`, x, 260, 160, 16)) - 1;
    const bottomIdx = els.push(V(bottom, `${resolveShape('ellipse', 'ellipse')}${FILL_ORANGE}`, x, 300, 160, 70)) - 1;
    els.push(E(lineIdx, topIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=2;strokeColor=#333333;'));
    els.push(E(lineIdx, bottomIdx, '', 'endArrow=none;endFill=0;html=1;strokeWidth=2;strokeColor=#333333;'));
    if (prevTopIdx != null) {
      // 组间虚线:类比关系延续
      els.push(E(prevTopIdx, topIdx, '', 'endArrow=none;endFill=0;dashed=1;html=1;strokeColor=#999999;'));
    }
    prevTopIdx = topIdx;
  });
  return els;
}
