/**
 * 文档 → 纯文本（零依赖，浏览器/桌面/Node 通用）：
 * - .md/.markdown/.txt：直接按 UTF-8 读；
 * - .docx：OOXML 是 zip——中央目录定位 word/document.xml，inflate 走
 *   DecompressionStream（Node 18+/现代浏览器/Electron 均有），XML 粗提取正文；
 * - .pdf：轻量正文提取——逐 stream 解 FlateDecode（或取未压缩流），按
 *   Tj/TJ 文本操作符拼文本。无 CMap/字体解码：复杂编码（部分中文 PDF、
 *   扫描件、加密文档）可能提取失败或过少，此时明确报错并建议粘贴文本。
 */

import { t } from '../i18n/keys';

export type DocExtractResult =
  | { ok: true; text: string }
  | { ok: false; kind: 'unsupported' | 'corrupt' | 'empty'; detail: string };

const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** PDF 提取低于该字符数视为失败（扫描件/加密/编码不支持） */
const MIN_PDF_CHARS = 100;

export async function extractDocumentText(fileName: string, bytes: Uint8Array): Promise<DocExtractResult> {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  if (bytes.length > MAX_DOC_BYTES) {
    return { ok: false, kind: 'corrupt', detail: t('aiFileTooLarge', 'file too large (over 20MB)') };
  }
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    return { ok: true, text: new TextDecoder('utf-8').decode(bytes) };
  }
  if (ext === 'docx') {
    return extractDocx(bytes);
  }
  if (ext === 'pdf') {
    return extractPdf(bytes);
  }
  return {
    ok: false,
    kind: 'unsupported',
    detail: t('aiFileUnsupported', 'unsupported format (use .md / .txt / .docx / .pdf)'),
  };
}

/* ==================== docx（zip + document.xml） ==================== */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** PDF FlateDecode 规范上是 zlib 封装(RFC 1950),少数生成器写裸流——两种都试 */
async function inflatePdf(data: Uint8Array): Promise<Uint8Array> {
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return inflateRaw(data);
  }
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** 中央目录定位条目;返回压缩方法/压缩数据切片(本地头解析) */
function findZipEntry(bytes: Uint8Array, entryName: string): { method: number; data: Uint8Array } | null {
  // EOCD 在最后 64KB 内:0x06054b50
  const tail = Math.max(0, bytes.length - 65536 - 22);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= tail; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdCount = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const nameBytes = new TextEncoder().encode(entryName);
  for (let n = 0; n < cdCount && p + 46 <= bytes.length; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    let matched = nameLen === nameBytes.length;
    for (let k = 0; matched && k < nameLen; k++) {
      if (bytes[p + 46 + k] !== nameBytes[k]) matched = false;
    }
    if (matched) {
      // 本地头:0x04034b50,数据起点 = +30 + 文件名长 + 扩展长
      if (u32(bytes, localOff) !== 0x04034b50) return null;
      const lNameLen = u16(bytes, localOff + 26);
      const lExtraLen = u16(bytes, localOff + 28);
      const csize = u32(bytes, p + 20);
      const start = localOff + 30 + lNameLen + lExtraLen;
      return { method, data: bytes.slice(start, start + csize) };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(bytes: Uint8Array): Promise<DocExtractResult> {
  const entry = findZipEntry(bytes, 'word/document.xml');
  if (entry == null) {
    return { ok: false, kind: 'corrupt', detail: t('aiFileCorrupt', 'cannot read the document (corrupted or not a real .docx)') };
  }
  let xmlBytes: Uint8Array;
  try {
    xmlBytes = entry.method === 8 ? await inflateRaw(entry.data) : entry.data;
  } catch {
    return { ok: false, kind: 'corrupt', detail: t('aiFileCorrupt', 'cannot read the document (corrupted or not a real .docx)') };
  }
  const text = docxXmlToText(new TextDecoder('utf-8').decode(xmlBytes));
  if (text.length < 20) {
    return { ok: false, kind: 'empty', detail: t('aiFileEmpty', 'no readable text extracted; try pasting the text instead') };
  }
  return { ok: true, text };
}

/* ==================== pdf（轻量文本提取） ==================== */

const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** PDF 字面串反转义:\ddd 八进制(优先) 、\( \) \\ \n \r \t \b \f、行延续 */
function unescapePdfString(s: string): string {
  return s.replace(/\\([0-7]{1,3}|.)/g, (_m, c: string) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8) & 0xff);
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    if (c === 'b') return '\b';
    if (c === 'f') return '\f';
    if (c === '\n' || c === '\r') return '';
    return c;
  });
}

function hexToText(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) return '';
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  // UTF-16BE(BOM FEFF)按双字节解码,否则按 latin1
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  return bytes.map((b) => String.fromCharCode(b)).join('');
}

/** 从内容流文本操作符抽取文本:Tj/'/" 单串、TJ 数组、Td/TD/T* 换行 */
function extractTextOps(content: string): string {
  const out: string[] = [];
  // 顺序扫描:字面串 (…)、十六进制串 <…>、换行操作符(target es2017,用 [\s\S] 代替 dotAll)
  const re = /\(((?:\\[\s\S]|[^\\()])*)\)\s*(Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(Tj|'|")|\[([\s\S]*?)\]\s*TJ|(T\*|Td|TD)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) != null) {
    if (m[6] != null) {
      out.push('\n');
    } else if (m[1] != null) {
      out.push(unescapePdfString(m[1]));
    } else if (m[3] != null) {
      out.push(hexToText(m[3]));
    } else if (m[5] != null) {
      // TJ 数组:取其中的字面串/十六进制串拼接(忽略数字 kerning)
      const inner = m[5];
      const innerRe = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g;
      let im: RegExpExecArray | null;
      let piece = '';
      while ((im = innerRe.exec(inner)) != null) {
        piece += im[1] != null ? unescapePdfString(im[1]) : hexToText(im[2]);
      }
      out.push(piece);
    }
  }
  return out.join('');
}

async function extractPdf(bytes: Uint8Array): Promise<DocExtractResult> {
  const raw = latin1(bytes);
  if (!raw.startsWith('%PDF')) {
    return { ok: false, kind: 'corrupt', detail: t('aiFileCorrupt', 'cannot read the document (corrupted or not a real .pdf)') };
  }
  const texts: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) != null) {
    const end = raw.indexOf('endstream', m.index);
    if (end < 0) break;
    // stream 前的字典(粗取前 600 字节)判断过滤器
    const header = raw.slice(Math.max(0, m.index - 600), m.index);
    const dataStart = m.index + m[0].length;
    let dataEnd = end;
    while (dataEnd > dataStart && (raw[dataEnd - 1] === '\n' || raw[dataEnd - 1] === '\r')) dataEnd--;
    const data = bytes.slice(dataStart, dataEnd);
    let content: Uint8Array;
    if (header.includes('/FlateDecode')) {
      try {
        content = await inflatePdf(data);
      } catch {
        continue; // 单个流解压失败不致命,继续其它流
      }
    } else if (header.includes('/Filter')) {
      continue; // 其它过滤器(DCTDecode 图像等)跳过
    } else {
      content = data;
    }
    const text = extractTextOps(latin1(content));
    if (text.trim() !== '') texts.push(text);
  }
  const joined = texts
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (joined.length < MIN_PDF_CHARS) {
    return {
      ok: false,
      kind: 'empty',
      detail: t('aiPdfThin', 'too little text extracted (scanned/encrypted/complex-encoding PDF); try pasting the text instead'),
    };
  }
  return { ok: true, text: joined };
}
