// @vitest-environment happy-dom
/**
 * HTML 正文提取测试（依赖 DOMParser，happy-dom 环境）。
 */

import { describe, expect, it } from 'vitest';
import { extractReadableText } from '../src/agent/tools';

const FIXTURE = `<!doctype html>
<html>
  <head><title>Intro to AI Agents | Learn</title></head>
  <body>
    <nav><a href="#">Home</a><a href="#">Courses</a></nav>
    <main>
      <h1>Intro to AI Agents and Agent Use Cases</h1>
      <p>This lesson explains what AI agents are.</p>
      <script>alert("should not appear");</script>
      <h2>Defining AI Agents</h2>
      <p>AI agents are systems that let LLMs act in an environment.</p>
      <ul>
        <li>Simple reflex agents</li>
        <li>Multi-Agent Systems (MAS)</li>
      </ul>
      <aside>advertisement noise</aside>
      <footer>copyright footer</footer>
    </main>
  </body>
</html>`;

describe('extractReadableText (happy-dom)', () => {
  it('extracts title, keeps headings as markdown, drops chrome', () => {
    const { title, text } = extractReadableText(FIXTURE);
    expect(title).toBe('Intro to AI Agents | Learn');
    expect(text).toContain('# Intro to AI Agents and Agent Use Cases');
    expect(text).toContain('## Defining AI Agents');
    expect(text).toContain('- Simple reflex agents');
    expect(text).toContain('let LLMs act in an environment');
    expect(text).not.toContain('should not appear');
    expect(text).not.toContain('advertisement noise');
    expect(text).not.toContain('copyright footer');
    expect(text).not.toContain('Home');
  });

  it('collapses whitespace and skips empty nodes', () => {
    const { text } = extractReadableText('<html><body><p>   a   spaced   line   </p><p></p></body></html>');
    expect(text).toBe('a spaced line');
  });
});
