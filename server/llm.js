import { config } from './config.js';
import { mockChat } from './mock.js';
import { recordUsage } from './usage.js';
import { currentSignal, CancelledError, throwIfCancelled, isCancelled } from './job-context.js';

/**
 * OpenAI 兼容的 Chat Completions 客户端。
 * 不绑定任何厂商，只要支持 /chat/completions 就能接。
 */

export class LLMError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.code = code;
  }
}

function endpoint() {
  const base = config.llm.baseUrl;
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/** max_tokens 的上限：推理模型会用大量 token 思考，需要留足空间 */
const TOKEN_CEILING = 64000;

/** 合并多个中止信号；旧版 Node 没有 AbortSignal.any 时退化为主信号 */
function combineSignals(primary, extra) {
  if (!extra) return primary;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([primary, extra]);
  return extra;
}

/**
 * 发一次请求，返回正文与元信息。
 * 注意：推理类模型（deepseek-flash / o 系列等）会把 token 花在 reasoning_content 上，
 * finish_reason=length 时正文可能为空或是半截 JSON，必须识别出来并升配重试。
 */
async function requestOnce(messages, opts, maxTokens) {
  const body = {
    model: config.llm.model,
    messages,
    temperature: opts.temperature ?? config.llm.temperature,
    max_tokens: maxTokens,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  if (config.llm.reasoningEffort) body.reasoning_effort = config.llm.reasoningEffort;

  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify(body),
    // 超时与「用户取消」两个信号合并：任一触发都会立刻中断请求
    signal: combineSignals(AbortSignal.timeout(config.llm.timeoutMs), opts.signal || currentSignal()),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text.slice(0, 400);
    if (res.status === 401 || res.status === 403) {
      throw new LLMError('大模型鉴权失败，请检查 LLM_API_KEY 与 LLM_BASE_URL 是否匹配', { status: res.status });
    }
    const err = new LLMError(`模型服务返回 ${res.status}：${detail}`, { status: res.status });
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning = message.reasoning_content || message.reasoning || '';

  return {
    content: content || (message.content ? JSON.stringify(message.content) : ''),
    finishReason: choice?.finish_reason || '',
    maxTokens,
    usage: data?.usage || null,
    reasoningChars: String(reasoning).length,
  };
}

/** 调用模型，返回文本；内部自动处理网络重试与截断升配 */
export async function chatDetailed(messages, opts = {}) {
  throwIfCancelled();
  const signal = opts.signal || currentSignal();
  if (config.demo) {
    return { content: mockChat(messages, opts), finishReason: 'stop', maxTokens: 0, reasoningChars: 0 };
  }

  let maxTokens = Math.max(256, opts.maxTokens ?? config.llm.maxTokens);
  let lastErr;
  let netAttempt = 0;
  let escalations = 0;

  while (true) {
    try {
      const out = await requestOnce(messages, opts, maxTokens);
      const truncated = out.finishReason === 'length';
      const empty = !out.content.trim();
      // 正文为空 + 有推理内容 = token 全被思考吃掉了，等同于截断
      const starved = empty && out.reasoningChars > 0;

      if ((truncated || starved) && escalations < 3 && maxTokens < TOKEN_CEILING) {
        const next = Math.min(TOKEN_CEILING, Math.max(maxTokens * 2, 8192));
        if (next > maxTokens) {
          console.warn(
            `[llm] 输出未完整（finish=${out.finishReason || '—'}，正文 ${out.content.length} 字，推理 ${out.reasoningChars} 字），max_tokens ${maxTokens} → ${next} 重试`,
          );
          maxTokens = next;
          escalations += 1;
          continue;
        }
      }

      if (empty) {
        throw new LLMError(
          truncated || starved
            ? `模型把 ${maxTokens} 个 token 都用在了思考上，没有给出结果。请调大 LLM_MAX_TOKENS（当前 ${config.llm.maxTokens}），或设置 LLM_REASONING_EFFORT=low 降低思考开销`
            : '模型返回为空，请重试或更换模型',
          { code: 'EMPTY' },
        );
      }
      if (truncated) console.warn(`[llm] 回复仍被截断（max_tokens=${maxTokens}），内容可能不完整`);
      if (out.usage) recordUsage(out.usage, config.llm.model);
      return out;
    } catch (err) {
      // 用户主动取消：不重试，直接把取消信号向上抛
      if (isCancelled(err) || signal?.aborted) throw new CancelledError();
      const retryable = err instanceof LLMError ? err.retryable || err.name === 'TimeoutError' : true;
      if (err instanceof LLMError && err.code === 'EMPTY') throw err;
      if (err instanceof LLMError && err.status && err.status < 500 && err.status !== 429) throw err;

      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        lastErr = new LLMError(`模型请求超时（>${Math.round(config.llm.timeoutMs / 1000)}s），可在 .env 调大 LLM_TIMEOUT_MS`);
      } else {
        lastErr = err instanceof LLMError ? err : new LLMError(`调用模型失败：${err.message}`);
      }
      netAttempt += 1;
      if (!retryable || netAttempt >= 3) throw lastErr;
      await new Promise((r) => setTimeout(r, 1000 * netAttempt));
    }
  }
}

export async function chat(messages, opts = {}) {
  const out = await chatDetailed(messages, opts);
  return out.content;
}

/** 从可能带 ```json 包裹或前后废话的文本里抠出 JSON */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  s = s.replace(/^```(?:json|JSON)?\s*/m, '').replace(/```\s*$/m, '').trim();

  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  const direct = tryParse(s);
  if (direct) return direct;

  // 截取第一个 { 或 [ 到最后一个配对的 } 或 ]
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const endChar = s[start] === '{' ? '}' : ']';
  const end = s.lastIndexOf(endChar);
  if (end > start) {
    const sliced = s.slice(start, end + 1);
    const parsed = tryParse(sliced);
    if (parsed) return parsed;
    // 长文本里模型常把换行/制表符直接写进字符串，JSON 会非法——先转义再解析
    const loose = tryParse(sanitizeJSON(sliced));
    if (loose) return loose;
  }
  return null;
}

/** 修掉模型常见的 JSON 小毛病：字符串里的裸控制字符、尾逗号 */
function sanitizeJSON(str) {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (const ch of str) {
    if (inStr) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inStr = false;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      // 其他不可见控制字符直接丢弃
      if (ch < ' ') continue;
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** 粗略判断 JSON 是否明显不完整（括号没闭合、末尾断在字符串里） */
function looksIncomplete(text) {
  if (!text) return true;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (const ch of text) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return inStr || depth !== 0;
}

/**
 * 要求模型返回 JSON：解析失败时先补足 token 重试，再让模型自己修一次。
 */
export async function chatJSON(messages, opts = {}) {
  throwIfCancelled();
  let maxTokens = Math.max(256, opts.maxTokens ?? config.llm.maxTokens);
  const first = await chatDetailed(messages, { ...opts, maxTokens });
  const parsed = extractJSON(first.content);
  if (parsed) return parsed;

  const incomplete = looksIncomplete(first.content);
  console.warn(
    `[llm] JSON 解析失败（finish=${first.finishReason || '—'}，正文 ${first.content.length} 字${incomplete ? '，疑似被截断' : ''}）：`,
    first.content.slice(0, 200).replace(/\s+/g, ' '),
  );

  // 截断型失败：直接加 token 重发原请求，比让模型"修半截 JSON"更可靠
  let raw = first.content;
  if (incomplete) {
    const bigger = Math.min(TOKEN_CEILING, Math.max(maxTokens * 2, 8192));
    if (bigger > maxTokens) {
      const retry = await chatDetailed(messages, { ...opts, maxTokens: bigger });
      const again = extractJSON(retry.content);
      if (again) return again;
      raw = retry.content;
      maxTokens = bigger;
    }
  }

  const repaired = await chatDetailed(
    [
      ...messages,
      { role: 'assistant', content: raw.slice(0, 8000) },
      {
        role: 'user',
        content:
          '你上一条回复不是合法 JSON（可能被截断了）。请只输出一个完整、合法、可被 JSON.parse 解析的对象，不要任何解释、不要 markdown 代码块。如果内容较长，请压缩表述但必须闭合所有括号。字段结构保持不变。',
      },
    ],
    { ...opts, json: true, temperature: 0, maxTokens: Math.min(TOKEN_CEILING, Math.max(maxTokens, 8192)) },
  );
  const again = extractJSON(repaired.content);
  if (again) return again;

  throw new LLMError(
    `模型没有返回可解析的 JSON。已自动重试并加大输出上限（${maxTokens} token）仍未成功。` +
      `常见原因：① 模型是推理型，token 多被思考占用 → 设置 LLM_REASONING_EFFORT=low 或调大 LLM_MAX_TOKENS；` +
      `② 单次要求的内容太多 → 减少一次生成的知识点数量。当前模型：${config.llm.model}`,
    { code: 'BAD_JSON' },
  );
}

export function describeLLM() {
  return {
    model: config.demo ? 'demo（内置样例数据）' : config.llm.model,
    baseUrl: config.demo ? '—' : config.llm.baseUrl,
    demo: config.demo,
  };
}
