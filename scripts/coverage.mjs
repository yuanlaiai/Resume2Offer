/**
 * 技能覆盖回归测试。
 * 目标：简历里的技术大类不能被"挑重点"挑掉，也不能被相似词误判成已覆盖。
 */
import {
  hasKey,
  groupCovers,
  normalizeStack,
  missingStacks,
  coverageOf,
  fallbackGroup,
  attachUncoveredTopics,
  topicCoverage,
} from '../server/coverage.js';

const checks = [];
const ok = (label, cond, extra = '') => checks.push({ label, cond: Boolean(cond), extra });

/* ---- 关键词匹配：不能误伤 ---- */
ok('Java 不被 JavaScript 误命中', !hasKey('JavaScript 工程化实践', 'java'));
ok('RAG 不被 storage 误命中', !hasKey('对象存储 storage 选型', 'RAG'));
ok('Go 不被 Google 误命中', !hasKey('Google Cloud 部署', 'Go'));
ok('Java 能命中「Java 并发」', hasKey('Java 并发与线程池', 'Java'));
ok('中文关键词按子串命中', hasKey('安卓性能优化', '安卓'));

/* ---- 别名匹配 ---- */
ok(
  'K8s 别名可覆盖 Kubernetes 分组',
  groupCovers({ name: 'Kubernetes 集群管理', topics: [] }, { name: 'K8s' }),
);
ok(
  'Docker 能命中考点标题',
  groupCovers({ name: '云原生', topics: [{ title: 'Docker 镜像分层与构建缓存' }] }, { name: 'Docker' }),
);

/* ---- 归一化与去重 ---- */
const stack = normalizeStack([
  { name: 'Java' },
  { name: 'K8s', alias: 'Kubernetes' },
  { name: 'Kubernetes' },
  { name: 'Android' },
  { name: 'Docker' },
  { name: 'Redis' },
  { name: 'Python', mustReview: false },
]);
ok('技能栈去重（K8s / Kubernetes 合一）', stack.length === 6, stack.map((s) => s.name).join(' / '));

/* ---- 缺失检测与兜底 ---- */
const groups = [{ name: '后端基本功', topics: [{ title: 'MySQL 索引失效的 6 种场景' }] }];
const missing = missingStacks(stack, groups);
ok(
  'Java / Android / Docker / Redis 都被判定为缺失',
  ['Java', 'Android', 'Docker', 'Redis'].every((n) => missing.some((m) => m.name === n)),
  missing.map((m) => m.name).join(' / '),
);
ok('非必考项不参与缺失判断', !missing.some((m) => m.name === 'Python'));

const filled = [...groups, ...missing.map(fallbackGroup)];
ok('兜底分组后完全覆盖', missingStacks(stack, filled).length === 0);
ok('每个兜底分组都给 3 个可深挖考点', filled.slice(1).every((g) => g.topics.length === 3));

/* ---- 画像页覆盖数据 ---- */
const cov = coverageOf(stack, filled);
ok(
  'coverageOf 正确标记覆盖与必考属性',
  cov.find((c) => c.name === 'Java')?.covered === true &&
    cov.find((c) => c.name === 'Redis')?.covered === true &&
    cov.find((c) => c.name === 'Python')?.required === false,
);

/* ---- 课程对考点的硬覆盖 ---- */
const g = {
  name: 'RAG',
  topics: [
    { id: 't1', title: 'RAG 链路与召回率', level: '基础', followups: ['召回率怎么测？'] },
    { id: 't2', title: '向量库索引选型', level: '进阶', followups: ['HNSW 和 IVF 怎么选？'] },
    { id: 't3', title: '重排序 rerank 的收益', level: '深度', followups: ['rerank 什么时候没用？'] },
  ],
};
const course = {
  stages: [
    { name: '入门', chapters: [{ id: 'ch1', title: 'RAG 链路怎么跑通', goal: '讲清召回与生成', topicIds: ['t1'] }] },
    { name: '进阶', chapters: [{ id: 'ch2', title: '向量库索引', goal: '选型与调参', topicIds: [] }] },
    { name: '精通', chapters: [{ id: 'ch3', title: '重排序与效果优化', goal: 'rerank 收益评估', topicIds: [] }] },
  ],
};
const before = topicCoverage(course, g);
ok('补齐前能查出未覆盖考点', before.covered === 1 && before.missing.length === 2, `${before.covered}/${before.total}`);
const fix = attachUncoveredTopics(course, g);
const after = topicCoverage(course, g);
ok('补齐后考点 100% 落到章', after.covered === after.total, `${after.covered}/${after.total}，挂靠 ${fix.attached.length} 新增 ${fix.created.length}`);
ok('相关章节优先挂靠而不是硬造新章', fix.created.length === 0 && fix.attached.length === 2, `新增 ${fix.created.length} 章`);

const lonely = {
  name: 'Kafka',
  topics: [{ id: 'k1', title: 'Kafka 事务消息与幂等', level: '深度', followups: ['怎么保证不重复消费？'] }],
};
const c2 = { stages: [{ name: '入门', chapters: [{ id: 'ch1', title: 'Kafka 是什么', topicIds: [] }] }] };
const fix2 = attachUncoveredTopics(c2, lonely);
ok('无处可挂时补一章并带上追问', fix2.created.length === 1 && c2.stages.some((s) => s.chapters.some((c) => c.topicIds.includes('k1') && c.keyQuestions.length)));
ok('补的章节不会重复挂同一个考点', attachUncoveredTopics(c2, lonely).created.length === 0);

let failed = 0;
for (const c of checks) {
  if (!c.cond) failed += 1;
  console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.label}${c.extra ? `  （${c.extra}）` : ''}`);
}

if (failed) {
  console.error(`${failed} 项失败`);
  process.exit(1);
}
console.log(`全部通过（${checks.length} 项）`);
