/**
 * Agent 命令绑定:把面板输入框接到 runAgentCommand——
 * 用户指令 → 工具修改上下文树 → 重建画布(逐个放置动画)。
 */

import { runAgentCommand } from '../agent/agent-command';
import { buildMindmapFromTree } from '../mindmap/tree-model';
import { loadSettings } from '../settings/settings';
import { getApiKey } from '../settings/secure-store';
import { t } from '../i18n/keys';
import { revealCellsProgressively } from './reveal';
import type { AgentPanelHandle } from './agent-panel';

export function bindAgentCommands(ui: DrawioPluginApi, panel: AgentPanelHandle): void {
  panel.onCommand = async (text: string): Promise<void> => {
    const ctx = panel.getContext();
    if (ctx == null) {
      panel.append({
        type: 'warn',
        text: t('aiAgentNoMap', 'No AI-generated map yet — generate one first. Agent commands edit the last AI-built map.'),
      });
      return;
    }
    const settings = loadSettings();
    const apiKey = await getApiKey();
    if (apiKey == null) {
      panel.append({ type: 'warn', text: t('aiNoKey', 'No API key configured.') });
      return;
    }
    const result = await runAgentCommand(settings, apiKey, { instruction: text, tree: ctx.tree, notes: ctx.notes }, {
      onEvent: (e) => panel.append(e),
    });
    if (!result.ok) {
      panel.append({ type: 'warn', text: `${t('aiAgentFailed', 'Agent run failed')}: ${result.detail}` });
      return;
    }
    panel.append({ type: 'assistant', text: result.reply !== '' ? result.reply : t('aiAgentChangesDone', 'Changes applied.') });
    panel.setContext({ ...ctx, tree: result.tree });
    const built = buildMindmapFromTree(ui, result.tree, {
      notes: ctx.notes,
      layout: ctx.layout,
      replaceExisting: true,
    });
    revealCellsProgressively(ui.editor.graph, built.placedCells, 2500);
  };
}
