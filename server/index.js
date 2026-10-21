import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, llmReady, ROOT } from './config.js';
import { store } from './store.js';
import { startJob, getJob } from './jobs.js';
import { extractResume, normalizeText } from './extract.js';
import { fixFileName } from './filename.js';
import { describeLLM, LLMError } from './llm.js';
import { runAnalyze, runMaterials, runQuiz, runGrade, runPlan, runExpand, runReport, runCourses, runLessons, runChat, prefillRole, runFlashcards, reviewCard, runQuickCard, runFeynman, dailyPlan } from './pipeline.js';
import { toMarkdown, materialMarkdown, reportMarkdown, courseMarkdown, lessonMarkdown } from './export.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

/* ---------------- 基础信息 ---------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ready: llmReady(),
    demo: config.demo,
    llm: describeLLM(),
    version: '0.1.0',
  });
});

app.get('/api/sample', (req, res) => {
  const file = path.join(ROOT, 'samples', 'sample-resume.md');
  if (!fs.existsSync(file)) return res.status(404).json({ error: '示例简历不存在' });
  res.json({ text: fs.readFileSync(file, 'utf8') });
});

/* ---------------- 分析记录 ---------------- */

app.get('/api/analyses', (req, res) => {
  res.json({ items: store.list() });
});

app.get('/api/analyses/:id', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  res.json(record);
});

app.delete('/api/analyses/:id', async (req, res) => {
  const ok = await store.remove(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

/* ---------------- 0. 上传即预判岗位（自动填充） ---------------- */

app.post('/api/prefill', upload.single('resume'), async (req, res, next) => {
  try {
    let resumeText = '';
    if (req.file) {
      const parsed = await extractResume({
        buffer: req.file.buffer,
        filename: fixFileName(req.file.originalname),
        mimetype: req.file.mimetype,
      });
      resumeText = parsed.text;
    } else if (req.body?.text) {
      resumeText = normalizeText(req.body.text);
    }
    if (!resumeText || resumeText.length < 40) {
      return res.status(400).json({ error: '简历内容太短，无法判断岗位' });
    }
    if (!llmReady()) return res.status(503).json({ error: '未配置模型' });

    const result = await prefillRole({ resumeText: resumeText.slice(0, 20000) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ---------------- 1. 上传简历 → 解析 + 知识点 ---------------- */

app.post('/api/analyze', upload.single('resume'), async (req, res, next) => {
  try {
    const targetRole = String(req.body?.targetRole || '').trim().slice(0, 60);
    const level = String(req.body?.level || '').trim().slice(0, 20);

    let resumeText = '';
    let fileName = '';
    if (req.file) {
      const parsed = await extractResume({
        buffer: req.file.buffer,
        filename: fixFileName(req.file.originalname),
        mimetype: req.file.mimetype,
      });
      resumeText = parsed.text;
      fileName = fixFileName(req.file.originalname);
    } else if (req.body?.text) {
      resumeText = normalizeText(req.body.text).slice(0, 30000);
      fileName = '粘贴的文本';
    }

    if (!resumeText || resumeText.length < 40) {
      return res.status(400).json({ error: '简历内容太短，请检查文件或补充粘贴内容' });
    }

    const jobId = startJob(['读懂简历', '推导知识点'], (ctx) =>
      runAnalyze(ctx, { resumeText, targetRole, level, fileName }),
    );
    res.json({ jobId });
  } catch (err) {
    next(err);
  }
});

/* ---------------- 2. 生成复习资料 ---------------- */

app.post('/api/analyses/:id/materials', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const topicIds = Array.isArray(req.body?.topicIds) ? req.body.topicIds.filter((x) => typeof x === 'string') : [];
  const depth = ['lite', 'standard', 'deep'].includes(req.body?.depth) ? req.body.depth : 'standard';
  const jobId = startJob([`生成复习资料（${depth === 'lite' ? '简单' : depth === 'deep' ? '深度' : '中等'}）`], (ctx) =>
    runMaterials(ctx, { analysisId: record.id, topicIds, depth }),
  );
  res.json({ jobId });
});

/* ---------------- 2.5 系统课程 ---------------- */

app.post('/api/analyses/:id/courses', (req, res, next) => {
  try {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    const names = Array.isArray(req.body?.names)
      ? req.body.names.filter((x) => typeof x === 'string').slice(0, 12)
      : [];
    const auto = Boolean(req.body?.auto);
    const jobId = startJob(['排课程大纲'], (ctx) =>
      runCourses(ctx, { analysisId: record.id, names, auto }),
    );
    res.json({ jobId });
  } catch (err) {
    next(err);
  }
});

app.post('/api/analyses/:id/courses/:courseId/lessons', (req, res, next) => {
  try {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    const course = (record.courses || []).find((c) => c.id === req.params.courseId);
    if (!course) return res.status(404).json({ error: '找不到这门课程' });
    const chapterIds = Array.isArray(req.body?.chapterIds)
      ? req.body.chapterIds.filter((x) => typeof x === 'string').slice(0, 8)
      : [];
    const depth = ['lite', 'standard', 'deep'].includes(req.body?.depth) ? req.body.depth : 'standard';
    const jobId = startJob(['写章节讲义'], (ctx) =>
      runLessons(ctx, { analysisId: record.id, courseId: course.id, chapterIds, depth }),
    );
    res.json({ jobId });
  } catch (err) {
    next(err);
  }
});

/* ---------------- 3. 出题 ---------------- */

app.post('/api/analyses/:id/quiz', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const topicIds = Array.isArray(req.body?.topicIds) ? req.body.topicIds.filter((x) => typeof x === 'string') : [];
  const count = Number(req.body?.count) || 10;
  const jobId = startJob(['出题'], (ctx) => runQuiz(ctx, { analysisId: record.id, topicIds, count }));
  res.json({ jobId });
});

/* ---------------- 4. 交卷评分 ---------------- */

app.post('/api/analyses/:id/grade', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const quizId = String(req.body?.quizId || '');
  const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  if (!quizId) return res.status(400).json({ error: '缺少 quizId' });
  const jobId = startJob(['批改与复盘'], (ctx) => runGrade(ctx, { analysisId: record.id, quizId, answers }));
  res.json({ jobId });
});

/* ---------------- 5. 提升计划 ---------------- */

app.post('/api/analyses/:id/plan', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const attemptId = req.body?.attemptId ? String(req.body.attemptId) : '';
  const jobId = startJob(['制定提升计划'], (ctx) => runPlan(ctx, { analysisId: record.id, attemptId }));
  res.json({ jobId });
});

/* ---------------- 6. 知识点拓展 ---------------- */

app.post('/api/analyses/:id/expand', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const topicId = String(req.body?.topicId || '');
  const count = Number(req.body?.count) || 4;
  if (!topicId) return res.status(400).json({ error: '缺少 topicId' });
  const jobId = startJob(['检索相关知识', '生成关联考点'], (ctx) =>
    runExpand(ctx, { analysisId: record.id, topicId, count }),
  );
  res.json({ jobId });
});

/* ---------------- 7. 面试准备报告 ---------------- */

app.post('/api/analyses/:id/report', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const depth = ['lite', 'standard', 'deep'].includes(req.body?.depth) ? req.body.depth : 'standard';
  const jobId = startJob(['检索岗位面经与行业资料', '生成报告'], (ctx) =>
    runReport(ctx, { analysisId: record.id, depth }),
  );
  res.json({ jobId });
});

/* ---------------- 任务进度 ---------------- */

/* ---------------- 速学中心 ---------------- */

// 闪卡批量生成（任务）
app.post('/api/analyses/:id/flashcards', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const count = Number(req.body?.count) || 12;
  const topicIds = Array.isArray(req.body?.topicIds) ? req.body.topicIds.map(String) : null;
  const jobId = startJob(['生成闪卡'], (ctx) => runFlashcards(ctx, { analysisId: record.id, count, topicIds }));
  res.json({ jobId });
});

// 翻卡自评（直接响应）
app.post('/api/analyses/:id/flashcards/:cardId/review', async (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  try {
    const { card } = await reviewCard({ analysisId: record.id, cardId: req.params.cardId, grade: req.body?.grade });
    res.json({ card });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 5 分钟速览卡（任务）
app.post('/api/analyses/:id/quickcard', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const topicId = String(req.body?.topicId || '');
  if (!topicId) return res.status(400).json({ error: '缺少 topicId' });
  const jobId = startJob(['生成速览卡'], (ctx) => runQuickCard(ctx, { analysisId: record.id, topicId }));
  res.json({ jobId });
});

// 费曼检验（任务）
app.post('/api/analyses/:id/feynman', (req, res, next) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const topicId = String(req.body?.topicId || '');
  const explanation = String(req.body?.explanation || '');
  if (!topicId) return res.status(400).json({ error: '缺少 topicId' });
  const jobId = startJob(['批改复述'], (ctx) => runFeynman(ctx, { analysisId: record.id, topicId, explanation }));
  res.json({ jobId });
});

// 每日速学（直接计算）
app.get('/api/analyses/:id/daily', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  res.json(dailyPlan(record));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json(job);
});

/* ---------------- AI 随问（划词追问，直接响应不进队列） ---------------- */

app.post('/api/chat', async (req, res, next) => {
  try {
    if (!llmReady()) return res.status(503).json({ error: '未配置模型' });

    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = raw
      .filter((m) => m && typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: '消息格式不对' });
    }

    const analysisId = typeof req.body?.analysisId === 'string' ? req.body.analysisId : '';
    const selection = typeof req.body?.selection === 'string' ? req.body.selection.slice(0, 2000) : '';
    const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 300) : '';

    const result = await runChat({ analysisId, messages, selection, context });
    res.json(result);
  } catch (err) {
    next(err);
  }
});


/* ---------------- 导出 Markdown ---------------- */

function sendMd(res, md, name) {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(md);
}

app.get('/api/analyses/:id/export.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const md = toMarkdown(record);
  sendMd(res, md, `${record.profile?.candidate?.name || '候选人'}-${record.targetRole || '面试'}-复习手册.md`);
});

/** 单篇资料下载：?version=0 取当前版本，1..n 取历史版本 */
app.get('/api/analyses/:id/materials/:topicId.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const current = (record.materials || []).find((m) => m.topicId === req.params.topicId);
  if (!current) return res.status(404).json({ error: '这篇资料还没生成' });

  const v = Number(req.query.version) || 0;
  const material = v > 0 ? current.history?.[v - 1]?.data : current;
  if (!material) return res.status(404).json({ error: '历史版本不存在' });

  const md = materialMarkdown(material);
  sendMd(res, md, `${material.topicTitle || '知识点'}-${material.depth || 'standard'}.md`);
});

app.get('/api/analyses/:id/report.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record?.report) return res.status(404).json({ error: '报告还没生成' });
  sendMd(res, reportMarkdown(record.report, record), `${record.profile?.candidate?.name || '候选人'}-面试准备报告.md`);
});

/** 整门课程下载（含已生成讲义） */
app.get('/api/analyses/:id/courses/:courseId.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const course = (record.courses || []).find((c) => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: '课程还没生成' });
  sendMd(res, courseMarkdown(course, record), `${course.title || course.group}-系统课程.md`);
});

/** 单章讲义下载 */
app.get('/api/analyses/:id/courses/:courseId/chapters/:chapterId.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const course = (record.courses || []).find((c) => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: '课程还没生成' });

  let hit = null;
  for (const stage of course.stages || []) {
    const chapter = (stage.chapters || []).find((ch) => ch.id === req.params.chapterId);
    if (chapter) {
      hit = { stage, chapter };
      break;
    }
  }
  if (!hit) return res.status(404).json({ error: '章节不存在' });
  if (!hit.chapter.lesson) return res.status(404).json({ error: '这一章还没有生成讲义' });

  sendMd(res, lessonMarkdown(course, hit.stage, hit.chapter), `${hit.chapter.title}-讲义.md`);
});

/* ---------------- 静态资源 ---------------- */

/**
 * 资源版本号：取 public 下文件的最大 mtime。
 * 改了前端文件，引用 URL 就变，浏览器不会继续用旧的 app.js（这是本地开发最常见的坑）。
 */
function assetVersion() {
  let latest = 0;
  try {
    for (const f of fs.readdirSync(config.publicDir)) {
      if (f === 'index.html' || f === 'favicon.svg') continue;
      const st = fs.statSync(path.join(config.publicDir, f));
      if (st.isFile() && st.mtimeMs > latest) latest = st.mtimeMs;
    }
  } catch {
    /* 读不到就用 0 */
  }
  return Math.round(latest).toString(36);
}

let indexCache = { stamp: 0, html: '' };

/** 入口 HTML：注入 ?v= 版本号，并禁止缓存 */
function renderIndex() {
  const file = path.join(config.publicDir, 'index.html');
  const stamp = fs.statSync(file).mtimeMs;
  if (indexCache.stamp !== stamp) {
    const v = assetVersion();
    indexCache = {
      stamp,
      html: fs
        .readFileSync(file, 'utf8')
        .replace('/styles.css', `/styles.css?v=${v}`)
        .replace('/app.js', `/app.js?v=${v}`),
    };
  }
  return indexCache.html;
}

app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderIndex());
});

app.use(
  express.static(config.publicDir, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      // 没有版本号兜底的 HTML 一律不缓存
      if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderIndex());
});

/* ---------------- 错误处理 ---------------- */

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `文件超过 ${config.maxUploadMb}MB，请压缩后再传` : '文件上传失败',
    });
  }
  if (err instanceof LLMError) return res.status(502).json({ error: err.message });
  console.error('[server]', err);
  res.status(500).json({ error: err.message || '服务端出错' });
});

app.listen(config.port, config.host, async () => {
  const url = `http://localhost:${config.port}`;
  console.log('');
  console.log('  Resume2Offer 已启动');
  console.log(`  → ${url}`);
  const lan = lanIPv4();
  if (lan && config.host === '0.0.0.0') {
    console.log(`  → http://${lan}:${config.port}（同局域网/手机可访问）`);
  }
  console.log(`  模型：${describeLLM().model}${config.demo ? '（演示模式，不消耗额度）' : ''}`);
  if (!llmReady()) {
    console.log('  ⚠️  未检测到 LLM_API_KEY，请复制 .env.example 为 .env 并填写，或用 npm run demo 体验');
  }

  // 端口抢占自查：本机若已有别的程序（uvicorn、其他 dev server…）绑在 127.0.0.1 上，
  // 访问 localhost 会打到它而不是我们，浏览器只会看到一个莫名其妙的 404。
  const self = await probeSelf(config.port);
  if (!self.ok) {
    console.log('');
    console.log(`  ⚠️  http://127.0.0.1:${config.port} 上响应的不是本服务：${self.detail}`);
    console.log('      多半是另一个程序先占了这个端口的回环地址。查一下：');
    console.log(`      lsof -nP -iTCP:${config.port} -sTCP:LISTEN`);
    console.log(`      换端口启动：PORT=${config.port + 101} npm start`);
    if (lan) console.log(`      或先用局域网地址访问：http://${lan}:${config.port}`);
  }
  console.log('');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ✖ 端口 ${config.port} 已被占用，换个端口再启动：PORT=${config.port + 101} npm start`);
    console.error(`    查看占用者：lsof -nP -iTCP:${config.port} -sTCP:LISTEN`);
    console.error('');
  } else {
    console.error('[server]', err);
  }
  process.exit(1);
});

/** 探测 127.0.0.1:port 上跑的到底是不是自己 */
async function probeSelf(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
      headers: { 'cache-control': 'no-store' },
    });
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      if (body && body.version) return { ok: true };
    } catch {
      /* 非 JSON，继续判断 */
    }
    return { ok: false, detail: `HTTP ${res.status}，响应内容不是 Resume2Offer` };
  } catch (err) {
    return { ok: false, detail: `探测失败：${err.message}` };
  }
}

function lanIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '';
}
