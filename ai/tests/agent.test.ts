/**
 * 来源模式管线测试：工具分块（纯函数）+ 管线状态机（注入假 chat）+
 * 本地 HTTP mock 集成（验证 [MM-STAGE:*] 标记与请求装配）。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSourceDocFromText, MAX_CHUNKS, MAX_CHUNK_CHARS } from '../src/agent/tools';
import { buildSkeleton, generateMindmapFromSource, parseAutotuneChoice, parseCritiqueReport } from '../src/agent/pipeline';
import type { ChatResult } from '../src/ai/client';
import { DEFAULT_GENERATION } from '../src/ai/prompts';
import { parseMindmapTree } from '../src/ai/schema';
import type { SourceDoc } from '../src/agent/types';

const SETTINGS = { baseUrl: 'http://mock.local', model: 'test-model', temperature: 1.0, fetchProxyPrefix: 'https://r.jina.ai/' };
const API_KEY = 'test-key';

type ChatFn = NonNullable<Parameters<typeof generateMindmapFromSource>[4]>['chat'];

/** 按调用次序消费脚本（末位复用）；记录每次的 messages 与 opts 供断言 */
function sequenceChat(script: Array<string>): { chat: ChatFn; calls: Array<{ messages: unknown[]; opts: unknown }> } {
  const calls: Array<{ messages: unknown[]; opts: unknown }> = [];
  const chat = vi.fn(async (_s: unknown, _k: unknown, messages: unknown[], opts: unknown) => {
    calls.push({ messages, opts });
    const content = script[Math.min(calls.length - 1, script.length - 1)];
    return { ok: true, content, model: 'test-model' } as ChatResult;
  }) as unknown as ChatFn;
  return { chat, calls };
}

const doc2Chunks: SourceDoc = {
  title: 'Doc',
  chunks: [
    { id: 'c1', text: 'chunk one' },
    { id: 'c2', text: 'chunk two' },
  ],
};

const DISTILL_1 = JSON.stringify({
  notes: [
    { id: 'n1', content: 'Point A', quote: 'quote a' },
    { content: 'Point A', quote: 'dup' },
    { id: 'n2', content: 'Point B', quote: 'quote b' },
  ],
});
const DISTILL_2 = JSON.stringify({ notes: [{ id: 'n3', content: 'Point C', quote: 'quote c' }] });
const CRITIQUE_PASS = JSON.stringify({
  scores: { grounding: 90, coverage: 85, specificity: 80, structure: 88 },
  overall: 86,
  verdict: 'pass',
  feedback: 'fine',
});
const CRITIQUE_REVISE = JSON.stringify({
  scores: { grounding: 80, coverage: 60, specificity: 75, structure: 82 },
  overall: 74,
  verdict: 'revise',
  feedback: 'missing a major theme',
});

describe('buildSourceDocFromText (chunker)', () => {
  it('splits by markdown headings and keeps heading paths', () => {
    const text = [
      '# Title',
      'intro text',
      '## One',
      'body one',
      '### Deep',
      'body deep',
      '## Two',
      'body two',
    ].join('\n');
    const doc = buildSourceDocFromText('', text);
    expect(doc.title).toBe('Title');
    expect(doc.chunks.map((c) => c.headingPath)).toEqual([
      undefined,
      ['One'].join(' > '),
      ['One', 'Deep'].join(' > '),
      ['Two'].join(' > '),
    ]);
    expect(doc.chunks[0].id).toBe('c1');
    expect(doc.chunks[3].text).toContain('body two');
  });

  it('packs paragraphs and hard-slices overlong single paragraphs', () => {
    const longPara = 'x'.repeat(MAX_CHUNK_CHARS + 800);
    const text = `${longPara}\n\nshort tail`;
    const doc = buildSourceDocFromText('T', text);
    expect(doc.chunks.length).toBeGreaterThanOrEqual(2);
    expect(doc.truncated).toBeUndefined();
    for (const c of doc.chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('caps chunk count and flags truncation', () => {
    const headings = Array.from({ length: MAX_CHUNKS + 4 }, (_, i) => `## H${i}\nbody ${i}`).join('\n\n');
    const doc = buildSourceDocFromText('T', headings);
    expect(doc.chunks.length).toBe(MAX_CHUNKS);
    expect(doc.truncated).toBe(true);
  });
});

describe('parseAutotuneChoice', () => {
  const manual = { depth: 3, maxChildren: 5, maxNodes: 60, language: 'auto' as const };

  it('clamps out-of-range recommendations', () => {
    const r = parseAutotuneChoice('{"depth":99,"maxChildren":0,"maxNodes":-5,"reason":"r"}', manual);
    expect(r).toEqual({ depth: 6, maxChildren: 1, maxNodes: 12, reason: 'r' });
  });

  it('returns null on malformed payloads and no-op choices', () => {
    expect(parseAutotuneChoice('nope', manual)).toBeNull();
    // 与手动值完全一致且无理由 → 视为无推荐
    expect(parseAutotuneChoice('{"depth":3,"maxChildren":5,"maxNodes":60,"reason":""}', manual)).toBeNull();
  });
});

describe('generateMindmapFromSource with autoConstraints', () => {
  it('lets the AI recommendation drive the architect prompt', async () => {
    const { chat, calls } = sequenceChat([
      DISTILL_1,
      DISTILL_2,
      JSON.stringify({ depth: 4, maxChildren: 6, maxNodes: 48, reason: 'dense source' }),
      JSON.stringify({
        label: 'Root',
        children: [{ label: 'A', source: { noteIds: ['n1'] } }],
      }),
      CRITIQUE_PASS,
    ]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, {
      chat,
      autoConstraints: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.autotune).toEqual({ depth: 4, maxChildren: 6, maxNodes: 48, reason: 'dense source' });
    // 5 次调用:2 distill + autotune + architect + critique
    expect(calls.length).toBe(5);
    const autotuneSys = (calls[2].messages as Array<{ role: string; content: string }>)[0].content;
    expect(autotuneSys).toContain('[MM-STAGE:autotune]');
    // architect 的 system prompt 使用推荐值(DEFAULT_GENERATION.depth 是 3)
    const archSys = (calls[3].messages as Array<{ role: string; content: string }>)[0].content;
    expect(archSys).toContain('Maximum depth: 4');
    expect(archSys).toContain('maximum 6 children per node');
  });

  it('falls back to manual constraints when autotune reply is malformed', async () => {
    const { chat, calls } = sequenceChat([
      DISTILL_1,
      DISTILL_2,
      'garbage',
      JSON.stringify({ label: 'Root', children: [{ label: 'A' }] }),
      CRITIQUE_PASS,
    ]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, {
      chat,
      autoConstraints: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.autotune).toBeNull();
    const archSys = (calls[3].messages as Array<{ role: string; content: string }>)[0].content;
    expect(archSys).toContain('Maximum depth: 3');
  });
});

describe('buildSkeleton (deterministic section tree)', () => {
  it('mirrors heading paths, counts notes, tracks depth', () => {
    const notes = [
      { id: 'a', content: 'x', quote: '', chunkId: 'c1', headingPath: '课程概览' },
      { id: 'b', content: 'y', quote: '', chunkId: 'c2', headingPath: '定义 > 什么是 AI 代理' },
      { id: 'c', content: 'z', quote: '', chunkId: 'c2', headingPath: '定义 > 什么是 AI 代理' },
      { id: 'd', content: 'w', quote: '', chunkId: 'c3', headingPath: '定义 > 类型' },
    ];
    const s = buildSkeleton(notes as never);
    expect(s.maxDepth).toBe(2);
    expect(s.sectionCount).toBe(4); // 课程概览 / 定义 / 什么是 AI 代理 / 类型
    expect(s.text).toContain('- 课程概览 (1 point)');
    expect(s.text).toContain('- 定义 > 什么是 AI 代理 (2 points)');
    expect(s.text).toContain('- 定义 > 类型 (1 point)');
  });

  it('is empty when notes carry no heading paths', () => {
    const s = buildSkeleton([{ id: 'a', content: 'x', quote: '', chunkId: 'c1' } as never]);
    expect(s.text).toBe('');
    expect(s.maxDepth).toBe(0);
  });

  it('compresses large skeletons to two levels with folded counts', () => {
    // 13 个一级章节 × 深路径 → 全量章节数 > 12 → 触发压缩
    const notes = Array.from({ length: 13 }, (_, i) => ({
      id: `n${i}`,
      content: `p${i}`,
      quote: '',
      chunkId: `c${i}`,
      headingPath: `S${i} > 子章节 > 细节`,
    })) as never[];
    const s = buildSkeleton(notes);
    expect(s.maxDepth).toBe(2);
    // 深层(细节)折叠进二级章节的要点计数
    expect(s.text).toContain('- S0 > 子章节 (2 points)');
    expect(s.text).not.toContain('细节');
    // 每行最多一段 " > "(两级)
    for (const line of s.text.split('\n')) {
      expect(line.split(' > ').length).toBeLessThanOrEqual(2);
    }
  });

  it('keeps full depth for small sources', () => {
    const notes = [
      { id: 'a', content: 'x', quote: '', chunkId: 'c1', headingPath: '定义 > 什么是代理' },
    ] as never[];
    const s = buildSkeleton(notes);
    expect(s.maxDepth).toBe(2);
    expect(s.text).toContain('定义 > 什么是代理');
  });
});

describe('generateMindmapFromSource with skeleton grounding', () => {
  const docSections: SourceDoc = {
    title: 'Doc',
    chunks: [
      { id: 'c1', headingPath: '学习目标', text: 'goals' },
      { id: 'c2', headingPath: '定义 > 类型', text: 'types' },
    ],
  };
  const DISTILL_C1 = JSON.stringify({ notes: [{ id: 'n1', content: '目标一', quote: 'q1' }] });
  const DISTILL_C2 = JSON.stringify({ notes: [{ id: 'n2', content: '类型表', quote: 'q2' }] });

  it('passes section paths and skeleton into the architect prompt', async () => {
    const { chat, calls } = sequenceChat([
      DISTILL_C1,
      DISTILL_C2,
      JSON.stringify({
        leaves: {
          '学习目标': [{ label: '目标一', source: { noteIds: ['n1'] } }],
          '定义 > 类型': [{ label: '类型表', source: { noteIds: ['n2'] } }],
        },
      }),
      CRITIQUE_PASS,
    ]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: docSections }, DEFAULT_GENERATION, { chat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes[0].headingPath).toBe('学习目标');
    const archUser = (calls[2].messages as Array<{ role: string; content: string }>)[1].content;
    expect(archUser).toContain('(学习目标)');
    expect(archUser).toContain('Section skeleton');
    expect(archUser).toContain('- 定义 > 类型');
    // 装配:根 = 主题,骨架章节为结构,叶子挂最深层章节之下
    expect(result.tree.label).toBe('T');
    const goalBranch = result.tree.children?.find((c: any) => c.label === '学习目标');
    expect(goalBranch?.children?.map((c: any) => c.label)).toEqual(['目标一']);
    const defBranch = result.tree.children?.find((c: any) => c.label === '定义');
    const typeBranch = defBranch?.children?.find((c: any) => c.label === '类型');
    expect(typeBranch?.children?.map((c: any) => c.label)).toEqual(['类型表']);
    // critique 也拿到骨架
    const critUser = (calls[3].messages as Array<{ role: string; content: string }>)[1].content;
    expect(critUser).toContain('Section skeleton');
  });

  it('floors depth and maxNodes so skeleton sections get leaves', async () => {
    const { chat, calls } = sequenceChat([
      DISTILL_C1,
      DISTILL_C2,
      // AI 推荐过浅(depth 2)且节点数过少 → 下限应抬到 maxDepth+1=3、章节+要点+根=6
      JSON.stringify({ depth: 2, maxChildren: 4, maxNodes: 6, reason: 'too shallow' }),
      JSON.stringify({
        leaves: {
          '学习目标': [{ label: '目标一', source: { noteIds: ['n1'] } }],
          '定义 > 类型': [{ label: '类型表', source: { noteIds: ['n2'] } }],
        },
      }),
      CRITIQUE_PASS,
    ]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: docSections }, DEFAULT_GENERATION, {
      chat,
      autoConstraints: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // depth 下限 = 骨架最深段(2) + 2 层(要点挂最深章节之下) = 4;
    // maxNodes 无下限:装配按预算截叶子,不再依赖 parse 截断
    expect(result.stats.autotune).toMatchObject({ depth: 4, maxNodes: 6 });
    const archUser = (calls[3].messages as Array<{ role: string; content: string }>)[1].content;
    expect(archUser).toContain('Leaf budget per deepest section');
    expect(archUser).toContain('- 学习目标: at most');
  });
});

describe('generateMindmapFromSource (injected fake chat)', () => {
  it('runs distill→architect→critique and keeps source noteIds', async () => {
    const { chat, calls } = sequenceChat([
      DISTILL_1,
      DISTILL_2,
      JSON.stringify({
        label: 'Root',
        source: { noteIds: [] },
        children: [
          { label: 'A', source: { noteIds: ['n1'] } },
          { label: 'B', source: { noteIds: ['n2', 'n3'] } },
        ],
      }),
      CRITIQUE_PASS,
    ]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, { chat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunks: 2, chunkFailures: 0, notes: 3, revisions: 0, dropped: 0 });
    expect(result.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(result.tree.children?.[1].source?.noteIds).toEqual(['n2', 'n3']);
    expect(result.critique?.verdict).toBe('pass');
    // 4 次调用：2 distill + architect + critique
    expect(calls.length).toBe(4);
    // 阶段标记进 system prompt
    const sys0 = (calls[0].messages as Array<{ role: string; content: string }>)[0].content;
    expect(sys0).toContain('[MM-STAGE:distill]');
    // 阶段温度：distill 0.5、critique 0
    expect((calls[0].opts as { temperature?: number }).temperature).toBe(0.5);
    expect((calls[3].opts as { temperature?: number }).temperature).toBe(0);
  });

  it('revises the tree once when critique verdicts revise', async () => {
    const firstTree = JSON.stringify({ label: 'Root', children: [{ label: 'Thin', source: { noteIds: ['n1'] } }] });
    const revisedTree = JSON.stringify({
      label: 'Root',
      children: [
        { label: 'Richer', source: { noteIds: ['n1', 'n2'] } },
        { label: 'Extra', source: { noteIds: ['n3'] } },
      ],
    });
    const { chat } = sequenceChat([DISTILL_1, DISTILL_2, firstTree, CRITIQUE_REVISE, revisedTree, CRITIQUE_PASS]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, { chat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.revisions).toBe(1);
    expect(result.tree.children?.length).toBe(2);
  });

  it('stops with kind cancelled between stages', async () => {
    let callsMade = 0;
    const chat: ChatFn = vi.fn(async () => {
      callsMade++;
      return { ok: true, content: DISTILL_1, model: 'm' } as ChatResult;
    }) as unknown as ChatFn;
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, {
      chat,
      isCancelled: () => callsMade >= 1,
    });
    expect(result).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(callsMade).toBe(1);
  });

  it('returns http failure when every chunk fails', async () => {
    const chat: ChatFn = vi.fn(async () => ({
      ok: false as const,
      kind: 'http' as const,
      status: 500,
      detail: 'boom',
    })) as unknown as ChatFn;
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, { chat });
    expect(result).toMatchObject({ ok: false, kind: 'http', status: 500 });
  });

  it('returns no-notes when chunks yield nothing', async () => {
    const { chat } = sequenceChat([JSON.stringify({ notes: [] }), JSON.stringify({ notes: [] })]);
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, { chat });
    expect(result).toMatchObject({ ok: false, kind: 'no-notes' });
  });

  it('skips a failing chunk and continues with the rest', async () => {
    let n = 0;
    const chat: ChatFn = vi.fn(async (_s, _k, messages) => {
      n++;
      const sys = (messages as Array<{ role: string; content: string }>)[0].content;
      if (sys.includes('[MM-STAGE:distill]')) {
        if (n === 1) return { ok: false as const, kind: 'timeout' as const, detail: '' };
        return { ok: true as const, content: DISTILL_2, model: 'm' };
      }
      if (sys.includes('[MM-STAGE:architect]')) {
        return { ok: true as const, content: JSON.stringify({ label: 'R', children: [{ label: 'C', source: { noteIds: ['n3'] } }] }), model: 'm' };
      }
      return { ok: true as const, content: CRITIQUE_PASS, model: 'm' };
    }) as unknown as ChatFn;
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc: doc2Chunks }, DEFAULT_GENERATION, { chat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.chunkFailures).toBe(1);
    expect(result.stats.notes).toBe(1);
  });
});

describe('parseCritiqueReport', () => {
  it('parses scores and clamps', () => {
    const r = parseCritiqueReport('```json\n{"scores":{"grounding":120,"coverage":-5,"specificity":70.4,"structure":80},"verdict":"revise","feedback":"f"}\n```');
    expect(r).toEqual({
      scores: { grounding: 100, coverage: 0, specificity: 70, structure: 80 },
      overall: 63,
      verdict: 'revise',
      feedback: 'f',
    });
  });

  it('returns null on malformed payloads', () => {
    expect(parseCritiqueReport('no json')).toBeNull();
    expect(parseCritiqueReport('{"scores":{},"verdict":"whatever"}')).toBeNull();
  });
});

describe('schema source passthrough', () => {
  it('keeps clean noteIds and drops malformed ones', () => {
    const good = parseMindmapTree('{"label":"R","source":{"noteIds":["n1","n1","n2"]} }', DEFAULT_GENERATION);
    expect(good.ok && good.tree.source?.noteIds).toEqual(['n1', 'n2']);
    const bad = parseMindmapTree('{"label":"R","source":{"noteIds":[1,null]}}', DEFAULT_GENERATION);
    expect(bad.ok && bad.tree.source).toBeUndefined();
  });
});

describe('generateMindmapFromSource (local http mock, stage markers)', () => {
  let server: Server;
  let baseUrl: string;

  const RESPOND_BY_STAGE = (
    res: ServerResponse,
    body: { messages?: Array<{ role: string; content: string }> }
  ): void => {
    const sys = (body.messages || []).find((m) => m.role === 'system');
    const m = typeof sys?.content === 'string' ? sys.content.match(/\[MM-STAGE:(\w+)\]/) : null;
    const stage = m != null ? m[1] : null;
    const content =
      stage === 'distill'
        ? JSON.stringify({ notes: [{ id: 'n1', content: 'Only point', quote: 'q' }] })
        : stage === 'architect'
          ? JSON.stringify({ label: 'Root', children: [{ label: 'Only', source: { noteIds: ['n1'] } }] })
          : stage === 'critique'
            ? CRITIQUE_PASS
            : JSON.stringify({ label: 'x' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      })
    );
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        RESPOND_BY_STAGE(res, raw !== '' ? JSON.parse(raw) : {});
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('end-to-end over HTTP with per-stage routing', async () => {
    const settings = { ...SETTINGS, baseUrl };
    const result = await generateMindmapFromSource(
      settings,
      API_KEY,
      { topic: 'T', doc: { title: 'D', chunks: [{ id: 'c1', text: 'text' }] } },
      DEFAULT_GENERATION,
      { critiqueEnabled: true }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunks: 1, notes: 1, revisions: 0 });
    expect(result.tree.children?.[0].label).toBe('Only');
  });
});

describe('detail mode (all notes as leaves + quotes as parts)', () => {
  it('skips architect and shows every note with its quote as a child node', async () => {
    const doc: SourceDoc = {
      title: 'D',
      chunks: [{ id: 'c1', headingPath: '学习目标', text: 'text' }],
    };
    const distillResp = JSON.stringify({
      notes: [
        { id: 'n1', content: '理解代理定义', quote: '代理是让LLM行动的系统' },
        { id: 'n2', content: '判断使用时机', quote: '' },
      ],
    });
    const chat = (async (_s: unknown, _k: unknown, messages: unknown[]) => {
      const sys = (messages as Array<{ role: string; content: string }>)[0].content;
      if (sys.includes('[MM-STAGE:architect]')) {
        throw new Error('detail mode 不应调用 architect');
      }
      return { ok: true as const, content: distillResp, model: 'm' } as ChatResult;
    }) as unknown as ChatFn;
    const result = await generateMindmapFromSource(SETTINGS, API_KEY, { topic: 'T', doc }, DEFAULT_GENERATION, {
      chat,
      detailMode: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 根 → 学习目标 → 两条要点,其中一条带引文子节点
    const goal = result.tree.children?.[0];
    expect(goal?.label).toBe('学习目标');
    expect(goal?.children?.map((c) => c.label)).toEqual(['理解代理定义', '判断使用时机']);
    const withQuote = goal?.children?.[0];
    expect(withQuote?.children?.[0].label).toBe('「代理是让LLM行动的系统」');
    // extras:notes < 6 不触发
    expect(result.extras).toBeUndefined();
  });
});
