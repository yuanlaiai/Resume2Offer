import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const ROOT = root;

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  publicDir: path.join(root, 'public'),
  maxUploadMb: 10,
  demo: process.env.DEMO_MODE === '1',
  search: {
    apiKey: (process.env.SEARCH_API_KEY || '').trim(),
    endpoint: (process.env.SEARCH_ENDPOINT || 'https://api.tavily.com/search').trim(),
    timeoutMs: num(process.env.SEARCH_TIMEOUT_MS, 15000),
  },
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: (process.env.LLM_API_KEY || '').trim(),
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: num(process.env.LLM_TEMPERATURE, 0.4),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 4096),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 120000),
  },
};

export function llmReady() {
  return config.demo || Boolean(config.llm.apiKey);
}
