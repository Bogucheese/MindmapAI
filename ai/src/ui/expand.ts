/**
 * 节点扩展的用户流程：右键导图节点 →「扩展节点」→ 收集路径/兄弟/已有
 * 子节点上下文 → LLM 生成新子节点 → 单事务插入并整图重排。
 * 来源模式生成的导图会带上要点集（graph.__mmNotesRegistry）参与 grounding。
 */

import { expandNodeChildren } from '../agent/expand';
import type { DistilledNote } from '../agent/types';
import { t } from '../i18n/keys';
import { loadGenerationPrefs, loadSettings } from '../settings/settings';
import { getApiKey } from '../settings/secure-store';
import { findMindmapParent, insertChildren, cellLabelText } from '../mindmap/tree-model';

export function expandNodeFlow(ui: DrawioPluginApi, cell: any): void {
  const graph = ui.editor.graph;
  const model = graph.getModel();

  // 路径（根 > … > 目标节点）；值可能是 Object 节点（含引文属性），经 cellLabelText 取显示文本
  const pathLabels: string[] = [];
  let cur = cell;
  for (let i = 0; i < 100 && cur != null; i++) {
    pathLabels.unshift(cellLabelText(cur));
    cur = findMindmapParent(graph, cur);
  }
  if (pathLabels.length === 0) return;

  const parentCell = findMindmapParent(graph, cell);
  const siblings =
    parentCell != null
      ? (model.getChildVertices(parentCell) ?? [])
          .filter((c: any) => c.getId() !== cell.getId())
          .map((c: any) => cellLabelText(c))
      : [];
  const existingChildren = (model.getChildVertices(cell) ?? []).map((c: any) => cellLabelText(c));

  const registry = graph.__mmNotesRegistry instanceof Map ? (graph.__mmNotesRegistry as Map<string, DistilledNote>) : null;
  const notes = registry != null && registry.size > 0 ? Array.from(registry.values()) : undefined;

  getApiKey().then((apiKey) => {
    if (apiKey == null) {
      mxUtils.alert(t('aiNoKey', 'No API key configured.'));
      return;
    }
    if (!ui.spinner.spin(ui.container, t('aiExpanding', 'Expanding node...'))) {
      return;
    }
    const settings = loadSettings();
    const prefs = loadGenerationPrefs();
    expandNodeChildren(
      settings,
      apiKey,
      { pathLabels, siblings, existingChildren, notes },
      { depth: prefs.depth, maxChildren: prefs.maxChildren, maxNodes: prefs.maxNodes, language: prefs.language }
    )
      .then((result) => {
        ui.spinner.stop();
        if (!result.ok) {
          if (result.kind === 'cancelled') return;
          if (result.kind === 'http') {
            const detail = result.detail !== '' ? `: ${result.detail}` : ` (${result.status ?? '?'})`;
            mxUtils.alert(`${t('aiExpandFailed', 'Failed to expand the node')}${detail}`);
          } else if (result.kind === 'timeout') {
            mxUtils.alert(t('aiConnTimeout', 'Connection timed out'));
          } else {
            mxUtils.alert(`${t('aiExpandFailed', 'Failed to expand the node')}: ${result.kind}`);
          }
          return;
        }
        if (result.children.length === 0) {
          mxUtils.alert(t('aiExpandNoChildren', 'The AI returned no children.'));
          return;
        }
        const insert = insertChildren(ui, cell, result.children);
        console.info('[MindmapAI] node expanded:', insert);
      })
      .catch((err: unknown) => {
        ui.spinner.stop();
        mxUtils.alert(err instanceof Error ? err.message : String(err));
      });
  });
}
