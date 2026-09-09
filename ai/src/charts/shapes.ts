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
