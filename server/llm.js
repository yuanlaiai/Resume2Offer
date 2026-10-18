import { config } from './config.js';
import { mockChat } from './mock.js';

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

export async function chat(messages, opts = {}) {
  if (config.demo) return mockChat(messages, opts);

  const body = {
    model: config.llm.model,
    messages,
    temperature: opts.temperature ?? config.llm.temperature,
    max_tokens: opts.maxTokens ?? config.llm.maxTokens,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.llm.timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const detail = text.slice(0, 400);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new LLMError(`模型服务返回 ${res.status}`, { status: res.status });
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new LLMError('大模型鉴权失败，请检查 LLM_API_KEY 与 LLM_BASE_URL 是否匹配', { status: res.status });
        }
        throw new LLMError(`模型服务返回 ${res.status}：${detail}`, { status: res.status });
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (!content) throw new LLMError('模型返回为空，请重试或更换模型');
      if (choice.finish_reason === 'length') {
        console.warn('[llm] 回复被 max_tokens 截断，可调大 LLM_MAX_TOKENS');
      }
      return typeof content === 'string' ? content : JSON.stringify(content);
    } catch (err) {
      if (err instanceof LLMError && err.status && err.status < 500 && err.status !== 429) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        lastErr = new LLMError(`模型请求超时（>${Math.round(config.llm.timeoutMs / 1000)}s）`);
      } else {
        lastErr = err instanceof LLMError ? err : new LLMError(`调用模型失败：${err.message}`);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr || new LLMError('调用模型失败');
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
    const sliced = tryParse(s.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return null;
}

/**
 * 要求模型返回 JSON，并做一次自动修复。
 */
export async function chatJSON(messages, opts = {}) {
  const raw = await chat(messages, { ...opts, json: true });
  const parsed = extractJSON(raw);
  if (parsed) return parsed;

  const repaired = await chat(
    [
      ...messages,
      { role: 'assistant', content: raw.slice(0, 6000) },
      {
        role: 'user',
        content:
          '你上一条回复不是合法 JSON。请只输出合法 JSON，不要任何解释、不要 markdown 代码块。字段结构保持不变。',
      },
    ],
    { ...opts, json: true, temperature: 0 },
  );
  const again = extractJSON(repaired);
  if (again) return again;
  throw new LLMError('模型没有返回可解析的 JSON，请重试');
}

export function describeLLM() {
  return {
    model: config.demo ? 'demo（内置样例数据）' : config.llm.model,
    baseUrl: config.demo ? '—' : config.llm.baseUrl,
    demo: config.demo,
  };
}
