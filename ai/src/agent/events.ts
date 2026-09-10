/**
 * Agent 事件流:管线在生成过程中发出的结构化中间产物。
 *
 * 目标是"让用户真正看到 AI 在做什么"——不是只有阶段名,而是把每个阶段的
 * 真实输出(提炼出的要点原文、评审四维分数与评语、回炉原因、每张图表的
 * 节点数)以事件形式推给侧边栏面板渲染。
 *
 * 事件必须自包含(面板不回查管线状态),且只含可展示数据,不含密钥。
 */

export interface AgentNoteItem {
  content: string;
  quote?: string;
}

export type AgentEvent =
  /** 一个阶段开始(带人话标签,面板显示为分组标题) */
  | { type: 'stage'; stage: string; label: string }
  /** 块级/张级进度(如 提炼 2/12、全景第 3/12 张) */
  | { type: 'progress'; stage: string; current: number; total: number; label: string }
  /** 提炼阶段真实产物:本块提炼出的要点原文(可展开查看引文) */
  | { type: 'notes'; stage: 'distill'; chunk: number; total: number; heading?: string; notes: AgentNoteItem[] }
  /** 自动参数选择结果与理由 */
  | { type: 'autotune'; depth: number; maxChildren: number; maxNodes: number; reason: string }
  /** 结构骨架:章节路径列表 */
  | { type: 'skeleton'; sections: string[] }
  /** 评审结果:四维分数 + 结论 + 评语原文 */
  | { type: 'critique'; scores: Record<string, number>; verdict: 'pass' | 'revise'; feedback: string }
  /** 评审不达标回炉 */
  | { type: 'revise'; feedback: string }
  /** 单张图表完成(全景/单图共用) */
  | { type: 'chart'; name: string; index?: number; total?: number; nodes: number }
  /** 命令输入:用户在面板输入框发送的指令(回显) */
  | { type: 'user'; text: string }
  /** 命令输入:Agent 的答复文本 */
  | { type: 'assistant'; text: string }
  /** Agent 模式:一次工具调用(name+结果摘要) */
  | { type: 'tool'; name: string; detail: string }
  /** Agent 模式:一个节点被放置/更新 */
  | { type: 'node'; id: string; label: string; depth: number; total: number; updated?: boolean }
  /** 复合画布 extras 完成摘要 */
  | { type: 'extras'; minimaps: Array<{ title: string; items: number }>; tableRows: number; relations: number }
  /** 一行补充信息(去重统计、跳过的图等) */
  | { type: 'info'; stage?: string; text: string }
  /** 整个任务完成 */
  | { type: 'done'; summary: string }
  /** 非致命失败(单张图失败等,任务仍继续) */
  | { type: 'warn'; text: string };

export type AgentEmitter = (event: AgentEvent) => void;
