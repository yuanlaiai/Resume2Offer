import { store } from './store.js';
import { chatJSON, chat } from './llm.js';
import { searchWeb, formatSearchBlock, searchReady } from './search.js';
import {
  parseResumePrompt,
  buildTopicsPrompt,
  buildCoveragePrompt,
  buildMaterialPrompt,
  buildQuizPrompt,
  buildGradePrompt,
  buildPlanPrompt,
  expandTopicsPrompt,
  prefillPrompt,
  buildReportPrompt,
  buildCoursePrompt,
  buildLessonPrompt,
  buildChatPrompt,
  buildQuickCardPrompt,
  buildFlashcardsPrompt,
  buildFeynmanPrompt,
  depthSpec,
  courseDepthSpec,
  DEPTHS,
} from './prompts.js';
import {
  normalizeStack,
  missingStacks,
  coverageOf,
  fallbackGroup,
  hasKey,
  keysOf,
  attachUncoveredTopics,
  topicCoverage,
} from './coverage.js';

const clamp = (n, min, max, dflt) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, v));
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);

/** 模型没给 stack 时，从 skills / experiences / projects 里兜底拼一份 */
function deriveStack(p) {
  const items = [];
  for (const s of arr(p?.skills)) {
    for (const part of str(s?.name).split(/\s*\/\s*/)) {
      if (part.trim()) items.push({ name: part.trim(), level: str(s?.level), evidence: str(s?.evidence) });
    }
  }
  for (const e of arr(p?.experiences)) {
    for (const s of arr(e?.stack)) items.push({ name: str(s), evidence: str(e?.company) });
  }
  for (const pr of arr(p?.projects)) {
    for (const s of arr(pr?.stack)) items.push({ name: str(s), evidence: str(pr?.name) });
  }
  return normalizeStack(items, 16);
}

function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const candidate = p.candidate && typeof p.candidate === 'object' ? p.candidate : {};
  const stack = normalizeStack(p.stack, 18);
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
    stack: stack.length ? stack : deriveStack(p),
  };
}

function normalizeGroups(raw, startNo = 1) {
  const groups = arr(raw?.groups).slice(0, 12);
  let counter = startNo - 1;
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
      .slice(0, 12);
    if (topics.length) out.push({ name, why: str(g?.why), topics });
  }
  return out;
}

function nextTopicNo(groups) {
  let max = 0;
  for (const g of groups || []) {
    for (const t of g.topics || []) {
      const m = /^t(\d+)$/.exec(t.id || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

const normGroupName = (s) => String(s || '').toLowerCase().replace(/[\s\-_·/、]/g, '');

/** 合并补充分组：同名（或包含关系）的并进已有组，其余追加 */
function mergeGroups(groups, incoming) {
  const out = (groups || []).map((g) => ({ ...g, topics: [...(g.topics || [])] }));
  for (const g of incoming || []) {
    const key = normGroupName(g.name);
    const hit = out.find((x) => {
      const k = normGroupName(x.name);
      return k === key || k.includes(key) || key.includes(k);
    });
    if (hit) {
      const seen = new Set(hit.topics.map((t) => t.title));
      hit.topics.push(...g.topics.filter((t) => !seen.has(t.title)));
    } else {
      out.push(g);
    }
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

/**
 * 覆盖保证：模型再"挑重点"，也不能把简历里写过的技术大类整类丢掉。
 * 缺的项先定向补一次，仍缺就落兜底分组，保证页面上每一类都有位置。
 */
async function ensureCoverage(ctx, { profile, groups, targetRole, level }) {
  let merged = groups;
  const warnings = [];

  let missing = missingStacks(profile.stack, merged);
  if (missing.length) {
    ctx.note(`发现 ${missing.length} 个技能没被覆盖，正在定向补齐：${missing.map((m) => m.name).join('、')}`);
    try {
      const raw = await chatJSON(
        buildCoveragePrompt({
          profile,
          targetRole,
          level,
          missing,
          existingGroups: merged.map((g) => g.name),
        }),
        { temperature: 0.3, maxTokens: 6500 },
      );
      merged = mergeGroups(merged, normalizeGroups(raw, nextTopicNo(merged)));
    } catch (err) {
      console.error('[coverage] 定向补齐失败：', err.message);
    }
    missing = missingStacks(profile.stack, merged);
  }

  for (const item of missing) {
    const [g] = normalizeGroups({ groups: [fallbackGroup(item)] }, nextTopicNo(merged));
    if (g) merged.push(g);
    warnings.push(item.name);
  }

  return { groups: merged, warnings };
}

export async function runAnalyze(ctx, { resumeText, targetRole, level, fileName }) {
  ctx.step(0, '正在读简历，拆分经历与技能');
  const profileRaw = await chatJSON(parseResumePrompt({ resumeText, targetRole, level }), {
    temperature: 0.2,
    maxTokens: 4000,
  });
  const profile = normalizeProfile(profileRaw);

  ctx.step(1, '正在推导需要复习的知识点');
  const finalRole = targetRole || profile.targetRole.title;
  const topicsRaw = await chatJSON(
    buildTopicsPrompt({ profile, targetRole: finalRole, level, mustCover: profile.stack }),
    { temperature: 0.35, maxTokens: 9000 },
  );
  let groups = normalizeGroups(topicsRaw);
  if (!groups.length) throw new Error('没有生成出知识点，请重试或换一个模型');

  const covered = await ensureCoverage(ctx, { profile, groups, targetRole: finalRole, level });
  groups = covered.groups;
  const topics = flatten(groups);

  const record = await store.create({
    stage: 'parsed',
    fileName: fileName || '',
    resumeText: resumeText.slice(0, 12000),
    targetRole: finalRole,
    level: level || '',
    profile,
    stack: profile.stack,
    coverage: coverageOf(profile.stack, groups),
    coverageWarnings: covered.warnings,
    groups,
    topics,
    courses: [],
  });

  return {
    analysisId: record.id,
    profile,
    groups,
    topics,
    coverage: record.coverage,
    coverageWarnings: record.coverageWarnings,
  };
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

/* ---------------- 2.5 系统课程：大纲 + 章节讲义 ---------------- */

const STAGE_NAMES = ['入门', '进阶', '实战', '精通'];
const STAGE_KEYS = ['beginner', 'advanced', 'practice', 'mastery'];
const LEVELS = ['基础', '进阶', '深度'];

function maxPriority(group) {
  return (group?.topics || []).reduce((m, t) => Math.max(m, t.priority || 0), 0);
}

function findStackItem(stack, groupName) {
  const target = str(groupName);
  return (stack || []).find((s) => keysOf(s).some((k) => hasKey(target, k)));
}

/** 讲义历史版本去掉嵌套 */
function stripLesson(lesson) {
  const { history, ...rest } = lesson;
  return rest;
}

function normalizeLesson(raw, { depth, sources, prev }) {
  const body = {
    objectives: arr(raw?.objectives).map(str).filter(Boolean).slice(0, 6),
    roadmap: arr(raw?.roadmap)
      .map((r) => ({ section: str(r?.section), points: arr(r?.points).map(str).filter(Boolean).slice(0, 5) }))
      .filter((r) => r.section || r.points.length),
    sections: arr(raw?.sections)
      .map((s) => ({
        heading: str(s?.heading),
        body: str(s?.body),
        code: str(s?.code),
        interviewAngle: str(s?.interviewAngle),
      }))
      .filter((s) => s.heading || s.body)
      .slice(0, 12),
    walkthrough: {
      case: str(raw?.walkthrough?.case),
      steps: arr(raw?.walkthrough?.steps).map(str).filter(Boolean).slice(0, 8),
    },
    qa: arr(raw?.qa)
      .map((q) => ({ q: str(q?.q), a: str(q?.a), trap: str(q?.trap) }))
      .filter((q) => q.q)
      .slice(0, 8),
    pitfalls: arr(raw?.pitfalls).map(str).filter(Boolean).slice(0, 6),
    exercises: arr(raw?.exercises)
      .map((e) => ({ task: str(e?.task), hint: str(e?.hint), standard: str(e?.standard) }))
      .filter((e) => e.task)
      .slice(0, 5),
    selfCheck: arr(raw?.selfCheck)
      .map((s) => ({ q: str(s?.q), answer: str(s?.answer) }))
      .filter((s) => s.q)
      .slice(0, 6),
    references: arr(raw?.references)
      .map((r) => ({ title: str(r?.title), note: str(r?.note) }))
      .filter((r) => r.title)
      .slice(0, 6),
    sources,
    depth,
    createdAt: new Date().toISOString(),
  };

  return {
    ...body,
    version: (prev?.version || 0) + 1,
    history: prev ? [{ depth: prev.depth, createdAt: prev.createdAt, data: stripLesson(prev) }, ...(prev.history || [])].slice(0, 2) : [],
  };
}

/** 模型没排出可用课程时，用已有考点兜底排一门（保证课程入口不空） */
function fallbackCourse(group, existing) {
  const rank = { 基础: 0, 进阶: 1, 深度: 2 };
  const topics = (group.topics || [])
    .slice()
    .sort((a, b) => (rank[a.level] ?? 1) - (rank[b.level] ?? 1) || (b.priority || 0) - (a.priority || 0));

  // 兜底也按 4 阶段铺（入门/进阶/实战/精通）；考点太少时空阶段会被过滤掉
  const per = Math.max(1, Math.ceil(topics.length / 4));
  const chunks = [0, 1, 2, 3].map((i) => topics.slice(per * i, per * (i + 1)));
  let n = 0;

  const stages = chunks
    .map((chunk, i) => {
      let prevTitle = '';
      const chapters = chunk.map((t) => {
        n += 1;
        const ch = {
          id: `ch${n}`,
          title: t.title,
          goal: `吃透「${t.title}」，并能接住面试追问`,
          why: t.reason || '',
          level: LEVELS.includes(t.level) ? t.level : '进阶',
          hours: 2,
          prereq: prevTitle ? [prevTitle] : [],
          keyQuestions: (t.followups || []).slice(0, 4),
          checkpoints: [`能脱稿讲清「${t.title}」的机制、边界，并举一个项目例子`],
          topicIds: [t.id],
          lesson: null,
        };
        prevTitle = t.title;
        return ch;
      });
      return {
        key: STAGE_KEYS[i] || `stage${i + 1}`,
        name: STAGE_NAMES[i] || `阶段 ${i + 1}`,
        goal: '',
        chapters,
      };
    })
    .filter((s) => s.chapters.length);

  const totalHours = stages.reduce((sum, s) => sum + s.chapters.reduce((x, c) => x + c.hours, 0), 0);
  return {
    id: existing?.id || store.newId('c'),
    group: group.name,
    title: `${group.name} 系统课：从入门到面试实战`,
    subtitle: '按考点难度排出的学习路径，先把地基打牢再上强度',
    outcome: '学完能按顺序讲清每个考点，并接住两层以上追问',
    totalHours,
    interviewWeight: maxPriority(group) || 3,
    stages,
    version: (existing?.version || 0) + 1,
    fallback: true,
    createdAt: new Date().toISOString(),
  };
}

function normalizeCourse(raw, { group, existing }) {
  const validIds = new Set((group.topics || []).map((t) => t.id));
  let chNo = 0;

  const stages = arr(raw?.stages)
    .slice(0, 4)
    .map((s, i) => {
      const chapters = arr(s?.chapters)
        .slice(0, 7)
        .map((ch) => {
          chNo += 1;
          return {
            id: `ch${chNo}`,
            title: str(ch?.title),
            goal: str(ch?.goal),
            why: str(ch?.why),
            level: LEVELS.includes(ch?.level) ? ch.level : '进阶',
            hours: clamp(ch?.hours, 0.5, 8, 2),
            prereq: arr(ch?.prereq).map(str).filter(Boolean).slice(0, 4),
            keyQuestions: arr(ch?.keyQuestions).map(str).filter(Boolean).slice(0, 5),
            checkpoints: arr(ch?.checkpoints).map(str).filter(Boolean).slice(0, 4),
            topicIds: [...new Set(arr(ch?.topicIds).map(str).filter((id) => validIds.has(id)))],
            lesson: null,
          };
        })
        .filter((c) => c.title);
      return {
        key: STAGE_KEYS[i] || `stage${i + 1}`,
        name: str(s?.name) || STAGE_NAMES[i] || `阶段 ${i + 1}`,
        goal: str(s?.goal),
        chapters,
      };
    })
    .filter((s) => s.chapters.length);

  const chapterCount = stages.reduce((sum, s) => sum + s.chapters.length, 0);
  if (stages.length < 2 || chapterCount < 3) return fallbackCourse(group, existing);

  // 重新排课时，同名章节的讲义保留下来，避免用户白学
  const oldLessons = new Map();
  for (const s of existing?.stages || []) {
    for (const c of s.chapters || []) {
      if (c.lesson) oldLessons.set(normGroupName(c.title), c.lesson);
    }
  }
  for (const s of stages) {
    for (const c of s.chapters) {
      const old = oldLessons.get(normGroupName(c.title));
      if (old) c.lesson = old;
    }
  }

  const hours = stages.reduce((sum, s) => sum + s.chapters.reduce((x, c) => x + c.hours, 0), 0);

  return {
    id: existing?.id || store.newId('c'),
    group: group.name,
    title: str(raw?.title) || `${group.name} 系统课`,
    subtitle: str(raw?.subtitle),
    outcome: str(raw?.outcome),
    totalHours: clamp(raw?.totalHours, 1, 120, Math.round(hours) || 10),
    interviewWeight: clamp(raw?.interviewWeight, 1, 5, maxPriority(group) || 3),
    stages,
    version: (existing?.version || 0) + 1,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 生成课程大纲。
 * names 指定要排的组；auto=true 时自动补优先级最高且还没有课程的 3 个组。
 */
export async function runCourses(ctx, { analysisId, names, auto = false }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  const groups = record.groups || [];
  if (!groups.length) throw new Error('还没有知识点，请先完成简历分析');

  const existing = new Map((record.courses || []).map((c) => [c.group, c]));
  const stack = record.stack?.length ? record.stack : record.profile?.stack || [];
  let targets;
  if (Array.isArray(names) && names.length) {
    targets = groups.filter((g) => names.includes(g.name));
  } else if (auto) {
    // 自动排课优先保证「简历里的每个技术大类」都有课，其次才是其他分组
    const stackOf = (g) => findStackItem(stack, g.name);
    const pending = groups.filter((g) => !existing.has(g.name));
    const stackTargets = pending.filter((g) => stackOf(g)).sort((a, b) => maxPriority(b) - maxPriority(a));
    const others = pending.filter((g) => !stackOf(g)).sort((a, b) => maxPriority(b) - maxPriority(a));
    targets = [...stackTargets, ...others].slice(0, 6);
  } else {
    targets = groups.filter((g) => !existing.has(g.name));
  }

  if (!targets.length) {
    return { analysisId, courses: record.courses || [], added: [], skipped: true };
  }

  ctx.step(0, `正在为 ${targets.length} 个技术大类排课（共 ${groups.length} 类）`);

  const results = new Array(targets.length).fill(null);
  const failed = [];
  let finished = 0;

  await pool(targets, 2, async (group, i) => {
    const ask = (compact) =>
      buildCoursePrompt({
        profile: record.profile,
        group,
        targetRole: record.targetRole,
        level: record.level,
        stackItem: findStackItem(stack, group.name),
        compact,
      });
    try {
      let raw;
      try {
        raw = await chatJSON(ask(false), { temperature: 0.35, maxTokens: 12000 });
      } catch (err) {
        // 章数多时个别模型会截断：降一档章数再试一次，总比这门课直接失败好
        if (err?.code !== 'BAD_JSON') throw err;
        console.warn(`[courses] ${group.name} 大纲过长，降级为精简版重试：`, err.message);
        raw = await chatJSON(ask(true), { temperature: 0.3, maxTokens: 9000 });
      }
      const course = normalizeCourse(raw, { group, existing: existing.get(group.name) });
      // 章数再多，考点没落到章里也等于没讲：这里做一次硬性补齐
      const fix = attachUncoveredTopics(course, group);
      course.topicCoverage = topicCoverage(course, group);
      if (fix.attached.length || fix.created.length) {
        console.log(
          `[courses] ${group.name} 补齐考点：挂靠 ${fix.attached.length} 个、新增 ${fix.created.length} 章`,
        );
      }
      results[i] = course;
    } catch (err) {
      console.error(`[courses] ${group.name} 排课失败：`, err.message);
      failed.push({ group: group.name, error: err.message });
    }
    finished += 1;
    ctx.tick(finished / targets.length, `已完成 ${finished}/${targets.length}：${group.name}`);
  });

  const added = results.filter(Boolean);
  const byGroup = new Map([...(record.courses || []), ...added].map((c) => [c.group, c]));
  const courses = groups.map((g) => byGroup.get(g.name)).filter(Boolean);

  await store.update(analysisId, { courses, stage: record.stage || 'parsed' });
  ctx.tick(1, added.length ? `已排好 ${added.length} 门课` : '排课未成功');

  if (!added.length && failed.length) throw new Error(failed[0].error || '排课失败，请重试');
  return { analysisId, courses, added, failed };
}

/**
 * 生成章节讲义。chapterIds 为空则补该课程里所有还没讲义的章节（单次最多 4 章）。
 */
export async function runLessons(ctx, { analysisId, courseId, chapterIds, depth = 'standard' }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  const course = (record.courses || []).find((c) => c.id === courseId);
  if (!course) throw new Error('找不到这门课程，请先生成课程大纲');

  const level = DEPTHS[depth] ? depth : 'standard';
  const spec = courseDepthSpec(level);

  const all = [];
  for (const stage of course.stages || []) {
    for (const chapter of stage.chapters || []) all.push({ stage, chapter });
  }

  let targets = Array.isArray(chapterIds) && chapterIds.length
    ? all.filter((x) => chapterIds.includes(x.chapter.id))
    : all.filter((x) => !x.chapter.lesson);

  if (!targets.length) return { analysisId, course };

  const total = targets.length;
  targets = targets.slice(0, 4);
  ctx.step(0, `正在写 ${targets.length} 节讲义（${spec.label}档）`);

  let finished = 0;
  const failed = [];
  await pool(targets, 2, async ({ stage, chapter }) => {
    try {
      let searchBlock = '';
      let sources = [];
      if (searchReady()) {
        const results = await searchWeb(`${course.title} ${chapter.title} 原理 面试 高频考点`, { maxResults: 4 });
        searchBlock = formatSearchBlock(results);
        sources = results.map((r, i) => ({ index: i + 1, title: r.title, url: r.url }));
      }

      const topics = (chapter.topicIds || [])
        .map((id) => (record.topics || []).find((t) => t.id === id))
        .filter(Boolean);

      const raw = await chatJSON(
        buildLessonPrompt({
          profile: record.profile,
          course,
          stage,
          chapter,
          topics,
          materials: record.materials || [],
          targetRole: record.targetRole,
          searchBlock,
          depth: level,
        }),
        { temperature: level === 'deep' ? 0.45 : 0.4, maxTokens: spec.maxTokens },
      );

      chapter.lesson = normalizeLesson(raw, { depth: level, sources, prev: chapter.lesson });
      delete chapter.lessonError;
    } catch (err) {
      console.error(`[lessons] ${chapter.title} 失败：`, err.message);
      chapter.lessonError = err.message;
      failed.push({ chapterId: chapter.id, title: chapter.title, error: err.message });
    }
    finished += 1;
    ctx.tick(finished / targets.length, `已完成 ${finished}/${targets.length}：${chapter.title}`);
  });

  await store.update(analysisId, { courses: record.courses });
  ctx.tick(1, '讲义已生成');
  return { analysisId, course, failed, truncated: total > targets.length };
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

/* ---------------- AI 随问（划词追问） ---------------- */

/**
 * 多轮随问对话：不进任务队列，直接 await。
 * messages 由调用方传入（含最新一条 user），服务端负责注入背景并落库。
 */
export async function runChat({ analysisId, messages, selection, context }) {
  const record = analysisId ? store.get(analysisId) : null;

  const prompt = buildChatPrompt({
    profile: record?.profile,
    targetRole: record?.targetRole,
    selection,
    context,
    messages,
  });

  const reply = await chat(prompt, { temperature: 0.5, maxTokens: 3000 });

  if (record) {
    const chats = [
      ...(record.chats || []),
      ...messages.filter((m) => m.role === 'user' && m.content?.trim()),
      { role: 'assistant', content: reply, at: new Date().toISOString() },
    ].slice(-40);
    await store.update(record.id, { chats });
  }

  return { reply, analysisId: record?.id || null };
}

/* ---------------- 速学中心 ---------------- */

const DAY = 24 * 60 * 60 * 1000;
/** 简化 SM-2：自评 4 档 → 下一次间隔（天） */
const SRS_INTERVALS = [1, 3, 7, 15, 30];

function normalizeCard(raw, id, topicTitle) {
  return {
    id,
    topicId: str(raw?.topicId),
    topicTitle: topicTitle || str(raw?.topicId),
    type: ['概念', '机制', '对比', '场景', '排错'].includes(raw?.type) ? raw.type : '概念',
    front: str(raw?.front),
    back: arr(raw?.back).map(str).filter(Boolean).slice(0, 5),
    mnemonic: str(raw?.mnemonic),
    // 复习调度
    stage: 0, // SRS_INTERVALS 下标
    dueAt: Date.now(), // 立即可复习
    reviews: 0,
    lapses: 0,
    lastAt: null,
    createdAt: Date.now(),
  };
}

/** 生成闪卡：runFlashcards */
export async function runFlashcards(ctx, { analysisId, count = 12, topicIds = null }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');

  let topics = record.topics || [];
  if (Array.isArray(topicIds) && topicIds.length) {
    const set = new Set(topicIds);
    topics = topics.filter((t) => set.has(t.id));
  }
  if (!topics.length) topics = record.topics || [];
  if (!topics.length) throw new Error('没有可用的知识点，请先完成简历分析');

  ctx.step(0, `正在把 ${topics.length} 个知识点做成闪卡`);
  const raw = await chatJSON(
    buildFlashcardsPrompt({
      profile: record.profile,
      targetRole: record.targetRole,
      topics,
      count: clamp(count, 6, 20, 12),
    }),
    { temperature: 0.5, maxTokens: 5000 },
  );

  const topicTitle = new Map(topics.map((t) => [t.id, t.title]));
  const existing = new Set((record.flashcards || []).map((c) => c.front));
  const fresh = [];
  let n = (record.flashcards || []).length;
  for (const c of arr(raw?.cards)) {
    const card = normalizeCard(c, `f${n + 1}`, topicTitle.get(c?.topicId) || '');
    if (!card.front || existing.has(card.front)) continue;
    existing.add(card.front);
    n += 1;
    fresh.push(card);
  }
  if (!fresh.length) throw new Error('没有生成出新卡片，请重试');

  const flashcards = [...(record.flashcards || []), ...fresh];
  await store.update(analysisId, { flashcards });
  return { analysisId, added: fresh.length, flashcards };
}

/** 翻卡自评：grade 0=忘了 1=想很久 2=记得 3=秒答 */
export async function reviewCard({ analysisId, cardId, grade }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const card = (record.flashcards || []).find((c) => c.id === cardId);
  if (!card) throw new Error('找不到这张卡片');

  const g = clamp(grade, 0, 3, 2);
  if (g === 0) {
    card.stage = 0;
    card.lapses += 1;
  } else {
    card.stage = Math.min(card.stage + (g >= 2 ? 1 : 0) + 1, SRS_INTERVALS.length - 1);
  }
  card.reviews += 1;
  card.lastAt = Date.now();
  card.dueAt = Date.now() + SRS_INTERVALS[card.stage] * DAY;
  card.lastGrade = g;

  await store.update(analysisId, { flashcards: record.flashcards });
  return { card };
}

/** 5 分钟速览卡 */
export async function runQuickCard(ctx, { analysisId, topicId }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const topic = (record.topics || []).find((t) => t.id === topicId);
  if (!topic) throw new Error('找不到知识点');

  ctx.step(0, `正在为「${topic.title}」写速览卡`);
  const material = (record.materials || []).find((m) => m.topicId === topicId && !m.error);
  const raw = await chatJSON(
    buildQuickCardPrompt({ profile: record.profile, targetRole: record.targetRole, topic, material }),
    { temperature: 0.45, maxTokens: 2600 },
  );

  const card = {
    topicId,
    topicTitle: topic.title,
    tldr: str(raw?.tldr),
    why: str(raw?.why),
    core: arr(raw?.core).map(str).filter(Boolean),
    mentalModel: str(raw?.mentalModel),
    howAsked: arr(raw?.howAsked).map(str).filter(Boolean),
    trap: str(raw?.trap),
    minute: {
      a: str(raw?.minute?.['0-1']),
      b: str(raw?.minute?.['1-3']),
      c: str(raw?.minute?.['3-5']),
    },
    goDeeper: str(raw?.goDeeper),
    createdAt: new Date().toISOString(),
  };
  if (!card.tldr && !card.core.length) throw new Error('速览卡生成失败，请重试');

  const quickCards = [...(record.quickCards || []).filter((c) => c.topicId !== topicId), card];
  await store.update(analysisId, { quickCards });
  return { analysisId, card, quickCards };
}

/** 费曼检验：复述 → 批改 */
export async function runFeynman(ctx, { analysisId, topicId, explanation }) {
  const record = store.get(analysisId);
  if (!record) throw new Error('找不到这份简历分析');
  const topic = (record.topics || []).find((t) => t.id === topicId);
  if (!topic) throw new Error('找不到知识点');
  const text = (explanation || '').trim();
  if (text.length < 10) throw new Error('复述太短了，至少写几十个字才能批改出东西');

  ctx.step(0, '面试官正在批改你的复述');
  const materials = (record.materials || []).filter((m) => m.topicId === topicId);
  const raw = await chatJSON(
    buildFeynmanPrompt({ profile: record.profile, targetRole: record.targetRole, topic, explanation: text, materials }),
    { temperature: 0.35, maxTokens: 2600 },
  );

  const grade = {
    id: `fy${(record.feynman || []).length + 1}`,
    topicId,
    topicTitle: topic.title,
    explanation: text.slice(0, 4000),
    score: clamp(raw?.score, 0, 100, 0),
    verdict: str(raw?.verdict),
    got: arr(raw?.got).map(str).filter(Boolean),
    missed: arr(raw?.missed).map(str).filter(Boolean),
    wrong: arr(raw?.wrong)
      .map((w) => ({ claim: str(w?.claim), truth: str(w?.truth), why: str(w?.why) }))
      .filter((w) => w.claim || w.truth),
    upgrade: str(raw?.upgrade),
    nextStep: str(raw?.nextStep),
    at: new Date().toISOString(),
  };

  const feynman = [...(record.feynman || []), grade];
  await store.update(analysisId, { feynman });
  return { analysisId, grade, feynman };
}

/** 每日速学：到期闪卡 + 1 个新知识点建议（不调用模型，直接计算） */
export function dailyPlan(record) {
  const now = Date.now();
  const cards = record.flashcards || [];
  const due = cards
    .filter((c) => c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 5);
  const upcoming = cards
    .filter((c) => c.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 3)
    .map((c) => ({ id: c.id, front: c.front, dueIn: Math.ceil((c.dueAt - now) / DAY) }));

  // 新知识点：优先级最高且（无闪卡/无资料/无费曼）覆盖最少的
  const covered = new Set([
    ...(record.materials || []).filter((m) => !m.error).map((m) => m.topicId),
    ...(record.quickCards || []).map((c) => c.topicId),
    ...(record.feynman || []).map((f) => f.topicId),
    ...cards.map((c) => c.topicId),
  ]);
  const fresh = (record.topics || [])
    .filter((t) => !covered.has(t.id))
    .sort((a, b) => b.priority - a.priority)[0] || null;

  // 费曼弱项：最近一次批改 < 70 分的知识点
  const lastByTopic = new Map();
  for (const f of record.feynman || []) lastByTopic.set(f.topicId, f);
  const weak = [...lastByTopic.values()]
    .filter((f) => f.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((f) => ({ topicId: f.topicId, topicTitle: f.topicTitle, score: f.score }));

  return {
    due,
    dueCount: due.length,
    upcoming,
    freshTopic: fresh,
    weakTopics: weak,
    totalCards: cards.length,
    mastered: cards.filter((c) => c.stage >= SRS_INTERVALS.length - 1).length,
  };
}
