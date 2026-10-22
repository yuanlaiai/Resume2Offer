/**
 * 技能覆盖校验：保证简历里出现的每一个技术大类（Java / Android / Docker / K8s…）
 * 都能落到至少一个复习分组里，不被模型"挑重点"挑掉。
 *
 * 这里只做纯函数，方便单测；不依赖 store / llm。
 */

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const asciiOnly = /^[\x00-\x7f]+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 归一键：去空格与常见分隔符，用于去重 */
export function normName(name) {
  return str(name)
    .toLowerCase()
    .replace(/[\s\-_·/、.]+/g, '');
}

/** 常见同义词。键也必须是 normName 之后的形式 */
const ALIASES = {
  k8s: ['kubernetes', 'kube'],
  kubernetes: ['k8s'],
  android: ['安卓'],
  安卓: ['android'],
  java: ['jdk', 'jvm'],
  jdk: ['java'],
  jvm: ['java'],
  spring: ['spring boot', 'springboot'],
  springboot: ['spring boot', 'spring'],
  js: ['javascript'],
  javascript: ['js'],
  ts: ['typescript'],
  typescript: ['ts'],
  node: ['nodejs'],
  nodejs: ['node'],
  vue: ['vuejs'],
  vuejs: ['vue'],
  react: ['reactjs'],
  reactjs: ['react'],
  golang: ['go'],
  go: ['golang'],
  postgres: ['postgresql', 'pg'],
  postgresql: ['postgres', 'pg'],
  es: ['elasticsearch'],
  elasticsearch: ['es'],
  mongo: ['mongodb'],
  mongodb: ['mongo'],
  mysql: ['mariadb'],
};

/**
 * 一个技能项可能被哪些写法命中（原名 + 别名 + 别名自身的别名）
 * @returns {string[]}
 */
export function keysOf(item) {
  const keys = new Set();
  const add = (v) => {
    const s = str(v);
    if (!s) return;
    keys.add(s);
    for (const a of ALIASES[normName(s)] || []) keys.add(a);
  };
  add(item?.name);
  // 模型可能把多个别名塞进 alias 字段
  for (const part of str(item?.alias).split(/[,，/、;；|]+/)) add(part);
  return [...keys];
}

/**
 * 在文本里找技能关键词。
 * 英文按 token 边界匹配，避免 Java 命中 JavaScript、RAG 命中 storage；
 * 中文用 includes。
 */
export function hasKey(text, key) {
  const t = String(text ?? '');
  const k = str(key);
  if (!t || !k) return false;
  if (!asciiOnly.test(k)) return t.toLowerCase().includes(k.toLowerCase());
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`, 'i');
  return re.test(t);
}

/** 某个分组是否覆盖了该技能（只看组名与考点标题，避免理由里的顺带提及造成误判） */
export function groupCovers(group, item) {
  const texts = [group?.name, ...(group?.topics || []).map((t) => t?.title)];
  const keys = keysOf(item);
  return keys.some((k) => texts.some((t) => hasKey(t, k)));
}

/** 技能栈归一化：去空、去重（同义词视为同一项）、去噪 */
export function normalizeStack(raw, limit = 20) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = str(item?.name);
    if (!name) continue;
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    const keys = keysOf(item).map(normName);
    // 已经收录过同义词（如先有 Kubernetes 又来 K8s）就跳过
    if (keys.some((k) => seen.has(k))) continue;
    seen.add(key);
    keys.forEach((k) => seen.add(k));
    out.push({
      name,
      alias: str(item?.alias),
      category: str(item?.category) || '其他',
      level: str(item?.level) || '掌握',
      evidence: str(item?.evidence).slice(0, 120),
      mustReview: item?.mustReview !== false,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 找出没有被任何分组覆盖的技能 */
export function missingStacks(stack, groups) {
  const list = (stack || []).filter((s) => s?.mustReview !== false);
  const gs = Array.isArray(groups) ? groups : [];
  return list.filter((item) => !gs.some((g) => groupCovers(g, item)));
}

/** 把技能栈映射到分组，供画像页展示「技能覆盖」 */
export function coverageOf(stack, groups) {
  const gs = Array.isArray(groups) ? groups : [];
  return (stack || []).map((item) => {
    const hit = gs.find((g) => groupCovers(g, item));
    return {
      name: item.name,
      alias: item.alias || '',
      category: item.category || '',
      level: item.level || '',
      evidence: item.evidence || '',
      group: hit?.name || '',
      covered: Boolean(hit),
      required: item.mustReview !== false,
    };
  });
}

/* ---------------- 考点 → 章节覆盖（课程不看章数够不够，看考点有没有落到章） ---------------- */

const STOP = new Set([
  '一个', '以及', '怎么', '如何', '什么', '为什么', '哪些', '多少', '这个', '那个',
  '进行', '实现', '使用', '基于', '相关', '问题', '场景', '方案', '体系', '能力',
]);

/** 把标题拆成可比较的词元：英文词 + 中文二元组 */
export function tokensOf(text) {
  const s = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const w of s.match(/[a-z][a-z0-9+#._-]{1,}/g) || []) out.add(w);
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cjk.length - 1; i += 1) {
    const bg = cjk.slice(i, i + 2);
    if (!STOP.has(bg)) out.add(bg);
  }
  return out;
}

function scoreChapter(chapter, topic, exclude) {
  const a = tokensOf(`${chapter?.title || ''} ${chapter?.goal || ''}`);
  const b = tokensOf(`${topic?.title || ''} ${topic?.reason || ''}`);
  let score = 0;
  for (const t of b) {
    // 组名本身（Kafka / RAG）每章都有，不算相似度信号，否则什么考点都会挂到第一章
    if (exclude.has(t) || !a.has(t)) continue;
    score += /^[a-z]/.test(t) ? 3 : 1;
  }
  return score;
}

/** 一门课的考点覆盖情况 */
export function topicCoverage(course, group) {
  const topics = Array.isArray(group?.topics) ? group.topics : [];
  const used = new Set();
  for (const s of course?.stages || []) {
    for (const c of s.chapters || []) for (const id of c.topicIds || []) used.add(id);
  }
  const covered = topics.filter((t) => used.has(t.id));
  const missing = topics.filter((t) => !used.has(t.id));
  return {
    total: topics.length,
    covered: covered.length,
    missing: missing.map((t) => t.title),
    entries: missing.map((t) => ({ id: t.id, title: t.title })),
  };
}

/**
 * 把没被任何章节引用的考点补进课程：
 * 先按关键词相似度挂到最相关的一章，实在没有对应章节就新增一章（放到匹配的阶段）。
 * 返回 { attached: [...], created: [...] }，纯函数式地改动传入的 course。
 */
export function attachUncoveredTopics(course, group) {
  const attached = [];
  const created = [];
  const topics = Array.isArray(group?.topics) ? group.topics : [];
  if (!topics.length || !course?.stages?.length) return { attached, created };

  const chapters = course.stages.flatMap((s) => s.chapters || []);
  const used = new Set(chapters.flatMap((c) => c.topicIds || []));
  const missing = topics.filter((t) => !used.has(t.id));
  if (!missing.length) return { attached, created };

  const stageByLevel = (level) => {
    const idx = level === '基础' ? 0 : level === '深度' ? course.stages.length - 1 : Math.min(1, course.stages.length - 1);
    return course.stages[idx] || course.stages[course.stages.length - 1];
  };

  const exclude = tokensOf(group?.name || '');
  let chNo = chapters.length;
  for (const topic of missing) {
    let best = null;
    let bestScore = 0;
    for (const ch of chapters) {
      const sc = scoreChapter(ch, topic, exclude);
      if (sc > bestScore) {
        bestScore = sc;
        best = ch;
      }
    }

    // 有明确相关章节：直接挂上去，不为了好看硬造新章
    if (best && bestScore >= 2) {
      best.topicIds = [...new Set([...(best.topicIds || []), topic.id])];
      attached.push({ id: topic.id, title: topic.title, chapter: best.title });
      continue;
    }

    // 没有对应章节：补一章，保证这个考点在课程里真的讲得到
    const stage = stageByLevel(topic.level);
    chNo += 1;
    const chapter = {
      id: `ch${chNo}`,
      title: topic.title,
      goal: `吃透「${topic.title}」，并能接住面试追问`,
      why: String(topic.reason || '').slice(0, 120),
      level: ['基础', '进阶', '深度'].includes(topic.level) ? topic.level : '进阶',
      hours: 2,
      prereq: [],
      keyQuestions: (topic.followups || []).slice(0, 3),
      checkpoints: [`能脱稿讲清「${topic.title}」的机制、边界，并举一个项目例子`],
      topicIds: [topic.id],
      lesson: null,
      added: true,
    };
    stage.chapters = [...(stage.chapters || []), chapter];
    chapters.push(chapter);
    created.push({ id: topic.id, title: topic.title, stage: stage.name });
  }

  return { attached, created };
}

/**
 * 兜底分组：模型补生成失败时也要保证页面上有这一类，
 * 内容虽通用，但至少给出可继续深挖的三个方向。
 */
export function fallbackGroup(item) {
  const name = str(item?.name) || '未命名技能';
  const evidence = str(item?.evidence);
  const why = `简历里明确写了 ${name}${evidence ? `（${evidence}）` : ''}。这类技能在面试里通常会被单独追问一轮，必须按体系过一遍，而不是只背零散结论。`;
  return {
    name,
    why,
    fallback: true,
    topics: [
      {
        title: `${name} 核心概念与知识地图`,
        level: '基础',
        priority: 5,
        gap: false,
        reason: `面试官通常先花两分钟确认你对 ${name} 有没有整体认知，再决定往哪深挖。`,
        interviewerFocus: '不是听你背名词，而是看你能不能画出这个技术的边界：它解决什么问题、不解决什么问题。',
        followups: [`${name} 和相邻技术相比，什么时候该用、什么时候不该用？`, '你项目里为什么选它？'],
      },
      {
        title: `${name} 高频面试题与原理追问`,
        level: '进阶',
        priority: 4,
        gap: false,
        reason: `这是 ${name} 在面试中最密集的考察区，简历里写了就必须接得住连续追问。`,
        interviewerFocus: '看你能不能从"会用"讲到"为什么这样设计"，以及答错时的边界意识。',
        followups: ['这个机制在什么情况下会失效？', '如果让你 redesign，你会改哪里？'],
      },
      {
        title: `${name} 在项目中的落地与故障排查`,
        level: '深度',
        priority: 4,
        gap: false,
        reason: `简历里的项目经历会被顺着 ${name} 追问：怎么落地、出过什么问题、怎么定位。`,
        interviewerFocus: '看你是不是真的动过手：有没有量化结果，能不能讲清一次真实的排障过程。',
        followups: ['线上出过最严重的一次问题是什么？', '你怎么证明优化有效？'],
      },
    ],
  };
}
