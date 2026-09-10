/**
 * 设置对话框（M3：AI 供应商配置 + 测试连接）。
 *
 * DOM 结构照抄 FilenameDialog（grapheditor/Editor.js:3396）：grid 容器
 * （gridAutoColumns 'auto 1fr'）+ 标签/输入各占一格 + 按钮行
 * gridColumn '1 / span 2'；Escape 关闭由 drawio 全局 keydown 处理，无需
 * 自监听；内容 div 不加 geDialog 类（Dialog 外壳自动包一层）。
 */

import { generateMindmapTree, testConnection } from '../ai/client';
import { generateMindmapFromSource } from '../agent/pipeline';
import { generateChart, generateChartGallery, generateShapeGallery } from '../charts/pipeline';
import { CHART_TYPES, CHART_TYPE_ORDER, type ChartTypeId } from '../charts/catalog';
import { buildChartElements, type BuildChartOptions } from '../charts/assemble';
import { attachChartSlots } from '../mindmap/tree-model';
import { buildSourceDocFromText, buildSourceDocFromUrl } from '../agent/tools';
import type { SourceDoc } from '../agent/types';
import { t } from '../i18n/keys';
import {
  DEFAULT_SETTINGS,
  loadGenerationPrefs,
  loadSettings,
  normalizeSettings,
  saveGenerationPrefs,
  saveSettings,
  type AiProviderSettings,
  type GenerationPrefs,
} from '../settings/settings';
import { clearApiKey, describeStorage, getApiKey, setApiKey } from '../settings/secure-store';
import { CUSTOM_PROVIDER, PROVIDER_PRESETS } from '../providers';
import { loadLastProvider, saveLastProvider } from '../settings/settings';
import { buildMindmapFromTree, type BuildMindmapOptions } from '../mindmap/tree-model';

const COLOR_OK = '#008a00';
const COLOR_ERROR = '#cc0000';
const COLOR_NOTICE = '#808080';

function makeLabelCell(text: string): HTMLDivElement {
  const cell = document.createElement('div');
  cell.style.display = 'inline-flex';
  cell.style.alignItems = 'center';
  cell.style.justifyContent = 'flex-end';
  cell.style.minWidth = '0';
  const wrapper = document.createElement('div');
  wrapper.style.display = 'inline-block';
  wrapper.style.textOverflow = 'ellipsis';
  wrapper.style.whiteSpace = 'nowrap';
  wrapper.style.overflow = 'hidden';
  wrapper.style.fontSize = '10pt';
  // Workaround for vertical clipping（同 FilenameDialog）
  wrapper.style.padding = '2px 0';
  wrapper.setAttribute('title', text);
  mxUtils.write(wrapper, text + ':');
  cell.appendChild(wrapper);
  return cell;
}

function makeInput(type: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.setAttribute('type', type);
  input.setAttribute('value', value);
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  return input;
}

/** 全宽行（提示/状态文字） */
function makeFullRow(fontSize: string): HTMLDivElement {
  const row = document.createElement('div');
  row.style.gridColumn = '1 / span 2';
  row.style.fontSize = fontSize;
  row.style.whiteSpace = 'normal';
  return row;
}

export function showSettingsDialog(ui: DrawioPluginApi): void {
  const current = loadSettings();

  const container = document.createElement('div');
  const table = document.createElement('div');
  table.style.width = '100%';
  table.style.display = 'grid';
  table.style.gap = '5px 8px';
  table.style.gridAutoColumns = 'auto 1fr';
  table.style.boxSizing = 'border-box';
  table.style.padding = '3px';
  container.appendChild(table);

  // 厂商预设:一键填充接口地址与模型(参考 cc-switch 的预设思路)
  const providerSelect = makeSelect(
    [
      { value: CUSTOM_PROVIDER, label: t('aiProviderCustom', 'Custom') },
      ...PROVIDER_PRESETS.map((pp) => ({ value: pp.id, label: pp.name })),
    ],
    loadLastProvider()
  );
  table.appendChild(makeLabelCell(t('aiProvider', 'Provider preset')));
  table.appendChild(providerSelect);

  // 抓取代理:网页版抓取非 CORS 站点用的公共/自建代理前缀
  const proxyInput = makeInput('text', current.fetchProxyPrefix);
  proxyInput.setAttribute('placeholder', t('aiProxyPlaceholder', 'https://r.jina.ai/ (leave empty to disable)'));
  table.appendChild(makeLabelCell(t('aiFetchProxy', 'Fetch proxy')));
  table.appendChild(proxyInput);
  const proxyHint = makeFullRow('9pt');
  proxyHint.style.color = COLOR_NOTICE;
  mxUtils.write(
    proxyHint,
    t('aiProxyHint', 'Used when a page blocks browser fetching. The URL is sent to the proxy service.')
  );
  table.appendChild(proxyHint);

  const baseUrlInput = makeInput('text', current.baseUrl);
  const apiKeyInput = makeInput('password', '');
  const modelInput = makeInput('text', current.model);
  const temperatureInput = makeInput('number', String(current.temperature));
  temperatureInput.setAttribute('min', '0');
  temperatureInput.setAttribute('max', '2');
  temperatureInput.setAttribute('step', '0.1');

  table.appendChild(makeLabelCell(t('aiBaseUrl', 'Base URL')));
  table.appendChild(baseUrlInput);
  table.appendChild(makeLabelCell(t('aiApiKey', 'API Key')));
  table.appendChild(apiKeyInput);
  table.appendChild(makeLabelCell(t('aiModel', 'Model')));
  table.appendChild(modelInput);
  table.appendChild(makeLabelCell(t('aiTemperature', 'Temperature')));
  table.appendChild(temperatureInput);

  // key 是异步读出的，先弹框再回填
  getApiKey().then((key) => {
    if (apiKeyInput.isConnected && key != null) {
      apiKeyInput.value = key;
    }
  });

  mxEvent.addListener(providerSelect, 'change', function () {
    const preset = PROVIDER_PRESETS.find((pp) => pp.id === providerSelect.value);
    if (preset == null) return;
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const setter = desc != null && desc.set != null ? desc.set : null;
    if (setter == null) return;
    setter.call(baseUrlInput, preset.baseUrl);
    baseUrlInput.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(modelInput, preset.models[0]);
    modelInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (preset.note != null) {
      setStatus(preset.note, COLOR_NOTICE);
    } else {
      setStatus('');
    }
  });

  const storageMode = describeStorage().mode;
  const noticeRow = makeFullRow('9pt');
  noticeRow.style.color = COLOR_NOTICE;
  noticeRow.textContent =
    storageMode === 'electron'
      ? t('aiStorageNoticeElectron', 'The API key will be stored with system-level encryption.')
      : t(
          'aiStorageNoticeBrowser',
          'The API key is stored in this browser (localStorage) without encryption. The desktop version will use encrypted storage.'
        );
  table.appendChild(noticeRow);

  const statusRow = makeFullRow('10pt');
  statusRow.style.minHeight = '16px';
  const setStatus = (text: string, color?: string): void => {
    statusRow.textContent = text;
    statusRow.style.color = color != null ? color : '';
  };
  table.appendChild(statusRow);

  /** 读入全部输入框并校验；非法时写状态行并返回 null */
  const readInputs = (): AiProviderSettings | null => {
    const tempRaw = temperatureInput.value.trim();
    const temperature = tempRaw === '' ? DEFAULT_SETTINGS.temperature : Number(tempRaw);
    if (!isFinite(temperature) || temperature < 0 || temperature > 2) {
      setStatus(t('aiTemperatureRange', 'Temperature must be a number between 0 and 2.'), COLOR_ERROR);
      return null;
    }
    return normalizeSettings({
      baseUrl: baseUrlInput.value,
      model: modelInput.value,
      temperature,
    });
  };

  const testBtn = mxUtils.button(t('aiTestConnection', 'Test Connection'), function () {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey === '') {
      setStatus(t('aiConnNoKey', 'Please enter an API key first.'), COLOR_ERROR);
      return;
    }
    const settings = readInputs();
    if (settings == null) return;
    setStatus(t('aiTestingConn', 'Testing connection...'));
    if (!ui.spinner.spin(container, t('aiTestingConn', 'Testing connection...'))) {
      return;
    }
    testConnection(settings, apiKey).then((result) => {
      ui.spinner.stop();
      if (result.ok) {
        setStatus(`${t('aiConnOk', 'Connection successful')} — ${result.model}, ${result.latencyMs}ms`, COLOR_OK);
      } else if (result.kind === 'http') {
        const detail = result.detail !== '' ? `: ${result.detail}` : ` (${result.status ?? '?'})`;
        setStatus(`${t('aiConnHttp', 'The API returned an error')}${detail}`, COLOR_ERROR);
      } else if (result.kind === 'timeout') {
        setStatus(t('aiConnTimeout', 'Connection timed out'), COLOR_ERROR);
      } else {
        setStatus(`${t('aiConnNetwork', 'Network error')}: ${result.detail}`, COLOR_ERROR);
      }
    });
  });
  testBtn.className = 'geBtn';

  const cancelBtn = mxUtils.button(mxResources.get('cancel'), function () {
    ui.hideDialog();
  });
  cancelBtn.className = 'geBtn';

  const saveBtn = mxUtils.button(t('aiSave', 'Save'), function () {
    const settings = readInputs();
    if (settings == null) return;
    saveSettings({ ...settings, fetchProxyPrefix: proxyInput.value.trim() });
    saveLastProvider(providerSelect.value);
    const apiKey = apiKeyInput.value.trim();
    (apiKey === '' ? clearApiKey() : setApiKey(apiKey))
      .then(() => {
        ui.hideDialog();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`${t('aiSaveFailed', 'Failed to save the API key')}: ${message}`, COLOR_ERROR);
      });
  });
  saveBtn.className = 'geBtn gePrimaryBtn';

  // Enter 在任意输入框提交保存（同 FilenameDialog 的输入框 Enter 行为）
  const inputs = [baseUrlInput, apiKeyInput, modelInput, temperatureInput];
  for (const input of inputs) {
    mxEvent.addListener(input, 'keypress', function (e: KeyboardEvent) {
      if (e.keyCode === 13) {
        saveBtn.click();
      }
    });
  }

  const buttonRow = document.createElement('div');
  buttonRow.style.gridColumn = '1 / span 2';
  buttonRow.style.paddingTop = '14px';
  buttonRow.style.whiteSpace = 'nowrap';
  buttonRow.style.display = 'inline-flex';
  buttonRow.style.alignItems = 'center';
  buttonRow.style.justifyContent = 'flex-end';
  buttonRow.style.gap = '4px';
  buttonRow.appendChild(testBtn);
  if (ui.editor != null && ui.editor.cancelFirst) {
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
  } else {
    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(cancelBtn);
  }
  table.appendChild(buttonRow);

  ui.showDialog(container, 360, null, true, true);
}

/** 下拉框（语言/布局选择用） */
function makeSelect(options: Array<{ value: string; label: string }>, selected: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.style.width = '100%';
  select.style.boxSizing = 'border-box';
  for (const opt of options) {
    const option = document.createElement('option');
    option.setAttribute('value', opt.value);
    mxUtils.write(option, opt.label);
    if (opt.value === selected) {
      option.setAttribute('selected', 'selected');
    }
    select.appendChild(option);
  }
  return select;
}

export function showGenerateDialog(ui: DrawioPluginApi): void {
  const prefs = loadGenerationPrefs();

  const container = document.createElement('div');
  const table = document.createElement('div');
  table.style.width = '100%';
  table.style.display = 'grid';
  table.style.gap = '5px 8px';
  table.style.gridAutoColumns = 'auto 1fr';
  table.style.boxSizing = 'border-box';
  table.style.padding = '3px';
  container.appendChild(table);

  // 图表类型:思维导图(现有) + 12 种思考图
  const chartSelect = makeSelect(
    [
      { value: 'mindmap', label: t('aiChartTypeMindmap', 'Mind map') },
      ...CHART_TYPE_ORDER.map((id) => ({ value: id as string, label: CHART_TYPES[id].name })),
      { value: 'gallery', label: t('aiChartTypeGallery', 'All charts (panorama canvas)') },
    ],
    prefs.chartType
  );
  table.appendChild(makeLabelCell(t('aiChartType', 'Chart type')));
  table.appendChild(chartSelect);
  const chartDescRow = makeFullRow('9pt');
  chartDescRow.style.color = COLOR_NOTICE;
  const updateChartDesc = (): void => {
    const id = chartSelect.value;
    chartDescRow.style.display = id === 'mindmap' ? 'none' : '';
    if (id === 'gallery') {
      mxUtils.write(chartDescRow, t('aiChartGalleryDesc', 'Generate all 12 thinking charts from the same source onto ONE canvas (one AI call per chart; charts that fail are skipped).'));
      return;
    }
    if (id !== 'mindmap' && CHART_TYPES[id as ChartTypeId] != null) {
      const m = CHART_TYPES[id as ChartTypeId];
      mxUtils.write(chartDescRow, `${m.definition} ${m.pros}`);
    }
  };
  const updateChartVisibility = (): void => {
    const isChart = chartSelect.value !== 'mindmap';
    const display = isChart ? 'none' : '';
    depthLabel.style.display = display;
    depthInput.style.display = display;
    childrenLabel.style.display = display;
    childrenInput.style.display = display;
    nodesLabel.style.display = display;
    nodesInput.style.display = display;
    layoutLabel.style.display = display;
    layoutSelect.style.display = display;
    autoRow.style.display = isChart ? 'none' : '';
    const dirVisible = isChart && DIRECTION_TYPES.indexOf(chartSelect.value) >= 0;
    directionLabel.style.display = dirVisible ? '' : 'none';
    directionSelect.style.display = dirVisible ? '' : 'none';
    // org 惯例横向:类型切换时重置默认方向
    if (isChart) {
      directionSelect.value = chartSelect.value === 'org' ? 'horizontal' : 'vertical';
    }
    updateChartDesc();
  };
  // 图类型切换必须重新计算行可见性(切回思维导图时恢复层级/分支/布局等行)
  mxEvent.addListener(chartSelect, 'change', updateChartVisibility);

  // 内容来源：仅主题（M6 现状单发）/ 粘贴文本 / 链接（P1 抓取）
  const sourceSelect = makeSelect(
    [
      { value: 'topic', label: t('aiSourceTopic', 'Topic only') },
      { value: 'paste', label: t('aiSourcePaste', 'Pasted text') },
      { value: 'link', label: t('aiSourceLink', 'Link') },
    ],
    prefs.sourceMode
  );
  table.appendChild(makeLabelCell(t('aiSourceMode', 'Source')));
  table.appendChild(sourceSelect);

  const topicLabel = makeLabelCell(t('aiTopic', 'Topic'));
  const topicInput = makeInput('text', '');
  topicInput.setAttribute('placeholder', t('aiTopicPlaceholder', 'e.g. Coffee supply chain'));
  table.appendChild(topicLabel);
  table.appendChild(topicInput);

  const titleLabel = makeLabelCell(t('aiSourceTitle', 'Title'));
  const titleInput = makeInput('text', '');
  titleInput.setAttribute('placeholder', t('aiSourceTitlePlaceholder', 'Auto-detected from the text'));
  table.appendChild(titleLabel);
  table.appendChild(titleInput);

  const textLabel = makeLabelCell(t('aiSourceText', 'Content'));
  const sourceTextArea = document.createElement('textarea');
  sourceTextArea.setAttribute('rows', '8');
  sourceTextArea.style.width = '100%';
  sourceTextArea.style.boxSizing = 'border-box';
  sourceTextArea.style.resize = 'vertical';
  sourceTextArea.setAttribute('placeholder', t('aiSourceTextPlaceholder', 'Paste an article, README or notes here…'));
  table.appendChild(textLabel);
  table.appendChild(sourceTextArea);

  const linkLabel = makeLabelCell(t('aiSourceLinkField', 'Page URL'));
  const linkInput = makeInput('text', '');
  linkInput.setAttribute('placeholder', t('aiSourceLinkPlaceholder', 'https://github.com/owner/repo or article page'));
  table.appendChild(linkLabel);
  table.appendChild(linkInput);

  const fetchHintRow = makeFullRow('9pt');
  fetchHintRow.style.color = COLOR_NOTICE;
  mxUtils.write(
    fetchHintRow,
    t('aiFetchHint', 'GitHub links are fetched directly; other sites may require the desktop version (browser CORS).')
  );
  table.appendChild(fetchHintRow);

  const tooltipHintRow = makeFullRow('9pt');
  tooltipHintRow.style.color = COLOR_NOTICE;
  mxUtils.write(tooltipHintRow, t('aiTooltipHint', 'After generating, hover any node to see the source quote.'));
  table.appendChild(tooltipHintRow);

  const updateSourceMode = (): void => {
    const mode = sourceSelect.value;
    const topicDisplay = mode === 'topic' ? '' : 'none';
    const pasteDisplay = mode === 'paste' ? '' : 'none';
    const linkDisplay = mode === 'link' ? '' : 'none';
    topicLabel.style.display = topicDisplay;
    topicInput.style.display = topicDisplay;
    titleLabel.style.display = pasteDisplay;
    titleInput.style.display = pasteDisplay;
    textLabel.style.display = pasteDisplay;
    sourceTextArea.style.display = pasteDisplay;
    tooltipHintRow.style.display = mode === 'topic' ? 'none' : '';
    linkLabel.style.display = linkDisplay;
    linkInput.style.display = linkDisplay;
    fetchHintRow.style.display = linkDisplay;
    // 自动参数只对来源模式生效
    autoInput.disabled = mode === 'topic';
    autoRow.style.opacity = mode === 'topic' ? '0.5' : '';
    updateChartVisibility();
  };
  mxEvent.addListener(sourceSelect, 'change', updateSourceMode);

  const depthLabel = makeLabelCell(t('aiDepth', 'Depth'));
  const depthInput = makeInput('number', String(prefs.depth));
  depthInput.setAttribute('min', '1');
  depthInput.setAttribute('max', '6');
  table.appendChild(depthLabel);
  table.appendChild(depthInput);

  const childrenLabel = makeLabelCell(t('aiMaxChildren', 'Branches per node'));
  const childrenInput = makeInput('number', String(prefs.maxChildren));
  childrenInput.setAttribute('min', '1');
  childrenInput.setAttribute('max', '10');
  table.appendChild(childrenLabel);
  table.appendChild(childrenInput);

  const nodesLabel = makeLabelCell(t('aiMaxNodes', 'Max nodes'));
  const nodesInput = makeInput('number', String(prefs.maxNodes));
  nodesInput.setAttribute('min', '5');
  nodesInput.setAttribute('max', '200');
  table.appendChild(nodesLabel);
  table.appendChild(nodesInput);

  // AI 自动参数：来源模式下按要点密度推荐 depth/分支/上限（手动值兜底）
  const autoRow = document.createElement('div');
  autoRow.style.gridColumn = '1 / span 2';
  autoRow.style.display = 'inline-flex';
  autoRow.style.alignItems = 'center';
  autoRow.style.gap = '6px';
  const autoInput = document.createElement('input');
  autoInput.setAttribute('type', 'checkbox');
  autoInput.checked = prefs.autoParams;
  const autoLabel = document.createElement('span');
  autoLabel.style.fontSize = '10pt';
  mxUtils.write(autoLabel, t('aiAutoParams', 'AI picks the best depth / branches / cap'));
  autoRow.appendChild(autoInput);
  autoRow.appendChild(autoLabel);
  table.appendChild(autoRow);
  const updateAutoDisabled = (): void => {
    const disabled = autoInput.checked ? 'disabled' : '';
    depthInput.setAttribute('disabled', disabled);
    childrenInput.setAttribute('disabled', disabled);
    nodesInput.setAttribute('disabled', disabled);
  };
  mxEvent.addListener(autoInput, 'change', updateAutoDisabled);
  updateAutoDisabled();

  const langSelect = makeSelect(
    [
      { value: 'auto', label: t('aiLangAuto', 'Auto (follow topic)') },
      { value: 'zh', label: '中文' },
      { value: 'en', label: 'English' },
    ],
    prefs.language
  );
  table.appendChild(makeLabelCell(t('aiOutputLang', 'Label language')));
  table.appendChild(langSelect);

  const layoutLabel = makeLabelCell(t('aiLayout', 'Layout'));
  const layoutSelect = makeSelect(
    [
      { value: 'radial', label: t('aiLayoutRadial', 'Radial') },
      { value: 'tree', label: t('aiLayoutTree', 'Tree (horizontal)') },
      { value: 'tree-vertical', label: t('aiLayoutTreeVertical', 'Tree (vertical)') },
    ],
    prefs.layout
  );
  table.appendChild(layoutLabel);
  table.appendChild(layoutSelect);

  // 图表方向(仅 tree/org/flow 支持;org 默认横向)
  const directionLabel = makeLabelCell(t('aiChartDirection', 'Direction'));
  const directionSelect = makeSelect(
    [
      { value: 'vertical', label: t('aiDirectionVertical', 'Vertical (top-down)') },
      { value: 'horizontal', label: t('aiDirectionHorizontal', 'Horizontal (left-right)') },
    ],
    prefs.chartDirection
  );
  table.appendChild(directionLabel);
  table.appendChild(directionSelect);
  const DIRECTION_TYPES = ['tree', 'org', 'flow'];
  // 全部行就绪后再做初始可见性(各 update 函数互相引用后面定义的行,避免 TDZ)
  updateSourceMode();

  // 替换选项（画布为空时无意义，但保持一致显示）
  // 详细模式:全部要点逐条成叶 + 引文成为画布上的引用节点
  const detailRow = document.createElement('div');
  detailRow.style.gridColumn = '1 / span 2';
  detailRow.style.display = 'inline-flex';
  detailRow.style.alignItems = 'center';
  detailRow.style.gap = '6px';
  const detailInput = document.createElement('input');
  detailInput.setAttribute('type', 'checkbox');
  detailInput.checked = prefs.detailMode;
  const detailLabel = document.createElement('span');
  detailLabel.style.fontSize = '10pt';
  mxUtils.write(detailLabel, t('aiDetailMode', 'Show ALL points and quotes as map parts (detailed)'));
  detailRow.appendChild(detailInput);
  detailRow.appendChild(detailLabel);
  table.appendChild(detailRow);

  const replaceRow = document.createElement('div');
  replaceRow.style.gridColumn = '1 / span 2';
  replaceRow.style.display = 'inline-flex';
  replaceRow.style.alignItems = 'center';
  replaceRow.style.gap = '6px';
  const replaceInput = document.createElement('input');
  replaceInput.setAttribute('type', 'checkbox');
  replaceInput.checked = prefs.replace;
  const replaceLabel = document.createElement('span');
  replaceLabel.style.fontSize = '10pt';
  mxUtils.write(replaceLabel, t('aiReplace', 'Replace existing mind map on the canvas'));
  replaceRow.appendChild(replaceInput);
  replaceRow.appendChild(replaceLabel);
  table.appendChild(replaceRow);

  // 密钥缺失提示（异步检查；已配置则不显示任何内容）
  const keyRow = makeFullRow('9pt');
  keyRow.style.color = COLOR_NOTICE;
  keyRow.style.display = 'none';
  keyRow.style.alignItems = 'center';
  keyRow.style.gap = '6px';
  const keyText = document.createElement('span');
  mxUtils.write(keyText, t('aiNoKey', 'No API key configured.'));
  const keyBtn = mxUtils.button(t('aiOpenSettings', 'Open Settings'), function () {
    showSettingsDialog(ui);
  });
  keyBtn.className = 'geBtn';
  keyBtn.style.fontSize = '9pt';
  keyBtn.style.padding = '2px 8px';
  keyRow.appendChild(keyText);
  keyRow.appendChild(keyBtn);
  table.appendChild(keyRow);
  getApiKey().then((key) => {
    if (key == null && container.isConnected) {
      keyRow.style.display = 'inline-flex';
    }
  });

  // 状态行 + 原始响应详情（schema 失败时展开）
  const statusRow = makeFullRow('10pt');
  statusRow.style.minHeight = '16px';
  const setStatus = (text: string, color?: string): void => {
    statusRow.textContent = text;
    statusRow.style.color = color != null ? color : '';
  };
  table.appendChild(statusRow);

  // 进度条:生成期间可见——确定进度显示比例,不确定阶段来回扫动
  const progressRow = document.createElement('div');
  progressRow.style.cssText = 'display:none;grid-column:1 / span 2;align-items:center;gap:8px;';
  const progressBarOuter = document.createElement('div');
  progressBarOuter.style.cssText = 'flex:1 1 auto;height:6px;border-radius:3px;background:#E2E8F0;overflow:hidden;';
  const progressBarFill = document.createElement('div');
  progressBarFill.style.cssText = 'height:100%;width:0%;border-radius:3px;background:#6D28D9;transition:width .25s;';
  progressBarOuter.appendChild(progressBarFill);
  const progressText = document.createElement('span');
  progressText.style.cssText = 'flex:0 0 auto;font-size:9pt;color:#475569;white-space:nowrap;';
  progressRow.appendChild(progressBarOuter);
  progressRow.appendChild(progressText);
  table.appendChild(progressRow);
  if (container.ownerDocument.getElementById('mm-progress-keyframes') == null) {
    const keyframes = container.ownerDocument.createElement('style');
    keyframes.id = 'mm-progress-keyframes';
    keyframes.textContent = '@keyframes mmProgressSweep{from{transform:translateX(-70%)}to{transform:translateX(170%)}}';
    container.ownerDocument.head.appendChild(keyframes);
  }
  const setProgress = (text: string, current?: number, total?: number): void => {
    progressRow.style.display = 'flex';
    progressText.textContent = text;
    if (current != null && total != null && total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
      progressBarFill.style.width = `${pct}%`;
      progressBarFill.style.animation = '';
    } else {
      progressBarFill.style.width = '40%';
      progressBarFill.style.animation = 'mmProgressSweep 1.1s ease-in-out infinite alternate';
    }
  };
  const hideProgress = (): void => {
    progressRow.style.display = 'none';
  };

  const rawRow = makeFullRow('9pt');
  rawRow.style.display = 'none';
  rawRow.style.maxHeight = '110px';
  rawRow.style.overflow = 'auto';
  rawRow.style.whiteSpace = 'pre-wrap';
  rawRow.style.wordBreak = 'break-all';
  rawRow.style.background = '#f5f5f5';
  rawRow.style.border = '1px solid #dddddd';
  rawRow.style.padding = '4px';
  table.appendChild(rawRow);

  const readPrefs = (): GenerationPrefs | null => {
    const depth = Number(depthInput.value);
    const maxChildren = Number(childrenInput.value);
    const maxNodes = Number(nodesInput.value);
    const rangeOk =
      Number.isInteger(depth) && depth >= 1 && depth <= 6 &&
      Number.isInteger(maxChildren) && maxChildren >= 1 && maxChildren <= 10 &&
      Number.isInteger(maxNodes) && maxNodes >= 5 && maxNodes <= 200;
    if (!rangeOk) {
      setStatus(t('aiGenInvalidRange', 'Please check the numeric ranges (depth 1-6, branches 1-10, nodes 5-200).'), COLOR_ERROR);
      return null;
    }
    return {
      sourceMode: sourceSelect.value === 'paste' || sourceSelect.value === 'link' ? sourceSelect.value : 'topic',
      chartType: chartSelect.value,
      chartDirection: directionSelect.value === 'horizontal' ? 'horizontal' : 'vertical',
      detailMode: detailInput.checked,
      autoParams: autoInput.checked,
      depth,
      maxChildren,
      maxNodes,
      language: langSelect.value === 'zh' || langSelect.value === 'en' ? langSelect.value : 'auto',
      layout: layoutSelect.value === 'tree' || layoutSelect.value === 'tree-vertical' ? layoutSelect.value : 'radial',
      replace: replaceInput.checked,
    };
  };

  let cancelled = false;

  /** 来源模式共用：跑管线 → 处理错误/取消 → 上画布（含引文 tooltip） */
  const runSourcePipeline = (
    prefs: GenerationPrefs,
    settings: AiProviderSettings,
    apiKey: string,
    topic: string,
    doc: SourceDoc
  ): void => {
    generateMindmapFromSource(settings, apiKey, { topic, doc }, prefs, {
      isCancelled: () => cancelled,
      detailMode: prefs.detailMode,
      autoConstraints: prefs.autoParams,
      onProgress: (p) => {
        if (p.stage === 'distill' && p.total != null && p.total > 1) {
          const label = `${t('aiStageDistill', 'Distilling knowledge points')} (${p.current ?? 0}/${p.total})`;
          setStatus(label);
          setProgress(label, p.current ?? 0, p.total);
          return;
        }
        const key =
          p.stage === 'ingest'
            ? 'aiStageIngest'
            : p.stage === 'autotune'
              ? 'aiStageAutotune'
              : p.stage === 'architect'
                ? 'aiStageArchitect'
                : p.stage === 'critique'
                  ? 'aiStageCritique'
                  : 'aiStageRender';
        setProgress(t(key, 'Working...'));
      },
    })
      .then((result) => {
        generateBtn.removeAttribute('disabled');
          hideProgress();
        if (!result.ok) {
          if (result.kind === 'cancelled') {
            if (container.isConnected) {
              setStatus(t('aiCancelled', 'Cancelled.'), COLOR_NOTICE);
            }
            return;
          }
          if (result.kind === 'http') {
            const detail = result.detail !== '' ? `: ${result.detail}` : ` (${result.status ?? '?'})`;
            setStatus(`${t('aiConnHttp', 'The API returned an error')}${detail}`, COLOR_ERROR);
          } else if (result.kind === 'timeout') {
            setStatus(t('aiConnTimeout', 'Connection timed out'), COLOR_ERROR);
          } else if (result.kind === 'network') {
            setStatus(`${t('aiConnNetwork', 'Network error')}: ${result.detail}`, COLOR_ERROR);
          } else if (result.kind === 'no-notes') {
            setStatus(t('aiGenNoNotes', 'No knowledge points could be extracted from the source.'), COLOR_ERROR);
          } else {
            setStatus(t('aiGenSchema', 'The AI reply could not be parsed as a mind map. Raw reply:'), COLOR_ERROR);
            rawRow.textContent = (result.raw ?? '').slice(0, 2000);
            rawRow.style.display = 'block';
          }
          return;
        }
        // 成功：上画布（替换/右侧落点 + 引文 tooltip + AI 参数说明）
        try {
          const graph = ui.editor.graph;
          const hasContent = graph.getChildCells(graph.getDefaultParent()).length > 0;
          const options: BuildMindmapOptions = { layout: prefs.layout, notes: result.notes };
          if (result.stats.autotune != null) {
            const a = result.stats.autotune;
            options.rootNote =
              `${t('aiAutotuneRootNote', 'AI-chosen parameters')}: ` +
              `${t('aiDepth', 'Depth')} ${a.depth} · ${t('aiMaxChildren', 'Branches')} ≤${a.maxChildren} · ${t('aiMaxNodes', 'Max nodes')} ≤${a.maxNodes}` +
              (a.reason !== '' ? ` (${a.reason})` : '');
          }
          if (prefs.replace) {
            options.replaceExisting = true;
          } else if (hasContent) {
            const bounds = graph.getGraphBounds();
            options.origin = { x: bounds.x + bounds.width + 160, y: bounds.y };
          }
          buildMindmapFromTree(ui, result.tree, options);
          // 复合画布:extras(支线小图/表格/关系图)排到主图右侧
          if (result.extras != null && result.extras.length > 0) {
            const boundsAfter = graph.getGraphBounds();
            buildChartElements(ui, result.extras, {
              origin: { x: boundsAfter.x + boundsAfter.width + 220, y: boundsAfter.y },
            });
            console.info('[MindmapAI] extras drawn:', result.extras.length);
          } else {
            console.info('[MindmapAI] no extras in result');
          }
          console.info('[MindmapAI] source-mode generated:', result.stats, result.critique);
          ui.hideDialog();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus(`${t('aiGenBuildFail', 'Failed to draw the mind map')}: ${message}`, COLOR_ERROR);
        }
      })
      .catch((err: unknown) => {
        generateBtn.removeAttribute('disabled');
          hideProgress();
        setStatus(String(err), COLOR_ERROR);
      });
  };

  /** 错误分类展示（抓取失败与 API 失败共用一套 i18n） */
  const showFetchError = (kind: 'http' | 'network' | 'timeout', status: number | undefined, detail: string): void => {
    if (kind === 'http') {
      const suffix = detail !== '' ? `: ${detail}` : ` (${status ?? '?'})`;
      setStatus(`${t('aiFetchFailed', 'Failed to fetch the page')}${suffix}`, COLOR_ERROR);
    } else if (kind === 'timeout') {
      setStatus(t('aiConnTimeout', 'Connection timed out'), COLOR_ERROR);
    } else {
      setStatus(
        `${t('aiConnNetwork', 'Network error')} — ${t(
          'aiFetchBrowserHint',
          'the site may block cross-origin browser requests; the desktop version can fetch it.'
        )}`,
        COLOR_ERROR
      );
    }
  };

  const generateBtn = mxUtils.button(t('aiGenerateBtn', 'Generate'), function () {
    if (generateBtn.getAttribute('disabled') === 'disabled') return;
    const genPrefs = readPrefs();
    if (genPrefs == null) return;

    if (genPrefs.chartType !== 'mindmap') {
      // 图表模式:12 种思考图,复用来源(主题/粘贴/链接)+ 提炼,槽位协议装配
      const runChart = (topic: string, doc: SourceDoc | undefined): void => {
        cancelled = false;
        generateBtn.setAttribute('disabled', 'disabled');
        getApiKey().then((apiKey) => {
          if (apiKey == null) {
            generateBtn.removeAttribute('disabled');
          hideProgress();
            setStatus(t('aiNoKey', 'No API key configured.'), COLOR_ERROR);
            return;
          }
          rawRow.style.display = 'none';
          saveGenerationPrefs(genPrefs);
          const settings: AiProviderSettings = loadSettings();
          const chartDirection = genPrefs.chartDirection === 'horizontal' ? 'horizontal' : 'vertical';
          const isGallery = genPrefs.chartType === 'gallery';
          const genResult = isGallery
            ? generateChartGallery(settings, apiKey, { topic, doc }, {
                isCancelled: () => cancelled,
                onProgress: (stage, current, total) => {
                  if (stage === 'distill' && total != null && total > 1) {
                    const label = `${t('aiStageDistill', 'Distilling knowledge points')} (${current ?? 0}/${total})`;
                    setStatus(label);
                    setProgress(label, current ?? 0, total);
                    return;
                  }
                  if (stage === 'architect' && total != null) {
                    const label = `${t('aiGalleryChart', 'Generating charts')} (${current ?? 0}/${total})`;
                    setStatus(label);
                    setProgress(label, current ?? 0, total);
                    return;
                  }
                  setProgress(t('aiStageRender', 'Rendering...'));
                },
              })
            : generateChart(settings, apiKey, genPrefs.chartType as ChartTypeId, { topic, doc }, {
                direction: chartDirection,
                isCancelled: () => cancelled,
                onProgress: (stage, current, total) => {
                  if (stage === 'distill' && total != null && total > 1) {
                    const label = `${t('aiStageDistill', 'Distilling knowledge points')} (${current ?? 0}/${total})`;
                    setStatus(label);
                    setProgress(label, current ?? 0, total);
                    return;
                  }
                  setProgress(t(stage === 'architect' ? 'aiChartArchitect' : 'aiStageRender', 'Working...'));
                },
              });
          genResult
            .then((result) => {
              generateBtn.removeAttribute('disabled');
          hideProgress();
              if (!result.ok) {
                if (result.kind === 'cancelled') {
                  if (container.isConnected) setStatus(t('aiCancelled', 'Cancelled.'), COLOR_NOTICE);
                  return;
                }
                if (result.kind === 'http') {
                  const detail = result.detail !== '' ? `: ${result.detail}` : ` (${result.status ?? '?'})`;
                  setStatus(`${t('aiConnHttp', 'The API returned an error')}${detail}`, COLOR_ERROR);
                } else if (result.kind === 'timeout') {
                  setStatus(t('aiConnTimeout', 'Connection timed out'), COLOR_ERROR);
                } else if (result.kind === 'network') {
                  setStatus(`${t('aiConnNetwork', 'Network error')}: ${result.detail}`, COLOR_ERROR);
                } else {
                  setStatus(`${t('aiGenSchema', 'The AI reply could not be parsed as a mind map. Raw reply:')}${result.detail}`, COLOR_ERROR);
                  if (result.raw != null && result.raw !== '') {
                    rawRow.textContent = result.raw.slice(0, 2000);
                    rawRow.style.display = 'block';
                  }
                }
                return;
              }
              try {
                const graph = ui.editor.graph;
                const hasContent = graph.getChildCells(graph.getDefaultParent()).length > 0;
                const chartOptions: BuildChartOptions = {};
                if (genPrefs.replace) chartOptions.replaceExisting = true;
                else if (hasContent) {
                  const bounds = graph.getGraphBounds();
                  chartOptions.origin = { x: bounds.x + bounds.width + 160, y: bounds.y };
                }
                const built = buildChartElements(ui, result.elements, chartOptions);
                if ('slots' in result) {
                  // 槽位记忆:右键「AI 修改此图」基于它增量修改;随文件持久化
                  (graph as any).__mmChartSlots = { type: genPrefs.chartType, slots: result.slots, direction: chartDirection };
                  attachChartSlots(graph, JSON.stringify({ type: genPrefs.chartType, slots: result.slots, direction: chartDirection }));
                  console.info('[MindmapAI] chart generated:', genPrefs.chartType, built);
                  setStatus(t('aiChartEditHint', 'Right-click blank canvas → Edit this chart with AI'), COLOR_NOTICE);
                } else {
                  const failedCount = result.failed.length;
                  console.info('[MindmapAI] gallery generated:', genPrefs.chartType, built, 'failed:', result.failed);
                  setStatus(
                    failedCount > 0
                      ? `${t('aiGalleryDone', 'Panorama canvas ready')} — ${failedCount} ${t('aiGalleryFailed', 'chart(s) failed, see console')}`
                      : t('aiGalleryDone', 'Panorama canvas ready'),
                    COLOR_NOTICE
                  );
                }
                ui.hideDialog();
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setStatus(`${t('aiGenBuildFail', 'Failed to draw the mind map')}: ${message}`, COLOR_ERROR);
              }
            })
            .catch((err: unknown) => {
              generateBtn.removeAttribute('disabled');
          hideProgress();
              setStatus(String(err), COLOR_ERROR);
            });
        });
      };

      if (genPrefs.sourceMode === 'paste') {
        const sourceTitle = titleInput.value.trim();
        const sourceText = sourceTextArea.value;
        if (sourceText.trim() === '') {
          setStatus(t('aiSourceRequired', 'Please paste the content to analyze.'), COLOR_ERROR);
          return;
        }
        const doc = buildSourceDocFromText(sourceTitle, sourceText);
        runChart(sourceTitle !== '' ? sourceTitle : doc.title, doc);
      } else if (genPrefs.sourceMode === 'link') {
        const linkUrl = linkInput.value.trim();
        if (!/^https?:\/\/\S+/i.test(linkUrl)) {
          setStatus(t('aiLinkInvalid', 'Please enter a valid http(s) link.'), COLOR_ERROR);
          return;
        }
        cancelled = false;
        generateBtn.setAttribute('disabled', 'disabled');
        getApiKey().then((apiKey) => {
          if (apiKey == null) {
            generateBtn.removeAttribute('disabled');
          hideProgress();
            setStatus(t('aiNoKey', 'No API key configured.'), COLOR_ERROR);
            return;
          }
          setStatus(t('aiFetchingPage', 'Fetching page...'));
          setProgress(t('aiFetchingPage', 'Fetching page...'));
          rawRow.style.display = 'none';
          saveGenerationPrefs(genPrefs);
          buildSourceDocFromUrl(linkUrl, undefined, loadSettings().fetchProxyPrefix)
            .then((fetched) => {
              if (!fetched.ok) {
                generateBtn.removeAttribute('disabled');
          hideProgress();
                showFetchError(fetched.kind, fetched.status, fetched.detail);
                return;
              }
              setStatus(t('aiStageIngest', 'Preparing source...'));
        setProgress(t('aiStageIngest', 'Preparing source...'));
              runChart(fetched.doc.title, fetched.doc);
            })
            .catch((err: unknown) => {
              generateBtn.removeAttribute('disabled');
          hideProgress();
              setStatus(String(err), COLOR_ERROR);
            });
        });
      } else {
        const topic = topicInput.value.trim();
        if (topic === '') {
          setStatus(t('aiTopicRequired', 'Please enter a topic.'), COLOR_ERROR);
          return;
        }
        runChart(topic, undefined);
      }
      return;
    }

    if (genPrefs.sourceMode === 'paste') {
      // 来源模式：粘贴文本 → 分块提炼 → 构造 → 评审（进度写状态行）
      const sourceTitle = titleInput.value.trim();
      const sourceText = sourceTextArea.value;
      if (sourceText.trim() === '') {
        setStatus(t('aiSourceRequired', 'Please paste the content to analyze.'), COLOR_ERROR);
        return;
      }
      cancelled = false;
      generateBtn.setAttribute('disabled', 'disabled');
      getApiKey().then((apiKey) => {
        if (apiKey == null) {
          generateBtn.removeAttribute('disabled');
          hideProgress();
          setStatus(t('aiNoKey', 'No API key configured.'), COLOR_ERROR);
          return;
        }
        setStatus(t('aiStageIngest', 'Preparing source...'));
        setProgress(t('aiStageIngest', 'Preparing source...'));
        rawRow.style.display = 'none';
        saveGenerationPrefs(genPrefs);
        const settings: AiProviderSettings = loadSettings();
        const doc = buildSourceDocFromText(sourceTitle, sourceText);
        if (doc.truncated) {
          setStatus(
            `${t('aiStageIngest', 'Preparing source...')} — ${t('aiSourceTruncated', 'long source truncated, quality may be affected')}`,
            COLOR_NOTICE
          );
        }
        runSourcePipeline(genPrefs, settings, apiKey, sourceTitle !== '' ? sourceTitle : doc.title, doc);
      });
      return;
    }

    if (genPrefs.sourceMode === 'link') {
      // 来源模式：链接抓取（GitHub 转 raw；其余 URL 浏览器模式受 CORS 限制）
      const linkUrl = linkInput.value.trim();
      if (!/^https?:\/\/\S+/i.test(linkUrl)) {
        setStatus(t('aiLinkInvalid', 'Please enter a valid http(s) link.'), COLOR_ERROR);
        return;
      }
      cancelled = false;
      generateBtn.setAttribute('disabled', 'disabled');
      getApiKey().then((apiKey) => {
        if (apiKey == null) {
          generateBtn.removeAttribute('disabled');
          hideProgress();
          setStatus(t('aiNoKey', 'No API key configured.'), COLOR_ERROR);
          return;
        }
        setStatus(t('aiFetchingPage', 'Fetching page...'));
        rawRow.style.display = 'none';
        saveGenerationPrefs(genPrefs);
        const settings: AiProviderSettings = loadSettings();
        buildSourceDocFromUrl(linkUrl, undefined, loadSettings().fetchProxyPrefix)
          .then((fetched) => {
            if (!fetched.ok) {
              generateBtn.removeAttribute('disabled');
          hideProgress();
              showFetchError(fetched.kind, fetched.status, fetched.detail);
              return;
            }
            console.info('[MindmapAI] fetched source:', fetched.finalUrl);
            setStatus(t('aiStageIngest', 'Preparing source...'));
        setProgress(t('aiStageIngest', 'Preparing source...'));
            runSourcePipeline(genPrefs, settings, apiKey, fetched.doc.title, fetched.doc);
          })
          .catch((err: unknown) => {
            generateBtn.removeAttribute('disabled');
          hideProgress();
            setStatus(String(err), COLOR_ERROR);
          });
      });
      return;
    }

    // 主题模式（M6 现状单发）
    const topic = topicInput.value.trim();
    if (topic === '') {
      setStatus(t('aiTopicRequired', 'Please enter a topic.'), COLOR_ERROR);
      return;
    }

    getApiKey().then((apiKey) => {
      if (apiKey == null) {
        setStatus(t('aiNoKey', 'No API key configured.'), COLOR_ERROR);
        return;
      }
      if (!ui.spinner.spin(container, t('aiGenerating', 'Generating mind map...'))) {
        return;
      }
      setStatus('');
      rawRow.style.display = 'none';
      saveGenerationPrefs(genPrefs);

      // 点击时读取最新配置：允许在对话框打开期间经设置对话框修改供应商
      const settings: AiProviderSettings = loadSettings();
      generateMindmapTree(settings, apiKey, topic, genPrefs)
        .then((result) => {
          ui.spinner.stop();
          if (!result.ok) {
            if (result.kind === 'http') {
              const detail = result.detail !== '' ? `: ${result.detail}` : ` (${result.status ?? '?'})`;
              setStatus(`${t('aiConnHttp', 'The API returned an error')}${detail}`, COLOR_ERROR);
            } else if (result.kind === 'timeout') {
              setStatus(t('aiConnTimeout', 'Connection timed out'), COLOR_ERROR);
            } else if (result.kind === 'network') {
              setStatus(`${t('aiConnNetwork', 'Network error')}: ${result.detail}`, COLOR_ERROR);
            } else {
              setStatus(t('aiGenSchema', 'The AI reply could not be parsed as a mind map. Raw reply:'), COLOR_ERROR);
              rawRow.textContent = result.raw.slice(0, 2000);
              rawRow.style.display = 'block';
            }
            return;
          }
          // 成功：上画布（非替换模式下放到现有内容右侧，避免重叠）
          const graph = ui.editor.graph;
          const hasContent = graph.getChildCells(graph.getDefaultParent()).length > 0;
          const options: BuildMindmapOptions = {
            layout: genPrefs.layout,
          };
          if (genPrefs.replace) {
            options.replaceExisting = true;
          } else if (hasContent) {
            const bounds = graph.getGraphBounds();
            options.origin = { x: bounds.x + bounds.width + 160, y: bounds.y };
          }
          try {
            buildMindmapFromTree(ui, result.tree, options);
            console.info('[MindmapAI] generated:', result.stats);
            ui.hideDialog();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus(`${t('aiGenBuildFail', 'Failed to draw the mind map')}: ${message}`, COLOR_ERROR);
          }
        })
        .catch((err: unknown) => {
          ui.spinner.stop();
          setStatus(String(err), COLOR_ERROR);
        });
    });
  });
  generateBtn.className = 'geBtn gePrimaryBtn';

  const cancelBtn = mxUtils.button(mxResources.get('cancel'), function () {
    cancelled = true;
    ui.hideDialog();
  });
  cancelBtn.className = 'geBtn';

  mxEvent.addListener(topicInput, 'keypress', function (e: KeyboardEvent) {
    if (e.keyCode === 13) {
      generateBtn.click();
    }
  });
  mxEvent.addListener(titleInput, 'keypress', function (e: KeyboardEvent) {
    if (e.keyCode === 13) {
      generateBtn.click();
    }
  });

  const buttonRow = document.createElement('div');
  buttonRow.style.gridColumn = '1 / span 2';
  buttonRow.style.paddingTop = '14px';
  buttonRow.style.whiteSpace = 'nowrap';
  buttonRow.style.display = 'inline-flex';
  buttonRow.style.alignItems = 'center';
  buttonRow.style.justifyContent = 'flex-end';
  buttonRow.style.gap = '4px';
  if (ui.editor != null && ui.editor.cancelFirst) {
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(generateBtn);
  } else {
    buttonRow.appendChild(generateBtn);
    buttonRow.appendChild(cancelBtn);
  }
  table.appendChild(buttonRow);

  ui.showDialog(container, 380, null, true, true, function () {
    // Esc / 关闭对话框时同样通知管线停止（取消只在阶段间生效）
    cancelled = true;
  });
  topicInput.focus();
}


/** AI → 部件示例图:AI 为全部形状部件生成实例,网格铺开 */
export function showShapeGalleryDialog(ui: DrawioPluginApi): void {
  getApiKey().then((apiKey) => {
    if (apiKey == null) {
      mxUtils.alert(t('aiNoKey', 'No API key configured.'));
      return;
    }
    if (!ui.spinner.spin(ui.container, t('aiGalleryBuilding', 'Generating shape gallery...'))) {
      return;
    }
    generateShapeGallery(loadSettings(), apiKey)
      .then((result) => {
        ui.spinner.stop();
        if (!result.ok || result.elements == null) {
          mxUtils.alert(`${t('aiGalleryFail', 'Failed to generate the shape gallery')}: ${result.detail ?? ''}`);
          return;
        }
        buildChartElements(ui, result.elements, { replaceExisting: true });
        console.info('[MindmapAI] shape gallery built:', result.elements.length, 'elements');
      })
      .catch((err: unknown) => {
        ui.spinner.stop();
        mxUtils.alert(err instanceof Error ? err.message : String(err));
      });
  });
}
