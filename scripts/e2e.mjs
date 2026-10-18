// 端到端自测：走完整闭环
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
import fs from 'node:fs';

const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`${path} 非 JSON（${res.status}）：${txt.slice(0, 200)}`);
  }
};

async function waitJob(id) {
  for (let i = 0; i < 120; i += 1) {
    const job = await j(`/api/jobs/${id}`);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error('job error: ' + job.error);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('job timeout');
}

const text = fs.readFileSync('samples/sample-resume.md', 'utf8');

const form = new FormData();
form.append('targetRole', 'AI 应用开发工程师');
form.append('level', '高级');
form.append('text', text);

console.log('0) prefill（上传即识别岗位）...');
const pfForm = new FormData();
pfForm.append('text', text);
const pf = await j('/api/prefill', { method: 'POST', body: pfForm });
if (!pf.roles?.length) throw new Error('prefill 没有返回岗位');
console.log(`   ok: roles=${pf.roles.map((r) => r.title).join(' / ')} level=${pf.level}`);

console.log('1) analyze...');
const a = await j('/api/analyze', { method: 'POST', body: form });
const an = await waitJob(a.jobId);
console.log(`   ok: id=${an.analysisId} topics=${an.topics.length} groups=${an.groups.length}`);

console.log('2) materials（深度档 = 深度）...');
const m = await j(`/api/analyses/${an.analysisId}/materials`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicIds: an.topics.slice(0, 3).map((t) => t.id), depth: 'deep' }),
});
const mat = await waitJob(m.jobId);
console.log(`   ok: materials=${mat.materials.length} depth=${mat.materials[0].depth} sources=${(mat.materials[0].sources || []).length} first="${mat.materials[0].oneLine.slice(0, 30)}..."`);

console.log('2b) 改写单篇为简单档（版本历史）...');
const m2 = await j(`/api/analyses/${an.analysisId}/materials`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicIds: [an.topics[0].id], depth: 'lite' }),
});
const mat2 = await waitJob(m2.jobId);
const changed = mat2.materials.find((x) => x.topicId === an.topics[0].id);
console.log(`   ok: depth=${changed.depth} version=${changed.version} history=${(changed.history || []).length}`);

console.log('2c) 单篇下载（当前 + 历史版本）...');
const one = await fetch(`${BASE}/api/analyses/${an.analysisId}/materials/${an.topics[0].id}.md`);
const oneText = await one.text();
if (!one.ok) throw new Error('单篇下载失败');
const oldOne = await fetch(`${BASE}/api/analyses/${an.analysisId}/materials/${an.topics[0].id}.md?version=1`);
const oldText = await oldOne.text();
console.log(`   ok: current=${oneText.length} chars, history=${oldText.length} chars`);

console.log('3) quiz...');
const q = await j(`/api/analyses/${an.analysisId}/quiz`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicIds: an.topics.slice(0, 3).map((t) => t.id), count: 8 }),
});
const quiz = await waitJob(q.jobId);
console.log(`   ok: questions=${quiz.quiz.questions.length} points=${quiz.quiz.questions.reduce((s, x) => s + x.points, 0)}`);

console.log('4) grade...');
const answers = {};
quiz.quiz.questions.forEach((qq, i) => {
  if (qq.type === 'choice') answers[qq.id] = i === 0 ? qq.answerIndex : 0;
  else answers[qq.id] = i === 1 ? '' : '我会先说明场景与约束，再给出方案取舍，最后用一个项目里的数据说明效果，比如我们把 P99 从 420ms 降到 120ms。';
});
const g = await j(`/api/analyses/${an.analysisId}/grade`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ quizId: quiz.quiz.id, answers }),
});
const grade = await waitJob(g.jobId);
console.log(`   ok: total=${grade.attempt.grade.total} items=${grade.attempt.grade.items.length} weak=${grade.attempt.grade.weakTopics.length}`);

console.log('5) expand topic...');
const ex = await j(`/api/analyses/${an.analysisId}/expand`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicId: an.topics[0].id, count: 4 }),
});
const expanded = await waitJob(ex.jobId);
console.log(`   ok: added=${expanded.added.length} first="${expanded.added[0]?.title}"`);

console.log('6) plan...');
const p = await j(`/api/analyses/${an.analysisId}/plan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const plan = await waitJob(p.jobId);
console.log(`   ok: days=${plan.plan.days.length} focus=${plan.plan.focus.length}`);

console.log('7) report（附来源与优先级模块）...');
const rp = await j(`/api/analyses/${an.analysisId}/report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ depth: 'standard' }),
});
const rep = await waitJob(rp.jobId);
console.log(`   ok: modules=${rep.report.modules.length} path=${rep.report.path.length} sources=${rep.report.sources.length} headline="${(rep.report.headline || '').slice(0, 24)}"`);
const rmd = await fetch(`${BASE}/api/analyses/${an.analysisId}/report.md`);
const rmdText = await rmd.text();
if (!rmd.ok) throw new Error('报告下载失败');
console.log(`   ok: report.md=${rmdText.length} chars`);

console.log('8) export.md & list...');
const md = await fetch(`${BASE}/api/analyses/${an.analysisId}/export.md`);
const mdText = await md.text();
console.log(`   ok: md=${mdText.length} chars, head="${mdText.slice(0, 60).replace(/\n/g, ' ')}"`);
const list = await j('/api/analyses');
console.log(`   ok: list=${list.items.length} lastScore=${list.items[0].lastScore}`);

console.log('9) record shape...');
const rec = await j(`/api/analyses/${an.analysisId}`);
console.log('   keys:', Object.keys(rec).join(','));
console.log('   stage:', rec.stage, 'materials:', rec.materials.length, 'report:', rec.report ? 'yes' : 'no', 'attempts:', rec.attempts.length);
console.log('\nALL PASS');
