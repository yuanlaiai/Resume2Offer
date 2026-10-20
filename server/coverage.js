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
