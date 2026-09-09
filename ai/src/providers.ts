/**
 * AI 供应商预设:OpenAI 兼容端点的厂商目录(供设置对话框一键填充)。
 * 端点来源:cc-switch(https://github.com/farion1231/cc-switch,MIT)的
 * codingPlanProviders.ts / 各 ProviderPresets 与各厂商官方文档。
 * 全部为 /chat/completions 兼容;key 由用户自行填写。
 */

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek(深度求索)',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'volces-coding',
    name: '火山方舟 Coding Plan(豆包)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: ['doubao-seed-code', 'kimi-k2-250905'],
    note: '需订阅火山引擎 Coding Plan,使用其 API Key',
  },
  {
    id: 'volces',
    name: '火山方舟(豆包按量)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'kimi-coding',
    name: 'Kimi For Coding(月之暗面)',
    baseUrl: 'https://api.kimi.com/coding',
    models: ['kimi-k2-250905'],
    note: '需订阅 Kimi For Coding',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi(按量)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k'],
  },
  {
    id: 'qwen',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-coder-plus', 'qwen-max', 'qwen-plus'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M2', 'abab6.5s-chat'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter(聚合)',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
  },
  {
    id: 'ollama',
    name: 'Ollama(本地)',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.1', 'qwen2.5'],
    note: '本地运行,无需 API Key',
  },
];

export const CUSTOM_PROVIDER = 'custom';
