/**
 * drawio 形状部件目录:语义 key → 样式串。
 * AI 按语义从目录里选部件(白名单校验),不再只会圆角矩形。
 * 样式全部为 drawio 核心内置(不依赖扩展形状库),追加 mindmapAI marker
 * 供替换/清理识别。
 */

import { MM_MARKER } from '../mindmap/styles';

const base = 'whiteSpace=wrap;html=1;';

export interface ChartShape {
  key: string;
  /** 中文名(进 prompt 与校验错误信息) */
  name: string;
  style: string;
}

export const CHART_SHAPES: Record<string, ChartShape> = {
  process: { key: 'process', name: '过程(矩形)', style: `${base}rounded=0;${MM_MARKER};` },
  terminator: { key: 'terminator', name: '开始/结束(圆角胶囊)', style: `${base}rounded=1;arcSize=50;${MM_MARKER};` },
  decision: { key: 'decision', name: '判断(菱形)', style: `${base}rhombus;${MM_MARKER};` },
  data: { key: 'data', name: '输入/输出(平行四边形)', style: `${base}shape=parallelogram;perimeter=parallelogramPerimeter;${MM_MARKER};` },
  document: { key: 'document', name: '文档', style: `${base}shape=document;boundedLbl=1;${MM_MARKER};` },
  database: { key: 'database', name: '数据库(圆柱)', style: `${base}shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=15;${MM_MARKER};` },
  preparation: { key: 'preparation', name: '准备(六边形)', style: `${base}shape=hexagon;perimeter=hexagonPerimeter2;${MM_MARKER};` },
  manualInput: { key: 'manualInput', name: '手动输入', style: `${base}shape=manualInput;${MM_MARKER};` },
  manualOperation: { key: 'manualOperation', name: '手工操作(倒梯形)', style: `${base}shape=trapezoid;perimeter=trapezoidPerimeter;flipV=1;${MM_MARKER};` },
  delay: { key: 'delay', name: '延迟(D形)', style: `${base}shape=delay;${MM_MARKER};` },
  display: { key: 'display', name: '显示(屏)', style: `${base}shape=display;${MM_MARKER};` },
  ellipse: { key: 'ellipse', name: '椭圆(气泡/集合)', style: `${base}ellipse;${MM_MARKER};` },
  card: { key: 'card', name: '卡片', style: `${base}shape=card;${MM_MARKER};` },
  text: { key: 'text', name: '纯文本标注', style: `text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;${MM_MARKER};` },
  actor: { key: 'actor', name: '人员(小人形)', style: `${base}shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;${MM_MARKER};` },
  triangle: { key: 'triangle', name: '三角形(警示/汇聚)', style: `${base}triangle;direction=east;${MM_MARKER};` },
  note: { key: 'note', name: '便签', style: `${base}shape=note;size=14;${MM_MARKER};` },
};

/** 泳道/容器:流程图按角色分列的容器部件 */
export function swimlaneStyle(): string {
  return `swimlane;startSize=28;html=1;rounded=1;fontSize=12;fillColor=#F5F5F5;strokeColor=#666666;${MM_MARKER};`;
}

/* ---------- 图标部件(原创内联 SVG,data-URI,不依赖网络与扩展形状库) ---------- */

const ICON_COLOR = '#475569';

/** 语义图标:24x24 单色剪影,style 里用 encodeURIComponent 的 data-URI(无分号,不破坏样式串) */
function iconShape(key: string, name: string, svg: string): ChartShape {
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return {
    key,
    name,
    style: `shape=image;image=${uri};noLabel=0;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;aspect=fixed;whiteSpace=wrap;html=1;${MM_MARKER};`,
  };
}

const ROBOT_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<circle cx='12' cy='3.2' r='1.5' fill='${ICON_COLOR}'/>` +
  `<rect x='11' y='4.2' width='2' height='3' fill='${ICON_COLOR}'/>` +
  `<rect x='4.5' y='7' width='15' height='11' rx='2.5' fill='${ICON_COLOR}'/>` +
  `<circle cx='9.2' cy='12' r='1.6' fill='#fff'/><circle cx='14.8' cy='12' r='1.6' fill='#fff'/>` +
  `<rect x='8' y='19.5' width='8' height='1.8' rx='0.9' fill='${ICON_COLOR}'/></svg>`;

const IDEA_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<circle cx='12' cy='10' r='6.5' fill='${ICON_COLOR}'/>` +
  `<rect x='9.4' y='16.5' width='5.2' height='3.4' rx='1' fill='${ICON_COLOR}'/>` +
  `<rect x='10.2' y='20.6' width='3.6' height='1.4' rx='0.7' fill='${ICON_COLOR}'/>` +
  `<path d='M12 1.2v2M3.6 10h-2M22.4 10h-2M5.8 3.8L4.4 2.4M18.2 3.8l1.4-1.4' stroke='${ICON_COLOR}' stroke-width='1.6' stroke-linecap='round'/></svg>`;

const GEAR_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<g fill='${ICON_COLOR}'>` +
  `<rect x='10.9' y='2' width='2.2' height='4.4' rx='0.8'/>` +
  `<rect x='10.9' y='17.6' width='2.2' height='4.4' rx='0.8'/>` +
  `<rect x='2' y='10.9' width='4.4' height='2.2' rx='0.8'/>` +
  `<rect x='17.6' y='10.9' width='4.4' height='2.2' rx='0.8'/>` +
  `<circle cx='12' cy='12' r='6'/></g>` +
  `<circle cx='12' cy='12' r='2.4' fill='#fff'/></svg>`;

const GLOBE_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<g fill='none' stroke='${ICON_COLOR}' stroke-width='1.8'>` +
  `<circle cx='12' cy='12' r='8.5'/>` +
  `<ellipse cx='12' cy='12' rx='3.8' ry='8.5'/>` +
  `<path d='M3.5 12h17M4.6 7.5h14.8M4.6 16.5h14.8'/></g></svg>`;

const CLOCK_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<circle cx='12' cy='12' r='8.5' fill='none' stroke='${ICON_COLOR}' stroke-width='2'/>` +
  `<path d='M12 6.8V12l3.6 2.4' fill='none' stroke='${ICON_COLOR}' stroke-width='2' stroke-linecap='round'/></svg>`;

const TARGET_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<circle cx='12' cy='12' r='8.5' fill='none' stroke='${ICON_COLOR}' stroke-width='1.8'/>` +
  `<circle cx='12' cy='12' r='4.8' fill='none' stroke='${ICON_COLOR}' stroke-width='1.8'/>` +
  `<circle cx='12' cy='12' r='1.8' fill='${ICON_COLOR}'/></svg>`;

const BOOK_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<path d='M12 4.5C10 3 7 2.8 4 3.4v15.2c3-.6 6-.4 8 1.1 2-1.5 5-1.7 8-1.1V3.4c-3-.6-6-.4-8 1.1z' fill='${ICON_COLOR}'/>` +
  `<path d='M12 4.5v15.2' stroke='#fff' stroke-width='1.4'/></svg>`;

const GROUP_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
  `<circle cx='9' cy='8.2' r='3.4' fill='${ICON_COLOR}'/>` +
  `<path d='M2.5 19.5c0-3.8 2.9-6.2 6.5-6.2s6.5 2.4 6.5 6.2z' fill='${ICON_COLOR}'/>` +
  `<circle cx='17.2' cy='8.8' r='2.6' fill='${ICON_COLOR}' opacity='0.72'/>` +
  `<path d='M16.6 13.1c2.9.1 5 2.2 5 5.4h-4.2' fill='${ICON_COLOR}' opacity='0.72'/></svg>`;

// 追加进部件目录:key 与现有部件不冲突;flow 槽位的 shape 字段可直接取用
const ICON_PARTS: ChartShape[] = [
  iconShape('robot', '机器人(AI/智能体)', ROBOT_SVG),
  iconShape('idea', '灯泡(创意/洞察)', IDEA_SVG),
  iconShape('gear', '齿轮(工具/机制)', GEAR_SVG),
  iconShape('globe', '地球(网络/全球/链接)', GLOBE_SVG),
  iconShape('clock', '时钟(时间/计划/周期)', CLOCK_SVG),
  iconShape('target', '靶心(目标/指标)', TARGET_SVG),
  iconShape('book', '书本(知识/文档/学习资源)', BOOK_SVG),
  iconShape('group', '群体(用户/团队/受众)', GROUP_SVG),
];
export const ICON_SHAPE_KEYS: ReadonlySet<string> = new Set(ICON_PARTS.map((s) => s.key));
Object.assign(CHART_SHAPES, Object.fromEntries(ICON_PARTS.map((s) => [s.key, s])));

/** 虚线边样式(在基础边样式上叠加) */
export function dashedEdgeStyle(baseStyle: string): string {
  return baseStyle + 'dashed=1;dashPattern=6 4;';
}

/** chart 元数据里引用的语义 key 白名单(按图类型收窄) */
export function resolveShape(key: string | undefined, fallback: string): string {
  const shape = key != null ? CHART_SHAPES[key] : undefined;
  return (shape ?? CHART_SHAPES[fallback]).style;
}

/** 供 prompt 的形状目录描述(紧凑) */
export const SHAPE_CATALOG_PROMPT = Object.values(CHART_SHAPES)
  .map((s) => `${s.key}: ${s.name}`)
  .join('; ');
