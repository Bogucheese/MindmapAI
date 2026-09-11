/**
 * Agent 命令绑定:面板输入框 → 按上下文路由——
 * - 导图:runAgentCommand 用工具修改上下文树 → 单事务重建 + 渐显;
 * - 思考图:editChart 槽位修正循环 → 重建图表。
 */

import { runAgentCommand } from '../agent/agent-command';
import { editChart } from '../charts/pipeline';
import { buildChartElements } from '../charts/assemble';
import type { ChartSlots } from '../charts/layout';
import type { ChartTypeId } from '../charts/catalog';
import { buildMindmapFromTree, attachChartSlots } from '../mindmap/tree-model';
import { ASPECT_RATIO, loadSettings } from '../settings/settings';
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
        text: t('aiAgentNoMap', 'No AI-generated map yet — generate one first. Agent commands edit the last AI-built result.'),
      });
      return;
    }
    const settings = loadSettings();
    const apiKey = await getApiKey();
    if (apiKey == null) {
      panel.append({ type: 'warn', text: t('aiNoKey', 'No API key configured.') });
      return;
    }

    if (ctx.kind === 'chart') {
      const result = await editChart(
        settings, apiKey,
        ctx.type as ChartTypeId,
        ctx.slots as ChartSlots,
        text, ctx.direction,
      );
      if (!result.ok || result.slots == null || result.elements == null) {
        panel.append({ type: 'warn', text: `${t('aiAgentFailed', 'Agent run failed')}: ${result.detail}` });
        return;
      }
      panel.append({ type: 'assistant', text: t('aiAgentChangesDone', 'Changes applied.') });
      panel.setContext({ kind: 'chart', type: ctx.type, slots: result.slots, direction: ctx.direction });
      const graph = ui.editor.graph;
      const built = buildChartElements(ui, result.elements, { replaceExisting: true });
      revealCellsProgressively(graph, built.placedCells, 2500);
      (graph as unknown as { __mmChartSlots: unknown }).__mmChartSlots = {
        type: ctx.type, slots: result.slots, direction: ctx.direction,
      };
      attachChartSlots(graph, JSON.stringify({ type: ctx.type, slots: result.slots, direction: ctx.direction }));
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
    panel.setContext({ kind: 'mindmap', tree: result.tree, notes: ctx.notes, layout: ctx.layout, aspect: ctx.aspect });
    const built = buildMindmapFromTree(ui, result.tree, {
      notes: ctx.notes,
      layout: ctx.layout,
      aspect: ASPECT_RATIO[ctx.aspect],
      replaceExisting: true,
    });
    revealCellsProgressively(ui.editor.graph, built.placedCells, 2500);
  };
}
