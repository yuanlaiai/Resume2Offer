/* 批量生成考点承载章节的讲义：3 个任务并行 × 每个 4 章 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const ID = process.env.AID;
if (!ID) throw new Error('需要 AID 环境变量（分析 id）');

const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { throw new Error(`${path} 非 JSON(${res.status}): ${txt.slice(0, 150)}`); }
};
async function waitJob(id, tag) {
  for (let i = 0; i < 400; i += 1) {
    const job = await j(`/api/jobs/${id}`);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(`${tag} job error: ${job.error}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${tag} job timeout`);
}

const rec = await j(`/api/analyses/${ID}`);
// 组装 [courseId, chapterId] 队列：只生成挂了考点且还没有讲义的章
const queue = [];
for (const c of rec.courses || []) {
  for (const st of c.stages || []) {
    for (const ch of st.chapters || []) {
      if (ch.topicIds?.length && !ch.lesson) queue.push([c.id, ch.id, c.group, ch.title]);
    }
  }
}
console.log(`待生成 ${queue.length} 章`);

const post = (path, body) => j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const chunk = (arr, n) => arr.splice(0, n);

let done = 0;
let failed = 0;
let consecFailed = 0; // 连续失败组计数：连续 4 组全败（如余额耗尽）时熔断退出
const PAR = 3;
while (queue.length && consecFailed < 4) {
  // 串行化取块：每 worker 取一组
  const groups = [];
  for (let i = 0; i < PAR && queue.length; i += 1) groups.push(queue.splice(0, 4));
  const results = await Promise.allSettled(groups.map(async (g, gi) => {
    const courseId = g[0][0];
    const group = g[0][2];
    const chapterIds = g.map((x) => x[1]);
    const job = await post(`/api/analyses/${ID}/courses/${courseId}/lessons`, { chapterIds, depth: 'standard' });
    const result = await waitJob(job.jobId, `${group}-${gi}`);
    const bad = (result?.failed || []).length;
    done += chapterIds.length - bad;
    failed += bad;
    for (const f of result?.failed || []) console.error(`  [${group}] 章失败：${f.title} — ${String(f.error).slice(0, 120)}`);
    if (!bad) console.log(`[${new Date().toISOString().slice(11, 19)}] ${group} +${chapterIds.length} 章（累计 ${done}）`);
    else console.log(`[${new Date().toISOString().slice(11, 19)}] ${group} +${chapterIds.length - bad}/${chapterIds.length} 章（累计 ${done}，失败累计 ${failed}）`);
    return bad === 0;
  }));
  let okInWave = 0;
  for (const r of results) {
    if (r.status === 'rejected') {
      failed += 4;
      console.error('  一组失败：', String(r.reason?.message || r.reason).slice(0, 160));
    } else if (r.value) {
      okInWave += 1;
    }
  }
  consecFailed = okInWave === 0 ? consecFailed + 1 : 0;
}
if (consecFailed >= 4) console.error('\n连续 4 组全部失败，疑似模型服务不可用（余额/限流），提前退出');
console.log(`\n完成：累计生成 ${done} 章，章失败 ${failed}，剩余 ${queue.length} 章未处理`);
