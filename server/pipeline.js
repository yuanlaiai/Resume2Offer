import { store } from './store.js';
import { chatJSON } from './llm.js';
import { searchWeb, formatSearchBlock, searchReady } from './search.js';
import {
  parseResumePrompt,
  buildTopicsPrompt,
  buildMaterialPrompt,
  buildQuizPrompt,
  buildGradePrompt,
  buildPlanPrompt,
  expandTopicsPrompt,
  prefillPrompt,
  buildReportPrompt,
  depthSpec,
  DEPTHS,
} from './prompts.js';

const clamp = (n, min, max, dflt) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, v));
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);

function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const candidate = p.candidate && typeof p.candidate === 'object' ? p.candidate : {};
  return {
    candidate: {
      name: str(candidate.name),
      title: str(candidate.title),
      years: clamp(candidate.years, 0, 60, 0),
      education: str(candidate.education),
      city: str(candidate.city),
    },
    targetRole: {
      title: str(p.targetRole?.title),
      level: str(p.targetRole?.level),
      fitScore: clamp(p.targetRole?.fitScore, 0, 100, 60),
      reason: str(p.targetRole?.reason),
    },
    summary: str(p.summary),
    skills: arr(p.skills)
      .map((s) => ({ name: str(s?.name), level: str(s?.level), evidence: str(s?.evidence) }))
      .filter((s) => s.name)
      .slice(0, 20),
    experiences: arr(p.experiences).map((e) => ({
      company: str(e?.company),
      role: str(e?.role),
      period: str(e?.period),
      highlights: arr(e?.highlights).map(str).filter(Boolean).slice(0, 6),
      stack: arr(e?.stack).map(str).filter(Boolean).slice(0, 10),
    })),
    projects: arr(p.projects).map((e) => ({
      name: str(e?.name),
      role: str(e?.role),
      desc: str(e?.desc),
      stack: arr(e?.stack).map(str).filter(Boolean),
      impact: str(e?.impact),
    })),
    strengths: arr(p.strengths).map(str).filter(Boolean).slice(0, 8),
    risks: arr(p.risks)
      .map((r) => ({ point: str(r?.point), why: str(r?.why), probe: str(r?.probe) }))
      .filter((r) => r.point)
      .slice(0, 6),
    missing: arr(p.missing).map(str).filter(Boolean).slice(0, 8),
  };
}

function normalizeGroups(raw) {
  const groups = arr(raw?.groups).slice(0, 6);
  let counter = 0;
  const out = [];
  for (const g of groups) {
    const name = str(g?.name) || `分组 ${out.length + 1}`;
    const topics = arr(g?.topics)
      .map((t) => {
        counter += 1;
        return {
          id: `t${counter}`,
          title: str(t?.title),
          level: ['基础', '进阶', '深度'].includes(t?.level) ? t.level : '进阶',
          priority: clamp(t?.priority, 1, 5, 3),
          gap: Boolean(t?.gap),
          reason: str(t?.reason),
          interviewerFocus: str(t?.interviewerFocus),
          followups: arr(t?.followups).map(str).filter(Boolean).slice(0, 4),
          group: name,
        };
      })
      .filter((t) => t.title)
      .slice(0, 10);
    if (topics.length) out.push({ name, why: str(g?.why), topics });
  }
  return out;
}

function flatten(groups) {
  return groups.flatMap((g) => g.topics);
}

function normalizeTopic(t, id, group) {
  return {
    id,
    title: str(t?.title),
    level: ['基础', '进阶', '深度'].includes(t?.level) ? t.level : '进阶',
    priority: clamp(t?.priority, 1, 5, 3),
    gap: Boolean(t?.gap),
    reason: str(t?.reason),
    interviewerFocus: str(t?.interviewerFocus),
    followups: arr(t?.followups).map(str).filter(Boolean).slice(0, 4),
    group,
    ...(t?.relation ? { relation: str(t.relation) } : {}),
    ...(t?.expanded ? { expanded: true } : {}),
  };
}

/** 并发受限的 map */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------------- 0. 岗位预判（上传后自动填充） ---------------- */

export async function prefillRole({ resumeText }) {
  const raw = await chatJSON(prefillPrompt({ resumeText: resumeText.slice(0, 8000) }), {
    temperature: 0.2,
    maxTokens: 900,
  });
  const roles = arr(raw?.roles)
    .map((r) => ({
      title: str(r?.title),
      level: ['初级', '中级', '高级', '专家', '管理'].includes(r?.level) ? r.level : '',
      fitScore: clamp(r?.fitScore, 0, 100, 60),
      reason: str(r?.reason),
    }))
    .filter((r) => r.title)
    .slice(0, 3);
  return {
    roles,
    level: str(raw?.level),
    headline: str(raw?.headline),
    keywords: arr(raw?.keywords).map(str).filter(Boolean).slice(0, 8),
  };
}

/* ---------------- 1. 解析简历 + 知识点图谱 ---------------- */

export async function runAnalyze(ctx, { resumeText, targetRole, level, fileName }) {
  ctx.step(0, '正在读简历，拆分经历与技能');
  const profileRaw = await chatJSON(parseResumePrompt({ resumeText, targetRole, level }), {
    temperature: 0.2,
    maxTokens: 3000,
  });
  const profile = normalizeProfile(profileRaw);

  ctx.step(1, '正在推导需要复习的知识点');
  const finalRole = targetRole || profile.targetRole.title;
  const topicsRaw = await chatJSON(
    buildTopicsPrompt({ profile, targetRole: finalRole, level }),
    { temperature: 0.35, maxTokens: 7000 },
  );
  const groups = normalizeGroups(topicsRaw);
  if (!groups.length) throw new Error('没有生成出知识点，请重试或换一个模型');
  const topics = flatten(groups);

  const record = await store.create({
    stage: 'parsed',
    fileName: fileName || '',
    resumeText: resumeText.slice(0, 12000),
    targetRole: finalRole,
    level: level || '',
    profile,
    groups,
    topics,
  });

  return { analysisId: record.id, profile, groups, topics };
}

/* ---------------- 2. 生成复习资料 ---------------- */

export async function runMaterials(ctx, { analysisId, topicIds, depth = 'standard' }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  const level = DEPTHS[depth] ? depth : 'standard';
  const spec = depthSpec(level);

  const all = record.topics || [];
  const wanted = topicIds && topicIds.length
    ? all.filter((t) => topicIds.includes(t.id))
    : all.filter((t) => !(record.materials || []).some((m) => m.topicId === t.id));

  if (!wanted.length) return { analysisId, materials: record.materials || [] };

  const done = new Map((record.materials || []).map((m) => [m.topicId, m]));
  let finished = 0;

  ctx.step(0, `按「${spec.label}」深度生成 ${wanted.length} 个知识点的资料`);

  await pool(wanted, 2, async (topic) => {
    try {
      // 联网检索：结果既注入提示词，也作为引用来源随资料一起保存
      let searchBlock = '';
      let sources = [];
      if (searchReady()) {
        const results = await searchWeb(`${topic.title} 原理 面试 常见考点`, { maxResults: 4 });
        searchBlock = formatSearchBlock(results);
        sources = results.map((r, i) => ({ index: i + 1, title: r.title, url: r.url }));
      }
      const raw = await chatJSON(
        buildMaterialPrompt({
          profile: record.profile,
          topic,
          group: topic.group,
          targetRole: record.targetRole,
          searchBlock,
          depth: level,
        }),
        { temperature: level === 'deep' ? 0.5 : 0.45, maxTokens: spec.maxTokens },
      );

      const prev = done.get(topic.id);
      const body = {
        topicId: topic.id,
        topicTitle: topic.title,
        group: topic.group,
        level: topic.level,
        priority: topic.priority,
        gap: topic.gap,
        depth: level,
        oneLine: str(raw?.oneLine),
        core: arr(raw?.core).map(str).filter(Boolean),
        principle: str(raw?.principle),
        resumeHook: str(raw?.resumeHook),
        answerFramework: arr(raw?.answerFramework)
          .map((s) => ({ step: str(s?.step), say: str(s?.say) }))
          .filter((s) => s.step || s.say),
        followups: arr(raw?.followups)
          .map((f) => ({ q: str(f?.q), a: str(f?.a), trap: str(f?.trap) }))
          .filter((f) => f.q),
        pitfalls: arr(raw?.pitfalls).map(str).filter(Boolean),
        bonus: arr(raw?.bonus).map(str).filter(Boolean),
        drill: { question: str(raw?.drill?.question), hint: str(raw?.drill?.hint) },
        references: arr(raw?.references)
          .map((r) => ({ title: str(r?.title), note: str(r?.note) }))
          .filter((r) => r.title),
        sources,
        createdAt: new Date().toISOString(),
      };

      done.set(topic.id, {
        ...body,
        version: (prev?.version || 0) + 1,
        history: prev ? [snapshot(prev), ...(prev.history || [])].slice(0, 4) : [],
      });
    } catch (err) {
      console.error(`[materials] ${topic.title} 失败：`, err.message);
      const prev = done.get(topic.id);
      done.set(topic.id, prev || {
        topicId: topic.id,
        topicTitle: topic.title,
        group: topic.group,
        level: topic.level,
        priority: topic.priority,
        gap: topic.gap,
        error: err.message,
      });
    }
    finished += 1;
    ctx.tick(finished / wanted.length, `已完成 ${finished}/${wanted.length}：${topic.title}`);
  });

  const materials = [...done.values()];
  await store.update(analysisId, { materials, stage: 'materials' });
  ctx.tick(1, '资料已生成');
  return { analysisId, materials };
}

/** 历史版本只留正文，避免嵌套 */
function snapshot(m) {
  const { history, ...rest } = m;
  return {
    depth: rest.depth || 'standard',
    createdAt: rest.createdAt || new Date().toISOString(),
    data: rest,
  };
}

/* ---------------- 3. 出题 ---------------- */

export async function runQuiz(ctx, { analysisId, topicIds, count = 10 }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  const all = record.topics || [];
  const picked = topicIds && topicIds.length ? all.filter((t) => topicIds.includes(t.id)) : all.slice(0, 8);
  if (!picked.length) throw new Error('请先选择要测验的知识点');

  ctx.step(0, `正在围绕 ${picked.length} 个知识点出题`);
  const n = clamp(count, 4, 20, 10);

  const raw = await chatJSON(
    buildQuizPrompt({
      profile: record.profile,
      topics: picked,
      targetRole: record.targetRole,
      count: n,
    }),
    { temperature: 0.5, maxTokens: 4200 },
  );

  let total = 0;
  const validTopicIds = new Set(all.map((t) => t.id));
  const questions = arr(raw?.questions)
    .map((q, i) => {
      const type = ['choice', 'short', 'design'].includes(q?.type) ? q.type : 'short';
      const options = arr(q?.options).map(str).filter(Boolean);
      const points = clamp(q?.points, 1, 30, 10);
      total += points;
      const topicId = validTopicIds.has(str(q?.topicId)) ? str(q.topicId) : picked[0].id;
      const topicTitle = str(q?.topicTitle) || all.find((t) => t.id === topicId)?.title || '';
      return {
        id: `q${i + 1}`,
        topicId,
        topicTitle,
        type,
        difficulty: ['基础', '进阶', '深度'].includes(q?.difficulty) ? q.difficulty : '进阶',
        question: str(q?.question),
        options: type === 'choice' ? options.slice(0, 4) : [],
        answerIndex: type === 'choice' ? clamp(q?.answerIndex, 0, Math.max(options.length - 1, 3), 0) : -1,
        reference: str(q?.reference),
        rubric: arr(q?.rubric).map(str).filter(Boolean),
        points,
      };
    })
    .filter((q) => q.question)
    .slice(0, 24);

  if (!questions.length) throw new Error('题目生成失败，请重试');

  // 归一到 100 分
  const scale = total > 0 ? 100 / total : 1;
  questions.forEach((q) => {
    q.points = Math.max(1, Math.round(q.points * scale));
  });

  const quiz = {
    id: store.newId('quiz'),
    title: str(raw?.title) || '知识点测验',
    topicIds: picked.map((t) => t.id),
    questions,
    createdAt: new Date().toISOString(),
  };

  await store.update(analysisId, (rec) => ({
    ...rec,
    quizzes: [...(rec.quizzes || []), quiz],
    stage: 'quiz',
  }));

  return { analysisId, quiz };
}

/* ---------------- 4. 打分复盘 ---------------- */

export async function runGrade(ctx, { analysisId, quizId, answers }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const quiz = (record.quizzes || []).find((q) => q.id === quizId);
  if (!quiz) throw new Error('找不到这套测验');

  ctx.step(0, '正在批改');
  const raw = await chatJSON(
    buildGradePrompt({ quiz, answers, targetRole: record.targetRole }),
    { temperature: 0.2, maxTokens: 4500 },
  );

  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const items = arr(raw?.items)
    .map((it) => {
      const q = byId.get(str(it?.id));
      if (!q) return null;
      const score = clamp(it?.score, 0, q.points, 0);
      return {
        id: q.id,
        topicId: q.topicId,
        topicTitle: q.topicTitle,
        question: q.question,
        type: q.type,
        userAnswer: typeof answers[q.id] === 'string' ? answers[q.id] : String(answers[q.id] ?? ''),
        correct: q.type === 'choice' ? Number(answers[q.id]) === q.answerIndex : null,
        answerIndex: q.answerIndex,
        reference: q.reference,
        options: q.options,
        score: Math.round(score),
        max: q.points,
        verdict: str(it?.verdict),
        missed: arr(it?.missed).map(str).filter(Boolean),
        better: str(it?.better),
        knowledgeGap: str(it?.knowledgeGap),
      };
    })
    .filter(Boolean);

  const sum = items.reduce((s, i) => s + i.score, 0);
  const maxSum = items.reduce((s, i) => s + i.max, 0) || 1;
  const computed = Math.round((sum / maxSum) * 100);

  const grade = {
    total: clamp(raw?.total, 0, 100, computed),
    level: str(raw?.level) || levelOf(computed),
    dimensions: {
      concept: dim(raw?.dimensions?.concept, computed),
      depth: dim(raw?.dimensions?.depth, computed),
      expression: dim(raw?.dimensions?.expression, computed),
    },
    items,
    summary: str(raw?.summary),
    weakTopics: arr(raw?.weakTopics)
      .map((w) => ({
        topicId: str(w?.topicId),
        topicTitle: str(w?.topicTitle),
        reason: str(w?.reason),
        severity: clamp(w?.severity, 1, 5, 3),
      }))
      .filter((w) => w.topicTitle || w.topicId),
    nextActions: arr(raw?.nextActions).map(str).filter(Boolean),
    gradedAt: new Date().toISOString(),
  };

  const attempt = { id: store.newId('at'), quizId, answers, grade, createdAt: grade.gradedAt };

  await store.update(analysisId, (rec) => ({
    ...rec,
    attempts: [...(rec.attempts || []), attempt],
    stage: 'graded',
  }));

  return { analysisId, quizId, attempt };
}

function dim(d, fallback) {
  return {
    score: clamp(d?.score, 0, 100, fallback),
    comment: str(d?.comment),
  };
}

export function levelOf(score) {
  if (score >= 90) return '优秀';
  if (score >= 78) return '良好';
  if (score >= 60) return '基本合格';
  if (score >= 40) return '待加强';
  return '不及格';
}

/* ---------------- 5. 知识点拓展（AI 关联生成 + 可选联网检索） ---------------- */

export async function runExpand(ctx, { analysisId, topicId, count = 4 }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  const parent = (record.topics || []).find((t) => t.id === topicId);
  if (!parent) throw new Error('找不到要拓展的知识点');

  ctx.step(0, '检索相关知识');
  let searchBlock = '';
  if (searchReady()) {
    const results = await searchWeb(`${parent.title} 相关知识 延伸考点`, { maxResults: 6 });
    searchBlock = formatSearchBlock(results);
    ctx.note(searchBlock ? '已注入联网检索结果' : '联网检索未命中，改用模型知识');
  } else {
    ctx.note('未配置联网检索，使用模型知识拓展（.env 里配 SEARCH_PROVIDER + SEARCH_API_KEY 即可开启）');
  }

  ctx.step(1, '生成关联考点');
  const existing = record.topics || [];
  const raw = await chatJSON(
    expandTopicsPrompt({
      profile: record.profile,
      topic: parent,
      existingTitles: existing.map((t) => t.title),
      targetRole: record.targetRole,
      searchBlock,
      count: clamp(count, 2, 6, 4),
    }),
    { temperature: 0.55, maxTokens: 2200 },
  );

  const seen = new Set(existing.map((t) => t.title.trim()));
  let nextId = existing.length + 1;
  const added = [];
  for (const t of arr(raw?.topics)) {
    const title = str(t?.title);
    if (!title || seen.has(title.trim())) continue;
    seen.add(title.trim());
    added.push(normalizeTopic({ ...t, expanded: true }, `t${nextId}`, parent.group));
    nextId += 1;
    if (added.length >= clamp(count, 2, 6, 4)) break;
  }

  if (!added.length) {
    return { analysisId, added: [], parentTopicId: parent.id };
  }

  await store.update(analysisId, (rec) => {
    const groups = (rec.groups || []).map((g) =>
      g.name === parent.group ? { ...g, topics: [...g.topics, ...added] } : g,
    );
    return {
      ...rec,
      groups,
      topics: [...(rec.topics || []), ...added],
      materials: rec.materials || [],
    };
  });

  return { analysisId, added, parentTopicId: parent.id };
}

/* ---------------- 6. 下一步计划 ---------------- */

export async function runPlan(ctx, { analysisId, attemptId }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const attempt = attemptId
    ? (record.attempts || []).find((a) => a.id === attemptId)
    : (record.attempts || [])[record.attempts.length - 1];
  if (!attempt) throw new Error('请先完成一次测验，再生成提升计划');

  ctx.step(0, '正在根据复盘结果排计划');
  const raw = await chatJSON(
    buildPlanPrompt({
      profile: record.profile,
      topics: record.topics,
      grade: attempt.grade,
      targetRole: record.targetRole,
    }),
    { temperature: 0.4, maxTokens: 3000 },
  );

  const plan = {
    headline: str(raw?.headline),
    focus: arr(raw?.focus)
      .map((f) => ({
        topicId: str(f?.topicId),
        topicTitle: str(f?.topicTitle),
        why: str(f?.why),
        how: arr(f?.how).map(str).filter(Boolean),
      }))
      .filter((f) => f.topicTitle),
    days: arr(raw?.days)
      .map((d) => ({
        day: str(d?.day),
        goal: str(d?.goal),
        tasks: arr(d?.tasks)
          .map((t) => ({ time: str(t?.time), task: str(t?.task), type: str(t?.type) }))
          .filter((t) => t.task),
      }))
      .filter((d) => d.tasks.length),
    resources: arr(raw?.resources)
      .map((r) => ({ type: str(r?.type), title: str(r?.title), note: str(r?.note) }))
      .filter((r) => r.title),
    nextRound: str(raw?.nextRound),
    createdAt: new Date().toISOString(),
  };

  await store.update(analysisId, { plan, stage: 'planned' });
  return { analysisId, plan };
}

/* ---------------- 7. 面试准备报告（全网检索 + 优先级模块 + 分阶段路径） ---------------- */

export async function runReport(ctx, { analysisId, depth = 'standard' }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const level = DEPTHS[depth] ? depth : 'standard';
  const spec = depthSpec(level);

  const topics = (record.topics || []).slice().sort((a, b) => b.priority - a.priority);
  const top = topics.slice(0, 4);

  ctx.step(0, '检索岗位面经与行业资料');
  const searched = [];
  if (searchReady()) {
    const queries = [
      `${record.targetRole} 面试 高频问题 考察重点`,
      `${top.map((t) => t.title).slice(0, 2).join(' ')} 面试 深入`,
    ];
    for (const q of queries) {
      const results = await searchWeb(q, { maxResults: 4 });
      for (const r of results) {
        if (!searched.some((s) => s.url && s.url === r.url)) searched.push(r);
      }
    }
    ctx.note(searched.length ? `检索到 ${searched.length} 条外部资料` : '检索未命中，改用模型知识');
  } else {
    ctx.note('未配置联网检索，报告基于模型知识生成（.env 配 SEARCH_PROVIDER + SEARCH_API_KEY 可开启）');
  }

  const searchBlock = formatSearchBlock(searched.map((r) => ({ title: r.title, content: r.content, url: r.url })));

  ctx.step(1, '生成报告');
  const raw = await chatJSON(
    buildReportPrompt({
      profile: record.profile,
      topics,
      materials: record.materials,
      targetRole: record.targetRole,
      level: record.level,
      depth: level,
      searchBlock,
    }),
    { temperature: 0.4, maxTokens: spec.maxTokens + 1200 },
  );

  const validIds = new Set(topics.map((t) => t.id));
  const modules = arr(raw?.modules)
    .map((m, i) => ({
      topicId: validIds.has(str(m?.topicId)) ? str(m.topicId) : '',
      title: str(m?.title) || (validIds.has(str(m?.topicId)) ? topics.find((t) => t.id === str(m.topicId)).title : ''),
      priority: clamp(m?.priority, 1, 5, 3),
      order: clamp(m?.order, 1, 99, i + 1),
      why: str(m?.why),
      hours: str(m?.hours),
      depth: ['简单', '中等', '深度'].includes(m?.depth) ? m.depth : spec.label,
    }))
    .filter((m) => m.title)
    .sort((a, b) => a.order - b.order)
    .slice(0, 30);

  const modelSources = arr(raw?.sources)
    .map((s) => ({ title: str(s?.title), url: str(s?.url), note: str(s?.note) }))
    .filter((s) => s.title);

  const sources = [
    ...searched.map((r, i) => ({ index: i + 1, title: r.title, url: r.url, note: '' })),
    ...modelSources.filter((s) => !s.url || !searched.some((r) => r.url === s.url)),
  ].slice(0, 16);

  const report = {
    headline: str(raw?.headline),
    verdict: {
      fit: str(raw?.verdict?.fit) || '匹配',
      passProbability: str(raw?.verdict?.passProbability) || '中',
      summary: str(raw?.verdict?.summary),
    },
    strengths: arr(raw?.strengths).map(str).filter(Boolean).slice(0, 6),
    gaps: arr(raw?.gaps)
      .map((g) => ({ point: str(g?.point), impact: str(g?.impact), fix: str(g?.fix) }))
      .filter((g) => g.point)
      .slice(0, 6),
    modules,
    path: arr(raw?.path)
      .map((p) => ({
        phase: str(p?.phase),
        goal: str(p?.goal),
        items: arr(p?.items).map(str).filter(Boolean),
      }))
      .filter((p) => p.phase || p.items.length),
    interviewSim: arr(raw?.interviewSim)
      .map((r) => ({
        round: str(r?.round),
        focus: arr(r?.focus).map(str).filter(Boolean),
        typicalQuestions: arr(r?.typicalQuestions).map(str).filter(Boolean).slice(0, 5),
      }))
      .filter((r) => r.round),
    sources,
    depth: level,
    createdAt: new Date().toISOString(),
  };

  const prev = record.report;
  const next = {
    ...report,
    version: (prev?.version || 0) + 1,
    history: prev ? [{ depth: prev.depth, createdAt: prev.createdAt, data: stripHistory(prev) }, ...(prev.history || [])].slice(0, 4) : [],
  };

  await store.update(analysisId, { report: next, stage: 'reported' });
  return { analysisId, report: next };
}

function stripHistory(r) {
  const { history, ...rest } = r;
  return rest;
}
