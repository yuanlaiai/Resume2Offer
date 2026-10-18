/**
 * 可选的联网检索增强：给提示词注入真实世界的相关资料，让知识点和复习资料更全面、更新。
 * 支持 Tavily 兼容接口（Tavily / 博查等）。未配置时静默跳过，不影响任何流程。
 */

import { config } from './config.js';

export function searchReady() {
  return Boolean(config.search.apiKey);
}

/**
 * @param {string} query
 * @param {{maxResults?: number}} opts
 * @returns {Promise<Array<{title: string, content: string, url: string}>>}
 */
export async function searchWeb(query, opts = {}) {
  const { apiKey, endpoint } = config.search;
  if (!apiKey || !query) return [];
  const maxResults = Math.min(opts.maxResults || 5, 8);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.slice(0, 400),
        max_results: maxResults,
        include_answer: false,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(config.search.timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[search] 检索服务返回 ${res.status}，本次跳过联网增强`);
      return [];
    }
    const data = await res.json();
    return (data.results || [])
      .map((r) => ({
        title: String(r.title || '').slice(0, 200),
        content: String(r.content || '').replace(/\s+/g, ' ').slice(0, 600),
        url: String(r.url || '').slice(0, 300),
      }))
      .filter((r) => r.content);
  } catch (err) {
    console.warn('[search] 联网检索失败，本次跳过：', err.message);
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
