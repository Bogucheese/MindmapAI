/**
 * 画布逐个放置动画:让导图/图表的节点"一个一个放出来"。
 *
 * 实现是纯视觉层——直接操作 mxGraph 已渲染 SVG 形状节点的 opacity 渐显,
 * 不产生任何模型变更:不进撤销栈(Ctrl+Z 仍一步撤销整张图)、不影响布局与
 * 溯源数据。布局是确定性预计算的,所以"放"的顺序就是 DFS 建树顺序
 * (父节点 → 子节点 → 连线),与 AI 逐个装配的语义一致。
 *
 * 若上一次动画未结束就开始新一次生成,旧定时器会被清除;动画期间 mxGraph
 * 若因缩放/刷新重绘了形状节点,内联 opacity 丢失,节点直接可见——最坏情况
 * 只是跳过动画,无副作用。
 */

type RevealTimer = ReturnType<typeof setInterval>;

/** 依次渐显 cells(应为插入顺序);totalMs 是整段动画的目标时长。 */
export function revealCellsProgressively(
  graph: any,
  cells: unknown[],
  totalMs = 4500,
  startDelayMs = 0
): void {
  const store = graph as { __mmRevealTimers?: RevealTimer[] };
  const timers: RevealTimer[] = [];
  const clearPrevious = (): void => {
    for (const t of store.__mmRevealTimers ?? []) clearInterval(t);
    store.__mmRevealTimers = timers;
  };

  const nodes: SVGElement[] = [];
  for (const cell of cells) {
    const state = graph.view.getState(cell);
    if (state == null) continue;
    // 顶点:形状与文字是两个 DOM 节点;边:只有形状
    for (const part of [state.shape?.node, state.text?.node]) {
      if (part != null && part.style != null) {
        part.style.transition = 'opacity 0.18s ease';
        part.style.opacity = '0';
        nodes.push(part as SVGElement);
      }
    }
  }
  if (nodes.length === 0) return;

  const interval = Math.max(25, Math.min(140, Math.round(totalMs / nodes.length)));
  let i = 0;
  const start = (): void => {
    const timer = setInterval(() => {
      const node = nodes[i];
      if (node != null) node.style.opacity = '1';
      i += 1;
      if (i >= nodes.length) {
        clearInterval(timer);
        // 动画结束后清掉 transition,避免后续重绘残留
        window.setTimeout(() => {
          for (const n of nodes) n.style.transition = '';
        }, 400);
      }
    }, interval);
    timers.push(timer);
  };

  clearPrevious();
  if (startDelayMs > 0) {
    const delay = setTimeout(start, startDelayMs);
    timers.push(delay as unknown as RevealTimer);
  } else {
    start();
  }
}
