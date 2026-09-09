/**
 * drawio 全局符号的类型声明。
 *
 * drawio 应用代码是 ES5 风格的全局脚本（无模块系统），我们的 bundle 以
 * "内部插件" 形式运行在这些全局之上。drawio 交互统一收敛在本文件与各模块
 * 顶部的窄接口里，内部模块保持类型安全；将来要收紧时只需改这里。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const mxResources: any;
declare const mxUtils: any;
declare const mxClient: any;
declare const mxEvent: any;
declare const mxRadialTreeLayout: any;
declare const mxCompactTreeLayout: any;
/** grapheditor 菜单对象（mxEventSource 子类）；menus.put 需要 Menu 实例而非裸函数 */
declare const Menu: {
  new (funct: (menu: any, parent?: any) => void, enabled?: boolean): any;
};

interface DrawioPluginApi {
  /** 注册 action；label 解析为 mxResources key（key 去掉尾部 ...） */
  actions: {
    addAction(key: string, funct: (evt?: any) => void, enabled?: boolean, iconCls?: string, shortcut?: string, visible?: boolean): any;
    get(key: string): any;
  };
  /** 顶部菜单栏；addMenu(label, fn, before?) — fn 收到 (menu, parent)，返回创建的元素 */
  menubar: {
    addMenu(label: string, fn: (menu: any, parent: any) => void, before?: HTMLElement): any;
    container: HTMLElement;
  };
  /** 菜单工具；createPopupMenu 为实例方法，可按实例覆盖做右键扩展 */
  menus: {
    defaultMenuItems: string[];
    addMenuItem(menu: any, key: string, parent?: any, trigger?: any, sprite?: any, label?: string): any;
    addMenuItems(menu: any, keys: string[], parent?: any, start?: number, end?: number): any;
    addSubmenu(name: string, menu: any, parent: any, label?: string): any;
    createPopupMenu(menu: any, cell: any, evt: any): void;
    put(name: string, menu: any): any;
  };
  /** 当前编辑器图实例（mxGraph 子类）；cancelFirst 决定取消按钮排列顺序 */
  editor: { graph: any; cancelFirst?: boolean; appName?: string };
  /** 重算 document.title（filename - editor.appName） */
  updateDocumentTitle?: () => void;
  /** 对话框：ui.showDialog(elt, w, h, modal, closable, onClose?, noScroll?, ...)；h=null 自动量高 */
  showDialog(elt: HTMLElement, w: number, h: number | null, modal: boolean, closable: boolean, onClose?: () => void, noScroll?: boolean, transparent?: boolean, minSize?: any, ignoreBgClick?: boolean, persistenceKey?: string): void;
  hideDialog(cancel?: boolean, isEsc?: boolean, matchContainer?: any): void;
  /** 加载指示器；spin 返回 false 表示已有活动指示（GitHubClient 先例：容器可为对话框内节点） */
  spinner: {
    spin(container: HTMLElement, label?: string, error?: () => void, timeout?: number): boolean;
    stop(): void;
  };
  keyHandler: any;
  sidebar: any;
  toolbar: any;
  container: HTMLElement;
  [key: string]: any;
}

interface Window {
  Draw?: {
    loadPlugin(fn: (ui: DrawioPluginApi) => void): void;
  };
  MindmapAI?: unknown;
  /** drawio-desktop preload 注入的 IPC 桥（存在即认定 Electron 环境） */
  electron?: unknown;
  process?: { type?: string; versions?: unknown };
}
