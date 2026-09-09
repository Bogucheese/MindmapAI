/**
 * 非敏感 AI 供应商偏好。独立于 drawio 的 mxSettings 存储（避免其
 * configVersion 整体重置机制牵连），localStorage key 自带版本号。
 */

export interface AiProviderSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  /** 网页抓取代理前缀(空 = 不使用代理) */
  fetchProxyPrefix: string;
}

export const SETTINGS_STORAGE_KEY = 'mindmapAI.settings.v1';
const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AiProviderSettings = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  temperature: 1.0,
  fetchProxyPrefix: 'https://r.jina.ai/',
};

/** 规范化单个字段：非法值回退默认，baseUrl 去尾部斜杠（拼接 /chat/completions 用） */
export function normalizeSettings(raw: Partial<AiProviderSettings>): AiProviderSettings {
  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== ''
      ? raw.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_SETTINGS.baseUrl;
  const model =
    typeof raw.model === 'string' && raw.model.trim() !== ''
      ? raw.model.trim()
      : DEFAULT_SETTINGS.model;
  const temperature =
    typeof raw.temperature === 'number' &&
    isFinite(raw.temperature) &&
    raw.temperature >= 0 &&
    raw.temperature <= 2
      ? raw.temperature
      : DEFAULT_SETTINGS.temperature;
  const fetchProxyPrefix =
    typeof raw.fetchProxyPrefix === 'string' ? raw.fetchProxyPrefix : DEFAULT_SETTINGS.fetchProxyPrefix;
  return { baseUrl, model, temperature, fetchProxyPrefix };
}

export function loadSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw == null) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as {
      version?: number;
      settings?: Partial<AiProviderSettings>;
    };
    if (parsed.version !== SETTINGS_VERSION || parsed.settings == null || typeof parsed.settings !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    return normalizeSettings(parsed.settings);
  } catch {
    // 坏 JSON / 存储不可用：回退默认值，不阻塞编辑器
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AiProviderSettings): void {
  const payload = { version: SETTINGS_VERSION, settings: normalizeSettings(settings) };
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

/** 生成对话框的选项（记住上次使用值；仅 UI 偏好，非敏感） */
export interface GenerationPrefs {
  /** 图表类型:mindmap = 现有导图;其余为思考图类型(charts/catalog) */
  /** 来源模式:全部要点逐条成叶 + 引文成引用子节点(详细)或 AI 合并(概览) */
  detailMode: boolean;
  /** 图表方向(tree/org/flow 支持) */
  chartDirection: 'vertical' | 'horizontal';
  chartType: string;
  /** 内容来源：仅主题（现状单发）| 粘贴文本 | 链接抓取 */
  sourceMode: 'topic' | 'paste' | 'link';
  /** 来源模式：AI 按要点推荐 depth/maxChildren/maxNodes（手动值兜底） */
  autoParams: boolean;
  depth: number;
  maxChildren: number;
  maxNodes: number;
  language: 'auto' | 'en' | 'zh';
  layout: 'radial' | 'tree' | 'tree-vertical';
  replace: boolean;
}

export const DEFAULT_GENERATION_PREFS: GenerationPrefs = {
  sourceMode: 'topic',
  chartType: 'mindmap',
  chartDirection: 'vertical',
  detailMode: true,
  autoParams: false,
  depth: 3,
  maxChildren: 5,
  maxNodes: 60,
  language: 'auto',
  layout: 'radial',
  replace: true,
};

const PROVIDER_PREFS_KEY = 'mindmapAI.providerPrefs.v1';

/** 上次使用的厂商预设(仅记忆名称,配置本体仍存 baseUrl/model) */
export function loadLastProvider(): string {
  try {
    return window.localStorage.getItem(PROVIDER_PREFS_KEY) ?? CUSTOM_PLACEHOLDER;
  } catch {
    return CUSTOM_PLACEHOLDER;
  }
}

export function saveLastProvider(id: string): void {
  try {
    window.localStorage.setItem(PROVIDER_PREFS_KEY, id);
  } catch {
    // 忽略存储失败
  }
}

const CUSTOM_PLACEHOLDER = 'custom';
const PREFS_STORAGE_KEY = 'mindmapAI.generation.v1';

export function loadGenerationPrefs(): GenerationPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_GENERATION_PREFS };
    const p = JSON.parse(raw) as Partial<GenerationPrefs>;
    const clampInt = (v: unknown, min: number, max: number, d: number): number =>
      typeof v === 'number' && isFinite(v) && Number.isInteger(v) && v >= min && v <= max ? v : d;
    return {
      sourceMode: p.sourceMode === 'paste' || p.sourceMode === 'link' ? p.sourceMode : 'topic',
      chartType: typeof p.chartType === 'string' && p.chartType !== '' ? p.chartType : 'mindmap',
      chartDirection: p.chartDirection === 'horizontal' ? 'horizontal' : 'vertical',
      detailMode: typeof p.detailMode === 'boolean' ? p.detailMode : true,
      autoParams: typeof p.autoParams === 'boolean' ? p.autoParams : DEFAULT_GENERATION_PREFS.autoParams,
      depth: clampInt(p.depth, 1, 6, DEFAULT_GENERATION_PREFS.depth),
      maxChildren: clampInt(p.maxChildren, 1, 10, DEFAULT_GENERATION_PREFS.maxChildren),
      maxNodes: clampInt(p.maxNodes, 5, 200, DEFAULT_GENERATION_PREFS.maxNodes),
      language: p.language === 'en' || p.language === 'zh' || p.language === 'auto' ? p.language : 'auto',
      layout: p.layout === 'tree' || p.layout === 'tree-vertical' ? p.layout : 'radial',
      replace: typeof p.replace === 'boolean' ? p.replace : true,
    };
  } catch {
    return { ...DEFAULT_GENERATION_PREFS };
  }
}

export function saveGenerationPrefs(prefs: GenerationPrefs): void {
  window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}
