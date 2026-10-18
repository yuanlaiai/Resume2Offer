import http from 'node:http';
import { config } from '../server/config.js';
import { searchWeb, searchReady } from '../server/search.js';

const shapes = {
  '/tavily': { results: [{ title: 'TAVILY', content: 'A'.repeat(40), url: 'https://a' }] },
  '/bocha': { data: { webPages: { value: [{ name: 'BOCHA', summary: 'B'.repeat(40), url: 'https://b' }] } } },
  '/brave': { web: { results: [{ title: 'BRAVE', description: 'C'.repeat(40), url: 'https://c' }] } },
  '/serper': { organic: [{ title: 'SERPER', snippet: 'D'.repeat(40), link: 'https://d' }] },
  '/searxng': { results: [{ title: 'SEARXNG', content: 'E'.repeat(40), url: 'https://e' }] },
};

const srv = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(shapes[path] || { results: [] }));
});
await new Promise((r) => srv.listen(9911, '127.0.0.1', r));

for (const provider of ['tavily', 'bocha', 'brave', 'serper', 'searxng', 'custom']) {
  config.search.provider = provider;
  config.search.apiKey = provider === 'searxng' ? '' : 'k';
  config.search.endpoint = `http://127.0.0.1:9911/${provider === 'custom' ? 'tavily' : provider}`;
  const out = await searchWeb('测试查询', { maxResults: 3 });
  console.log(provider.padEnd(8), searchReady() ? 'ready' : 'skip', '→', out.length, out[0]?.title || '-', '|', out[0]?.content?.slice(0, 20));
}

// 失败降级：端点不可达时应静默返回空数组
config.search.provider = 'tavily';
config.search.endpoint = 'http://127.0.0.1:9911/boom';
console.log('failover →', (await searchWeb('x')).length);

srv.close();
