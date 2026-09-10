/**
 * OpenAI 兼容 chat/completions 客户端。
 * - chatRequest：共享的单次请求（超时、HTTP/网络/超时错误分类）；
 * - testConnection：设置对话框的"测试连接"（max_tokens=1 最小请求）；
 * - generateMindmapTree：导图生成（response_format json_object，供应商
 *   不支持时去字段重试；schema 校验失败后带原文重答一次，仍失败则把
 *   原始响应返回给界面层展示）。
 */

import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, type GenerationConstraints } from './prompts';
import { parseMindmapTree, type MindmapTree, type ParseMindmapResult } from './schema';
import type { AiProviderSettings } from '../settings/settings';

const TEST_TIMEOUT_MS = 15000;
const GENERATE_TIMEOUT_MS = 60000;

function chatCompletionsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

/** Electron 下走主进程 IPC（渲染层 CSP connect-src 'self' 禁外联） */
function hasElectronBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { electron?: { request?: unknown } };
  return typeof w.electron?.request === 'function';
}

type TransportResult =
  | { ok: true; status: number; body: string }
  | { ok: false; kind: 'network' | 'timeout'; detail: string };

interface TransportRequestOptions {
  url: string;
  /** 缺省 POST（AI API）；来源抓取用 GET */
  method?: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/**
 * 统一 HTTP 请求：Electron 走 mmAiFetch（主进程 fetch，超时在主进程侧执行）；
 * 浏览器直接 fetch（AbortController 超时）。任何 HTTP 响应（含 4xx/5xx）
 * 都返回 ok:true 由调用方按 status 分类。
 */
async function transportRequest(opts: TransportRequestOptions): Promise<TransportResult> {
  const method = opts.method ?? 'POST';
  if (hasElectronBridge()) {
    return new Promise<TransportResult>((resolve) => {
      (window as unknown as {
        electron: {
          request(msg: Record<string, unknown>, cb: (data: any) => void, err: (msg: string, e?: unknown) => void): void;
        };
      }).electron.request(
        { action: 'mmAiFetch', url: opts.url, method, headers: opts.headers, body: opts.body, timeoutMs: opts.timeoutMs },
        (data: { ok?: boolean; status?: number; body?: string; timeout?: boolean; detail?: string }) => {
          if (data != null && data.ok) {
            resolve({ ok: true, status: data.status ?? 0, body: data.body ?? '' });
          } else {
            resolve({ ok: false, kind: data != null && data.timeout ? 'timeout' : 'network', detail: data?.detail ?? '' });
          }
        },
        (errMsg) => resolve({ ok: false, kind: 'network', detail: errMsg != null ? String(errMsg) : 'IPC error' })
      );
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(opts.url, {
      method,
      headers: opts.headers,
      body: method === 'GET' ? undefined : opts.body,
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');
    return { ok: true, status: response.status, body };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, kind: 'timeout', detail: '' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: 'network', detail: message };
  } finally {
    clearTimeout(timer);
  }
}

/** 来源抓取工具用的 GET（无鉴权头） */
export function transportGet(url: string, timeoutMs: number): Promise<TransportResult> {
  return transportRequest({ url, method: 'GET', headers: {}, timeoutMs });
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatFailureKind = 'http' | 'network' | 'timeout';

export type ChatResult =
  | { ok: true; content: string; model: string }
  | { ok: false; kind: ChatFailureKind; status?: number; detail: string };

interface ChatRequestOptions {
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
  /** 请求 response_format: json_object（部分兼容供应商会 400，调用方自行回退） */
  jsonMode?: boolean;
  /** 阶段级覆盖（critique 用 0 等）；缺省用设置里的温度 */
  temperature?: number;
}

async function chatRequest(
  settings: AiProviderSettings,
  apiKey: string,
  opts: ChatRequestOptions
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: opts.messages,
    temperature: opts.temperature ?? settings.temperature,
    max_tokens: opts.maxTokens,
    stream: false,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  const transport = await transportRequest({
    url: chatCompletionsUrl(settings.baseUrl),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    timeoutMs: opts.timeoutMs,
  });
  if (!transport.ok) {
    return { ok: false, kind: transport.kind, detail: transport.detail };
  }
  if (transport.status >= 400) {
    return {
      ok: false,
      kind: 'http',
      status: transport.status,
      detail: transport.body.slice(0, 300),
    };
  }
  const data = JSON.parse(transport.body) as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return {
      ok: false,
      kind: 'http',
      status: transport.status,
      detail: 'Malformed response: missing choices[0].message.content',
    };
  }
  const model = typeof data?.model === 'string' ? data.model : settings.model;
  return { ok: true, content, model };
}

export interface TestConnectionResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  kind?: ChatFailureKind;
  status?: number;
  detail: string;
}

/**
 * 发一条 max_tokens=1 的最小请求验证 baseUrl + key + model 三者同时有效；
 * 比探测 /models 更真实（模型名写错只有 chat/completions 能暴露）。
 */
export async function testConnection(
  settings: AiProviderSettings,
  apiKey: string
): Promise<TestConnectionResult> {
  const started = Date.now();
  const result = await chatRequest(settings, apiKey, {
    messages: [{ role: 'user', content: 'Hi' }],
    maxTokens: 1,
    timeoutMs: TEST_TIMEOUT_MS,
  });
  if (result.ok) {
    return { ok: true, model: result.model, latencyMs: Date.now() - started, detail: '' };
  }
  return { ok: false, kind: result.kind, status: result.status, detail: result.detail };
}

export type GenerateMindmapResult =
  | { ok: true; tree: MindmapTree; stats: { nodes: number; dropped: number } }
  | { ok: false; kind: ChatFailureKind | 'schema'; status?: number; detail: string; raw: string };

/**
 * 带 json_object 回退的生成请求：供应商对 response_format 返回 400 时，
 * 去掉该字段重试一次（提示词本身已含 JSON schema 约束）。
 * pipeline 的各阶段共用（temperature 透传到每次请求）。
 */
export interface ChatJsonOptions {
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}

/* ==================== Agent 模式:OpenAI 兼容 tool calling ==================== */

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** 原始 JSON 字符串(解析失败由执行方兜底) */
  arguments: string;
}

/** Agent 循环的消息:普通消息之外还有带 tool_calls 的 assistant 与 tool 结果 */
export type ToolLoopMessage =
  | ChatMessage
  | { role: 'assistant'; content: string | null; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatToolsResult =
  | { ok: true; content: string; toolCalls: ToolCallRequest[]; model: string }
  | { ok: false; kind: ChatFailureKind; status?: number; detail: string };

export async function chatWithTools(
  settings: AiProviderSettings,
  apiKey: string,
  messages: ToolLoopMessage[],
  tools: ToolSpec[],
  opts: ChatJsonOptions
): Promise<ChatToolsResult> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: opts.temperature ?? settings.temperature,
    max_tokens: opts.maxTokens,
    stream: false,
    tools,
    tool_choice: 'auto',
  };
  const transport = await transportRequest({
    url: chatCompletionsUrl(settings.baseUrl),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    timeoutMs: opts.timeoutMs,
  });
  if (!transport.ok) {
    return { ok: false, kind: transport.kind, detail: transport.detail };
  }
  if (transport.status >= 400) {
    return { ok: false, kind: 'http', status: transport.status, detail: transport.body.slice(0, 300) };
  }
  let data: {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
  } | null = null;
  try {
    data = JSON.parse(transport.body) as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
    } | null;
  } catch {
    return { ok: false, kind: 'http', status: transport.status, detail: 'Malformed response: body is not JSON' };
  }
  const message = data?.choices?.[0]?.message;
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCallRequest[] = [];
  for (const raw of rawCalls) {
    const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof call.function?.name === 'string' ? call.function.name : '';
    if (call.id == null || name === '') continue;
    toolCalls.push({
      id: String(call.id),
      name,
      arguments: typeof call.function?.arguments === 'string' ? call.function.arguments : '{}',
    });
  }
  const content = typeof message?.content === 'string' ? message.content : '';
  const model = typeof data?.model === 'string' ? data.model : settings.model;
  return { ok: true, content, toolCalls, model };
}

export async function chatWithJsonFallback(
  settings: AiProviderSettings,
  apiKey: string,
  messages: ChatMessage[],
  opts: ChatJsonOptions
): Promise<ChatResult> {
  const withJson = await chatRequest(settings, apiKey, {
    messages,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    jsonMode: true,
    temperature: opts.temperature,
  });
  if (
    !withJson.ok &&
    withJson.kind === 'http' &&
    withJson.status === 400 &&
    /response_format/i.test(withJson.detail)
  ) {
    return chatRequest(settings, apiKey, {
      messages,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      temperature: opts.temperature,
    });
  }
  return withJson;
}

export async function generateMindmapTree(
  settings: AiProviderSettings,
  apiKey: string,
  topic: string,
  constraints: GenerationConstraints,
  timeoutMs: number = GENERATE_TIMEOUT_MS
): Promise<GenerateMindmapResult> {
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(constraints) },
    { role: 'user', content: buildUserPrompt(topic) },
  ];
  // 60 节点 × ~40 token ≈ 2.4k，4k 上限留足余量
  const maxTokens = 4096;

  const first = await chatWithJsonFallback(settings, apiKey, baseMessages, {
    maxTokens,
    timeoutMs,
  });
  if (!first.ok) {
    return { ok: false, kind: first.kind, status: first.status, detail: first.detail, raw: '' };
  }

  const firstParse = parseMindmapTree(first.content, constraints);
  if (firstParse.ok) {
    return { ok: true, tree: firstParse.tree, stats: firstParse.stats };
  }

  // 一次"重答"修复：把失败原文作为 assistant 消息回传，要求只回 JSON
  const repairMessages: ChatMessage[] = [
    ...baseMessages,
    { role: 'assistant', content: first.content.slice(0, 2000) },
    { role: 'user', content: buildRepairPrompt() },
  ];
  const second = await chatWithJsonFallback(settings, apiKey, repairMessages, {
    maxTokens,
    timeoutMs,
  });
  if (!second.ok) {
    return { ok: false, kind: second.kind, status: second.status, detail: second.detail, raw: first.content };
  }

  const secondParse: ParseMindmapResult = parseMindmapTree(second.content, constraints);
  if (secondParse.ok) {
    return { ok: true, tree: secondParse.tree, stats: secondParse.stats };
  }
  return {
    ok: false,
    kind: 'schema',
    detail: secondParse.reason,
    raw: first.content,
  };
}
