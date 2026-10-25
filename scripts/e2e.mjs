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

console.log('1b) 技能覆盖（简历里的技术大类不能缺）...');
const requiredCov = (an.coverage || []).filter((c) => c.required !== false);
const uncovered = requiredCov.filter((c) => !c.covered);
if (!requiredCov.length) throw new Error('没有返回技能覆盖数据');
if (uncovered.length) throw new Error(`技能未覆盖：${uncovered.map((c) => c.name).join('、')}`);
console.log(`   ok: ${requiredCov.length}/${requiredCov.length} 覆盖 → ${requiredCov.map((c) => `${c.name}(${c.group})`).join(' | ')}`);

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

console.log('7b) 系统课程（按技术大类排课 + 章节讲义）...');
const csJob = await j(`/api/analyses/${an.analysisId}/courses`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ auto: true }),
});
const cs = await waitJob(csJob.jobId);
if (!cs.courses?.length) throw new Error('没有排出课程');
const course = cs.courses[0];
const totalCh = course.stages.reduce((s, st) => s + st.chapters.length, 0);
if (course.stages.length < 3 || totalCh < 6) throw new Error(`课程结构不完整：${course.stages.length} 阶段 / ${totalCh} 章`);
const firstCh = course.stages[0].chapters[0];
const lJob = await j(`/api/analyses/${an.analysisId}/courses/${course.id}/lessons`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chapterIds: [firstCh.id], depth: 'standard' }),
});
const ls = await waitJob(lJob.jobId);
const lesson = ls.course.stages[0].chapters[0].lesson;
if (!lesson?.sections?.length) throw new Error('讲义没有正文小节');
const courseMd = await fetch(`${BASE}/api/analyses/${an.analysisId}/courses/${course.id}.md`).then((r) => r.text());
if (!courseMd.includes('学习路径')) throw new Error('课程导出缺少学习路径');
const lessonMd = await fetch(`${BASE}/api/analyses/${an.analysisId}/courses/${course.id}/chapters/${firstCh.id}.md`).then((r) => r.text());
if (!lessonMd.includes(firstCh.title)) throw new Error('单章导出内容不对');
console.log(
  `   ok: ${cs.courses.length} 门课；首门 ${course.group} ${course.stages.length} 阶段/${totalCh} 章；讲义 ${lesson.sections.length} 节/${lesson.qa.length} 问；md=${courseMd.length}/${lessonMd.length} 字`,
);

console.log('7c) AI 随问（划词追问 + 多轮对话）...');
const chatBody = {
  analysisId: an.analysisId,
  selection: 'RAG 检索质量决定了回答的可信度',
  context: '系统课程 · 第一章',
  messages: [
    { role: 'user', content: '【我选中了这段内容】\nRAG 检索质量决定了回答的可信度\n\n【我的问题】这是什么意思？' },
  ],
};
const chat1 = await j('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(chatBody),
});
if (!chat1.reply || chat1.reply.length < 10) throw new Error('随问第一轮没有回答');
const chat2 = await j('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    analysisId: an.analysisId,
    selection: chatBody.selection,
    messages: [
      ...chatBody.messages,
      { role: 'assistant', content: chat1.reply.slice(0, 200) },
      { role: 'user', content: '展开讲讲失效场景' },
    ],
  }),
});
if (!chat2.reply || chat2.reply.length < 10) throw new Error('随问第二轮没有回答');
const chatRec = await j(`/api/analyses/${an.analysisId}`);
if (!(chatRec.chats || []).length) throw new Error('随问对话没有落库');
console.log(`   ok: 两轮回答 ${chat1.reply.length}/${chat2.reply.length} 字，落库 ${chatRec.chats.length} 条`);

console.log('7d) 速学中心（闪卡 / 速览卡 / 费曼 / 每日速学）...');
const fc = await waitJob((await j(`/api/analyses/${an.analysisId}/flashcards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 8 }) })).jobId);
if (!fc.added) throw new Error('闪卡没有生成');
const fcCard = fc.flashcards[0];
const reviewed = await j(`/api/analyses/${an.analysisId}/flashcards/${fcCard.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grade: 2 }) });
if (!reviewed.card?.dueAt) throw new Error('翻卡自评失败');
const qc = await waitJob((await j(`/api/analyses/${an.analysisId}/quickcard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: an.topics[0].id }) })).jobId);
if (!qc.card?.tldr) throw new Error('速览卡没有生成');
const fy = await waitJob((await j(`/api/analyses/${an.analysisId}/feynman`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: an.topics[0].id, explanation: '这个知识点主要是为了提升性能，把数据放在内存里，查询就快了， 项目里我们也用它做过缓存。' }) })).jobId);
if (typeof fy.grade?.score !== 'number') throw new Error('费曼批改失败');
const daily = await j(`/api/analyses/${an.analysisId}/daily`);
console.log(
  `   ok: cards=${fc.added} due=${daily.dueCount}/${daily.totalCards} mastered=${daily.mastered} ` +
  `qc="${qc.card.tldr.slice(0, 18)}…" fy=${fy.grade.score}分 weak=${daily.weakTopics.length} fresh=${daily.freshTopic ? daily.freshTopic.title.slice(0, 12) : '—'}`,
);

console.log('7e) 模拟面试（开场 → 追问 → 收尾报告 → 逐题参考答案 → 导出）...');
const mkStart = await j(`/api/analyses/${an.analysisId}/mock/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'standard' }),
});
const mk = mkStart.session;
if (!mk.transcript?.[0]?.content) throw new Error('面试官没有开场');
const mkTurn = await j(`/api/analyses/${an.analysisId}/mock/turn`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: mk.id, answer: '项目是门店知识问答系统：文档解析、切片、混合检索接 rerank，我负责检索链路，命中率从 62% 提到 89%，日均 3 万次问答。' }),
});
if (mkTurn.session.transcript.length < 3) throw new Error('面试官没有追问');
const mkDone = await waitJob((await j(`/api/analyses/${an.analysisId}/mock/finish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: mk.id }),
})).jobId);
if (mkDone.status !== 'done' || typeof mkDone.report?.overall !== 'number') throw new Error('评分报告没生成');
if (!Array.isArray(mkDone.answers) || !mkDone.answers.length) throw new Error('逐题参考答案没生成');
const mockMd = await fetch(`${BASE}/api/analyses/${an.analysisId}/mocks/${mk.id}.md`);
const mockMdText = await mockMd.text();
if (!mockMd.ok || !mockMdText.includes('逐题参考答案')) throw new Error('面试复盘导出缺少参考答案');
console.log(`   ok: 报告 ${mkDone.report.overall} 分/${mkDone.report.dimensions.length} 维度，参考答案 ${mkDone.answers.length} 题，md=${mockMdText.length} 字`);

console.log('7f) JD 对比 + 简历评审...');
const jdRes = await waitJob((await j(`/api/analyses/${an.analysisId}/jd`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jdText: '岗位职责：负责 AI 问答平台服务治理，要求 5 年后端经验，熟悉 K8s，有 RAG 落地经验者优先。任职要求：本科以上，沟通能力好。' }),
})).jobId);
if (typeof jdRes.fitScore !== 'number' || !jdRes.gaps?.length) throw new Error('JD 对比结果不完整');
const rvRes = await waitJob((await j(`/api/analyses/${an.analysisId}/resume-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).jobId);
if (!rvRes.grill?.length || !rvRes.rewrite?.length) throw new Error('简历评审结果不完整');
const jdMd = await fetch(`${BASE}/api/analyses/${an.analysisId}/jd.md`);
const rvMd = await fetch(`${BASE}/api/analyses/${an.analysisId}/resume-review.md`);
if (!jdMd.ok || !rvMd.ok) throw new Error('JD/评审导出失败');
console.log(`   ok: JD ${jdRes.fitScore} 分/缺口 ${jdRes.gaps.length}，评审追问 ${rvRes.grill.length}/改写 ${rvRes.rewrite.length}`);

console.log('7g) 章节学习进度...');
const prog = await j(`/api/analyses/${an.analysisId}/progress`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chapterId: firstCh.id, status: 'mastered' }),
});
if (prog.progress[firstCh.id] !== 'mastered') throw new Error('进度标记失败');
const progBack = await j(`/api/analyses/${an.analysisId}/progress`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chapterId: firstCh.id, status: 'none' }),
});
if (progBack.progress[firstCh.id]) throw new Error('进度重置失败');
console.log('   ok: 标记已掌握 → 重置，双向通过');

console.log('7h) 用量统计...');
const usage = await j('/api/usage');
if (typeof usage.totalCalls !== 'number' || typeof usage.totalTokens !== 'number') throw new Error('用量接口字段缺失');
console.log(`   ok: ${usage.totalCalls} 次调用 / ${(usage.totalTokens / 1000).toFixed(1)}k tokens`);

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
