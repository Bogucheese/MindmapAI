/**
 * 导图顶点/边样式。配色用 drawio 原生色板（fill/stroke 成对），一级分支
 * 按序循环取色，后代继承所在分支的颜色。所有样式串带 mindmapAI marker，
 * 替换旧图时按 marker 识别本插件生成的单元格，不碰用户手绘内容。
 */

export const MM_MARKER = 'mindmapAI=1';

/** drawio 原生 6 色系（fill, stroke），一级分支循环使用 */
export const BRANCH_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#DAE8FC', '#6C8EBF'],
  ['#D5E8D4', '#82B366'],
  ['#FFE6CC', '#D79B00'],
  ['#FFF2CC', '#D6B656'],
  ['#F8CECC', '#B85450'],
  ['#E1D5E7', '#9673A6'],
];

export function branchColor(index: number): readonly [string, string] {
  return BRANCH_PALETTE[((index % BRANCH_PALETTE.length) + BRANCH_PALETTE.length) % BRANCH_PALETTE.length];
}

export function rootVertexStyle(): string {
  return `rounded=1;whiteSpace=wrap;html=1;arcSize=30;fillColor=#23445D;strokeColor=#23445D;fontColor=#FFFFFF;fontStyle=1;${MM_MARKER};`;
}

export function branchVertexStyle(fill: string, stroke: string, fontSize: number, isBranchHead: boolean): string {
  const bold = isBranchHead ? 'fontStyle=1;' : '';
  return `rounded=1;whiteSpace=wrap;html=1;arcSize=40;fillColor=${fill};strokeColor=${stroke};fontColor=#1A1A1A;fontSize=${fontSize};${bold}${MM_MARKER};`;
}

/**
 * 径向布局的浮动曲线边：无箭头、随节点方向弯曲（正交边在放射图上很乱）。
 * 横向树布局请用 treeEdgeStyle。
 */
export function radialEdgeStyle(stroke: string): string {
  return `edgeStyle=none;curved=1;rounded=0;html=1;endArrow=none;startArrow=none;strokeColor=${stroke};strokeWidth=1.5;${MM_MARKER};`;
}

/** 横向树布局的正交边：右侧出、左侧进，水平段走中点 */
export function treeEdgeStyle(stroke: string): string {
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;endArrow=none;startArrow=none;strokeColor=${stroke};strokeWidth=1.5;${MM_MARKER};`;
}

/** 竖向树布局的正交边：父底部出、子顶部进 */
export function treeVerticalEdgeStyle(stroke: string): string {
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;endArrow=none;startArrow=none;strokeColor=${stroke};strokeWidth=1.5;${MM_MARKER};`;
}
