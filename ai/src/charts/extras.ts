/**
 * 复合画布 extras:支线小思维导图(泳道容器)、要点表格、关系图。
 * 全部确定性几何布局,输出 ChartElement[](buildChartElements 统一入画布)。
 */

import type { ChartElement } from './layout';
import { resolveShape } from './shapes';

export interface ExtrasSlots {
  minimaps: Array<{ title: string; items: string[] }>;
  table: { title: string; headers: string[]; rows: string[][] };
  relations: Array<{ from: string; label: string; to: string }>;
}

const V = (label: string, style: string, x: number, y: number, w: number, h: number): ChartElement => ({
  kind: 'vertex', label, style, x, y, w, h,
});
const E = (from: number, to: number, label = '', style = ''): ChartElement => ({
  kind: 'edge', from, to, label,
  style: style !== '' ? style : 'edgeStyle=none;rounded=1;html=1;endArrow=none;strokeWidth=1.5;strokeColor=#6C8EBF;',
});

const MM = 'mindmapAI=1;';
const FILL_BLUE = 'fillColor=#DAE8FC;strokeColor=#6C8EBF;';
const FILL_GREEN = 'fillColor=#D5E8D4;strokeColor=#82B366;';
const FILL_ORANGE = 'fillColor=#FFE6CC;strokeColor=#D79B00;';
const FILL_YELLOW = 'fillColor=#FFF2CC;strokeColor=#D6B656;';

/** 校验并清洗 extras 槽位;形状不对返回 null */
export function parseExtrasSlots(raw: string): ExtrasSlots | null {
  // 容错解析:去 ``` 围栏/截取大括号/去尾逗号(与 schema 同阶梯)
  let candidate = raw.trim();
  const fenced = candidate.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?\s*```$/);
  if (fenced != null) candidate = fenced[1].trim();
  else if (candidate.startsWith('```')) candidate = candidate.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  if (!candidate.startsWith('{')) {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) candidate = candidate.slice(first, last + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const minimaps: ExtrasSlots['minimaps'] = [];
  if (Array.isArray(obj.minimaps)) {
    for (const m of obj.minimaps) {
      if (m == null || typeof m !== 'object') continue;
      const o = m as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const items = Array.isArray(o.items)
        ? o.items.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
        : [];
      if (title !== '' && items.length >= 2) minimaps.push({ title, items: items.slice(0, 6) });
    }
  }
  const table: ExtrasSlots['table'] = { title: '', headers: [], rows: [] };
  if (obj.table != null && typeof obj.table === 'object' && !Array.isArray(obj.table)) {
    const t = obj.table as Record<string, unknown>;
    table.title = typeof t.title === 'string' ? t.title.trim().slice(0, 60) : '';
    if (Array.isArray(t.headers)) {
      table.headers = t.headers
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim().slice(0, 20))
        .slice(0, 3);
    }
    if (Array.isArray(t.rows)) {
      for (const r of t.rows) {
        if (!Array.isArray(r)) continue;
        const row = r.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 30));
        if (row.length === table.headers.length) table.rows.push(row);
        if (table.rows.length >= 8) break;
      }
    }
  }
  const relations: ExtrasSlots['relations'] = [];
  if (Array.isArray(obj.relations)) {
    for (const r of obj.relations) {
      if (r == null || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const from = typeof o.from === 'string' ? o.from.trim().slice(0, 20) : '';
      const to = typeof o.to === 'string' ? o.to.trim().slice(0, 20) : '';
      const label = typeof o.label === 'string' ? o.label.trim().slice(0, 20) : '';
      if (from !== '' && to !== '') relations.push({ from, label, to });
      if (relations.length >= 5) break;
    }
  }
  if (minimaps.length === 0 && table.rows.length === 0 && relations.length === 0) return null;
  return { minimaps: minimaps.slice(0, 3), table, relations: relations.slice(0, 5) };
}

/** extras → ChartElement[](纵向堆叠:支线小图 → 表格 → 关系图) */
export function layoutExtras(slots: ExtrasSlots): ChartElement[] {
  const els: ChartElement[] = [];
  let y = 0;
  let maxW = 0;

  // 支线小思维导图:泳道容器 + 标题 + 要点椭圆
  for (const mini of slots.minimaps) {
    const h = 80 + mini.items.length * 55;
    const w = 360;
    els.push(V(mini.title, `swimlane;startSize=30;html=1;rounded=1;fontSize=13;${FILL_BLUE}${MM}`, 0, y, w, h));
    mini.items.forEach((item, j) => {
      els.push(V(item, `${resolveShape('ellipse', 'ellipse')}${FILL_YELLOW}`, 30, y + 50 + j * 55, 280, 45));
    });
    y += h + 40;
    maxW = Math.max(maxW, w);
  }

  // 要点表格:标题 + 表头 + 数据行
  if (slots.table.rows.length > 0 && slots.table.headers.length > 0) {
    const cols = slots.table.headers.length;
    const colW = 160;
    const rowH = 40;
    if (slots.table.title !== '') {
      els.push(V(slots.table.title, `text;html=1;align=left;fontStyle=1;fontSize=12;${MM}`, 0, y + 6, colW * cols, 28));
      y += 44;
    }
    slots.table.headers.forEach((hh, i) => {
      els.push(V(hh, `whiteSpace=wrap;html=1;${FILL_GREEN}${MM}`, i * colW, y, colW, rowH));
    });
    y += rowH;
    for (const row of slots.table.rows) {
      row.forEach((cell, i) => {
        els.push(V(cell, `whiteSpace=wrap;html=1;${MM}`, i * colW, y, colW, rowH));
      });
      y += rowH;
    }
    maxW = Math.max(maxW, cols * colW);
    y += 40;
  }

  // 关系图:去重节点左右两列 + 标注连线
  if (slots.relations.length > 0) {
    els.push(V('关键关系', `text;html=1;align=left;fontStyle=1;fontSize=12;${MM}`, 0, y + 6, 200, 28));
    y += 44;
    const nodePos = new Map<string, { x: number; y: number; idx: number }>();
    const nodeOf = (name: string, side: 'left' | 'right'): { x: number; y: number; idx: number } => {
      const existing = nodePos.get(`${side}:${name}`);
      if (existing != null) return existing;
      const peers = [...nodePos.entries()].filter(([k]) => k.startsWith(`${side}:`));
      const idx = els.push(
        V(name, `${resolveShape('process', 'process')}${side === 'left' ? FILL_BLUE : FILL_ORANGE}rounded=1;`, side === 'left' ? 40 : 420, y + peers.length * 70, 160, 50)
      ) - 1;
      const pos = { x: side === 'left' ? 40 : 420, y: y + peers.length * 70, idx };
      nodePos.set(`${side}:${name}`, pos);
      return pos;
    };
    for (const rel of slots.relations) {
      const from = nodeOf(rel.from, 'left');
      const to = nodeOf(rel.to, 'right');
      els.push(E(from.idx, to.idx, rel.label, 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeWidth=1.5;strokeColor=#9673A6;'));
    }
    const relCount = Math.max(1, slots.relations.length);
    maxW = Math.max(maxW, 620);
    y += Math.max(2, Math.ceil(relCount / 1)) * 70 + 20;
  }

  void maxW;
  return els;
}
