/**
 * Agent 侧边栏面板:实时展示生成过程的中间产物,类似 AI 编码助手的会话流。
 *
 * 面板不回查管线状态——管线通过 onEvent 推送自包含的结构化事件,这里只做
 * 渲染:提炼出的要点原文(含引文)、评审四维分数与评语、回炉原因、每张图表
 * 进度、复合画布摘要。可折叠 <details> 保证长内容不刷屏;自动滚动到底部,
 * 用户向上翻阅时暂停跟随。
 */

import type { AgentEvent } from '../agent/events';
import type { MindmapTree } from '../ai/schema';
import type { DistilledNote } from '../agent/types';
import { t } from '../i18n/keys';

/** 面板上下文:最近一次 AI 生成的导图,供命令 Agent 修改 */
export interface AgentPanelContext {
  tree: MindmapTree;
  notes: DistilledNote[];
  layout: 'radial' | 'tree' | 'tree-vertical';
}

export interface AgentPanelHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  append(event: AgentEvent): void;
  clear(): void;
  getContext(): AgentPanelContext | null;
  setContext(ctx: AgentPanelContext | null): void;
  setBusy(busy: boolean): void;
  /** 用户在输入框发送指令时的回调(由宿主绑定) */
  onCommand: ((text: string) => Promise<void>) | null;
}

interface PanelDom {
  root: HTMLDivElement;
  log: HTMLDivElement;
  empty: HTMLDivElement;
  clearBtn: HTMLDivElement;
  closeBtn: HTMLDivElement;
  commandInput: HTMLInputElement;
  sendBtn: HTMLDivElement;
}

const SCORE_LABELS: Array<{ key: string; labelKey: string; fallback: string; color: string }> = [
  { key: 'grounding', labelKey: 'aiCritGrounding', fallback: 'grounding', color: '#6D28D9' },
  { key: 'coverage', labelKey: 'aiCritCoverage', fallback: 'coverage', color: '#2563EB' },
  { key: 'specificity', labelKey: 'aiCritSpecificity', fallback: 'specificity', color: '#0D9488' },
  { key: 'structure', labelKey: 'aiCritStructure', fallback: 'structure', color: '#D97706' },
];

function el(tag: string, cssText: string, text?: string): HTMLDivElement {
  const node = document.createElement(tag);
  node.style.cssText = cssText;
  if (text != null) node.textContent = text;
  return node as HTMLDivElement;
}

const CARD_CSS = 'border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;background:#FFFFFF;';
const QUOTE_CSS = 'margin:2px 0 0 0;font-size:8.5pt;color:#64748B;font-style:italic;';

function buildPanelDom(): PanelDom {
  const root = el('div', [
    'position:fixed;right:10px;top:10px;bottom:10px;width:340px;z-index:100000;',
    'display:flex;flex-direction:column;background:#F8FAFC;border:1px solid #CBD5E1;',
    'border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,0.18);overflow:hidden;',
  ].join(''));

  const header = el('div', 'display:flex;align-items:center;gap:6px;padding:8px 10px;background:#FFFFFF;border-bottom:1px solid #E2E8F0;');
  header.appendChild(el('span', 'font-weight:bold;font-size:10pt;color:#1E293B;', 'MindmapAI Agent'));
  header.appendChild(el('span', 'font-size:8pt;color:#6D28D9;background:#EDE9FE;border-radius:8px;padding:1px 7px;', t('aiAgentLive', 'live')));
  const spacer = el('span', 'flex:1 1 auto;');
  header.appendChild(spacer);
  const clearBtn = el('button', 'border:none;background:none;cursor:pointer;font-size:9pt;color:#64748B;padding:2px 4px;', t('aiAgentClear', 'Clear'));
  const closeBtn = el('button', 'border:none;background:none;cursor:pointer;font-size:11pt;color:#64748B;padding:0 4px;line-height:1;', '×');
  header.appendChild(clearBtn);
  header.appendChild(closeBtn);

  const log = el('div', 'flex:1 1 auto;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;');
  const empty = el('div', 'font-size:9pt;color:#94A3B8;padding:12px 4px;line-height:1.5;', t('aiAgentEmpty', 'Waiting for a run — the agent\u2019s distilled notes, review feedback and more will stream here.'));
  log.appendChild(empty);

  const inputRow = el('div', 'display:flex;gap:6px;padding:8px 10px;border-top:1px solid #E2E8F0;background:#FFFFFF;');
  const commandInput = document.createElement('input');
  commandInput.setAttribute('type', 'text');
  commandInput.style.cssText = 'flex:1 1 auto;font-size:9pt;padding:4px 8px;border:1px solid #CBD5E1;border-radius:6px;outline:none;';
  commandInput.placeholder = t('aiCommandPlaceholder', 'Instruct the agent, e.g. unify the term to AI Agent');
  const sendBtn = el('button', 'flex:0 0 auto;font-size:9pt;padding:4px 10px;border:none;border-radius:6px;background:#6D28D9;color:#fff;cursor:pointer;', t('aiSend', 'Send'));
  inputRow.appendChild(commandInput);
  inputRow.appendChild(sendBtn);
  root.appendChild(header);
  root.appendChild(log);
  root.appendChild(inputRow);
  document.body.appendChild(root);

  return { root, log, empty, clearBtn, closeBtn, commandInput, sendBtn };
}

export function ensureAgentPanel(ui: DrawioPluginApi): AgentPanelHandle {
  const store = ui as unknown as { __mmAgentPanel?: AgentPanelHandle & { dom: PanelDom } };
  if (store.__mmAgentPanel != null) return store.__mmAgentPanel;

  const dom = buildPanelDom();
  let userScrolledUp = false;
  let context: AgentPanelContext | null = null;
  let busy = false;
  dom.log.addEventListener('scroll', () => {
    const log = dom.log;
    userScrolledUp = log.scrollHeight - log.scrollTop - log.clientHeight > 48;
  });

  const scrollToEnd = (): void => {
    if (!userScrolledUp) dom.log.scrollTop = dom.log.scrollHeight;
  };

  const append = (event: AgentEvent): void => {
    dom.empty.style.display = 'none';
    dom.log.appendChild(renderEvent(event));
    // 超长会话截断:保留最近 200 张卡片
    while (dom.log.childElementCount > 201) {
      dom.log.removeChild(dom.log.children[1]);
    }
    scrollToEnd();
  };

  const clear = (): void => {
    while (dom.log.firstChild != null) dom.log.removeChild(dom.log.firstChild);
    dom.log.appendChild(dom.empty);
    dom.empty.style.display = '';
    userScrolledUp = false;
  };

  const handle: AgentPanelHandle = {
    show: () => {
      dom.root.style.display = 'flex';
      scrollToEnd();
    },
    hide: () => {
      dom.root.style.display = 'none';
    },
    toggle: () => {
      dom.root.style.display = dom.root.style.display === 'none' ? 'flex' : 'none';
    },
    isVisible: () => dom.root.style.display !== 'none',
    append,
    clear,
    getContext: () => context,
    setContext: (ctx) => {
      context = ctx;
    },
    setBusy: (b) => {
      busy = b;
      applyBusy();
    },
    onCommand: null,
  };
  dom.clearBtn.addEventListener('click', () => clear());
  dom.closeBtn.addEventListener('click', () => handle.hide());

  const applyBusy = (): void => {
    dom.commandInput.disabled = busy;
    (dom.sendBtn as unknown as HTMLButtonElement).disabled = busy;
    dom.sendBtn.style.opacity = busy ? '0.5' : '1';
  };
  const send = (): void => {
    const text = dom.commandInput.value.trim();
    if (text === '' || busy || handle.onCommand == null) return;
    dom.commandInput.value = '';
    append({ type: 'user', text });
    busy = true;
    applyBusy();
    void Promise.resolve(handle.onCommand(text)).finally(() => {
      busy = false;
      applyBusy();
    });
  };
  dom.sendBtn.addEventListener('click', () => send());
  dom.commandInput.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') {
      ev.preventDefault();
      send();
    }
  });

  store.__mmAgentPanel = { ...handle, dom };
  return store.__mmAgentPanel;
}

/* ---------- 事件 → 卡片 ---------- */

function renderEvent(event: AgentEvent): HTMLElement {
  switch (event.type) {
    case 'stage':
      return renderStage(event.label);
    case 'notes':
      return renderNotes(event);
    case 'autotune':
      return renderAutotune(event);
    case 'skeleton':
      return renderSkeleton(event);
    case 'critique':
      return renderCritique(event);
    case 'revise':
      return renderRevise(event);
    case 'user':
      return renderLine(event.text, '#FFFFFF', '#6D28D9');
    case 'assistant':
      return renderLine(event.text, '#1E293B', '#EDE9FE');
    case 'tool':
      return renderLine(`⚙ ${event.name} ${event.detail}`, '#475569', '#F1F5F9');
    case 'node':
      return renderLine(
        `${event.updated === true ? '↻' : '＋'} ${event.label} (${event.total} ${t('aiAgentNodesWord', 'nodes')})`,
        '#166534', '#F0FDF4',
      );
    case 'chart':
      return renderChart(event);
    case 'extras':
      return renderExtras(event);
    case 'done':
      return renderDone(event);
    case 'warn':
      return renderLine(event.text, '#B45309', '#FEF3C7');
    case 'info':
    default:
      return renderLine(event.type === 'info' ? event.text : '', '#475569', '#F1F5F9');
  }
}

function renderStage(label: string): HTMLElement {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 0 0;');
  row.appendChild(el('span', 'flex:0 0 auto;font-size:8pt;font-weight:bold;letter-spacing:0.06em;color:#6D28D9;text-transform:uppercase;', label));
  row.appendChild(el('span', 'flex:1 1 auto;height:1px;background:#E2E8F0;'));
  return row;
}

function renderNotes(event: Extract<AgentEvent, { type: 'notes' }>): HTMLElement {
  const card = el('details', CARD_CSS);
  const head = el('summary', 'cursor:pointer;font-size:9pt;color:#1E293B;');
  const preview = event.notes.length > 0 ? event.notes[0].content : '';
  const more = event.notes.length > 1 ? ` ${t('aiAgentAndMore', `+${event.notes.length - 1}`)}` : '';
  head.textContent = `${t('aiAgentNotesWord', 'notes')} ${event.chunk}/${event.total} · ${event.notes.length}${more}${event.heading != null ? ` — ${event.heading}` : ''} · ${preview}`;
  card.appendChild(head);
  const list = el('ul', 'margin:6px 0 0 0;padding-left:16px;font-size:9pt;color:#334155;');
  for (const note of event.notes) {
    const li = document.createElement('li');
    li.style.marginBottom = '3px';
    li.appendChild(el('span', '', note.content));
    if (note.quote != null) {
      li.appendChild(el('div', QUOTE_CSS, `"${note.quote}"`));
    }
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

function renderAutotune(event: Extract<AgentEvent, { type: 'autotune' }>): HTMLElement {
  const card = el('div', CARD_CSS);
  card.appendChild(el('div', 'font-size:9pt;color:#1E293B;font-weight:bold;', t('aiAgentAutotune', 'Auto-tuned parameters')));
  card.appendChild(el('div', 'font-size:9pt;color:#334155;', `${t('aiDepth', 'Depth')} ${event.depth} · ${t('aiMaxChildren', 'Branches')} ${event.maxChildren} · ${t('aiMaxNodes', 'Max nodes')} ${event.maxNodes}`));
  if (event.reason !== '') {
    card.appendChild(el('div', QUOTE_CSS, event.reason));
  }
  return card;
}

function renderSkeleton(event: Extract<AgentEvent, { type: 'skeleton' }>): HTMLElement {
  const card = el('details', CARD_CSS);
  const head = el('summary', 'cursor:pointer;font-size:9pt;color:#1E293B;');
  head.textContent = `${t('aiAgentSkeleton', 'Section skeleton')} · ${event.sections.length}`;
  card.appendChild(head);
  const list = el('ul', 'margin:6px 0 0 0;padding-left:16px;font-size:8.5pt;color:#475569;');
  for (const sec of event.sections) {
    list.appendChild(el('li', 'margin-bottom:2px;', sec));
  }
  card.appendChild(list);
  return card;
}

function renderCritique(event: Extract<AgentEvent, { type: 'critique' }>): HTMLElement {
  const card = el('div', `${CARD_CSS}border-color:${event.verdict === 'pass' ? '#86EFAC' : '#FCD34D'};`);
  card.appendChild(el('div', 'font-size:9pt;font-weight:bold;color:#1E293B;', t('aiAgentReview', 'AI review')));
  for (const score of SCORE_LABELS) {
    const value = event.scores[score.key];
    if (typeof value !== 'number') continue;
    const row = el('div', 'display:flex;align-items:center;gap:6px;margin:3px 0;');
    row.appendChild(el('span', 'flex:0 0 64px;font-size:8pt;color:#475569;', t(score.labelKey, score.fallback)));
    const barOuter = el('div', 'flex:1 1 auto;height:5px;border-radius:3px;background:#E2E8F0;overflow:hidden;');
    const barFill = el('div', `height:100%;width:${Math.max(0, Math.min(100, value))}%;background:${score.color};`);
    barOuter.appendChild(barFill);
    row.appendChild(barOuter);
    row.appendChild(el('span', 'flex:0 0 26px;font-size:8pt;color:#334155;text-align:right;', String(value)));
    card.appendChild(row);
  }
  const verdictColor = event.verdict === 'pass' ? '#15803D' : '#B45309';
  card.appendChild(el('div', `margin-top:4px;font-size:8pt;font-weight:bold;color:${verdictColor};`, event.verdict === 'pass' ? t('aiAgentVerdictPass', 'PASS') : t('aiAgentVerdictRevise', 'NEEDS REVISION')));
  if (event.feedback !== '') {
    card.appendChild(el('div', QUOTE_CSS, event.feedback));
  }
  return card;
}

function renderRevise(event: Extract<AgentEvent, { type: 'revise' }>): HTMLElement {
  const card = el('div', `${CARD_CSS}background:#FFFBEB;border-color:#FCD34D;`);
  card.appendChild(el('div', 'font-size:9pt;font-weight:bold;color:#B45309;', t('aiAgentRevising', 'Rebuilding map from review feedback...')));
  if (event.feedback !== '') {
    card.appendChild(el('div', QUOTE_CSS, event.feedback));
  }
  return card;
}

function renderChart(event: Extract<AgentEvent, { type: 'chart' }>): HTMLElement {
  const range = event.index != null && event.total != null ? ` (${event.index}/${event.total})` : '';
  return renderLine(`✓ ${event.name} · ${event.nodes} ${t('aiAgentNodesWord', 'nodes')}${range}`, '#166534', '#F0FDF4');
}

function renderExtras(event: Extract<AgentEvent, { type: 'extras' }>): HTMLElement {
  const card = el('details', CARD_CSS);
  const head = el('summary', 'cursor:pointer;font-size:9pt;color:#1E293B;');
  head.textContent = `${t('aiAgentExtras', 'Composite canvas extras')} · ${event.minimaps.length} ${t('aiAgentMinimapsWord', 'minimaps')} · ${event.tableRows} ${t('aiAgentTableRowsWord', 'table rows')} · ${event.relations} ${t('aiAgentRelationsWord', 'relations')}`;
  card.appendChild(head);
  for (const mini of event.minimaps) {
    card.appendChild(el('div', 'font-size:8.5pt;color:#475569;margin-top:3px;', `• ${mini.title} (${mini.items})`));
  }
  return card;
}

function renderDone(event: Extract<AgentEvent, { type: 'done' }>): HTMLElement {
  const card = el('div', `${CARD_CSS}background:#F0FDF4;border-color:#86EFAC;`);
  card.appendChild(el('div', 'font-size:9pt;font-weight:bold;color:#166534;', `✓ ${t('aiAgentDone', 'Done')} — ${event.summary}`));
  return card;
}

function renderLine(text: string, color: string, background: string): HTMLElement {
  const line = el('div', `font-size:9pt;color:${color};background:${background};border-radius:6px;padding:4px 8px;`, text);
  return line;
}
