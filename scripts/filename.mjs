/**
 * 文件名编码回归测试。
 * 浏览器按 UTF-8 传 filename，multipart 解析器按 latin1 解出来就是乱码，
 * 这里验证 fixFileName 能还原中文、又不误伤正常名字。
 */
import { fixFileName } from '../server/filename.js';

const cases = [
  // 中文名被 latin1 误解码后的典型乱码
  ['æ\x9d¨é\x9bªé£\x9e-Agentå¼\x80å\x8f\x91å·¥ç¨\x8bå¸\x88.docx', '杨雪飞-Agent开发工程师.docx'],
  ['å¼\xa0ä¸\x89-ç®\x80å\x8e\x86.pdf', '张三-简历.pdf'],
  ['简历.pdf', '简历.pdf'],
  ['resume.pdf', 'resume.pdf'],
  // 合法的西欧字符名不能被当成乱码
  ['résumé.pdf', 'résumé.pdf'],
  ['', ''],
];

let failed = 0;
for (const [input, expect] of cases) {
  const got = fixFileName(input);
  const ok = got === expect;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input)} → ${JSON.stringify(got)}`);
}

if (failed) {
  console.error(`${failed} 项失败`);
  process.exit(1);
}
console.log(`全部通过（${cases.length} 项）`);
