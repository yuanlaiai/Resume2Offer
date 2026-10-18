import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, llmReady, ROOT } from './config.js';
import { store } from './store.js';
import { startJob, getJob } from './jobs.js';
import { extractResume, normalizeText } from './extract.js';
import { describeLLM, LLMError } from './llm.js';
import { runAnalyze, runMaterials, runQuiz, runGrade, runPlan, runExpand } from './pipeline.js';
import { toMarkdown } from './export.js';

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
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      });
      resumeText = parsed.text;
      fileName = req.file.originalname;
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
  const jobId = startJob(['生成复习资料'], (ctx) => runMaterials(ctx, { analysisId: record.id, topicIds }));
  res.json({ jobId });
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

/* ---------------- 任务进度 ---------------- */

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json(job);
});

/* ---------------- 导出 Markdown ---------------- */

app.get('/api/analyses/:id/export.md', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  const md = toMarkdown(record);
  const name = `${record.profile?.candidate?.name || '候选人'}-${record.targetRole || '面试'}-复习手册.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(md);
});

/* ---------------- 静态资源 ---------------- */

app.use(express.static(config.publicDir, { extensions: ['html'], maxAge: '1h' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(config.publicDir, 'index.html'));
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

app.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  console.log('');
  console.log('  Interview Forge 已启动');
  console.log(`  → ${url}`);
  console.log(`  模型：${describeLLM().model}${config.demo ? '（演示模式，不消耗额度）' : ''}`);
  if (!llmReady()) {
    console.log('  ⚠️  未检测到 LLM_API_KEY，请复制 .env.example 为 .env 并填写，或用 npm run demo 体验');
  }
  console.log('');
});
