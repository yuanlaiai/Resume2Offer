/** 把整份分析导出为 Markdown 复习手册 */

const nz = (s) => (s && String(s).trim() ? String(s).trim() : '—');

export function toMarkdown(record) {
  const p = record.profile || {};
  const c = p.candidate || {};
  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push(`# ${c.name || '候选人'} · ${record.targetRole || p.targetRole?.title || ''} 面试复习手册`, '');

  const meta = [];
  if (c.title) meta.push(`- 当前身份：${c.title}`);
  if (c.years) meta.push(`- 工作年限：${c.years} 年`);
  if (c.education) meta.push(`- 教育背景：${c.education}`);
  if (p.targetRole?.fitScore) meta.push(`- 岗位匹配度：${p.targetRole.fitScore}/100`);
  if (record.createdAt) meta.push(`- 生成时间：${new Date(record.createdAt).toLocaleString('zh-CN')}`);
  if (meta.length) push(...meta, '');

  if (p.summary) push('> ' + p.summary.replace(/\n/g, ' '), '');

  /* ---------- 画像 ---------- */
  push('## 一、简历画像', '');
  if (p.skills?.length) {
    push('### 技能盘点', '', '| 技能 | 自评 | 简历依据 |', '| --- | --- | --- |');
    p.skills.forEach((s) => push(`| ${nz(s.name)} | ${nz(s.level)} | ${nz(s.evidence)} |`));
    push('');
  }
  if (p.experiences?.length) {
    push('### 工作经历', '');
    p.experiences.forEach((e) => {
      push(`**${nz(e.company)}｜${nz(e.role)}｜${nz(e.period)}**`, '');
      (e.highlights || []).forEach((h) => push(`- ${h}`));
      push('');
    });
  }
  if (p.projects?.length) {
    push('### 项目', '');
    p.projects.forEach((pr) => {
      push(`**${nz(pr.name)}**（${nz(pr.role)}）`, '', nz(pr.desc), '');
      if (pr.impact) push(`- 结果：${pr.impact}`);
      if (pr.stack?.length) push(`- 相关：${pr.stack.join('、')}`);
      push('');
    });
  }
  if (p.strengths?.length) {
    push('### 面试中的真实优势', '');
    p.strengths.forEach((s) => push(`- ${s}`));
    push('');
  }
  if (p.risks?.length) {
    push('### 面试官会质疑的点（提前准备说法）', '');
    p.risks.forEach((r, i) => {
      push(`${i + 1}. **${nz(r.point)}**`);
      if (r.why) push(`   - 为什么被质疑：${r.why}`);
      if (r.probe) push(`   - 可能怎么问：${r.probe}`);
    });
    push('');
  }
  if (p.missing?.length) {
    push('### 岗位需要但简历没体现', '');
    p.missing.forEach((m) => push(`- ${m}`));
    push('');
  }

  /* ---------- 知识点 ---------- */
  push('## 二、需要复习的知识点', '');
  (record.groups || []).forEach((g) => {
    push(`### ${g.name}`, '');
    if (g.why) push(`_${g.why}_`, '');
    push('| # | 知识点 | 难度 | 重要度 | 备注 |', '| --- | --- | --- | --- | --- |');
    g.topics.forEach((t, i) => {
      push(`| ${i + 1} | ${t.title} | ${t.level} | ${'★'.repeat(t.priority)} | ${t.gap ? '简历缺口' : nz(t.reason)} |`);
    });
    push('');
  });

  /* ---------- 复习资料 ---------- */
  const materials = (record.materials || []).filter((m) => !m.error);
  if (materials.length) {
    push('## 三、知识点复习资料', '');
    materials.forEach((m, idx) => {
      push(`### ${idx + 1}. ${m.topicTitle}`, '');
      if (m.oneLine) push(`**一句话本质**：${m.oneLine}`, '');
      if (m.core?.length) {
        push('**必须记住**', '');
        m.core.forEach((x) => push(`- ${x}`));
        push('');
      }
      if (m.principle) push('**原理讲透**', '', m.principle, '');
      if (m.resumeHook) push(`**简历入口**：${m.resumeHook}`, '');
      if (m.answerFramework?.length) {
        push('**答题框架**', '');
        m.answerFramework.forEach((s, i) => push(`${i + 1}. **${nz(s.step)}**${s.say ? `：${s.say}` : ''}`));
        push('');
      }
      if (m.followups?.length) {
        push('**追问与应答**', '');
        m.followups.forEach((f) => {
          push(`- **问**：${f.q}`);
          if (f.a) push(`  - **答**：${f.a}`);
          if (f.trap) push(`  - ⚠️ 坑：${f.trap}`);
        });
        push('');
      }
      if (m.pitfalls?.length) {
        push('**易错点**', '');
        m.pitfalls.forEach((x) => push(`- ${x}`));
        push('');
      }
      if (m.bonus?.length) {
        push('**加分项**', '');
        m.bonus.forEach((x) => push(`- ${x}`));
        push('');
      }
      if (m.drill?.question) {
        push('**自测**', '', `> ${m.drill.question}`, '');
        if (m.drill.hint) push(`提示：${m.drill.hint}`, '');
      }
      if (m.references?.length) {
        push('**延伸阅读**', '');
        m.references.forEach((r) => push(`- ${r.title}${r.note ? `（${r.note}）` : ''}`));
        push('');
      }
      push('---', '');
    });
  }

  /* ---------- 测验复盘 ---------- */
  const attempt = (record.attempts || [])[record.attempts.length - 1];
  if (attempt) {
    const g = attempt.grade;
    push('## 四、测验与复盘', '');
    push(`**总分：${g.total}/100（${g.level}）**`, '');
    push('| 维度 | 得分 | 点评 |', '| --- | --- | --- |');
    push(`| 概念准确性 | ${g.dimensions.concept.score} | ${nz(g.dimensions.concept.comment)} |`);
    push(`| 理解深度 | ${g.dimensions.depth.score} | ${nz(g.dimensions.depth.comment)} |`);
    push(`| 表达结构 | ${g.dimensions.expression.score} | ${nz(g.dimensions.expression.comment)} |`);
    push('');
    if (g.summary) push(g.summary, '');
    (g.items || []).forEach((it, i) => {
      push(`### 第 ${i + 1} 题（${it.score}/${it.max}）`, '');
      push(`**题目**：${it.question}`, '');
      push(`**我的回答**：${it.userAnswer || '（未作答）'}`, '');
      push(`**判定**：${nz(it.verdict)}`, '');
      if (it.missed?.length) {
        push('**漏掉的点**', '');
        it.missed.forEach((x) => push(`- ${x}`));
        push('');
      }
      if (it.better) push(`**更好的答法**：${it.better}`, '');
      if (it.knowledgeGap) push(`**知识缺口**：${it.knowledgeGap}`, '');
    });
    if (g.nextActions?.length) {
      push('### 立刻要做的三件事', '');
      g.nextActions.forEach((x) => push(`- ${x}`));
      push('');
    }
  }

  /* ---------- 计划 ---------- */
  if (record.plan) {
    push('## 五、7 天提升计划', '');
    if (record.plan.headline) push(`> ${record.plan.headline}`, '');
    (record.plan.focus || []).forEach((f) => {
      push(`### 重点补强：${f.topicTitle}`, '');
      if (f.why) push(f.why, '');
      (f.how || []).forEach((h) => push(`- ${h}`));
      push('');
    });
    (record.plan.days || []).forEach((d) => {
      push(`### ${d.day}｜${nz(d.goal)}`, '');
      (d.tasks || []).forEach((t) => push(`- [ ] ${t.time ? `(${t.time}) ` : ''}${t.task}`));
      push('');
    });
    if (record.plan.resources?.length) {
      push('### 资源', '');
      record.plan.resources.forEach((r) => push(`- **${nz(r.type)}**｜${r.title}：${nz(r.note)}`));
      push('');
    }
    if (record.plan.nextRound) push(`### 下一轮验收标准`, '', record.plan.nextRound, '');
  }

  push('', '---', '', '_由 Interview Forge 生成 · 内容供复习参考，请结合真实项目经历核对_');
  return lines.join('\n');
}
