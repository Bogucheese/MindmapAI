import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATION,
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from '../src/ai/prompts';

describe('prompts', () => {
  it('embeds all numeric constraints into the system prompt', () => {
    const p = buildSystemPrompt({ depth: 4, maxChildren: 6, maxNodes: 40, language: 'en' });
    expect(p).toContain('Maximum depth: 4');
    expect(p).toContain('Maximum 6 children per node');
    expect(p).toContain('At most 40 nodes');
  });

  it('states the JSON schema and forbids non-JSON output', () => {
    const p = buildSystemPrompt(DEFAULT_GENERATION);
    expect(p).toContain('"label"');
    expect(p).toContain('"children"');
    expect(p).toContain('JSON object ONLY');
  });

  it('switches the label language rule', () => {
    expect(buildSystemPrompt({ ...DEFAULT_GENERATION, language: 'zh' })).toContain('中文');
    expect(buildSystemPrompt({ ...DEFAULT_GENERATION, language: 'en' })).toContain('in English');
    expect(buildSystemPrompt({ ...DEFAULT_GENERATION, language: 'auto' })).toContain(
      "same language as the user's topic"
    );
  });

  it('passes the topic through to the user prompt', () => {
    expect(buildUserPrompt('  Coffee supply chain  ')).toContain('Coffee supply chain');
  });

  it('repair prompt demands JSON-only output', () => {
    expect(buildRepairPrompt()).toContain('ONLY the JSON object');
  });
});
