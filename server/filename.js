/**
 * 上传文件名修复。
 *
 * 浏览器按 UTF-8 发送 filename="简历.docx"，但 multipart 解析器（busboy/multer）
 * 默认按 latin1 解码，中文就会变成 "æ\x9d¨é\x9bª..." 这种乱码存进库里。
 * 这里把它还原回 UTF-8；本来就是正常名字（含中文或纯 ASCII）则原样返回。
 */
export function fixFileName(name = '') {
  const s = String(name || '');
  if (!s) return '';

  // 已经是正常中文名，直接放过
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(s)) return s;

  // 只处理"全是 latin1 高位字符"的可疑字符串
  if (!/[\u0080-\u00ff]/.test(s)) return s;

  try {
    const decoded = Buffer.from(s, 'latin1').toString('utf8');
    // 还原失败会出现替换字符；成功则一定没有
    if (!decoded.includes('\ufffd') && decoded !== s) return decoded;
  } catch {
    /* 忽略，原样返回 */
  }
  return s;
}
