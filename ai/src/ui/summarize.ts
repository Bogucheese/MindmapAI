/**
 * AI → 总结与优化建议:对最近一次 AI 生成结果(面板上下文)做单发评审,
 * 结果以 assistant 卡片流入 Agent 面板。只读分析,不改画布。
 */

import { serializeTree, summarizeMap } from '../agent/summarize';
import { loadSettings } from '../settings/settings';
import { getApiKey } from '../settings/secure-store';
import { t } from '../i18n/keys';
import { ensureAgentPanel } from './agent-panel';

export async function summarizeCurrentMap(ui: DrawioPluginApi): Promise<void> {
  const panel = ensureAgentPanel(ui);
  panel.show();
  const ctx = panel.getContext();
  if (ctx == null) {
    panel.append({
      type: 'warn',
      text: t('aiAgentNoMap', 'No AI-generated map yet — generate one first. Agent commands edit the last AI-built result.'),
    });
    return;
  }
  const apiKey = await getApiKey();
  if (apiKey == null) {
    panel.append({ type: 'warn', text: t('aiNoKey', 'No API key configured.') });
    return;
  }
  panel.append({ type: 'stage', stage: 'summarize', label: t('aiStageSummarize', 'Summarizing the map...') });
  const content =
    ctx.kind === 'chart'
      ? `图表类型: ${ctx.type}\n槽位 JSON:\n${JSON.stringify(ctx.slots).slice(0, 5000)}`
      : serializeTree(ctx.tree);
  const res = await summarizeMap(loadSettings(), apiKey, content);
  if (!res.ok) {
    panel.append({ type: 'warn', text: `${t('aiAgentFailed', 'Agent run failed')}: ${res.detail}` });
    return;
  }
  panel.append({ type: 'assistant', text: res.text });
}
