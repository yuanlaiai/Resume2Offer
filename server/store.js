import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * 极简 JSON 文件存储：一整个 db.json 放内存里，改完原子落盘。
 * 单机自托管场景足够用，不引入数据库依赖。
 */

const DB_FILE = path.join(config.dataDir, 'db.json');
let db = { analyses: {}, meta: { version: 1 } };
let queue = Promise.resolve();

function load() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = { analyses: {}, meta: { version: 1 }, ...parsed };
      db.analyses = db.analyses || {};
    }
  } catch (err) {
    console.error('[store] 读取失败，使用空库：', err.message);
  }
}
load();

function persist() {
  // 串行化写入，先写临时文件再 rename，避免半截文件
  queue = queue.then(async () => {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const tmp = `${DB_FILE}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(db), 'utf8');
      await fs.promises.rename(tmp, DB_FILE);
    } catch (err) {
      console.error('[store] 写入失败：', err.message);
    }
  });
  return queue;
}

export const store = {
  newId(prefix = 'a') {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  },

  get(id) {
    return db.analyses[id] || null;
  },

  list() {
    return Object.values(db.analyses)
      .map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        candidate: a.profile?.candidate || {},
        targetRole: a.targetRole,
        topicCount: (a.topics || []).length,
        materialCount: (a.materials || []).length,
        quizCount: (a.quizzes || []).length,
        lastScore: a.attempts?.length ? (a.attempts[a.attempts.length - 1].grade?.total ?? null) : null,
        stage: a.stage,
      }))
      .sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
  },

  async create(data) {
    const id = data.id || store.newId();
    const now = new Date().toISOString();
    const record = {
      id,
      createdAt: now,
      updatedAt: now,
      stage: 'created',
      profile: null,
      topics: [],
      materials: [],
      quizzes: [],
      attempts: [],
      plan: null,
      ...data,
    };
    db.analyses[id] = record;
    await persist();
    return record;
  },

  async update(id, patch) {
    const rec = db.analyses[id];
    if (!rec) return null;
    const next = typeof patch === 'function' ? patch(rec) : { ...rec, ...patch };
    next.updatedAt = new Date().toISOString();
    db.analyses[id] = next;
    await persist();
    return next;
  },

  async remove(id) {
    if (!db.analyses[id]) return false;
    delete db.analyses[id];
    await persist();
    return true;
  },
};
