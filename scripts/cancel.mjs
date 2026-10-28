/* 任务取消能力自测：中断在途模型请求、状态正确、正常任务不受影响 */
import http from 'node:http';

process.env.DEMO_MODE = '0';
process.env.LLM_API_KEY = 'test';
process.env.LLM_MODEL = 'stub';
process.env.LLM_BASE_URL = 'http://127.0.0.1:8931/v1';
process.env.DATA_DIR = '/tmp/r2o-cancel-test';

let calls = 0;
const server = http.createServer((req, res) => {
  calls += 1;
  const reply = () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} }));
  };
  // 第 1 次请求故意拖 1.5 秒，用来验证取消能立刻中断在途请求
  if (calls === 1) setTimeout(reply, 1500);
  else reply();
});
await new Promise((r) => server.listen(8931, '127.0.0.1', r));

const { startJob, cancelJob, getJob } = await import('../server/jobs.js');
const { chat } = await import('../server/llm.js');

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

// 1) 模型请求进行中取消：应立刻停，且不重试
const t0 = Date.now();
const id1 = startJob(['读简历', '推导知识点'], async (ctx) => {
  ctx.step(0, '正在读简历');
  await chat([{ role: 'user', content: 'slow' }], { maxTokens: 100 });
  ctx.step(1, '取消后不该走到这里');
  return { analysisId: 'should_not_exist' };
});
await new Promise((r) => setTimeout(r, 300));
const cancelled = cancelJob(id1);
const elapsed = Date.now() - t0;
await new Promise((r) => setTimeout(r, 500));
const job1 = getJob(id1);
check('cancelJob 返回 true', cancelled === true);
check('状态变为 cancelled', job1.status === 'cancelled', `status=${job1.status}`);
check('提示信息友好', /取消/.test(job1.error || ''), job1.error);
check('无结果残留（未落库）', job1.result === null);
check('中断在途请求够快', elapsed < 1200, `${elapsed}ms`);
check('不再可取消', job1.cancellable === false);
check('重复取消不抛错', cancelJob(id1) === true);
check('取消不存在的任务返回 false', cancelJob('job_not_exist') === false);

// 2) 正常任务不受影响（第 2 次请求秒回）
const id2 = startJob(['单步'], async (ctx) => {
  ctx.step(0, '跑一下');
  const out = await chat([{ role: 'user', content: 'fast' }], { maxTokens: 50 });
  return { echo: out.trim() };
});
await new Promise((r) => setTimeout(r, 400));
const job2 = getJob(id2);
check('正常任务照常完成', job2.status === 'done', `status=${job2.status}`);
check('正常任务返回结果', job2.result?.echo === '{"ok":true}');

server.close();
const ok = results.every(Boolean);
console.log(`\n${ok ? '全部通过' : '存在失败'}（${results.filter(Boolean).length}/${results.length}）`);
process.exit(ok ? 0 : 1);
