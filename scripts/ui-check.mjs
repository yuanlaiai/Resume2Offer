/* CDP 实测新 UI：模拟面试对话/报告/逐题答案、JD 卡、章节进度、语音按钮 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 9336;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/r2o-cdp-profile', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonrpc(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let errors = [];
let ws;
try {
  let targets = [];
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try { targets = await jsonrpc(PORT, '/json/list'); if (targets.length) break; } catch { /* retry */ }
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const WebSocket = (await import('node:module')).createRequire(import.meta.url)('ws');
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));

  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 200));
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      console.error('[page-exception]', String(r.result.exceptionDetails?.exception?.description || r.result.exceptionDetails?.text).slice(0, 300));
      return null;
    }
    return r.result?.result?.value ?? null;
  };
  // 轮询直到条件满足或超时
  const waitFor = async (expr, ms = 6000) => {
    const start = Date.now();
    let v = null;
    while (Date.now() - start < ms) {
      v = await evaluate(expr);
      if (v) return v;
      await sleep(400);
    }
    return v;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const goto = async (hash, wait = 3000) => {
    await send('Page.navigate', { url: `http://localhost:8899/${hash}` });
    await sleep(wait);
  };
  const clickTab = (label) => evaluate(`(() => { const t=[...document.querySelectorAll('[data-tab]')].find(b=>b.textContent.includes('${label}')); if(t){t.click();return true} return false })()`);

  const results = [];
  const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

  // 1. 首页
  await goto('');
  ok('首页加载', await waitFor(`document.body.innerText.includes('把简历变成一套')`, 6000));

  // 2. 画像页（等 record 加载完成）
  const recId = await evaluate(`fetch('/api/analyses').then(r=>r.json()).then(d=>{const l=d.items||d;return l[0].id})`);
  await goto(`#/a/${recId}`, 3200);
  // 打开记录默认停在别的 Tab，先切到画像页再检查 JD 卡
  await clickTab('简历画像');
  ok('画像页含 JD 对比/简历评审卡', await waitFor(`document.body.innerText.includes('JD 对比') && document.body.innerText.includes('简历评审')`, 6000));

  // 3. 模拟面试 Tab：会话切换 + 对话流 + 报告 + 逐题答案
  ok('模拟面试 Tab 存在', await clickTab('模拟面试'));
  // active 可能是没答完的 live 会话：切到最近一个已评分的会话再断言
  await waitFor(`(async () => {
    const done = [...document.querySelectorAll('[data-mock-open]')].find((c) => c.textContent.includes('已评分'));
    if (!done) return false;
    done.click();
    await new Promise((r) => setTimeout(r, 600));
    return !!document.querySelector('.mr-verdict');
  })()`, 8000);
  const mockState = await waitFor(`(() => {
    const chips = document.querySelectorAll('[data-mock-open]').length;
    const msgs = document.querySelectorAll('.m-msg').length;
    const answers = document.querySelectorAll('.mq-card').length;
    if (!chips) return null;
    const report = document.querySelector('.mr-verdict')?.textContent || '';
    if (!report) return null;
    const fu = document.querySelectorAll('.mq-fu > div').length;
    return { chips, msgs, answers, fu, report: report.slice(0, 30) };
  })()`, 8000);
  ok('模拟面试对话流渲染', mockState && mockState.msgs >= 2, `消息 ${mockState?.msgs}`);
  ok('评分报告渲染', Boolean(mockState?.report), mockState?.report);
  ok('逐题参考答案卡片', mockState && mockState.answers >= 1, `${mockState?.answers} 张 / 追问 ${mockState?.fu}`);
  ok('多场会话切换入口', mockState && mockState.chips >= 2, `${mockState?.chips} 场`);
  const switchOk = await waitFor(`(async () => {
    const chips=[...document.querySelectorAll('[data-mock-open]')];
    if(chips.length<2) return false;
    chips[chips.length-1].click();
    await new Promise(r=>setTimeout(r,600));
    return document.querySelectorAll('.m-msg').length !== ${mockState?.msgs};
  })()`, 6000);
  ok('切换历史会话生效', Boolean(switchOk));

  // 4. 系统课程：章节行 / 进度按钮 / 覆盖徽标
  ok('切到系统课程', await clickTab('系统课程'));
  const course = await waitFor(`(() => {
    const rows = document.querySelectorAll('.chapter-row').length;
    if (rows < 10) return null;
    const prog = document.querySelectorAll('[data-progress]').length;
    const cov = [...document.querySelectorAll('.chip')].some(c=>c.textContent.includes('考点覆盖'));
    return { rows, prog, cov };
  })()`, 8000);
  ok('课程章节行渲染', course && course.rows >= 10, `${course?.rows} 行`);
  ok('章节进度按钮', course && course.prog >= 10, `${course?.prog} 个`);
  ok('考点覆盖徽标', Boolean(course?.cov));

  // 点一次进度按钮验证三态切换（未学→已学）
  const progToggle = await waitFor(`(async () => {
    const b = document.querySelector('[data-progress]');
    if (!b) return null;
    const before = b.textContent.trim();
    b.click();
    await new Promise(r=>setTimeout(r,2000));
    const b2 = document.querySelector('[data-progress]');
    if (!b2) return 'gone';
    return before + '->' + b2.textContent.trim();
  })()`, 8000);
  ok('进度标记三态切换', /(未学|已学|已掌握)->(未学|已学|已掌握)/.test(String(progToggle).replace(/\s+/g, '')) && !/^(.+)->\1$/.test(String(progToggle).replace(/\s+/g, '')), String(progToggle));

  // 5. 语音按钮：live 会话里出现（headless Chrome 有 SpeechRecognition）
  ok('切回模拟面试', await clickTab('模拟面试'));
  const startClick = await waitFor(`(() => { const b=document.querySelector('[data-mock-start="standard"]'); if(b){b.click();return true} return false })()`, 6000);
  const micState = await waitFor(`(() => {
    if (!document.querySelector('.mock-input')) return null; // 只认 live 会话的输入区
    const mic = document.getElementById('mock-mic');
    return { mic: !!mic && !mic.hidden, sr: !!(window.SpeechRecognition||window.webkitSpeechRecognition) };
  })()`, 30000); // 等面试官开场（真实模型）
  ok('开始一场新面试', Boolean(startClick && micState), JSON.stringify(micState || {}));
  ok('语音按钮在 live 会话出现', Boolean(micState?.mic) === Boolean(micState?.sr), JSON.stringify(micState || {}));
  const micLabel = await waitFor(`document.querySelector('.mock-input #mock-mic')?.textContent?.trim() || ''`, 4000);
  ok('mic 按钮文案正常', String(micLabel).includes('说话'), micLabel);

  // 6. 截图存档
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/tmp/r2o-ui-check.png', Buffer.from(shot.result.data, 'base64'));

  console.log(results.join('\n'));
  console.log('console errors:', errors.length ? errors.slice(0, 5) : '无');
  process.exitCode = errors.length || results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
} catch (e) {
  console.error('CDP 失败：', e.message);
  process.exitCode = 2;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
}
