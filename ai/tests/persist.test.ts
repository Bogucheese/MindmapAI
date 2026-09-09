// @vitest-environment happy-dom
/**
 * 溯源持久化测试：mm-quotes 值节点 + cellLabelText 兼容 + tooltip 覆盖读取。
 */

import { describe, expect, it } from 'vitest';
import { cellLabelText, installQuoteTooltips, makeCellValue } from '../src/mindmap/tree-model';

describe('makeCellValue / cellLabelText', () => {
  it('creates an Object node with label and mm-quotes when extra present', () => {
    const v = makeCellValue('节点A', '“引文内容”');
    expect(typeof v).toBe('object');
    const el = v as Element;
    // 真实浏览器 XML 文档保留 'Object' 原样大小写(drawio 解码依赖);
    // happy-dom 会大写,故用不区分大小写的断言
    expect(/object/i.test(el.tagName)).toBe(true);
    expect(el.getAttribute('label')).toBe('节点A');
    expect(el.getAttribute('mm-quotes')).toBe('“引文内容”');
  });

  it('keeps plain string value when no extra', () => {
    expect(makeCellValue('纯文本')).toBe('纯文本');
    expect(makeCellValue('纯文本', '   ')).toBe('纯文本');
  });

  it('cellLabelText reads both string values and Object label attributes', () => {
    expect(cellLabelText({ getValue: () => 'str-value' })).toBe('str-value');
    expect(cellLabelText({ getValue: () => makeCellValue('标签', '引文') })).toBe('标签');
    expect(cellLabelText({ getValue: () => null })).toBe('');
    expect(cellLabelText(null)).toBe('');
  });
});

describe('installQuoteTooltips', () => {
  it('replaces native tooltip with FULL quotes (idempotent, no truncation)', () => {
    const longQuote = '“' + '很长的引文'.repeat(30) + '”';
    const cellWithQuote = { getValue: () => makeCellValue('X', `“短引文”\n${longQuote}\n“第三条”`) };
    const cellPlain = { getValue: () => 'plain' };
    const graph: any = {
      getTooltipForCell: (c: any) => (c === cellWithQuote ? '冗长的属性表' : 'plain'),
      getModel: () => ({ getValue: (c: any) => c.getValue() }),
    };
    installQuoteTooltips(graph);
    installQuoteTooltips(graph); // 幂等
    const tip = String(graph.getTooltipForCell(cellWithQuote));
    // 完全接管:不再包含原生属性表;全部引文完整展示(用户要求)
    expect(tip).not.toContain('冗长的属性表');
    expect(tip).toContain('“短引文”');
    expect(tip).toContain(longQuote);
    expect(tip).toContain('“第三条”');
    expect(graph.getTooltipForCell(cellPlain)).toBe('');
  });
});
