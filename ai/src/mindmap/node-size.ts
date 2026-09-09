/**
 * 节点尺寸估算（纯函数，可单测）。字符级宽度：CJK 全角 ≈ fontSize×1.0，
 * 其余 ≈ fontSize×0.58；字号按层级：根 16 / 一级分支 14 / 更深 12。
 * 超宽标签按 maxNodeWidth 折行，高度按行数累加。
 */

/** CJK 与全角字符区段（含中文标点、全角拉丁、假名、汉字） */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\u3000-\u303F]/;

export function fontSizeForDepth(depth: number): number {
  return depth <= 0 ? 16 : depth === 1 ? 14 : 12;
}

export interface NodeSize {
  width: number;
  height: number;
}

export function estimateNodeSize(label: string, depth: number, maxNodeWidth = 240): NodeSize {
  const fontSize = fontSizeForDepth(depth);
  let textWidth = 0;
  for (const ch of label) {
    textWidth += CJK_RE.test(ch) ? fontSize : fontSize * 0.58;
  }

  const padX = 24;
  const lineHeight = fontSize * 1.45;
  const padY = 14;

  if (textWidth <= maxNodeWidth) {
    return { width: Math.ceil(textWidth + padX), height: Math.ceil(lineHeight + padY) };
  }
  const lines = Math.ceil(textWidth / (maxNodeWidth - padX));
  return {
    width: maxNodeWidth,
    height: Math.ceil(lines * lineHeight + padY),
  };
}
