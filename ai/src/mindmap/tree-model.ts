/**
 * 核心：JSON 导图树 → mxCell 顶点+边。
 *
 * - 整棵树在单个 model 事务内构建（含布局），Ctrl+Z 一步撤销全部；
 * - 一级分支按色板序取色，后代继承；边用所在分支的 stroke 色；
 * - 旧图替换按样式 marker（mindmapAI=1）识别本插件生成的单元格，
 *   不触碰用户手绘内容（用户连到导图节点的自绘边不在清理范围）；
 * - 布局在事务内执行（mxRadialTreeLayout / mxCompactTreeLayout），
 *   fit() 取景与选中根节点放在事务外。
 */

import type { MindmapTree } from '../ai/schema';
import type { DistilledNote } from '../agent/types';
import { createLayoutEngine, type LayoutKind } from './radial-layout';
import { estimateNodeSize, fontSizeForDepth } from './node-size';
import {
  MM_MARKER,
  branchColor,
  branchVertexStyle,
  radialEdgeStyle,
  rootVertexStyle,
  treeEdgeStyle,
  treeVerticalEdgeStyle,
} from './styles';

export interface BuildMindmapOptions {
  layout: LayoutKind;
  /** 移除此前由本插件生成的导图（按 marker 识别）后再构建 */
  replaceExisting?: boolean;
  /**
   * 根节点的初始落点（mxRadialTreeLayout 以根的中心为整个放射图的圆心）。
   * 非替换模式下应传现有图形的右侧空位，避免与既有内容重叠。
   */
  origin?: { x: number; y: number };
  /**
   * 来源模式的要点列表：节点 source.noteIds 匹配到的引文会挂到单元格的
   * 悬停 tooltip 上（graph 实例级 getTooltipForCell 包装，不写入模型，
   * 不影响布局与估宽；保存后失效属 P0 已知限制）。
   */
  notes?: DistilledNote[];
  /** 追加到根节点 tooltip 的说明行（如 AI 自动参数的选定值） */
  rootNote?: string;
}

export interface BuildMindmapResult {
  rootCell: unknown;
  vertexCount: number;
  edgeCount: number;
  /** 按放置顺序排列的单元格(顶点+边交错,DFS 序)——供逐个放置动画使用 */
  placedCells: unknown[];
}

/** 收集此前由本插件生成的顶点与边（按样式 marker 识别） */
export function findMindmapCells(graph: any): any[] {
  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  const cells = [...graph.getChildVertices(parent), ...graph.getChildEdges(parent)];
  return cells.filter((cell: any) => String(model.getStyle(cell) || '').includes(MM_MARKER));
}

/** 悬停引文：graph 实例级 getTooltipForCell 包装。引文随单元格值
 *  （Object 节点的 mm-quotes 属性，drawio Edit Data 同款机制）持久化，
 *  保存/重开文件不丢失；本函数只装一次，重载文件后依然生效。
 *  展示策略:完全接管(Object 值的原生属性表冗长),只给精简核心——
 *  首条引文截断 + 条数提示,完整内容右键"编辑数据"可查。 */
export function installQuoteTooltips(graph: any): void {
  if (graph.__mmTooltipInstalled) return;
  graph.__mmTooltipInstalled = true;
  graph.getTooltipForCell = (cell: unknown): string => {
    // 完整展示全部引文(用户要求);不再截断
    return readCellQuotes(cell);
  };
}

/** 读取单元格 mm-quotes 属性（值节点为 Object 时） */
function readCellQuotes(cell: any): string {
  try {
    const value = readCellValue(cell);
    if (value != null && value.nodeType === 1 && value.getAttribute != null) {
      return String(value.getAttribute('mm-quotes') ?? '');
    }
  } catch {
    // 非 DOM 值：按无引文处理
  }
  return '';
}

// mxUtils 在测试环境不可用；nodeType 判定即可（1 = ELEMENT_NODE）
function readCellValue(cell: any): any {
  return cell != null && typeof cell.getValue === 'function' ? cell.getValue() : null;
}

/** 带元数据的单元格值：Object 节点（label 供渲染，mm-quotes 随文件持久化） */
export function makeCellValue(label: string, extra?: string): string | Element {
  if (extra == null || extra.trim() === '') return label;
  const doc = document.implementation.createDocument(null, null, null);
  const node = doc.createElement('Object');
  node.setAttribute('label', label);
  node.setAttribute('mm-quotes', extra);
  return node;
}

/** 图表槽位记忆持久化:写入根节点值的 mm-slots 属性(保存/重开不丢) */
export function attachChartSlots(graph: any, slotsJson: string): void {
  try {
    const model = graph.getModel();
    const verts = Object.values(model.getCells()).filter((c: any) => c.isVertex());
    const root = verts.find((c: any) => {
      const inc = model.getIncomingEdges(c) ?? [];
      return inc.filter((e: any) => String(model.getStyle(e) || '').includes('mindmapAI=1')).length === 0;
    });
    if (root == null) return;
    const value = model.getValue(root);
    const doc = document.implementation.createDocument(null, null, null);
    let node: Element;
    if (value != null && value.nodeType === 1 && value.getAttribute != null) {
      node = value;
    } else {
      node = doc.createElement('Object');
      node.setAttribute('label', String(value ?? ''));
    }
    node.setAttribute('mm-slots', slotsJson);
    model.setValue(root, node);
  } catch {
    // 值结构异常时静默放弃(不影响绘图)
  }
}

/** 从图中恢复图表槽位记忆(优先根节点 mm-slots 属性,其次会话内存) */
export function readChartSlots(graph: any): { type: string; slots: unknown; direction?: string } | null {
  try {
    const mem = (graph as any).__mmChartSlots;
    if (mem != null) return mem;
    const model = graph.getModel();
    const verts = Object.values(model.getCells()).filter((c: any) => c.isVertex());
    for (const c of verts) {
      const value = model.getValue(c);
      if (value != null && value.nodeType === 1 && value.getAttribute != null) {
        const raw = value.getAttribute('mm-slots');
        if (raw != null && raw !== '') {
          return JSON.parse(raw);
        }
      }
    }
  } catch {
    // 忽略坏 JSON
  }
  return null;
}

/** 单元格显示文本：兼容字符串值与 Object 值节点（label 属性） */
export function cellLabelText(cell: any): string {
  const value = readCellValue(cell);
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value.nodeType === 1 && typeof value.getAttribute === 'function') {
    return String(value.getAttribute('label') ?? '');
  }
  return String(value);
}

export function buildMindmapFromTree(
  ui: DrawioPluginApi,
  tree: MindmapTree,
  options: BuildMindmapOptions
): BuildMindmapResult {
  const graph = ui.editor.graph;
  const model = graph.getModel();
  const parent = graph.getDefaultParent();
  let vertexCount = 0;
  let edgeCount = 0;
  let rootCell: unknown = null;
  const placedCells: unknown[] = [];

  // 节点 → 引文（来源模式；noteIds 匹配不到的节点不出现在 tooltip 逻辑里）
  const noteMap = new Map<string, DistilledNote>();
  if (options.notes != null) {
    for (const n of options.notes) noteMap.set(n.id, n);
  }
  // 要点注册表：节点扩展（insertChildren）解析引文时复用
  (graph as any).__mmNotesRegistry = noteMap;
  const quotesForNode = (node: MindmapTree): string | null => {
    if (node.source == null) return null;
    const parts = node.source.noteIds
      .map((id) => noteMap.get(id))
      .filter((n): n is DistilledNote => n != null)
      .map((n) => (n.quote !== '' ? `“${n.quote}”` : n.content));
    return parts.length > 0 ? parts.join('\n') : null;
  };

  model.beginUpdate();
  try {
    if (options.replaceExisting) {
      const stale = findMindmapCells(graph);
      if (stale.length > 0) {
        // 自绘边不在 stale 里，不会被连带删除
        graph.removeCells(stale);
      }
    }

    const rootSize = estimateNodeSize(tree.label, 0);
    const originX = options.origin != null ? options.origin.x : 0;
    const originY = options.origin != null ? options.origin.y : 0;
    const rootQuotes = quotesForNode(tree);
    const rootMeta = [options.rootNote ?? '', rootQuotes ?? ''].filter((s) => s !== '').join('\n');
    rootCell = graph.insertVertex(
      parent, null, makeCellValue(tree.label, rootMeta !== '' ? rootMeta : undefined),
      originX, originY, rootSize.width, rootSize.height, rootVertexStyle()
    );
    vertexCount++;
    placedCells.push(rootCell);

    const edgeStyleFor =
      options.layout === 'tree'
        ? treeEdgeStyle
        : options.layout === 'tree-vertical'
          ? treeVerticalEdgeStyle
          : radialEdgeStyle;

    const addSubtree = (node: MindmapTree, parentCell: unknown, depth: number, colorIndex: number): void => {
      const [fill, stroke] = branchColor(colorIndex);
      const size = estimateNodeSize(node.label, depth);
      const style = branchVertexStyle(fill, stroke, fontSizeForDepth(depth), depth === 1);
      const cell = graph.insertVertex(
        parent, null, makeCellValue(node.label, quotesForNode(node) ?? undefined),
        0, 0, size.width, size.height, style
      );
      vertexCount++;
      placedCells.push(cell);
      const edge = graph.insertEdge(parent, null, '', parentCell, cell, edgeStyleFor(stroke));
      edgeCount++;
      placedCells.push(edge);

      for (const child of node.children ?? []) {
        // 一级分支各自取新色（顶层循环传入 i），后代沿用所在分支的色号
        addSubtree(child, cell, depth + 1, colorIndex);
      }
    };

    const level1 = tree.children ?? [];
    for (let i = 0; i < level1.length; i++) {
      addSubtree(level1[i], rootCell, 1, i);
    }

    createLayoutEngine(options.layout).execute(graph, parent, rootCell);
  } finally {
    model.endUpdate();
  }

  graph.fit();
  graph.setSelectionCell(rootCell);
  installQuoteTooltips(graph);
  return { rootCell, vertexCount, edgeCount, placedCells };
}

/* ==================== 节点扩展（懒展开） ==================== */

/** 沿导图边向上找根单元格（导图边带 marker，方向为父→子） */
export function findMindmapParent(graph: any, cell: any): any | null {
  const model = graph.getModel();
  const incoming = model.getIncomingEdges(cell) ?? [];
  const edge = incoming.find((e: any) => String(model.getStyle(e) || '').includes(MM_MARKER));
  return edge != null ? model.getTerminal(edge, true) : null;
}

export function findMindmapRoot(graph: any, cell: any): any {
  let cur = cell;
  for (let i = 0; i < 100; i++) {
    const parent = findMindmapParent(graph, cur);
    if (parent == null) return cur;
    cur = parent;
  }
  return cur;
}

/** 按既有导图的边样式识别布局种类（竖向树/横向树的正交边 vs 径向的自由曲线边） */
export function detectLayoutKind(graph: any, root: any): 'radial' | 'tree' | 'tree-vertical' {
  const model = graph.getModel();
  const outgoing = model.getOutgoingEdges(root) ?? [];
  for (const e of outgoing) {
    const style = String(model.getStyle(e) || '');
    if (!style.includes(MM_MARKER)) continue;
    if (style.includes('exitX=1')) return 'tree';
    if (style.includes('exitY=1')) return 'tree-vertical';
    return 'radial';
  }
  return 'radial';
}

function extractStyleColor(style: string, key: string): string | null {
  const m = style.match(new RegExp(`${key}=([^;]+)`));
  return m != null ? m[1] : null;
}

export interface InsertChildrenResult {
  added: number;
  rootCell: unknown;
}

/**
 * 把扩展生成的子树插到 parentCell 之下（单事务：插入 + 整图重排，
 * Ctrl+Z 一步撤销）。颜色/边样式沿用所在分支，tooltip 引文从
 * graph.__mmNotesRegistry（最近一次来源生成的要点注册表）解析。
 */
export function insertChildren(
  ui: DrawioPluginApi,
  parentCell: any,
  children: MindmapTree[]
): InsertChildrenResult {
  const graph = ui.editor.graph;
  const model = graph.getModel();
  const parent = graph.getDefaultParent();

  // 深度：从根走到 parentCell 的层数（根为 0）
  let depth = 0;
  let ancestor = findMindmapParent(graph, parentCell);
  while (ancestor != null && depth < 100) {
    depth++;
    ancestor = findMindmapParent(graph, ancestor);
  }
  const childDepth = depth + 1;

  const parentStyle = String(model.getStyle(parentCell) || '');
  const fill = extractStyleColor(parentStyle, 'fillColor') ?? branchColor(0)[0];
  const stroke = extractStyleColor(parentStyle, 'strokeColor') ?? branchColor(0)[1];
  // 新边沿用父节点入边的样式（同分支的边应一致）
  const model2 = graph.getModel();
  const incoming = model2.getIncomingEdges(parentCell) ?? [];
  const parentEdge = incoming.find((e: any) => String(model2.getStyle(e) || '').includes(MM_MARKER));
  const edgeStyle = parentEdge != null ? String(model2.getStyle(parentEdge)) : radialEdgeStyle(stroke);

  const registry = graph.__mmNotesRegistry instanceof Map ? (graph.__mmNotesRegistry as Map<string, DistilledNote>) : null;
  const quotesForNode = (node: MindmapTree): string | null => {
    if (node.source == null || registry == null) return null;
    const parts = node.source.noteIds
      .map((id) => registry.get(id))
      .filter((n): n is DistilledNote => n != null)
      .map((n) => (n.quote !== '' ? `“${n.quote}”` : n.content));
    return parts.length > 0 ? parts.join('\n') : null;
  };

  const rootCell = findMindmapRoot(graph, parentCell);
  let added = 0;

  model.beginUpdate();
  try {
    const addLevel = (node: MindmapTree, parentC: unknown, d: number): void => {
      const size = estimateNodeSize(node.label, d);
      const style = branchVertexStyle(fill, stroke, fontSizeForDepth(d), d === 1);
      const cell = graph.insertVertex(
        parent, null, makeCellValue(node.label, quotesForNode(node) ?? undefined),
        0, 0, size.width, size.height, style
      );
      graph.insertEdge(parent, null, '', parentC, cell, edgeStyle);
      added++;
      for (const child of node.children ?? []) {
        addLevel(child, cell, d + 1);
      }
    };
    for (const child of children) {
      addLevel(child, parentCell, childDepth);
    }
    createLayoutEngine(detectLayoutKind(graph, rootCell)).execute(graph, parent, rootCell);
  } finally {
    model.endUpdate();
  }

  graph.fit();
  graph.setSelectionCell(parentCell);
  installQuoteTooltips(graph);
  return { added, rootCell };
}
