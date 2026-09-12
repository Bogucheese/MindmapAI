/**
 * 文档提取测试:.md 直通;.docx 手工构造 zip(stored + deflate 两种);
 * .pdf 未压缩流 + FlateDecode 流;坏文件/不支持格式/过薄 PDF 的错误路径。
 * 全程 node 环境(DecompressionStream / node:zlib 现成)。
 */

import { describe, expect, it } from 'vitest';
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib';
import { extractDocumentText } from '../src/agent/doc-extract';

const enc = new TextEncoder();

/* ---------- 最小 zip 构造器(stored=0 / deflate=8) ---------- */
function buildZip(entries: Array<{ name: string; data: Uint8Array; method: 0 | 8 }>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf-8');
    const payload = e.method === 8 ? deflateRawSync(Buffer.from(e.data)) : Buffer.from(e.data);
    const crc = crc32(Buffer.from(e.data)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, payload);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(e.method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>AI Agent 是让 LLM 在环境中行动的系统</w:t></w:r></w:p>
<w:p><w:r><w:t>包含环境、传感器与执行器三要素,以及 &amp; 符号转义</w:t></w:r></w:p>
<w:p><w:r><w:t>第三段:规划、工具调用与记忆。</w:t></w:r></w:p>
</w:body></w:document>`;

function buildDocx(method: 0 | 8): Uint8Array {
  return buildZip([{ name: 'word/document.xml', data: enc.encode(DOCX_XML), method }]);
}

/* ---------- 最小 pdf 构造器 ---------- */
const PDF_TEXT = 'AI Agent terminology guide for mindmap generation. '.repeat(4);

function buildPdfUncompressed(): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${PDF_TEXT.trim()}) Tj T* (second\\(escaped\\) line) Tj ET`;
  return enc.encode(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\ntrailer\n<< >>\n%%EOF`
  );
}

function buildPdfFlate(): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${PDF_TEXT.trim()}) Tj ET`;
  const deflated = deflateSync(Buffer.from(stream));
  const head = enc.encode(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`
  );
  const tail = enc.encode(`\nendstream\nendobj\ntrailer\n<< >>\n%%EOF`);
  return new Uint8Array(Buffer.concat([head, deflated, tail]));
}

describe('extractDocumentText', () => {
  it('reads markdown/txt as UTF-8', async () => {
    const r = await extractDocumentText('notes.md', enc.encode('# 标题\n\n正文内容'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain('正文内容');
  });

  it('rejects unsupported extensions', async () => {
    const r = await extractDocumentText('data.xlsx', enc.encode('xx'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unsupported');
  });

  it('extracts docx text (stored entry)', async () => {
    const r = await extractDocumentText('a.docx', buildDocx(0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('AI Agent 是让 LLM 在环境中行动的系统');
    expect(r.text).toContain('& 符号转义');
    // 段落转换为换行
    expect(r.text.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThanOrEqual(3);
  });

  it('extracts docx text (deflate entry)', async () => {
    const r = await extractDocumentText('a.docx', buildDocx(8));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain('第三段:规划、工具调用与记忆。');
  });

  it('rejects a fake docx (no central directory)', async () => {
    const r = await extractDocumentText('a.docx', enc.encode('not a zip at all'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('corrupt');
  });

  it('extracts pdf text from an uncompressed stream', async () => {
    const r = await extractDocumentText('a.pdf', buildPdfUncompressed());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('AI Agent terminology guide');
    expect(r.text).toContain('second(escaped) line');
  });

  it('extracts pdf text from a FlateDecode stream', async () => {
    const r = await extractDocumentText('a.pdf', buildPdfFlate());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain('AI Agent terminology guide');
  });

  it('flags near-empty pdf (scanned/encrypted) with a helpful error', async () => {
    const r = await extractDocumentText('a.pdf', enc.encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('empty');
  });
});
