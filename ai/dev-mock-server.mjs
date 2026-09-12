/**
 * 本地 mock LLM 服务器（开发联调用）：OpenAI 兼容 /chat/completions。
 *
 * 两种模式（按 system prompt 首行 [MM-STAGE:*] 标记区分，见 agent/skills.ts）：
 * 1. 无标记（旧链路）：主题模式生成返回固定导图 JSON，测试连接最小请求照常回；
 * 2. [MM-STAGE:distill] / [MM-STAGE:architect] / [MM-STAGE:critique]：
 *    来源模式管线按阶段返回固定脚本，走完整 INGEST→DISTILL→ARCHITECT→
 *    CRITIQUE 链路（architect 的 noteIds 与 distill 的 n1..n4 对齐，
 *    画布悬停引文可端到端验证）。设 MM_MOCK_CRITIQUE=revise 可强制
 *    第一次评审判 revise，验证回炉重构路径。
 *
 * 浏览器设置里 Base URL 填 http://127.0.0.1:8787 即可
 * 在不消耗真实 API 配额的情况下走通完整生成链路。
 *
 * 启动：node dev-mock-server.mjs
 */

import { createServer } from 'node:http';

const forceRevise = process.env.MM_MOCK_CRITIQUE === 'revise';
let critiqueCalls = 0;

const TREE = {
  label: 'Mock 咖啡供应链',
  children: [
    {
      label: '种植与采购',
      children: [{ label: '阿拉比卡' }, { label: '罗布斯塔' }, { label: '直接贸易' }],
    },
    {
      label: '烘焙加工',
      children: [{ label: '浅烘' }, { label: '中烘' }, { label: '深烘' }],
    },
    {
      label: '销售渠道',
      children: [{ label: '线下门店' }, { label: '电商订阅' }],
    },
    { label: '可持续认证' },
  ],
};

const DISTILL_NOTES = {
  notes: [
    { id: 'n1', content: 'AI Agent 是让 LLM 在环境中行动的系统：环境、传感器、执行器', quote: 'AI agents are systems that let LLMs act in an environment' },
    { id: 'n2', content: 'Agent 类型从简单反射到多智能体系统（MAS）', quote: 'from simple reflex agents to Multi-Agent Systems (MAS)' },
    { id: 'n3', content: '适合用 Agent 的场景：开放性问题、多步工具调用、持续改进', quote: 'open-ended problems, multi-step tool-using processes' },
    { id: 'n4', content: 'Agentic 方案三要素：开发平台、设计模式、框架', quote: 'Agent Development, Agentic Patterns and Agentic Frameworks' },
  ],
};

const SOURCE_TREE = {
  label: 'AI Agents 第一课',
  source: { noteIds: [] },
  children: [
    {
      label: '定义与类型',
      source: { noteIds: ['n1', 'n2'] },
      children: [
        { label: '环境/传感器/执行器', source: { noteIds: ['n1'] } },
        { label: '从反射到多智能体', source: { noteIds: ['n2'] } },
      ],
    },
    {
      label: '适用场景',
      source: { noteIds: ['n3'] },
      children: [
        { label: '开放性问题', source: { noteIds: ['n3'] } },
        { label: '多步工具调用', source: { noteIds: ['n3'] } },
      ],
    },
    {
      label: '方案三要素',
      source: { noteIds: ['n4'] },
      children: [
        { label: '开发平台', source: { noteIds: ['n4'] } },
        { label: '设计模式', source: { noteIds: ['n4'] } },
        { label: '框架', source: { noteIds: ['n4'] } },
      ],
    },
  ],
};

const CRITIQUE_PASS = {
  scores: { grounding: 92, coverage: 88, specificity: 85, structure: 90 },
  overall: 89,
  verdict: 'pass',
  feedback: '结构清晰，覆盖完整，叶子具体。',
};

const CRITIQUE_REVISE = {
  scores: { grounding: 80, coverage: 65, specificity: 72, structure: 85 },
  overall: 75,
  verdict: 'revise',
  feedback: '缺少“代码样例”主题的一级分支，请补充覆盖。',
};

const EXPAND_CHILDREN = {
  label: '(node)',
  children: [
    { label: '扩展子项 A' },
    { label: '扩展子项 B' },
    { label: '扩展子项 C' },
  ],
};

const AUTOTUNE = {
  depth: 4,
  maxChildren: 6,
  maxNodes: 48,
  reason: '来源 5 节、主题集中，按要点密度选择。',
};

// 图表阶段(流程图):跨泳道 + decision 分支 + 回退 edge,覆盖显式 edges 布局路径
const FLOW_SLOTS = {
  title: 'AI Agent 工作流程',
  lanes: ['用户', 'Agent', '工具'],
  steps: [
    { id: 's1', label: '提出目标', shape: 'terminator', lane: 0 },
    { id: 's2', label: '规划任务', shape: 'process', lane: 1 },
    { id: 's3', label: '调用工具', shape: 'process', lane: 2 },
    { id: 's4', label: '目标达成?', shape: 'decision', lane: 1 },
    { id: 's5', label: '输出结果', shape: 'terminator', lane: 1 },
  ],
  edges: [
    { from: 's1', to: 's2' },
    { from: 's2', to: 's3' },
    { from: 's3', to: 's4' },
    { from: 's4', to: 's5', label: '是' },
    { from: 's4', to: 's2', label: '否', dashed: true },
  ],
};

function stageOf(body) {
  const sys = (body.messages || []).find((m) => m.role === 'system');
  const m = typeof sys?.content === 'string' ? sys.content.match(/\[MM-STAGE:([\w-]+)\]/) : null;
  return m != null ? m[1] : null;
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!(req.url || '').includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock: unknown path ' + req.url } }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk.toString();
  });
  req.on('end', () => {
    const body = raw !== '' ? JSON.parse(raw) : {};
    const stage = stageOf(body);
    console.log('[mock] stage=%s model=%s messages=%d', stage ?? 'topic', body.model, (body.messages || []).length);

    let content;
    let toolCalls = null;
    if (stage === 'distill') {
      content = JSON.stringify(DISTILL_NOTES);
    } else if (stage === 'autotune') {
      content = JSON.stringify(AUTOTUNE);
    } else if (stage === 'architect') {
      content = JSON.stringify(SOURCE_TREE);
    } else if (stage === 'critique') {
      critiqueCalls++;
      content = JSON.stringify(forceRevise && critiqueCalls % 2 === 1 ? CRITIQUE_REVISE : CRITIQUE_PASS);
    } else if (stage === 'expand') {
      content = JSON.stringify(EXPAND_CHILDREN);
    } else if (stage === 'chart') {
      const sys = (body.messages || []).find((m) => m.role === 'system');
      content = typeof sys?.content === 'string' && sys.content.includes('流程图')
        ? JSON.stringify(FLOW_SLOTS)
        : JSON.stringify(TREE);
    } else if (stage === 'agent-chart') {
      // Agent 模式(思考图):直接以 tool_calls 提交槽位,一次成环
      content = '';
      toolCalls = [
        {
          id: 'mock-submit-1',
          type: 'function',
          function: { name: 'submit_chart', arguments: JSON.stringify({ slots: FLOW_SLOTS }) },
        },
      ];
    } else {
      content = JSON.stringify(TREE);
    }

    const message = { role: 'assistant', content };
    if (toolCalls != null) message.tool_calls = toolCalls;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion',
        model: body.model || 'mock-model',
        choices: [{ index: 0, message, finish_reason: 'stop' }],
      })
    );
  });
});

server.listen(8787, '127.0.0.1', () => {
  console.log('mock LLM listening on http://127.0.0.1:8787 (MM_MOCK_CRITIQUE=%s)', forceRevise ? 'revise' : 'pass');
});
