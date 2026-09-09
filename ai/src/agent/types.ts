/**
 * 来源模式生成的数据契约（P0：粘贴文本来源）。
 *
 * 数据流：tools.buildSourceDocFromText → SourceDoc
 *   → pipeline 的 DISTILL 阶段 → DistilledNote[]
 *   → ARCHITECT 阶段 → MindmapTree（节点 source.noteIds 引用要点 id）
 *   → CRITIQUE 阶段 → CritiqueReport（不达标回炉一次）。
 */

/** 来源文档的一个分块（按标题层级/段落切分，控制单次请求的体积） */
export interface SourceChunk {
  /** 管线内唯一 id（c1、c2…） */
  id: string;
  /** 所处标题路径（如 "## 何时使用 > ### 开放性问题"），无标题结构时缺省 */
  headingPath?: string;
  text: string;
}

/** 来源文档：粘贴文本或（P1）抓取的网页正文 */
export interface SourceDoc {
  title: string;
  url?: string;
  chunks: SourceChunk[];
  /** 超出分块预算被截断时为 true（stats 透出，界面提示质量风险） */
  truncated?: boolean;
}

/** DISTILL 阶段产出的一条要点：内容 + 原文引文 + 所在分块 */
export interface DistilledNote {
  id: string;
  /** 提炼后的要点（进入 ARCHITECT 的素材） */
  content: string;
  /** 原文引文（溯源展示与 grounding 抽检用，容忍空串） */
  quote: string;
  chunkId: string;
  /** 所在章节路径（继承自分块的 headingPath，构造导图骨架用） */
  headingPath?: string;
}

/** CRITIQUE 阶段的 rubric 评分（0-100）与结论 */
export interface CritiqueReport {
  scores: {
    grounding: number;
    coverage: number;
    specificity: number;
    structure: number;
  };
  overall: number;
  verdict: 'pass' | 'revise';
  feedback: string;
}
