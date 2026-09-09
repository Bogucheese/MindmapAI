import { describe, expect, it } from 'vitest';
import { extractJson, parseMindmapTree, type TreeConstraints } from '../src/ai/schema';

const C: TreeConstraints = { depth: 3, maxChildren: 3, maxNodes: 10 };

const simpleTree = { label: 'Root', children: [{ label: 'A' }, { label: 'B' }] };

describe('extractJson', () => {
  it('passes plain JSON through', () => {
    expect(extractJson('{"label":"R"}')).toBe('{"label":"R"}');
  });

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"label":"R"}\n```')).toBe('{"label":"R"}');
  });

  it('strips bare ``` fences', () => {
    expect(extractJson('```\n{"label":"R"}\n```')).toBe('{"label":"R"}');
  });

  it('extracts JSON from surrounding prose', () => {
    expect(extractJson('Here is your mind map:\n{"label":"R"}\nHope it helps!')).toBe('{"label":"R"}');
  });

  it('strips an unterminated leading fence (truncated output)', () => {
    expect(extractJson('```json\n{"label":"R"}')).toBe('{"label":"R"}');
  });

  it('returns null for text without braces', () => {
    expect(extractJson('sorry, no json here')).toBeNull();
  });
});

describe('parseMindmapTree', () => {
  it('parses a valid tree and reports node count', () => {
    const r = parseMindmapTree(JSON.stringify(simpleTree), C);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.label).toBe('Root');
      expect(r.tree.children).toHaveLength(2);
      expect(r.stats.nodes).toBe(3);
      expect(r.stats.dropped).toBe(0);
    }
  });

  it('parses fenced and prose-wrapped output', () => {
    expect(parseMindmapTree('```json\n' + JSON.stringify(simpleTree) + '\n```', C).ok).toBe(true);
    expect(parseMindmapTree('Answer: ' + JSON.stringify(simpleTree) + ' . Thanks', C).ok).toBe(true);
  });

  it('repairs trailing commas', () => {
    const r = parseMindmapTree('{"label":"Root","children":[{"label":"A"},]}', C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stats.nodes).toBe(2);
  });

  it('falls back to the first element of a root-level array', () => {
    const r = parseMindmapTree(JSON.stringify([simpleTree, { label: 'ignored' }]), C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tree.label).toBe('Root');
  });

  it('coerces numeric/boolean labels and accepts name/text aliases', () => {
    const r = parseMindmapTree(
      '{"label":"R","children":[{"name":"A","children":[{"text":true}]}]}',
      C
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.children![0].label).toBe('A');
      expect(r.tree.children![0].children![0].label).toBe('true');
    }
  });

  it('caps label length at 100 chars', () => {
    const r = parseMindmapTree('{"label":"' + 'x'.repeat(150) + '"}', C);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tree.label).toHaveLength(100);
  });

  it('truncates children beyond maxChildren and counts drops', () => {
    const wide = {
      label: 'R',
      children: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }],
    };
    const r = parseMindmapTree(JSON.stringify(wide), C);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.children).toHaveLength(3);
      expect(r.stats.dropped).toBe(2);
    }
  });

  it('truncates total nodes at maxNodes', () => {
    const big = {
      label: 'R',
      children: [
        { label: 'A', children: [{ label: 'A1' }, { label: 'A2' }] },
        { label: 'B', children: [{ label: 'B1' }] },
        { label: 'C' },
      ],
    };
    const r = parseMindmapTree(JSON.stringify(big), { depth: 5, maxChildren: 3, maxNodes: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stats.nodes).toBe(5); // R, A, A1, A2, B
      expect(r.stats.dropped).toBe(2); // B1, C
    }
  });

  it('truncates below depth limit', () => {
    const deep = {
      label: 'L1',
      children: [{ label: 'L2', children: [{ label: 'L3', children: [{ label: 'L4' }] }] }],
    };
    const r = parseMindmapTree(JSON.stringify(deep), C);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.children![0].children![0].label).toBe('L3');
      expect(r.tree.children![0].children![0].children).toBeUndefined();
      expect(r.stats.dropped).toBe(1);
    }
  });

  it('drops malformed children but keeps valid siblings', () => {
    const r = parseMindmapTree(
      '{"label":"R","children":[{"label":"A"},{"label":"  "},null,{"label":"B"}]}',
      C
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree.children).toHaveLength(2);
      expect(r.stats.dropped).toBe(2);
    }
  });

  it('fails with reason unparseable on garbage', () => {
    const r = parseMindmapTree('this is not json at all', C);
    expect(r).toMatchObject({ ok: false, reason: 'unparseable' });
  });

  it('fails with reason empty on blank input', () => {
    expect(parseMindmapTree('   \n\t', C)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('fails with reason invalid-shape when root has no usable label', () => {
    expect(parseMindmapTree('{"foo": 1}', C)).toMatchObject({ ok: false, reason: 'invalid-shape' });
    expect(parseMindmapTree('[1, 2, 3]', C)).toMatchObject({ ok: false, reason: 'invalid-shape' });
  });

  it('preserves the raw response on failure', () => {
    const raw = 'garbage {"label":';
    const r = parseMindmapTree(raw, C);
    if (!r.ok) expect(r.raw).toBe(raw);
  });
});
