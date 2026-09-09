/**
 * MindmapAI — AI 思维导图插件入口。
 *
 * 以 drawio "内部插件" 形式集成：经 Draw.loadPlugin(ui => ...) 拿到 EditorUi
 * 实例后注册 action / 菜单 / 对话框（官方注释称这是唯一长期支持的 EditorUi
 * 访问入口，见 js/diagramly/App.js 的 initPluginCallback）。
 *
 * 加载时序兜底：本 bundle 由 js/bootstrap.js 经 mxscript 注入，正常情况在
 * app.min.js（prod）或 Devel.js（dev）之后执行，window.Draw 已定义；若因
 * 时序问题 Draw 尚未就绪，按固定间隔重试一小段时间。
 */

import { registerActions } from './ui/actions';
import { registerMenus, registerPopupMenu } from './ui/menus';

const LOAD_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 100;

function registerPlugin(ui: DrawioPluginApi): void {
  // 品牌：标题用本产品名（上游 Editor.prototype.appName 硬编码 'draw.io'）
  ui.editor.appName = 'MindmapAI';
  ui.updateDocumentTitle?.();
  registerActions(ui);
  registerMenus(ui);
  registerPopupMenu(ui);
  // 调试句柄：控制台可用 MindmapAI.ui.editor.graph 检查模型/几何
  (window as unknown as { MindmapAI?: unknown }).MindmapAI = { ui };
  console.info('[MindmapAI] plugin registered');
}

function tryRegister(): void {
  const started = Date.now();
  const attempt = (): void => {
    const draw = window.Draw;
    if (draw != null && typeof draw.loadPlugin === 'function') {
      draw.loadPlugin(registerPlugin);
      return;
    }
    if (Date.now() - started < LOAD_TIMEOUT_MS) {
      window.setTimeout(attempt, RETRY_INTERVAL_MS);
    } else {
      console.warn('[MindmapAI] window.Draw.loadPlugin not available after timeout; plugin not registered.');
    }
  };
  attempt();
}

tryRegister();

export {};
