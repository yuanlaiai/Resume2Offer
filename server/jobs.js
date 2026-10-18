import crypto from 'node:crypto';

/**
 * 内存任务队列：前端拿 jobId 轮询进度。
 * 单机自托管不需要真队列，够用且零依赖。
 */

const jobs = new Map();
const TTL = 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > TTL) jobs.delete(id);
  }
}

export function startJob(stepLabels, worker) {
  gc();
  const id = `job_${crypto.randomBytes(5).toString('hex')}`;
  const job = {
    id,
    status: 'running',
    progress: 2,
    label: stepLabels[0] || '处理中',
    detail: '',
    steps: stepLabels.map((label) => ({ label, status: 'pending' })),
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(id, job);

  const ctx = {
    /** 标记某一步开始（0-based），前面的步骤自动置为 done */
    step(index, detail = '') {
      job.steps.forEach((s, i) => {
        s.status = i < index ? 'done' : i === index ? 'running' : 'pending';
      });
      job.label = stepLabels[index] || job.label;
      job.detail = detail;
      job.progress = Math.max(job.progress, Math.round(((index + 0.25) / stepLabels.length) * 100));
    },
    /** 细粒度进度 0~1 */
    tick(ratio, detail) {
      const base = job.steps.filter((s) => s.status === 'done').length;
      const overall = (base + Math.min(Math.max(ratio, 0), 1)) / stepLabels.length;
      job.progress = Math.max(job.progress, Math.min(99, Math.round(overall * 100)));
      if (detail) job.detail = detail;
    },
    note(detail) {
      job.detail = detail;
    },
  };

  Promise.resolve()
    .then(() => worker(ctx))
    .then((result) => {
      job.steps.forEach((s) => { s.status = 'done'; });
      job.result = result;
      job.status = 'done';
      job.progress = 100;
      job.label = '完成';
      job.finishedAt = Date.now();
    })
    .catch((err) => {
      console.error('[job] 失败：', err);
      const running = job.steps.find((s) => s.status === 'running');
      if (running) running.status = 'error';
      job.status = 'error';
      job.error = err.message || '处理失败';
      job.finishedAt = Date.now();
    });

  return id;
}

export function getJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    label: job.label,
    detail: job.detail,
    steps: job.steps,
    result: job.status === 'done' ? job.result : null,
    error: job.error,
  };
}
