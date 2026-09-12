/**
 * Agent 侧边栏面板:实时展示生成过程的中间产物,类似 AI 编码助手的会话流。
 *
 * 面板不回查管线状态——管线通过 onEvent 推送自包含的结构化事件,这里只做
 * 渲染:提炼出的要点原文(含引文)、评审四维分数与评语、回炉原因、每张图表
 * 进度、复合画布摘要。可折叠 <details> 保证长内容不刷屏;自动滚动到底部,
 * 用户向上翻阅时暂停跟随。
 *
 * 主题:跟随 drawio 亮/暗主题(ui.theme + currentThemeChanged 事件);切换时
 * 按事件历史重渲染卡片,不丢会话内容。
 */

import type { AgentEvent } from '../agent/events';
import type { MindmapTree } from '../ai/schema';
import type { DistilledNote } from '../agent/types';
import { t } from '../i18n/keys';

/** 面板上下文:最近一次 AI 生成结果,供命令 Agent 修改 */
export type AgentPanelContext =
  | { kind: 'mindmap'; tree: MindmapTree; notes: DistilledNote[]; layout: 'radial' | 'tree' | 'tree-vertical'; aspect: 'auto' | '16:9' | '4:3' | '1:1' }
  | { kind: 'chart'; type: string; slots: unknown; direction: 'vertical' | 'horizontal' };

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
  header: HTMLDivElement;
  titleSpan: HTMLDivElement;
  livePill: HTMLDivElement;
  log: HTMLDivElement;
  empty: HTMLDivElement;
  clearBtn: HTMLDivElement;
  closeBtn: HTMLDivElement;
  inputRow: HTMLDivElement;
  commandInput: HTMLInputElement;
  sendBtn: HTMLDivElement;
  grip: HTMLDivElement;
}

/* ---------- 主题:跟随 drawio 亮/暗主题 ---------- */

/** 面板配色板:全部颜色唯一定义,渲染/重渲染共用(新增颜色请先加键) */
export interface PanelPalette {
  dark: boolean;
  /** 面板底色 */
  bg: string;
  /** 头部/输入行底色 */
  headerBg: string;
  /** 边框与分隔线 */
  border: string;
  /** 主文字 */
  text: string;
  /** 次级文字 */
  text2: string;
  /** 引文/说明(斜体) */
  quote: string;
  /** 空状态提示 */
  empty: string;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  inputBorder: string;
  toolBg: string;
  toolText: string;
  assistantBg: string;
  assistantText: string;
  userBg: string;
  userText: string;
  okBg: string;
  okBorder: string;
  okText: string;
  warnBg: string;
  warnBorder: string;
  warnText: string;
  liveBg: string;
  liveText: string;
  /** 评分条轨道 */
  track: string;
}

export function panelPalette(dark: boolean): PanelPalette {
  if (dark) {
    // 对齐 drawio 暗色主题(画布 #2A2A2E / 工具区 #202124 / 描边 #3C4043)
    return {
      dark: true,
      bg: '#2A2A2E',
      headerBg: '#202124',
      border: '#3C4043',
      text: '#E8EAED',
      text2: '#B9BDC4',
      quote: '#9AA0A6',
      empty: '#7C828A',
      cardBg: '#24262A',
      cardBorder: '#3C4043',
      inputBg: '#1F2023',
      inputBorder: '#3C4043',
      toolBg: '#33363B',
      toolText: '#C9CDD2',
      assistantBg: '#37304F',
      assistantText: '#DCD6F2',
      userBg: '#6D28D9',
      userText: '#FFFFFF',
      okBg: '#173320',
      okBorder: '#2F6B43',
      okText: '#7ED79A',
      warnBg: '#3A2F12',
      warnBorder: '#7A611F',
      warnText: '#E5B85C',
      liveBg: '#37304F',
      liveText: '#B9A8F5',
      track: '#3C4043',
    };
  }
  return {
    dark: false,
    bg: '#FFFFFF',
    headerBg: '#F5F5F5',
    border: '#E0E0E0',
    text: '#1E293B',
    text2: '#475569',
    quote: '#64748B',
    empty: '#94A3B8',
    cardBg: '#FFFFFF',
    cardBorder: '#E2E8F0',
    inputBg: '#FFFFFF',
    inputBorder: '#D0D0D0',
    toolBg: '#F1F5F9',
    toolText: '#475569',
    assistantBg: '#EDE9FE',
    assistantText: '#1E293B',
    userBg: '#6D28D9',
    userText: '#FFFFFF',
    okBg: '#F0FDF4',
    okBorder: '#86EFAC',
    okText: '#166534',
    warnBg: '#FEF3C7',
    warnBorder: '#FCD34D',
    warnText: '#B45309',
    liveBg: '#EDE9FE',
    liveText: '#6D28D9',
    track: '#E2E8F0',
  };
}

/** drawio 主题判定:新版 drawio 用 Editor.darkMode 布尔(EditorUi.setDarkMode
 *  综合 urlParams/用户设置/系统偏好解析);旧版 'dark' 是一种 currentTheme;
 *  兜底宿主暴露的 ui.theme */
export function isDarkTheme(ui: unknown): boolean {
  const g = globalThis as { Editor?: { darkMode?: unknown; currentTheme?: string } };
  if (typeof g.Editor?.darkMode === 'boolean') return g.Editor.darkMode;
  if (g.Editor?.currentTheme != null && g.Editor.currentTheme !== '') {
    return g.Editor.currentTheme === 'dark';
  }
  const theme = (ui as { theme?: string } | null | undefined)?.theme ?? '';
  if (theme === 'dark') return true;
  if (theme === 'auto' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
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

const cardCss = (p: PanelPalette): string =>
  `border:1px solid ${p.cardBorder};border-radius:8px;padding:6px 8px;background:${p.cardBg};`;
const quoteCss = (p: PanelPalette): string =>
  `margin:2px 0 0 0;font-size:8.5pt;color:${p.quote};font-style:italic;`;

function buildPanelDom(ui: DrawioPluginApi, width: number, p: PanelPalette): PanelDom {
  // 停靠在主编辑区右侧(Format 面板左侧),随窗口缩放
  const graphContainer = ui.editor.graph.container as HTMLElement;
  const host = (graphContainer.parentElement ?? document.body) as HTMLElement;
  if (window.getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  // 初始隐藏:生成流程显式 .show();菜单/Format tab 首次 toggle 才是"打开"
  const root = el('div', [
    'position:absolute;right:0;top:0;bottom:0;',
    `width:${width}px;z-index:100000;`,
    `display:none;flex-direction:column;background:${p.bg};`,
    `border-left:1px solid ${p.border};overflow:hidden;`,
  ].join(''));

  // 左缘拖拽条:调宽(240-640)
  const grip = el('div', 'position:absolute;left:0;top:0;bottom:0;width:7px;cursor:col-resize;background:transparent;');
  root.appendChild(grip);

  const header = el('div', `display:flex;align-items:center;gap:6px;padding:7px 10px;background:${p.headerBg};border-bottom:1px solid ${p.border};`);
  const titleSpan = el('span', `font-weight:bold;font-size:10pt;color:${p.text};`, 'MindmapAI Agent');
  header.appendChild(titleSpan);
  const livePill = el('span', `font-size:8pt;color:${p.liveText};background:${p.liveBg};border-radius:8px;padding:1px 7px;`, t('aiAgentLive', 'live'));
  header.appendChild(livePill);
  const spacer = el('span', 'flex:1 1 auto;');
  header.appendChild(spacer);
  const clearBtn = el('button', `border:none;background:none;cursor:pointer;font-size:9pt;color:${p.text2};padding:2px 4px;`, t('aiAgentClear', 'Clear'));
  const closeBtn = el('button', `border:none;background:none;cursor:pointer;font-size:11pt;color:${p.text2};padding:0 4px;line-height:1;`, '×');
  header.appendChild(clearBtn);
  header.appendChild(closeBtn);

  const log = el('div', 'flex:1 1 auto;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;');
  const empty = el('div', `font-size:9pt;color:${p.empty};padding:12px 4px;line-height:1.5;`, t('aiAgentEmpty', 'Waiting for a run — the agent’s distilled notes, review feedback and more will stream here.'));
  log.appendChild(empty);

  const inputRow = el('div', `display:flex;gap:6px;padding:8px 10px;border-top:1px solid ${p.border};background:${p.headerBg};`);
  const commandInput = document.createElement('input');
  commandInput.setAttribute('type', 'text');
  commandInput.style.cssText = `flex:1 1 auto;font-size:9pt;padding:4px 8px;border:1px solid ${p.inputBorder};border-radius:4px;outline:none;background:${p.inputBg};color:${p.text};`;
  commandInput.placeholder = t('aiCommandPlaceholder', 'Instruct the agent, e.g. unify the term to AI Agent');
  const sendBtn = el('button', `flex:0 0 auto;font-size:9pt;padding:4px 10px;border:none;border-radius:6px;background:${p.userBg};color:${p.userText};cursor:pointer;`, t('aiSend', 'Send'));
  inputRow.appendChild(commandInput);
  inputRow.appendChild(sendBtn);
  root.appendChild(header);
  root.appendChild(log);
  root.appendChild(inputRow);
  document.body.appendChild(root);

  return { root, header, titleSpan, livePill, log, empty, clearBtn, closeBtn, inputRow, commandInput, sendBtn, grip };
}

/** 主题切换时重刷面板框架颜色(卡片由事件历史重渲染) */
function restyleChrome(dom: PanelDom, p: PanelPalette): void {
  dom.root.style.background = p.bg;
  dom.root.style.borderLeft = `1px solid ${p.border}`;
  dom.header.style.background = p.headerBg;
  dom.header.style.borderBottom = `1px solid ${p.border}`;
  dom.titleSpan.style.color = p.text;
  dom.livePill.style.color = p.liveText;
  dom.livePill.style.background = p.liveBg;
  dom.clearBtn.style.color = p.text2;
  dom.closeBtn.style.color = p.text2;
  dom.inputRow.style.background = p.headerBg;
  dom.inputRow.style.borderTop = `1px solid ${p.border}`;
  dom.commandInput.style.background = p.inputBg;
  dom.commandInput.style.border = `1px solid ${p.inputBorder}`;
  dom.commandInput.style.color = p.text;
  dom.sendBtn.style.background = p.userBg;
  dom.sendBtn.style.color = p.userText;
  dom.empty.style.color = p.empty;
}

export function ensureAgentPanel(ui: DrawioPluginApi): AgentPanelHandle {
  const store = ui as unknown as { __mmAgentPanel?: AgentPanelHandle };
  if (store.__mmAgentPanel != null) return store.__mmAgentPanel;

  let width = 340;
  try {
    const saved = window.localStorage.getItem('mmAgentPanelWidth');
    if (saved != null) {
      const n = Number(saved);
      if (Number.isFinite(n)) width = Math.max(260, Math.min(640, n));
    }
  } catch { /* 忽略 */ }
  let palette = panelPalette(isDarkTheme(ui));
  const dom = buildPanelDom(ui, width, palette);
  let userScrolledUp = false;
  let context: AgentPanelContext | null = null;
  let busy = false;
  /** 事件历史:主题切换时重渲染卡片用;与 DOM 截断同上限(200) */
  const history: AgentEvent[] = [];
  dom.log.addEventListener('scroll', () => {
    const log = dom.log;
    userScrolledUp = log.scrollHeight - log.scrollTop - log.clientHeight > 48;
  });

  const scrollToEnd = (): void => {
    if (!userScrolledUp) dom.log.scrollTop = dom.log.scrollHeight;
  };

  const append = (event: AgentEvent): void => {
    history.push(event);
    if (history.length > 200) history.shift();
    dom.empty.style.display = 'none';
    dom.log.appendChild(renderEvent(event, palette));
    // 超长会话截断:保留最近 200 张卡片
    while (dom.log.childElementCount > 201) {
      dom.log.removeChild(dom.log.children[1]);
    }
    scrollToEnd();
  };

  const clear = (): void => {
    history.length = 0;
    while (dom.log.firstChild != null) dom.log.removeChild(dom.log.firstChild);
    dom.log.appendChild(dom.empty);
    dom.empty.style.display = '';
    userScrolledUp = false;
  };

  /** 主题/语言变化共用:按事件历史重渲染卡片(文案随当前 t() 重取) */
  const rerenderCards = (): void => {
    while (dom.log.firstChild != null) dom.log.removeChild(dom.log.firstChild);
    if (history.length === 0) {
      dom.log.appendChild(dom.empty);
      dom.empty.style.display = '';
    } else {
      for (const ev of history) dom.log.appendChild(renderEvent(ev, palette));
    }
    scrollToEnd();
  };

  /** drawio 主题切换:重刷框架配色并按历史重渲染卡片,不丢会话内容 */
  const applyTheme = (): void => {
    palette = panelPalette(isDarkTheme(ui));
    restyleChrome(dom, palette);
    rerenderCards();
  };
  /** drawio 语言切换:重取 i18n 文案(框架 + 历史卡片) */
  const applyLocale = (): void => {
    dom.livePill.textContent = t('aiAgentLive', 'live');
    (dom.clearBtn as unknown as HTMLButtonElement).textContent = t('aiAgentClear', 'Clear');
    dom.empty.textContent = t('aiAgentEmpty', 'Waiting for a run — the agent’s distilled notes, review feedback and more will stream here.');
    dom.commandInput.placeholder = t('aiCommandPlaceholder', 'Instruct the agent, e.g. unify the term to AI Agent');
    (dom.sendBtn as unknown as HTMLButtonElement).textContent = t('aiSend', 'Send');
    rerenderCards();
  };
  const listenerHost = ui as unknown as { addListener?: (name: string, fn: () => void) => void };
  listenerHost.addListener?.('darkModeChanged', applyTheme);
  listenerHost.addListener?.('currentThemeChanged', applyTheme);
  listenerHost.addListener?.('languageChanged', applyLocale);

  let handle: AgentPanelHandle;
  handle = {
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

  // 拖左缘调宽
  dom.grip.addEventListener('mousedown', (down) => {
    down.preventDefault();
    const startX = (down as MouseEvent).clientX;
    const startW = dom.root.offsetWidth;
    const move = (mv: MouseEvent): void => {
      const w = Math.max(260, Math.min(640, startW + (startX - mv.clientX)));
      dom.root.style.width = `${w}px`;
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      try {
        window.localStorage.setItem('mmAgentPanelWidth', String(dom.root.offsetWidth));
      } catch { /* 忽略 */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // 常驻入口:并入右侧 Format 面板的 tab 行(与「绘图/样式」并列);
  // Format 每次选中变化会重建 DOM,挂 immediateRefresh 每次重挂
  const fmt = (ui as unknown as { format?: { container: HTMLElement; immediateRefresh: (...a: unknown[]) => void } }).format;
  if (fmt != null && typeof fmt.immediateRefresh === 'function') {
    const orig = fmt.immediateRefresh.bind(fmt);
    fmt.immediateRefresh = (...args: unknown[]) => {
      const r = orig(...args);
      try {
        const row = fmt.container.querySelector('.geFormatContent');
        if (row != null && row.querySelector('.mmAgentTab') == null) {
          const tab = document.createElement('div');
          tab.className = 'geFormatTitle mmAgentTab';
          tab.setAttribute('title', 'MindmapAI Agent');
          const label = document.createElement('div');
          mxUtils.write(label, 'AI Agent');
          tab.appendChild(label);
          tab.addEventListener('click', () => handle.toggle());
          row.appendChild(tab);
        }
      } catch { /* Format 结构变化时静默跳过 */ }
      return r;
    };
  }

  store.__mmAgentPanel = handle;
  return handle;
}

/* ---------- 事件 → 卡片 ---------- */

function renderEvent(event: AgentEvent, p: PanelPalette): HTMLElement {
  switch (event.type) {
    case 'stage':
      return renderStage(event.label, p);
    case 'notes':
      return renderNotes(event, p);
    case 'autotune':
      return renderAutotune(event, p);
    case 'skeleton':
      return renderSkeleton(event, p);
    case 'critique':
      return renderCritique(event, p);
    case 'revise':
      return renderRevise(event, p);
    case 'user':
      return renderLine(event.text, p.userText, p.userBg);
    case 'assistant':
      return renderLine(event.text, p.assistantText, p.assistantBg);
    case 'tool':
      return renderLine(`⚙ ${event.name} ${event.detail}`, p.toolText, p.toolBg);
    case 'node':
      return renderLine(
        `${event.updated === true ? '↻' : '＋'} ${event.label} (${event.total} ${t('aiAgentNodesWord', 'nodes')})`,
        p.okText, p.okBg,
      );
    case 'chart':
      return renderChart(event, p);
    case 'extras':
      return renderExtras(event, p);
    case 'done':
      return renderDone(event, p);
    case 'warn':
      return renderLine(event.text, p.warnText, p.warnBg);
    case 'info':
    default:
      return renderLine(event.type === 'info' ? event.text : '', p.toolText, p.toolBg);
  }
}

function renderStage(label: string, p: PanelPalette): HTMLElement {
  const row = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0 0 0;');
  row.appendChild(el('span', 'flex:0 0 auto;font-size:8pt;font-weight:bold;letter-spacing:0.06em;color:#6D28D9;text-transform:uppercase;', label));
  row.appendChild(el('span', `flex:1 1 auto;height:1px;background:${p.track};`));
  return row;
}

function renderNotes(event: Extract<AgentEvent, { type: 'notes' }>, p: PanelPalette): HTMLElement {
  const card = el('details', cardCss(p));
  const head = el('summary', `cursor:pointer;font-size:9pt;color:${p.text};`);
  const preview = event.notes.length > 0 ? event.notes[0].content : '';
  const more = event.notes.length > 1 ? ` ${t('aiAgentAndMore', `+${event.notes.length - 1}`)}` : '';
  head.textContent = `${t('aiAgentNotesWord', 'notes')} ${event.chunk}/${event.total} · ${event.notes.length}${more}${event.heading != null ? ` — ${event.heading}` : ''} · ${preview}`;
  card.appendChild(head);
  const list = el('ul', `margin:6px 0 0 0;padding-left:16px;font-size:9pt;color:${p.text2};`);
  for (const note of event.notes) {
    const li = document.createElement('li');
    li.style.marginBottom = '3px';
    li.appendChild(el('span', '', note.content));
    if (note.quote != null) {
      li.appendChild(el('div', quoteCss(p), `"${note.quote}"`));
    }
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

function renderAutotune(event: Extract<AgentEvent, { type: 'autotune' }>, p: PanelPalette): HTMLElement {
  const card = el('div', cardCss(p));
  card.appendChild(el('div', `font-size:9pt;color:${p.text};font-weight:bold;`, t('aiAgentAutotune', 'Auto-tuned parameters')));
  card.appendChild(el('div', `font-size:9pt;color:${p.text2};`, `${t('aiDepth', 'Depth')} ${event.depth} · ${t('aiMaxChildren', 'Branches')} ${event.maxChildren} · ${t('aiMaxNodes', 'Max nodes')} ${event.maxNodes}`));
  if (event.reason !== '') {
    card.appendChild(el('div', quoteCss(p), event.reason));
  }
  return card;
}

function renderSkeleton(event: Extract<AgentEvent, { type: 'skeleton' }>, p: PanelPalette): HTMLElement {
  const card = el('details', cardCss(p));
  const head = el('summary', `cursor:pointer;font-size:9pt;color:${p.text};`);
  head.textContent = `${t('aiAgentSkeleton', 'Section skeleton')} · ${event.sections.length}`;
  card.appendChild(head);
  const list = el('ul', `margin:6px 0 0 0;padding-left:16px;font-size:8.5pt;color:${p.text2};`);
  for (const sec of event.sections) {
    list.appendChild(el('li', 'margin-bottom:2px;', sec));
  }
  card.appendChild(list);
  return card;
}

function renderCritique(event: Extract<AgentEvent, { type: 'critique' }>, p: PanelPalette): HTMLElement {
  const card = el('div', `${cardCss(p)}border-color:${event.verdict === 'pass' ? p.okBorder : p.warnBorder};`);
  card.appendChild(el('div', `font-size:9pt;font-weight:bold;color:${p.text};`, t('aiAgentReview', 'AI review')));
  for (const score of SCORE_LABELS) {
    const value = event.scores[score.key];
    if (typeof value !== 'number') continue;
    const row = el('div', 'display:flex;align-items:center;gap:6px;margin:3px 0;');
    row.appendChild(el('span', `flex:0 0 64px;font-size:8pt;color:${p.text2};`, t(score.labelKey, score.fallback)));
    const barOuter = el('div', `flex:1 1 auto;height:5px;border-radius:3px;background:${p.track};overflow:hidden;`);
    const barFill = el('div', `height:100%;width:${Math.max(0, Math.min(100, value))}%;background:${score.color};`);
    barOuter.appendChild(barFill);
    row.appendChild(barOuter);
    row.appendChild(el('span', `flex:0 0 26px;font-size:8pt;color:${p.text2};text-align:right;`, String(value)));
    card.appendChild(row);
  }
  const verdictColor = event.verdict === 'pass' ? p.okText : p.warnText;
  card.appendChild(el('div', `margin-top:4px;font-size:8pt;font-weight:bold;color:${verdictColor};`, event.verdict === 'pass' ? t('aiAgentVerdictPass', 'PASS') : t('aiAgentVerdictRevise', 'NEEDS REVISION')));
  if (event.feedback !== '') {
    card.appendChild(el('div', quoteCss(p), event.feedback));
  }
  return card;
}

function renderRevise(event: Extract<AgentEvent, { type: 'revise' }>, p: PanelPalette): HTMLElement {
  const card = el('div', `${cardCss(p)}background:${p.warnBg};border-color:${p.warnBorder};`);
  card.appendChild(el('div', `font-size:9pt;font-weight:bold;color:${p.warnText};`, t('aiAgentRevising', 'Rebuilding map from review feedback...')));
  if (event.feedback !== '') {
    card.appendChild(el('div', quoteCss(p), event.feedback));
  }
  return card;
}

function renderChart(event: Extract<AgentEvent, { type: 'chart' }>, p: PanelPalette): HTMLElement {
  const range = event.index != null && event.total != null ? ` (${event.index}/${event.total})` : '';
  return renderLine(`✓ ${event.name} · ${event.nodes} ${t('aiAgentNodesWord', 'nodes')}${range}`, p.okText, p.okBg);
}

function renderExtras(event: Extract<AgentEvent, { type: 'extras' }>, p: PanelPalette): HTMLElement {
  const card = el('details', cardCss(p));
  const head = el('summary', `cursor:pointer;font-size:9pt;color:${p.text};`);
  head.textContent = `${t('aiAgentExtras', 'Composite canvas extras')} · ${event.minimaps.length} ${t('aiAgentMinimapsWord', 'minimaps')} · ${event.tableRows} ${t('aiAgentTableRowsWord', 'table rows')} · ${event.relations} ${t('aiAgentRelationsWord', 'relations')}`;
  card.appendChild(head);
  for (const mini of event.minimaps) {
    card.appendChild(el('div', `font-size:8.5pt;color:${p.text2};margin-top:3px;`, `• ${mini.title} (${mini.items})`));
  }
  return card;
}

function renderDone(event: Extract<AgentEvent, { type: 'done' }>, p: PanelPalette): HTMLElement {
  const card = el('div', `${cardCss(p)}background:${p.okBg};border-color:${p.okBorder};`);
  card.appendChild(el('div', `font-size:9pt;font-weight:bold;color:${p.okText};`, `✓ ${t('aiAgentDone', 'Done')} — ${event.summary}`));
  return card;
}

function renderLine(text: string, color: string, background: string): HTMLElement {
  const line = el('div', `font-size:9pt;color:${color};background:${background};border-radius:6px;padding:4px 8px;`, text);
  return line;
}
