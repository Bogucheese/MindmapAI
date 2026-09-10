import { describe, expect, it } from 'vitest';
import type { MindmapTree } from '../src/ai/schema';
import {
  FLAT_LIST_THRESHOLD,
  dedupeSiblingLabels,
  findStructureIssues,
  normalizeLabel,
} from '../src/agent/validate';

const leaf = (label: string, noteIds?: string[]): MindmapTree => ({
  label,
  ...(noteIds != null ? { source: { noteIds } } : {}),
});

describe('normalizeLabel', () => {
  it('folds case, whitespace and trailing punctuation', () => {
    expect(normalizeLabel('  AI Agent！ ')).toBe('aiagent');
    expect(normalizeLabel('AI agent。')).toBe('aiagent');
    expect(normalizeLabel('核心-结构（一）')).toBe('核心结构一');
  });

  it('keeps distinct labels distinct', () => {
    expect(normalizeLabel('规划')).not.toBe(normalizeLabel('记忆'));
  });
});

describe('dedupeSiblingLabels', () => {
  it('merges same-label siblings and unions noteIds', () => {
    const tree: MindmapTree = {
      label: 'R',
      children: [
        leaf('AI Agent', ['n1']),
        leaf('AI Agent。', ['n2']),
        leaf('记忆', ['n3']),
      ],
    };
    const { tree: out, merged } = dedupeSiblingLabels(tree);
    expect(merged).toBe(1);
    expect(out.children).toHaveLength(2);
    expect(out.children![0].source?.noteIds).toEqual(['n1', 'n2']);
  });

  it('merges same-label subtrees recursively (children concatenated, re-deduped)', () => {
    const tree: MindmapTree = {
      label: 'R',
      children: [
        { label: '能力', children: [leaf('规划'), leaf('记忆')] },
        { label: '能力 ', children: [leaf('记忆'), leaf('工具')] },
      ],
    };
    const { tree: out, merged } = dedupeSiblingLabels(tree);
    expect(merged).toBe(2); // 能力×2 一次 + 拼接后 记忆×2 一次
    expect(out.children).toHaveLength(1);
    expect(out.children![0].children!.map((c) => c.label)).toEqual(['规划', '记忆', '工具']);
  });

  it('does not mutate the input tree', () => {
    const tree: MindmapTree = {
      label: 'R',
      children: [leaf('A', ['n1']), leaf('A', ['n2'])],
    };
    const snapshot = JSON.stringify(tree);
    dedupeSiblingLabels(tree);
    expect(JSON.stringify(tree)).toBe(snapshot);
  });

  it('keeps different labels untouched', () => {
    const tree: MindmapTree = { label: 'R', children: [leaf('规划'), leaf('工具调用')] };
    const { tree: out, merged } = dedupeSiblingLabels(tree);
    expect(merged).toBe(0);
    expect(out.children).toHaveLength(2);
  });
});

describe('findStructureIssues', () => {
  it('reports the same label under different parents', () => {
    const tree: MindmapTree = {
      label: 'R',
      children: [
        { label: '组成', children: [leaf('规划')] },
        { label: '能力', children: [leaf('规划')] },
      ],
    };
    const issues = findStructureIssues(tree);
    expect(issues.some((s) => s.includes('duplicate label "规划"'))).toBe(true);
  });

  it('reports flat lists beyond the threshold', () => {
    const many = Array.from({ length: FLAT_LIST_THRESHOLD + 1 }, (_, i) => leaf(`工具${i}`));
    const tree: MindmapTree = { label: 'R', children: [{ label: '学习资源', children: many }] };
    expect(findStructureIssues(tree).some((s) => s.includes('flat leaf children'))).toBe(true);
  });

  it('stays silent on a clean tree', () => {
    const tree: MindmapTree = {
      label: 'R',
      children: [{ label: '组成', children: [leaf('规划'), leaf('记忆')] }],
    };
    expect(findStructureIssues(tree)).toEqual([]);
  });
});
