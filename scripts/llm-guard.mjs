/**
 * 模型输出健壮性回归测试（不需要真实 API Key，也不需要联网）。
 *
 * 用本地假模型模拟三类真实故障，验证 server/llm.js 能自动救回来：
 *   1. 推理模型把 token 花在思考上，正文被截断（finish_reason=length）
 *   2. 正文被推理吃光，content 为空
 *   3. JSON 里带裸换行，JSON.parse 直接失败
 *
 * 运行：npm run test:llm
 */
import http from 'node:http';

const requests = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const userText = (payload.messages || []).map((m) => m.content).join('\n');
    const maxTokens = payload.max_tokens;
    requests.push({ maxTokens, userText });

    const mode = userText.includes('CASE_TRUNCATE')
      ? 'truncate'
      : userText.includes('CASE_STARVED')
        ? 'starved'
        : 'dirty';

    let content = '';
    let reasoning = '';
    let finish = 'stop';

    if (mode === 'truncate') {
      if (maxTokens < 12000) {
        content = '{"topics":[{"title":"RAG 检索","reason":"简历里写过向量召回';
        reasoning = '思考过程'.repeat(200);
        finish = 'length';
      } else {
        content = JSON.stringify({ topics: [{ title: 'RAG 检索', reason: '简历里写过向量召回' }, { title: '重排', reason: '追问常考' }] });
      }
    } else if (mode === 'starved') {
      if (maxTokens < 8000) {
        content = '';
        reasoning = '很长很长的思考过程'.repeat(400);
        finish = 'length';
      } else {
        content = JSON.stringify({ ok: true, topics: [{ title: 'a' }, { title: 'b' }] });
      }
    } else {
      // 字符串里带真实换行，直接 JSON.parse 会报错
      content = '{"text":"第一行\n第二行","list":[1,2,]}';
    }

    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'stub',
        choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: reasoning }, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

process.env.DEMO_MODE = '0';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.LLM_MODEL = 'stub-reasoner';

const { chatJSON } = await import('../server/llm.js');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// 1) 截断 → 自动加大 max_tokens 后成功
{
  const before = requests.length;
  const out = await chatJSON(
    [
      { role: 'system', content: '只输出 JSON' },
      { role: 'user', content: 'CASE_TRUNCATE：列两个考点' },
    ],
    { maxTokens: 3000 },
  );
  const used = requests.slice(before).map((r) => r.maxTokens);
  check(
    '截断后自动升配并拿到完整 JSON',
    out?.topics?.length === 2 && Math.max(...used) >= 12000,
    `max_tokens 尝试序列=${used.join(' → ')}`,
  );
}

// 2) 正文被推理吃光 → 识别为空并升配
{
  const before = requests.length;
  const out = await chatJSON(
    [
      { role: 'system', content: '只输出 JSON' },
      { role: 'user', content: 'CASE_STARVED：给个对象' },
    ],
    { maxTokens: 2000 },
  );
  const used = requests.slice(before).map((r) => r.maxTokens);
  check(
    '推理吃光正文后自动升配',
    out?.ok === true && Math.max(...used) >= 8000,
    `max_tokens 尝试序列=${used.join(' → ')}`,
  );
}

// 3) 脏 JSON（裸换行 + 尾逗号）→ 本地修复，不额外请求
{
  const before = requests.length;
  const out = await chatJSON([{ role: 'user', content: 'CASE_DIRTY：带换行的字符串' }], { maxTokens: 1000 });
  const calls = requests.length - before;
  check(
    '裸换行/尾逗号能就地修复',
    out?.text === '第一行\n第二行' && out?.list?.length === 2 && calls === 1,
    `模型调用 ${calls} 次`,
  );
}

server.close();

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  console.error(`${failed.length} 项失败`);
  process.exit(1);
}
console.log(`全部通过（${results.length} 项）`);
