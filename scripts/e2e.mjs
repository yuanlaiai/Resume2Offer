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

console.log('1) analyze...');
const a = await j('/api/analyze', { method: 'POST', body: form });
const an = await waitJob(a.jobId);
console.log(`   ok: id=${an.analysisId} topics=${an.topics.length} groups=${an.groups.length}`);

console.log('2) materials (first 3)...');
const m = await j(`/api/analyses/${an.analysisId}/materials`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topicIds: an.topics.slice(0, 3).map((t) => t.id) }),
});
const mat = await waitJob(m.jobId);
console.log(`   ok: materials=${mat.materials.length} first="${mat.materials[0].oneLine.slice(0, 30)}..."`);

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

console.log('7) export.md & list...');
const md = await fetch(`${BASE}/api/analyses/${an.analysisId}/export.md`);
const mdText = await md.text();
console.log(`   ok: md=${mdText.length} chars, head="${mdText.slice(0, 60).replace(/\n/g, ' ')}"`);
const list = await j('/api/analyses');
console.log(`   ok: list=${list.items.length} lastScore=${list.items[0].lastScore}`);

console.log('8) record shape...');
const rec = await j(`/api/analyses/${an.analysisId}`);
console.log('   keys:', Object.keys(rec).join(','));
console.log('   stage:', rec.stage, 'materials:', rec.materials.length, 'quizzes:', rec.quizzes.length, 'attempts:', rec.attempts.length);
console.log('\nALL PASS');
