/**
 * 可选的联网检索增强：给提示词注入真实世界的相关资料，让知识点和复习资料更全面、更新。
 *
 * 不绑定任何一家服务商。SEARCH_PROVIDER 可切换：
 *   tavily   默认，https://tavily.com      （AI 检索 API，结果已清洗成适合喂模型的正文片段）
 *   bocha    国内直连，https://bochaai.com （中文资料好，无需代理）
 *   brave    独立索引，https://brave.com/search/api
 *   serper   Google SERP，https://serper.dev
 *   searxng  自建元搜索，完全免费，SEARCH_ENDPOINT 填自己的实例地址
 *   custom   任意"Tavily 兼容"接口，SEARCH_ENDPOINT 指向它即可
 *
 * 未配置 SEARCH_API_KEY（searxng 除外）时静默跳过，不影响任何流程。
 */

import { config } from './config.js';

const DEFAULTS = {
  tavily: 'https://api.tavily.com/search',
  bocha: 'https://api.bochaai.com/v1/web-search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
  serper: 'https://google.serper.dev/search',
  searxng: 'http://127.0.0.1:8080/search',
  custom: 'https://api.tavily.com/search',
};

export function searchProvider() {
  return (config.search.provider || 'tavily').toLowerCase();
}

export function searchReady() {
  const p = searchProvider();
  if (p === 'searxng') return Boolean(config.search.endpoint);
  return Boolean(config.search.apiKey);
}

function endpointOf() {
  return config.search.endpoint || DEFAULTS[searchProvider()] || DEFAULTS.tavily;
}

function clip(s, n) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** 统一收敛成 [{title, content, url}]，并丢掉没有正文的条目 */
function normalize(items) {
  return (items || [])
    .map((r) => ({
      title: clip(r.title, 200),
      content: clip(r.content, 600),
      url: clip(r.url, 300),
    }))
    .filter((r) => r.content.length >= 20);
}

/* ---------------- 各服务商适配：输入 query，输出统一结构 ---------------- */

const adapters = {
  async tavily(query, maxResults, signal) {
    const data = await postJSON(
      endpointOf(),
      { api_key: config.search.apiKey, query, max_results: maxResults, include_answer: false, search_depth: 'basic' },
      {},
      signal,
    );
    return normalize((data.results || []).map((r) => ({ title: r.title, content: r.content, url: r.url })));
  },

  // 博查：POST /v1/web-search，Bearer 鉴权，返回 data.webPages.value[]
  async bocha(query, maxResults, signal) {
    const data = await postJSON(
      endpointOf(),
      { query, summary: true, count: maxResults, freshness: 'noLimit' },
      { Authorization: `Bearer ${config.search.apiKey}` },
      signal,
    );
    const pages = data?.data?.webPages?.value || data?.webPages?.value || [];
    return normalize(
      pages.map((r) => ({ title: r.name, content: r.summary || r.snippet, url: r.url })),
    );
  },

  // Brave：GET ?q=，X-Subscription-Token 鉴权，返回 web.results[]
  async brave(query, maxResults, signal) {
    const url = `${endpointOf()}?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const data = await getJSON(
      url,
      { 'X-Subscription-Token': config.search.apiKey, Accept: 'application/json' },
      signal,
    );
    const list = data?.web?.results || [];
    return normalize(list.map((r) => ({ title: r.title, content: r.description, url: r.url })));
  },

  // Serper：POST，X-API-KEY 鉴权，返回 organic[]
  async serper(query, maxResults, signal) {
    const data = await postJSON(
      endpointOf(),
      { q: query, num: maxResults },
      { 'X-API-KEY': config.search.apiKey },
      signal,
    );
    const list = data.organic || data.news || [];
    return normalize(list.map((r) => ({ title: r.title, content: r.snippet, url: r.link || r.url })));
  },

  // SearXNG：自建实例，GET ?q=&format=json，无需 Key
  async searxng(query, maxResults, signal) {
    const url = `${endpointOf()}?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
    const data = await getJSON(url, {}, signal);
    return normalize(
      (data.results || []).slice(0, maxResults).map((r) => ({ title: r.title, content: r.content, url: r.url })),
    );
  },

  // 任意 Tavily 兼容接口
  async custom(query, maxResults, signal) {
    const data = await postJSON(
      endpointOf(),
      { api_key: config.search.apiKey, query, max_results: maxResults },
      { Authorization: `Bearer ${config.search.apiKey}` },
      signal,
    );
    return normalize(
      (data.results || []).map((r) => ({ title: r.title, content: r.content || r.snippet, url: r.url })),
    );
  },
};

async function postJSON(url, body, headers, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getJSON(url, headers, signal) {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {string} query
 * @param {{maxResults?: number}} opts
 * @returns {Promise<Array<{title: string, content: string, url: string}>>}
 */
export async function searchWeb(query, opts = {}) {
  if (!searchReady() || !query) return [];
  const maxResults = Math.min(opts.maxResults || 5, 8);
  const provider = searchProvider();
  const run = adapters[provider] || adapters.tavily;

  try {
    return await run(query.slice(0, 400), maxResults, AbortSignal.timeout(config.search.timeoutMs));
  } catch (err) {
    console.warn(`[search] ${provider} 检索失败，本次跳过联网增强：${err.message}`);
    return [];
  }
}

/** 把检索结果拼成可注入提示词的文本块 */
export function formatSearchBlock(results) {
  if (!results || !results.length) return '';
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.content}${r.url ? `\n   来源: ${r.url}` : ''}`)
    .join('\n');
}
