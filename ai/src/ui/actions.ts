/**
 * action 注册。命名约定：ai 前缀 + mxResources key（Action.getTitle 会用
 * mxResources.get(key) 解析 label，资源文件与插件侧 EN_STRINGS 双保险）。
 */

import { showGenerateDialog, showSettingsDialog, showShapeGalleryDialog } from './dialogs';
import { showChartEditDialog } from './chart-edit';
import { ensureAgentPanel } from './agent-panel';
import { summarizeCurrentMap } from './summarize';
import { bindAgentCommands } from './agent-commands';
import { revealCellsProgressively } from './reveal';
import { buildMindmapFromTree } from '../mindmap/tree-model';
import { DEMO_TREE } from '../mindmap/fixture';

export function registerActions(ui: DrawioPluginApi): void {
  // Agent 面板:命令输入框 → 修改当前画布上的导图
  bindAgentCommands(ui, ensureAgentPanel(ui));

  // AI → 生成思维导图：主题 → DeepSeek → 上画布（M6）
  ui.actions.addAction('aiGenerate', function () {
    showGenerateDialog(ui);
  });

  // AI → Agent 面板：实时展示生成过程(要点原文/评审意见/图表进度)
  ui.actions.addAction('aiAgentPanel', function () {
    ensureAgentPanel(ui).toggle();
  });

  // AI → 总结与优化建议：对最近一次生成结果做单发评审(面板展示,只读)
  ui.actions.addAction('aiSummarize', function () {
    void summarizeCurrentMap(ui);
  });

  // AI → 设置：供应商配置 + 测试连接（M3）
  ui.actions.addAction('aiSettings', function () {
    showSettingsDialog(ui);
  });

  // AI → AI 修改当前图表:基于图表槽位记忆(生成过图表才可用)
  ui.actions.addAction('aiChartEdit', function () {
    showChartEditDialog(ui);
  });

  // AI → 部件示例图:AI 为全部形状部件生成实例
  ui.actions.addAction('aiShapeGallery', function () {
    showShapeGalleryDialog(ui);
  });

  // AI → 示例导图：固定 fixture 演示（M5 建树/布局/配色的验收载体）
  ui.actions.addAction('aiDemo', function () {
    const result = buildMindmapFromTree(ui, DEMO_TREE, { layout: 'radial', replaceExisting: true });
    revealCellsProgressively(ui.editor.graph, result.placedCells, 4500);
    console.info('[MindmapAI] demo mind map built:', result);
  });
}
