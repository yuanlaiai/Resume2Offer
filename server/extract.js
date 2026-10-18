import path from 'node:path';
import mammoth from 'mammoth';

/** 容错解析 PDF（pdf-parse 的默认入口会去读测试文件，因此直接引 lib 内部实现） */
async function parsePDF(buffer) {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = mod.default || mod;
  const data = await pdfParse(buffer);
  return data.text || '';
}

function decodeText(buffer) {
  // 先按 UTF-8 严格解码，失败再退回 GBK（国内 Windows 导出的 txt 常见）
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

export function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * @param {{buffer: Buffer, filename: string, mimetype: string}} file
 * @returns {Promise<{text: string, kind: string}>}
 */
export async function extractResume({ buffer, filename = '', mimetype = '' }) {
  const ext = path.extname(filename).toLowerCase();
  let text = '';
  let kind = '';

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    kind = 'pdf';
    try {
      text = await parsePDF(buffer);
    } catch (err) {
      throw new Error(`PDF 解析失败：${err.message}。若是扫描件/图片版 PDF，请上传 DOCX 或直接粘贴文本`);
    }
  } else if (ext === '.docx' || ext === '.doc') {
    kind = ext === '.doc' ? 'doc' : 'docx';
    if (kind === 'doc') {
      throw new Error('不支持旧版 .doc，请另存为 .docx 后再上传（或直接粘贴文本）');
    }
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || '';
  } else if (['.txt', '.md', '.markdown', '.json', ''].includes(ext)) {
    kind = 'text';
    text = decodeText(buffer);
  } else {
    throw new Error(`不支持的文件类型：${ext || mimetype}，请上传 PDF / DOCX / TXT / MD`);
  }

  const clean = normalizeText(text);
  if (clean.length < 40) {
    throw new Error('解析出来的内容太少，可能是扫描件或空文件，请换一份或直接粘贴简历文本');
  }
  return { text: clean.slice(0, 30000), kind };
}
