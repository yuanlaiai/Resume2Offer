/**
 * 技能覆盖回归测试。
 * 目标：简历里的技术大类不能被"挑重点"挑掉，也不能被相似词误判成已覆盖。
 */
import { hasKey, groupCovers, normalizeStack, missingStacks, coverageOf, fallbackGroup } from '../server/coverage.js';

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
