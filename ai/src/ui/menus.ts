/**
 * 菜单注册。
 *
 * drawio 顶部菜单栏会在 languageChanged / currentThemeChanged 时按
 * Menus.prototype.defaultMenuItems 白名单整体重建（grapheditor/Menus.js
 * createMenubar），插件直接塞进 DOM 的元素会被抹掉。正确做法：
 *   1. 菜单 id 必须有同名资源 key（白名单用 mxResources.get(id) 取 label，
 *      drawio 对缺失 key 的回退是返回 key 本身，会显示成小写 id）；
 *   2. ui.menus.put(id, menu) 必须传 Menu 实例而非裸函数——重建时
 *      menuCreated 会调 menu.addListener，裸函数会抛 TypeError 中断重建，
 *      导致排在后面的 help 等菜单消失；
 *   3. 把菜单 id 插入 defaultMenuItems（help 之前），每次重建自动出现。
 * menubar.addMenu 直接追加仅作为插件晚于菜单栏构建时的兜底，重建后由
 * 白名单机制接管。
 */

import { parseResourceStrings, t } from '../i18n/keys';
import { MM_MARKER } from '../mindmap/styles';
import { expandNodeFlow } from './expand';
import { readChartSlots } from '../mindmap/tree-model';
import { showChartEditDialog } from './chart-edit';

export const AI_MENU_KEY = 'aiMindmap';

export function registerMenus(ui: DrawioPluginApi): void {
  parseResourceStrings();

  ui.menus.put(AI_MENU_KEY, new Menu(function (menu, parent) {
    ui.menus.addMenuItem(menu, 'aiGenerate', parent);
    ui.menus.addMenuItem(menu, 'aiAgentPanel', parent);
    ui.menus.addMenuItem(menu, 'aiSummarize', parent);
    ui.menus.addMenuItem(menu, 'aiShapeGallery', parent);
    // 图表槽位记忆存在(本会话生成过图表)时提供「AI 修改当前图表」
    const chartMemory = readChartSlots(ui.editor.graph);
    if (chartMemory != null) {
      ui.menus.addMenuItem(menu, 'aiChartEdit', parent);
    }
    ui.menus.addMenuItem(menu, 'aiDemo', parent);
    ui.menus.addMenuItem(menu, 'aiSettings', parent);
  }));

  const items = ui.menus.defaultMenuItems as string[] | undefined;
  if (Array.isArray(items) && items.indexOf(AI_MENU_KEY) < 0) {
    const helpIdx = items.indexOf('help');
    if (helpIdx >= 0) {
      items.splice(helpIdx, 0, AI_MENU_KEY);
    } else {
      items.push(AI_MENU_KEY);
    }
  }

  // 兜底：若菜单栏已构建（本插件通常晚于 App.createUi 执行），把 AI 菜单
  // 插到 Help 之前，与白名单重建后的位置一致；后续语言/主题切换重建由
  // 上面的白名单机制接管。
  // Menubar.addMenu 会把元素 className 设为 'geMenubar'（供工具栏按钮用，
  // 块级布局会占满整行、窄窗口下溢出屏幕），drawio 自身调用后都会覆盖
  // 回目标样式——顶部菜单项必须改回 'geItem'。
  if (ui.menubar != null && typeof ui.menubar.addMenu === 'function') {
    const container = ui.menubar.container;
    const helpText = String(mxResources.get('help'));
    const helpElt = (Array.from(container.children) as HTMLElement[]).find(
      (el) => (el.textContent || '').trim() === helpText
    );
    const elt = ui.menubar.addMenu(t(AI_MENU_KEY, 'AI'), function (menu, parent) {
      ui.menus.addMenuItem(menu, 'aiGenerate', parent);
      ui.menus.addMenuItem(menu, 'aiAgentPanel', parent);
      ui.menus.addMenuItem(menu, 'aiSummarize', parent);
      ui.menus.addMenuItem(menu, 'aiShapeGallery', parent);
      if (readChartSlots(ui.editor.graph) != null) {
        ui.menus.addMenuItem(menu, 'aiChartEdit', parent);
      }
      ui.menus.addMenuItem(menu, 'aiDemo', parent);
      ui.menus.addMenuItem(menu, 'aiSettings', parent);
    }, helpElt);
    if (elt) {
      elt.className = 'geItem';
    }
  }
}

/**
 * 右键菜单入口：空白处右键追加"生成思维导图"；本插件生成的导图节点
 * 右键追加"扩展节点"（懒展开：带路径上下文生成一层新子节点）。
 * Menus.prototype.createPopupMenu 是原型方法、经 ui.menus 实例分发
 * （grapheditor/EditorUi.js:804-808），按实例覆盖并链调原实现；
 * smartSeparators 由原方法开启，addSeparator 会自动去重。
 */
export function registerPopupMenu(ui: DrawioPluginApi): void {
  const original = ui.menus.createPopupMenu;
  ui.menus.createPopupMenu = function (menu: any, cell: any, evt: any) {
    original.call(this, menu, cell, evt);
    if (cell == null) {
      menu.addSeparator(null);
      ui.menus.addMenuItem(menu, 'aiGenerate', null);
      // 图表槽位记忆存在时提供「AI 修改此图」(基于上次生成的槽位增量修改)
      const g = ui.editor.graph;
      if (g != null && (g as any).__mmChartSlots != null) {
        menu.addItem(t('aiChartEdit', 'Edit this chart with AI…'), null, function () {
          showChartEditDialog(ui);
        }, null, null, true);
      }
      return;
    }
    // 本插件生成的导图节点：追加"扩展节点"（用户绘制的顶点不显示）
    const model = ui.editor.graph.getModel();
    const isMindmapVertex =
      typeof cell.isVertex === 'function' &&
      cell.isVertex() &&
      String(model.getStyle(cell) || '').includes(MM_MARKER);
    if (isMindmapVertex) {
      menu.addSeparator(null);
      menu.addItem(t('aiExpand', 'Expand node'), null, function () {
        expandNodeFlow(ui, cell);
      }, null, null, true);
      // 图表槽位记忆存在(会话或文件内)时,顶点右键同样提供 AI 修改入口
      if (readChartSlots(ui.editor.graph) != null) {
        menu.addItem(t('aiChartEdit', 'Edit this chart with AI…'), null, function () {
          showChartEditDialog(ui);
        }, null, null, true);
      }
    }
  };
}
