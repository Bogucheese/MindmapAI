/**
 * 导图确定性校验与修复（不依赖模型）。
 *
 * 模型评审（critique）负责语义层问题；这里处理可以精确判定的两类：
 * 1. 同级重复：同一父节点下归一化后同名的子树 —— 自动合并（noteIds 取并集、
 *    children 递归合并），这是"同一概念出现两个节点"的硬性缺陷，能修就修；
 * 2. 结构报告：跨分支重复、超过扁平阈值的叶子列表 —— 无法安全自动修复，
 *    以 findings 形式交给 critique 一并评分。
 *
 * 术语变体（如 Agent / AI Agent）的判定需要语义理解，代码层不做启发式
 * 猜测（子串匹配误报率高），由 architect/critique prompt 的术语一致性规则
 * 约束。
 */

import type { MindmapTree } from '../ai/schema';

/** 跨分支重复、扁平列表报告给 critique 时的阈值（与"同级节点 ≤8"的导图惯例一致）。 */
export const FLAT_LIST_THRESHOLD = 8;

export function normalizeLabel(label: string): string {
  // 去除全部标点/符号/空白（中英文皆含），仅保留文字与数字，用于同名判定
  return label.toLowerCase().replace(/[\p{P}\p{S}\s\u3000]+/gu, '');
}

function mergeNoteIds(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a == null && b == null) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * 合并同级归一化同名的节点：保留首个，并集 noteIds、拼接 children（递归
 * 去重）。返回新树，不动入参。
 */
export function dedupeSiblingLabels(tree: MindmapTree): { tree: MindmapTree; merged: number } {
  let merged = 0;
  const dedupeLevel = (children: MindmapTree[]): MindmapTree[] => {
    const kept: MindmapTree[] = [];
    const byKey = new Map<string, MindmapTree>();
    for (const raw of children) {
      // 总是浅拷贝，合并时对 prev.children 的修改不会污染调用方的原树
      const child: MindmapTree =
        raw.children != null ? { ...raw, children: dedupeLevel(raw.children) } : { ...raw };
      const key = normalizeLabel(child.label);
      const prev = key !== '' ? byKey.get(key) : undefined;
      if (prev == null) {
        if (key !== '') byKey.set(key, child);
        kept.push(child);
      } else {
        merged += 1;
        prev.source = { noteIds: mergeNoteIds(prev.source?.noteIds, child.source?.noteIds) ?? [] };
        if (child.children != null) {
          // 两棵同名子树拼接后，其子级可能再次同名——重新走一遍同级去重
          prev.children = dedupeLevel([...(prev.children ?? []), ...child.children]);
        }
      }
    }
    return kept;
  };
  const result: MindmapTree =
    tree.children != null ? { ...tree, children: dedupeLevel(tree.children) } : { ...tree };
  return { tree: result, merged };
}

function collectPaths(
  node: MindmapTree,
  parentKey: string,
  leafParents: Map<string, string[]>,
  labelParents: Map<string, Set<string>>
): void {
  const key = normalizeLabel(node.label);
  if (key !== '' && parentKey !== '') {
    let set = labelParents.get(key);
    if (set == null) {
      set = new Set();
      labelParents.set(key, set);
    }
    set.add(parentKey);
  }
  if (node.children == null || node.children.length === 0) {
    let list = leafParents.get(parentKey);
    if (list == null) {
      list = [];
      leafParents.set(parentKey, list);
    }
    list.push(key);
    return;
  }
  for (const child of node.children) {
    collectPaths(child, key, leafParents, labelParents);
  }
}

/**
 * 结构检查报告（仅报告，不修复）：
 * - cross-branch duplicate: 同一标签出现在不同直接父节点下（是否真重复由
 *   critique 结合语义判断）；
 * - flat list: 某节点下超过 FLAT_LIST_THRESHOLD 个叶子、无中间分组。
 */
export function findStructureIssues(tree: MindmapTree): string[] {
  const leafParents = new Map<string, string[]>();
  const labelParents = new Map<string, Set<string>>();
  collectPaths(tree, '', leafParents, labelParents);

  const issues: string[] = [];
  for (const [label, parents] of labelParents) {
    if (parents.size > 1) {
      issues.push(`duplicate label "${label}" appears under ${parents.size} different parents`);
    }
  }
  for (const [parent, leaves] of leafParents) {
    if (parent !== '' && leaves.length > FLAT_LIST_THRESHOLD) {
      issues.push(`"${parent}" has ${leaves.length} flat leaf children (no grouping)`);
    }
  }
  return issues;
}
