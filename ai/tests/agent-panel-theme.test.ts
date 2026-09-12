// @vitest-environment happy-dom
/**
 * Agent 面板主题测试(happy-dom):浅色/深色调色板完备;构建按主题着色;
 * currentThemeChanged 事件后框架重着色且按历史重渲染卡片(不丢会话)。
 */

import { describe, expect, it } from 'vitest';
import { ensureAgentPanel, isDarkTheme, panelPalette, type PanelPalette } from '../src/ui/agent-panel';

const REQUIRED_KEYS: Array<keyof PanelPalette> = [
  'bg', 'headerBg', 'border', 'text', 'text2', 'quote', 'empty',
  'cardBg', 'cardBorder', 'inputBg', 'inputBorder',
  'toolBg', 'toolText', 'assistantBg', 'assistantText', 'userBg', 'userText',
  'okBg', 'okBorder', 'okText', 'warnBg', 'warnBorder', 'warnText',
  'liveBg', 'liveText', 'track',
];

describe('panelPalette', () => {
  it('provides complete, distinct palettes for both themes', () => {
    const light = panelPalette(false);
    const dark = panelPalette(true);
    for (const key of REQUIRED_KEYS) {
      expect(light[key], `light.${key}`).toMatch(/^#/);
      expect(dark[key], `dark.${key}`).toMatch(/^#/);
    }
    expect(dark.bg).not.toBe(light.bg);
    expect(dark.cardBg).not.toBe(light.cardBg);
    expect(dark.text).not.toBe(light.text);
    // 暗色面板必须是真正的深色底(用户诉求:黑色主题)
    expect(parseInt(dark.bg.slice(1, 3), 16)).toBeLessThan(0x60);
  });
});

function fakeUi(theme: string): {
  ui: Record<string, unknown>;
  fire: (name: string) => void;
} {
  const listeners = new Map<string, Array<() => void>>();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ui: Record<string, unknown> = {
    theme,
    editor: { graph: { container } },
    addListener: (name: string, fn: () => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
  };
  return {
    ui,
    fire: (name) => {
      for (const fn of listeners.get(name) ?? []) fn();
    },
  };
}

function rootOf(): HTMLDivElement {
  const roots = Array.from(document.body.children).filter(
    (c) => (c as HTMLDivElement).style?.zIndex === '100000'
  ) as HTMLDivElement[];
  expect(roots.length).toBeGreaterThan(0);
  return roots[roots.length - 1];
}

describe('agent panel theming', () => {
  it('isDarkTheme: Editor.darkMode 优先,currentTheme/ui.theme 兜底', () => {
    const g = globalThis as { Editor?: { darkMode?: unknown; currentTheme?: string } };
    try {
      g.Editor = { darkMode: true, currentTheme: 'kennedy' };
      expect(isDarkTheme({})).toBe(true); // darkMode 布尔是权威信号
      g.Editor = { darkMode: false, currentTheme: 'dark' };
      expect(isDarkTheme({ theme: 'dark' })).toBe(false); // darkMode=false 直接判亮
      g.Editor = { currentTheme: 'dark' };
      expect(isDarkTheme({})).toBe(true); // 无 darkMode 时回退 currentTheme
      g.Editor = { currentTheme: '' };
      expect(isDarkTheme({ theme: 'dark' })).toBe(true); // 空值回退 ui.theme
    } finally {
      delete g.Editor;
    }
    expect(isDarkTheme({ theme: 'dark' })).toBe(true);
    expect(isDarkTheme({ theme: 'light' })).toBe(false);
    expect(isDarkTheme(null)).toBe(false);
    // happy-dom 的 matchMedia 默认不匹配暗色
    expect(isDarkTheme({ theme: 'auto' })).toBe(false);
  });

  it('builds with dark chrome when Editor.darkMode, restyles on theme events', () => {
    const g = globalThis as { Editor?: { darkMode?: unknown; currentTheme?: string } };
    g.Editor = { darkMode: true, currentTheme: 'kennedy' };
    const { ui, fire } = fakeUi('dark');
    try {
      const handle = ensureAgentPanel(ui as never);
      const root = rootOf();
      const dark = panelPalette(true);
      const light = panelPalette(false);
      expect(root.style.background).toBe(dark.bg);
      // 初始隐藏:生成流程显式 show;菜单首次 toggle 为打开
      expect(root.style.display).toBe('none');
      handle.show();
      expect(root.style.display).toBe('flex');

      // 有历史事件时切浅色(darkModeChanged):卡片重渲染、内容不丢
      handle.append({ type: 'user', text: 'hello theme' });
      g.Editor = { darkMode: false, currentTheme: 'kennedy' };
      fire('darkModeChanged');
      expect(root.style.background).toBe(light.bg);
      // root 子元素顺序:[grip, header, log, inputRow]
      const log = root.children[2] as HTMLDivElement;
      expect(log.textContent).toContain('hello theme');
      const userLine = Array.from(log.querySelectorAll('div')).find(
        (d) => d.textContent === 'hello theme'
      ) as HTMLDivElement;
      expect(userLine.style.background).toBe(light.userBg);

      // 再切回深色(currentThemeChanged 也监听):同一历史换成深色卡片
      g.Editor = { darkMode: true };
      fire('currentThemeChanged');
      expect(root.style.background).toBe(dark.bg);
      const userLineDark = Array.from((root.children[2] as HTMLDivElement).querySelectorAll('div')).find(
        (d) => d.textContent === 'hello theme'
      ) as HTMLDivElement;
      expect(userLineDark.style.background).toBe(dark.userBg);

      // 清理:面板是模块级单例,避免污染其它用例
      root.remove();
      delete (ui as Record<string, unknown>).__mmAgentPanel;
    } finally {
      delete g.Editor;
    }
  });

  it('re-renders chrome and cards on languageChanged (i18n follows)', () => {
    const g = globalThis as {
      mxResources?: { get: (k: string, d: unknown, fb: string) => string; resources?: Record<string, string> };
    };
    const ZH: Record<string, string> = {
      aiAgentEmpty: '等待一次运行——提炼要点、评审意见等内容将在此流出。',
      aiSend: '发送',
      aiAgentLive: '实时',
    };
    g.mxResources = { get: (k, _d, fb) => ZH[k] ?? fb, resources: ZH };
    const { ui, fire } = fakeUi('light');
    try {
      ensureAgentPanel(ui as never);
      const root = rootOf();
      const log = root.children[2] as HTMLDivElement;
      const inputRow = root.children[3] as HTMLDivElement;
      const sendBtn = inputRow.querySelector('button') as HTMLButtonElement;
      // 初始:中文文案
      expect((log.firstElementChild as HTMLDivElement).textContent).toBe(ZH.aiAgentEmpty);
      expect(sendBtn.textContent).toBe(ZH.aiSend);

      // 切英文:替换资源表并派发 languageChanged
      const EN: Record<string, string> = {
        aiAgentEmpty: 'Waiting for a run.',
        aiSend: 'Send',
        aiAgentLive: 'live',
      };
      g.mxResources = { get: (k, _d, fb) => EN[k] ?? fb, resources: EN };
      fire('languageChanged');
      expect((log.firstElementChild as HTMLDivElement).textContent).toBe(EN.aiAgentEmpty);
      expect(sendBtn.textContent).toBe(EN.aiSend);

      root.remove();
      delete (ui as Record<string, unknown>).__mmAgentPanel;
    } finally {
      delete g.mxResources;
    }
  });
});
