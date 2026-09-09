/**
 * 「AI 修改此图」流程:右键空白画布(存在图表槽位记忆时)→ 输入修改指令 →
 * editChart 基于当前槽位增量修改 → 校验 → 单事务替换重绘。
 */

import { editChart } from '../charts/pipeline';
import { buildChartElements } from '../charts/assemble';
import type { ChartDirection } from '../charts/layout';
import { readChartSlots } from '../mindmap/tree-model';
import { t } from '../i18n/keys';
import { loadSettings } from '../settings/settings';
import { getApiKey } from '../settings/secure-store';

export function showChartEditDialog(ui: DrawioPluginApi): void {
  const memory = readChartSlots(ui.editor.graph);
  if (memory == null || typeof memory.type !== 'string') return;

  const container = document.createElement('div');
  const table = document.createElement('div');
  table.style.width = '100%';
  table.style.display = 'grid';
  table.style.gap = '5px 8px';
  table.style.boxSizing = 'border-box';
  table.style.padding = '3px';
  container.appendChild(table);

  const instructionArea = document.createElement('textarea');
  instructionArea.setAttribute('rows', '4');
  instructionArea.style.width = '100%';
  instructionArea.style.boxSizing = 'border-box';
  instructionArea.style.resize = 'vertical';
  instructionArea.setAttribute('placeholder', t('aiChartEditPlaceholder', 'e.g. 把开始节点改为手动输入;增加一个审批环节;去掉 XX 分支…'));
  table.appendChild(instructionArea);

  const statusRow = document.createElement('div');
  statusRow.style.fontSize = '10pt';
  statusRow.style.minHeight = '16px';
  const setStatus = (text: string, color?: string): void => {
    statusRow.textContent = text;
    statusRow.style.color = color != null ? color : '';
  };
  table.appendChild(statusRow);

  const rawRow = document.createElement('div');
  rawRow.style.display = 'none';
  rawRow.style.maxHeight = '110px';
  rawRow.style.overflow = 'auto';
  rawRow.style.whiteSpace = 'pre-wrap';
  rawRow.style.wordBreak = 'break-all';
  rawRow.style.background = '#f5f5f5';
  rawRow.style.border = '1px solid #dddddd';
  rawRow.style.padding = '4px';
  rawRow.style.fontSize = '9pt';
  table.appendChild(rawRow);

  const applyBtn = mxUtils.button(t('aiChartEditApply', 'Apply'), function () {
    const instruction = instructionArea.value.trim();
    if (instruction === '') {
      setStatus(t('aiChartEditRequired', 'Please describe the change you want.'), '#cc0000');
      return;
    }
    applyBtn.setAttribute('disabled', 'disabled');
    setStatus(t('aiChartEditing', 'Editing the chart...'));
    rawRow.style.display = 'none';
    getApiKey().then((apiKey) => {
      if (apiKey == null) {
        applyBtn.removeAttribute('disabled');
        setStatus(t('aiNoKey', 'No API key configured.'), '#cc0000');
        return;
      }
      editChart(loadSettings(), apiKey, memory.type as never, memory.slots as never, instruction, (memory.direction as ChartDirection) ?? 'vertical')
        .then((result) => {
          applyBtn.removeAttribute('disabled');
          if (!result.ok || result.elements == null || result.slots == null) {
            setStatus(`${t('aiChartEditFailed', 'Failed to edit the chart')}: ${result.detail ?? ''}`, '#cc0000');
            if (result.raw != null && result.raw !== '') {
              rawRow.textContent = result.raw.slice(0, 2000);
              rawRow.style.display = 'block';
            }
            return;
          }
          try {
            buildChartElements(ui, result.elements, { replaceExisting: true });
            (ui.editor.graph as any).__mmChartSlots = { type: memory.type, slots: result.slots, direction: memory.direction };
            console.info('[MindmapAI] chart edited:', memory.type);
            ui.hideDialog();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus(`${t('aiChartEditFailed', 'Failed to edit the chart')}: ${message}`, '#cc0000');
          }
        })
        .catch((err: unknown) => {
          applyBtn.removeAttribute('disabled');
          setStatus(String(err), '#cc0000');
        });
    });
  });
  applyBtn.className = 'geBtn gePrimaryBtn';

  const cancelBtn = mxUtils.button(mxResources.get('cancel'), function () {
    ui.hideDialog();
  });
  cancelBtn.className = 'geBtn';

  const buttonRow = document.createElement('div');
  buttonRow.style.paddingTop = '12px';
  buttonRow.style.whiteSpace = 'nowrap';
  buttonRow.style.display = 'inline-flex';
  buttonRow.style.justifyContent = 'flex-end';
  buttonRow.style.gap = '4px';
  if (ui.editor != null && ui.editor.cancelFirst) {
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(applyBtn);
  } else {
    buttonRow.appendChild(applyBtn);
    buttonRow.appendChild(cancelBtn);
  }
  table.appendChild(buttonRow);

  ui.showDialog(container, 420, null, true, true);
  instructionArea.focus();
}
