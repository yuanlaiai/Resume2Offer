import crypto from 'node:crypto';
import { jobStorage, CancelledError, throwIfCancelled, isCancelled } from './job-context.js';

/**
 * 内存任务队列：前端拿 jobId 轮询进度。
 * 单机自托管不需要真队列，够用且零依赖。
 *
 * 任务在服务端独立跑，与 HTTP 连接无关：刷新页面/关标签页都不会中断，
 * 只有调用 cancelJob() 或服务进程退出才会停。
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
  const controller = new AbortController();
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
    controller,
  };
  jobs.set(id, job);

  const ctx = {
    /** 标记某一步开始（0-based），前面的步骤自动置为 done */
    step(index, detail = '') {
      throwIfCancelled();
      job.steps.forEach((s, i) => {
        s.status = i < index ? 'done' : i === index ? 'running' : 'pending';
      });
      job.label = stepLabels[index] || job.label;
      job.detail = detail;
      job.progress = Math.max(job.progress, Math.round(((index + 0.25) / stepLabels.length) * 100));
    },
    /** 细粒度进度 0~1 */
    tick(ratio, detail) {
      throwIfCancelled();
      const base = job.steps.filter((s) => s.status === 'done').length;
      const overall = (base + Math.min(Math.max(ratio, 0), 1)) / stepLabels.length;
      job.progress = Math.max(job.progress, Math.min(99, Math.round(overall * 100)));
      if (detail) job.detail = detail;
    },
    note(detail) {
      job.detail = detail;
    },
    /** 非模型步骤之间的检查点 */
    ensureActive: throwIfCancelled,
    signal: controller.signal,
  };

  Promise.resolve()
    .then(() => jobStorage.run({ signal: controller.signal, jobId: id }, () => worker(ctx)))
    .then((result) => {
      if (job.status === 'cancelled') return;
      job.steps.forEach((s) => { s.status = 'done'; });
      job.result = result;
      job.status = 'done';
      job.progress = 100;
      job.label = '完成';
      job.finishedAt = Date.now();
    })
    .catch((err) => {
      if (job.status === 'cancelled' || isCancelled(err)) {
        markCancelled(job);
        return;
      }
      console.error('[job] 失败：', err);
      const running = job.steps.find((s) => s.status === 'running');
      if (running) running.status = 'error';
      job.status = 'error';
      job.error = err.message || '处理失败';
      job.finishedAt = Date.now();
    });

  return id;
}

function markCancelled(job) {
  job.status = 'cancelled';
  job.label = '已取消';
  job.detail = '已停止生成';
  job.error = '已取消生成，已生成的部分会保留';
  const running = job.steps.find((s) => s.status === 'running');
  if (running) running.status = 'pending';
  if (!job.finishedAt) job.finishedAt = Date.now();
}

/**
 * 取消任务：立刻中断正在进行的模型请求，后续步骤不再执行。
 * 返回 false 表示任务不存在或已结束。
 */
export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status !== 'running') return job.status === 'cancelled';
  markCancelled(job);
  try {
    job.controller.abort(new CancelledError());
  } catch {
    /* abort 不应影响返回值 */
  }
  return true;
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
    cancellable: job.status === 'running',
  };
}
