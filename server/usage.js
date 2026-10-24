import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * LLM 用量统计：内存累计 + 节流落盘到 data/usage.json。
 * 只统计真实调用（演示模式不计）。重启后从文件读回累计值。
 */

const FILE = path.join(config.dataDir, 'usage.json');
const FLUSH_MS = 20 * 1000;

let stats = { totalCalls: 0, promptTokens: 0, completionTokens: 0, byModel: {}, startedAt: null };
let dirty = false;
let timer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') stats = { ...stats, ...parsed };
    }
  } catch {
    /* 坏了就重新计数 */
  }
}

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stats), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.warn('[usage] 落盘失败：', err.message);
  }
}

load();
process.on('exit', flush);

export function recordUsage(usage, model) {
  if (!usage || typeof usage !== 'object') return;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  if (prompt + completion <= 0) return;

  stats.totalCalls += 1;
  stats.promptTokens += prompt;
  stats.completionTokens += completion;
  stats.startedAt = stats.startedAt || new Date().toISOString();
  const key = model || 'unknown';
  const m = stats.byModel[key] || { calls: 0, promptTokens: 0, completionTokens: 0 };
  m.calls += 1;
  m.promptTokens += prompt;
  m.completionTokens += completion;
  stats.byModel[key] = m;

  dirty = true;
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
    timer.unref?.();
  }
}

export function usageSummary() {
  return {
    ...stats,
    totalTokens: stats.promptTokens + stats.completionTokens,
    persistedAt: new Date().toISOString(),
  };
}
