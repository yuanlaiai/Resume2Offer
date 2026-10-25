/* Resume2Offer — 前端（零依赖，原生 JS） */

const $app = document.getElementById('app');
const $topRight = document.getElementById('topbar-right');
const $topbar = document.getElementById('topbar');
const $toast = document.getElementById('toast');

const state = {
  health: null,
  history: [],
  record: null,
  tab: 'profile',
  selected: new Set(),
  answers: {},
  materialId: null,
  quizId: null,
  attemptId: null,
  mode: 'file',
  file: null,
  submitting: false,
  depth: localStorage.getItem('if-depth') || 'standard',
  prefill: null,
  prefillBusy: false,
  prefillQueued: false,
  roleTouched: false,
  autoStart: localStorage.getItem('if-autostart') !== '0',
  autoTimer: null,
  reportDepth: localStorage.getItem('if-depth') || 'standard',
  historyOpen: false,
  courseId: null,
  chapterId: null,
  lessonDepth: localStorage.getItem('if-depth') || 'standard',
  lessonVersion: 0,
  lessonHistOpen: false,
};

const DEPTH_LABEL = { lite: '简单', standard: '中等', deep: '深度' };
const DEPTH_DESC = {
  lite: '只给结论与答题骨架，5 分钟能过一遍',
  standard: '原理讲透到能应对一轮技术面',
  deep: '讲到实现机制、对比选型与失效场景',
};

/* ---------------- 小工具 ---------------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
};

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** 极简 markdown：段落 / 列表 / 加粗 / 行内代码（先转义，安全） */
function md(src) {
  const lines = esc(src || '').split('\n');
  const out = [];
  let list = false;
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push('</ul>');
      list = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      closeList();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flush();
      if (!list) {
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      flush();
      closeList();
      out.push(`<p><strong>${inline(line.replace(/^#+\s+/, ''))}</strong></p>`);
      continue;
    }
    closeList();
    para.push(inline(line));
  }
  flush();
  closeList();
  return out.join('');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $toast.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts = {}) {
  const token = localStorage.getItem('r2o-token') || '';
  const headers = { ...(opts.headers || {}) };
  if (token) headers['x-token'] = token;

  // 默认 120s 超时：服务重启/断网时请求不会无限挂起，浮层能正常报错而不是永远转圈
  const timeoutMs = Number(opts.timeout) || 120000;
  const doFetch = () => fetch(path, { ...opts, headers, signal: AbortSignal.timeout(timeoutMs) });

  let res;
  try {
    res = await doFetch();
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error('请求超时：服务可能刚重启过，请刷新页面后重试');
    }
    throw new Error('网络请求失败：请检查服务是否在线后刷新页面');
  }
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.authRequired) {
      const input = window.prompt('这台服务开启了访问鉴权，请输入 ACCESS_TOKEN：');
      if (input && input.trim()) {
        localStorage.setItem('r2o-token', input.trim());
        headers['x-token'] = input.trim();
        res = await doFetch();
      }
    }
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
  return data;
}

const on = (sel, ev, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

/* ---------------- 任务进度浮层 ---------------- */

function showOverlay(title, steps = []) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.id = 'job-overlay';
  el.innerHTML = `
    <div class="job-card">
      <h3>${esc(title)}</h3>
      <p class="sub" id="job-sub">正在连接模型…</p>
      <div class="job-steps" id="job-steps">
        ${steps.map((s) => `<div class="job-step"><span class="ic"></span><span>${esc(s)}</span></div>`).join('')}
      </div>
      <div class="job-bar"><i id="job-bar" style="width:4%"></i></div>
      <div id="job-err"></div>
    </div>`;
  document.body.appendChild(el);
}

function updateOverlay(job) {
  const sub = document.getElementById('job-sub');
  const bar = document.getElementById('job-bar');
  const wrap = document.getElementById('job-steps');
  if (sub) sub.textContent = job.detail || job.label || '处理中…';
  if (bar) bar.style.width = `${Math.max(4, job.progress || 0)}%`;
  if (wrap && Array.isArray(job.steps)) {
    wrap.innerHTML = job.steps
      .map((s) => {
        const cls = s.status === 'done' ? 'done' : s.status === 'running' ? 'running' : s.status === 'error' ? 'error' : '';
        return `<div class="job-step ${cls}"><span class="ic">${s.status === 'done' ? '✓' : s.status === 'error' ? '!' : ''}</span><span>${esc(s.label)}</span></div>`;
      })
      .join('');
  }
}

function overlayError(message) {
  const err = document.getElementById('job-err');
  if (err) {
    err.innerHTML = `<div class="job-err">${esc(message)}</div>
      <div style="margin-top:14px;text-align:right"><button class="btn btn-ghost btn-sm" id="job-close">关闭</button></div>`;
    document.getElementById('job-close').addEventListener('click', hideOverlay);
  }
  const bar = document.getElementById('job-bar');
  if (bar) bar.style.background = '#d92d20';
}

function hideOverlay() {
  const el = document.getElementById('job-overlay');
  if (el) el.remove();
}

function pollJob(jobId) {
  return new Promise((resolve, reject) => {
    const step = async () => {
      try {
        const job = await api(`/api/jobs/${jobId}`);
        updateOverlay(job);
        if (job.status === 'done') return resolve(job.result);
        if (job.status === 'error') return reject(new Error(job.error || '处理失败'));
        setTimeout(step, 750);
      } catch (err) {
        reject(err);
      }
    };
    step();
  });
}

async function runJob(reqPromise, title, steps) {
  showOverlay(title, steps);
  try {
    const { jobId } = await reqPromise;
    const result = await pollJob(jobId);
    hideOverlay();
    return result;
  } catch (err) {
    overlayError(err.message);
    throw err;
  }
}

/* ---------------- 顶部 ---------------- */

function renderTopbar() {
  const h = state.health;
  if (!h) {
    $topRight.innerHTML = '';
    return;
  }
  const modelPill = h.demo
    ? `<span class="pill"><span class="dot"></span>演示模式</span>`
    : h.ready
      ? `<span class="pill ghost" title="${esc(h.llm.baseUrl)}">${esc(h.llm.model)}</span>`
      : `<span class="pill" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)">未配置模型</span>`;
  const usage = state.usage && state.usage.totalTokens
    ? `<span class="pill ghost" title="本服务累计 LLM 用量（${state.usage.totalCalls} 次调用）">↯ ${(state.usage.totalTokens / 1000).toFixed(1)}k tok</span>`
    : '';
  const newBtn = state.record ? `<a class="btn btn-ghost btn-sm" href="#/">新建分析</a>` : '';
  // 多简历快速切换：顶栏下拉列出最近 8 份分析
  const switcher = state.record && (state.history || []).length > 1
    ? `<select id="resume-switch" class="input topbar-switch" title="切换到其他简历">
        ${state.history.slice(0, 8).map((h) => `<option value="${esc(h.id)}" ${h.id === state.record.id ? 'selected' : ''}>${esc(h.candidate?.name || '未命名')}·${esc((h.targetRole || h.candidate?.title || '').slice(0, 12))}</option>`).join('')}
      </select>`
    : '';
  $topRight.innerHTML = `${modelPill}${usage}${switcher}${newBtn}`;
  const sw = document.getElementById('resume-switch');
  if (sw) sw.addEventListener('change', () => { location.hash = `#/a/${sw.value}`; });
}

/* ---------------- 首页 ---------------- */

function renderHome() {
  state.record = null;
  renderTopbar();
  const notReady = state.health && !state.health.ready;

  $app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Resume2Offer</div>
        <h1 class="hero-title">把简历变成一套<br /><em>能背下来</em>的面试答案</h1>
        <p class="hero-sub">上传简历，AI 用面试官的视角拆出你真正会被问到的知识点，生成能直接开口说的复习资料，再出题考你、给你打分、指出下一步。</p>
        <ul class="hero-points">
          <li><span class="num">1</span><span><b>只看你的简历</b>　不生成通用八股，每个知识点都能追到简历里的某一句</span></li>
          <li><span class="num">2</span><span><b>面试官视角</b>　告诉你他在意什么、会怎么追问、哪里会埋坑</span></li>
          <li><span class="num">3</span><span><b>测完才算会</b>　出题打分、逐题复盘，再按短板排 7 天计划</span></li>
        </ul>
        <div class="hero-note">
          <span><i></i>支持 PDF / DOCX / TXT</span>
          <span><i></i>数据只存在你自己部署的机器上</span>
          <span><i></i>任何 OpenAI 兼容模型</span>
        </div>
      </div>

      <form class="upload-card" id="upload-form">
        <h3>开始生成复习方案</h3>
        <p class="hint">上传简历，或直接粘贴文本</p>

        <div class="mode-switch">
          <button type="button" data-mode="file" class="on">上传文件</button>
          <button type="button" data-mode="text">粘贴文本</button>
        </div>

        <div id="upload-body" style="margin-top:12px">
          <div class="dropzone" id="dropzone">
            <div class="dz-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            </div>
            <strong>点击选择，或拖拽文件到这里</strong>
            <span>PDF / DOCX / TXT / MD，最大 10MB</span>
          </div>
          <input type="file" id="file-input" accept=".pdf,.docx,.txt,.md,.markdown" hidden />
          <div id="file-chip"></div>
        </div>

        <div class="field">
          <label for="role">目标岗位<span class="label-hint" id="prefill-hint"></span></label>
          <input class="input" id="role" name="targetRole" placeholder="上传简历后自动识别，也可以自己填" maxlength="60" />
          <div class="role-suggest" id="role-suggest"></div>
        </div>
        <div class="field">
          <label for="level">目标级别（可选）</label>
          <select class="select" id="level">
            <option value="">自动判断</option>
            <option>初级</option>
            <option>中级</option>
            <option>高级</option>
            <option>专家</option>
            <option>管理岗</option>
          </select>
        </div>

        <div class="field">
          <label>复习资料深度</label>
          <div class="depth-switch" id="home-depth">
            ${Object.entries(DEPTH_LABEL).map(([k, v]) => `<button type="button" data-depth="${k}" class="${state.depth === k ? 'on' : ''}"><b>${v}</b><span>${DEPTH_DESC[k]}</span></button>`).join('')}
          </div>
        </div>

        <div class="upload-actions">
          <button class="btn btn-brand btn-lg btn-block" id="submit-btn" type="submit">生成知识点与复习方案</button>
          <label class="auto-start">
            <input type="checkbox" id="auto-start" ${state.autoStart ? 'checked' : ''} />
            <span>上传后自动开始分析（识别完岗位就拆简历）</span>
          </label>
          <button class="btn btn-quiet btn-sm" type="button" id="sample-btn">没有简历？用示例简历试一下</button>
        </div>
        <div class="upload-foot">${notReady ? '⚠️ 服务端未配置 LLM_API_KEY，请参考 README 配置后重启，或用 npm run demo 启动' : '分析通常需要 20~40 秒，建议在电脑上操作'}</div>
      </form>
    </section>

    <div class="flow">
      <div class="flow-step"><span class="idx">1</span><span><b>上传简历</b>　拆经历</span></div>
      <div class="flow-step"><span class="idx">2</span><span><b>知识点图谱</b>　按优先级</span></div>
      <div class="flow-step"><span class="idx">3</span><span><b>复习资料</b>　面试官视角</span></div>
      <div class="flow-step"><span class="idx">4</span><span><b>测验打分</b>　逐题复盘</span></div>
      <div class="flow-step"><span class="idx">5</span><span><b>下一步计划</b>　7 天冲刺</span></div>
    </div>

    <div class="section-head">
      <h2>历史分析</h2><span id="history-count"></span>
    </div>
    <div class="history-grid" id="history-grid">
      <div class="history-card"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:10px;width:40%;margin-top:8px"></div></div>
    </div>
  `;

  bindHome();
  loadHistory();
}

function bindHome() {
  on('.mode-switch button', 'click', (e) => {
    const mode = e.currentTarget.dataset.mode;
    state.mode = mode;
    document.querySelectorAll('.mode-switch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const body = document.getElementById('upload-body');
    if (mode === 'text') {
      body.innerHTML = `<textarea class="textarea" id="resume-text" placeholder="把简历内容粘贴到这里（至少 40 字）…" style="min-height:180px"></textarea>`;
      const ta = document.getElementById('resume-text');
      let timer = null;
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => requestPrefill({ auto: false }), 1200);
      });
    } else {
      body.innerHTML = `
        <div class="dropzone" id="dropzone">
          <div class="dz-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
          </div>
          <strong>点击选择，或拖拽文件到这里</strong>
          <span>PDF / DOCX / TXT / MD，最大 10MB</span>
        </div>
        <input type="file" id="file-input" accept=".pdf,.docx,.txt,.md,.markdown" hidden />
        <div id="file-chip"></div>`;
      bindDropzone();
    }
  });

  bindDropzone();

  on('#home-depth [data-depth]', 'click', (e) => {
    const d = e.currentTarget.dataset.depth;
    state.depth = d;
    state.reportDepth = d;
    localStorage.setItem('if-depth', d);
    document.querySelectorAll('#home-depth [data-depth]').forEach((b) => b.classList.toggle('on', b.dataset.depth === d));
  });

  document.getElementById('sample-btn').addEventListener('click', async () => {
    try {
      const { text } = await api('/api/sample');
      document.querySelector('.mode-switch button[data-mode="text"]').click();
      document.getElementById('resume-text').value = text;
      requestPrefill();
      toast('已填入示例简历，正在识别岗位');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('upload-form').addEventListener('submit', submitAnalyze);

  const auto = document.getElementById('auto-start');
  if (auto) {
    auto.checked = state.autoStart;
    auto.addEventListener('change', () => {
      state.autoStart = auto.checked;
      localStorage.setItem('if-autostart', auto.checked ? '1' : '0');
      if (!auto.checked) cancelAutoAnalyze();
      else if (state.prefill) scheduleAutoAnalyze();
    });
  }

  const roleInput = document.getElementById('role');
  if (roleInput) {
    // 用户手动改过岗位，就不再被自动识别覆盖
    roleInput.addEventListener('input', () => {
      state.roleTouched = true;
      cancelAutoAnalyze();
    });
  }
}

function bindDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  if (!dz || !input) return;

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) setFile(input.files[0]);
  });
}

function setFile(file) {
  if (file.size > 10 * 1024 * 1024) {
    toast('文件超过 10MB，请压缩后再传', 'err');
    return;
  }
  state.file = file;
  state.prefill = null;
  state.roleTouched = false;
  cancelAutoAnalyze();
  const chip = document.getElementById('file-chip');
  if (chip) {
    chip.innerHTML = `<div class="file-chip">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
      <span>${esc(file.name)}</span>
      <button type="button" class="x" id="clear-file">×</button>
    </div>`;
    document.getElementById('clear-file').addEventListener('click', (e) => {
      e.stopPropagation();
      state.file = null;
      chip.innerHTML = '';
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    });
  }
  requestPrefill();
}

/* ---------- 上传即识别岗位 ---------- */

/**
 * 请求岗位预判。
 * - 正在识别时再次触发，会记为「待补一次」，避免上传后的识别被丢掉
 * - 失败时给出可见提示（之前是静默吞掉，用户只会觉得「没反应」）
 * - 识别成功后若开启自动开始，倒计时 3 秒自动拆简历
 */
async function requestPrefill({ auto = true } = {}) {
  if (state.prefillBusy) {
    state.prefillQueued = true;
    return;
  }
  if (!state.health?.ready) {
    setPrefillHint('服务端未就绪，无法自动识别岗位', 'warn');
    return;
  }

  const form = new FormData();
  if (state.mode === 'text') {
    const text = (document.getElementById('resume-text')?.value || '').trim();
    if (text.length < 60) return;
    form.append('text', text);
  } else {
    if (!state.file) return;
    form.append('resume', state.file);
  }

  state.prefillBusy = true;
  setPrefillHint('识别中…', 'busy');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45000);
  try {
    const res = await fetch('/api/prefill', { method: 'POST', body: form, signal: ac.signal });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `识别失败（HTTP ${res.status}）`;
      throw new Error(msg);
    }
    const data = await res.json();
    state.prefill = data;
    applyPrefill(data);
    if (auto && state.autoStart) scheduleAutoAnalyze();
  } catch (err) {
    const msg = err.name === 'AbortError' ? '识别超时' : err.message;
    setPrefillHint(`${msg}，可手动填写岗位`, 'warn');
    toast(`岗位自动识别失败：${msg}`, 'err');
    console.warn('[prefill]', err);
  } finally {
    clearTimeout(timer);
    state.prefillBusy = false;
    if (state.prefillQueued) {
      state.prefillQueued = false;
      requestPrefill({ auto });
    }
  }
}

function setPrefillHint(text, tone = '') {
  const hint = document.getElementById('prefill-hint');
  if (!hint) return;
  hint.className = `label-hint${tone ? ` ${tone}` : ''}`;
  hint.textContent = text || '';
}

function applyPrefill(data) {
  const roles = data.roles || [];
  if (!roles.length) {
    setPrefillHint('没识别出岗位，可手动填写', 'warn');
    return;
  }
  const input = document.getElementById('role');
  const level = document.getElementById('level');
  // 用户填过就不覆盖，否则用识别结果填充
  if (input && (!input.value.trim() || !state.roleTouched)) input.value = roles[0].title;
  if (level && !level.value && (data.level || roles[0].level)) {
    const lv = data.level || roles[0].level;
    if ([...level.options].some((o) => o.value === lv)) level.value = lv;
  }
  setPrefillHint('✓ 已自动识别，可修改', 'ok');

  const box = document.getElementById('role-suggest');
  if (!box) return;
  box.innerHTML = `
    <div class="suggest-title">AI 识别：${esc(data.headline || '')}</div>
    <div class="chips">
      ${roles
        .map(
          (r, i) => `<button type="button" class="chip pick ${i === 0 ? 'brand' : ''}" data-pick="${esc(r.title)}" data-level="${esc(r.level || '')}" title="${esc(r.reason)}">
        ${esc(r.title)}${r.fitScore ? `<span class="fit">${r.fitScore}</span>` : ''}
      </button>`,
        )
        .join('')}
    </div>
    ${(data.keywords || []).length ? `<div class="suggest-kw">${data.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}`;

  box.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const roleInput = document.getElementById('role');
      if (roleInput) roleInput.value = btn.dataset.pick;
      state.roleTouched = true;
      const lv = btn.dataset.level;
      const levelSel = document.getElementById('level');
      if (lv && levelSel && [...levelSel.options].some((o) => o.value === lv)) levelSel.value = lv;
      box.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('brand', b === btn));
    });
  });
}

/** 识别完成后倒计时自动开始分析（3 秒内可取消） */
function scheduleAutoAnalyze() {
  if (state.autoTimer || state.submitting) return;
  if (!state.autoStart || !state.prefill) return;
  const form = document.getElementById('upload-form');
  if (!form) return;

  let left = 3;
  const paint = () => {
    const hint = document.getElementById('prefill-hint');
    if (!hint) return;
    hint.className = 'label-hint ok';
    hint.innerHTML = `✓ 已识别，${left} 秒后自动拆简历 <button type="button" class="hint-cancel" id="cancel-auto">取消</button>`;
    document.getElementById('cancel-auto')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelAutoAnalyze();
      setPrefillHint('已取消自动开始，点下方按钮开始', 'ok');
    });
  };
  paint();

  state.autoTimer = setInterval(() => {
    left -= 1;
    if (left > 0) {
      paint();
      return;
    }
    cancelAutoAnalyze();
    if (!state.submitting) form.requestSubmit();
  }, 1000);
}

function cancelAutoAnalyze() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
}

/** 提交前等一等还没回来的识别结果，避免「岗位空着就分析」 */
async function waitPrefill(timeoutMs = 10000) {
  if (!state.prefillBusy && !state.prefillQueued) return;
  const started = Date.now();
  while ((state.prefillBusy || state.prefillQueued) && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function submitAnalyze(e) {
  e.preventDefault();
  if (state.submitting) return;
  if (state.health && !state.health.ready) {
    toast('服务端还没有配置 LLM_API_KEY，请先配置或用 npm run demo 启动', 'err');
    return;
  }

  cancelAutoAnalyze();

  state.submitting = true;
  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '分析中…';
  }

  try {
    // 岗位识别可能还在路上：等它一下，别用空岗位去分析
    if (!(document.getElementById('role')?.value || '').trim()) {
      setPrefillHint('正在识别岗位，稍等…', 'busy');
      await waitPrefill();
    }

    const role = (document.getElementById('role')?.value || '').trim();
    const level = document.getElementById('level')?.value || '';
    const form = new FormData();
    form.append('targetRole', role);
    form.append('level', level);

    if (state.mode === 'text') {
      const text = (document.getElementById('resume-text')?.value || '').trim();
      if (text.length < 40) {
        toast('简历内容太短，至少 40 字', 'err');
        return;
      }
      form.append('text', text);
    } else {
      if (!state.file) {
        toast('请先选择简历文件', 'err');
        return;
      }
      form.append('resume', state.file);
    }

    const result = await runJob(
      api('/api/analyze', { method: 'POST', body: form }),
      '正在读懂你的简历',
      ['读懂简历：拆解经历与技能', '推导知识点：按岗位重要性排序'],
    );
    state.selected = new Set((result.topics || []).map((t) => t.id));
    state.pendingAuto = 5;
    state.justAnalyzed = true;
    location.hash = `#/a/${result.analysisId}`;
  } catch (err) {
    /* 错误已在浮层展示 */
  } finally {
    state.submitting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '生成知识点与复习方案';
    }
  }
}

async function loadHistory() {
  const grid = document.getElementById('history-grid');
  if (!grid) return;
  try {
    const { items } = await api('/api/analyses');
    state.history = items;
    const count = document.getElementById('history-count');
    if (count) count.textContent = items.length ? `共 ${items.length} 份` : '';
    if (!items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:34px">
        <h3>还没有分析记录</h3><p>上传第一份简历，30 秒内得到一份专属复习清单。</p></div>`;
      return;
    }
    grid.innerHTML = items
      .map(
        (it) => `<div class="history-card" data-id="${esc(it.id)}">
          <button class="history-del" data-del="${esc(it.id)}" title="删除">×</button>
          <h4>${esc(it.candidate?.name || '未命名')} · ${esc(it.targetRole || it.candidate?.title || '未指定岗位')}</h4>
          <p>${esc(it.createdAt ? fmtDate(it.createdAt) : '')}　·　${it.topicCount || 0} 个知识点</p>
          <div class="history-meta">
            ${it.lastScore != null ? `<span class="score-badge">${it.lastScore} 分</span>` : '<span class="chip" style="padding:1px 7px;font-size:11px">待测验</span>'}
            <span>${it.materialCount ? `${it.materialCount} 份资料` : '未生成资料'}</span>
          </div>
        </div>`,
      )
      .join('');

    on('.history-card', 'click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        deleteRecord(del.dataset.del);
        return;
      }
      location.hash = `#/a/${e.currentTarget.dataset.id}`;
    });
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><p>${esc(err.message)}</p></div>`;
  }
}

async function deleteRecord(id) {
  if (!confirm('删除后不可恢复，确定删除这份分析吗？')) return;
  try {
    await api(`/api/analyses/${id}`, { method: 'DELETE' });
    toast('已删除');
    loadHistory();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------------- 工作区 ---------------- */

const TABS = [
  { key: 'profile', label: '简历画像' },
  { key: 'study', label: '速学' },
  { key: 'courses', label: '系统课程' },
  { key: 'topics', label: '知识点图谱' },
  { key: 'materials', label: '复习资料' },
  { key: 'report', label: '面试报告' },
  { key: 'quiz', label: '测验' },
  { key: 'mock', label: '模拟面试' },
  { key: 'review', label: '复盘' },
  { key: 'plan', label: '计划' },
];

async function openAnalysis(id) {
  try {
    const record = await api(`/api/analyses/${id}`);
    state.record = record;
    state.selected = new Set((record.topics || []).map((t) => t.id));
    state.answers = {};
    state.quizId = record.quizzes?.[record.quizzes.length - 1]?.id || null;
    state.attemptId = record.attempts?.[record.attempts.length - 1]?.id || null;
    state.materialId = record.materials?.find((m) => !m.error)?.topicId || record.topics?.[0]?.id || null;
    state.viewVersion = 0;
    state.historyOpen = false;
    state.courseId = (record.courses || []).find((c) => (c.stages || []).length)?.id || null;
    state.chapterId = null;
    state.lessonVersion = 0;
    state.lessonHistOpen = false;
    if (state.pendingMaterial) state.materialId = state.pendingMaterial;
    state.tab = defaultTab(record);
    if (state.pendingTab && TABS.some((t) => t.key === state.pendingTab)) state.tab = state.pendingTab;
    // 刚分析完：先让用户看到简历被拆成了什么（画像页），资料在后台继续生成
    if (state.justAnalyzed) {
      state.tab = 'profile';
      state.justAnalyzed = false;
    }
    state.pendingTab = null;
    state.pendingMaterial = null;
    renderWorkspace();
    if (state.pendingAuto) {
      const n = state.pendingAuto;
      state.pendingAuto = 0;
      setTimeout(() => autoBuildCourses(), 200);
      if (!(record.materials || []).filter((m) => !m.error).length) {
        setTimeout(() => generateTop(n, true), 300);
      }
    }
  } catch (err) {
    toast(err.message, 'err');
    location.hash = '#/';
  }
}

function defaultTab(record) {
  if (record.plan) return 'plan';
  if (record.attempts?.length) return 'review';
  if ((record.courses || []).length) return 'courses';
  if (record.materials?.length) return 'materials';
  return 'topics';
}

function renderWorkspace() {
  const r = state.record;
  renderTopbar();
  const c = r.profile?.candidate || {};
  const fit = r.profile?.targetRole?.fitScore;

  $app.innerHTML = `
    <div class="ws-head">
      <div>
        <h1 class="ws-title">${esc(c.name || '候选人')}<span style="color:var(--muted);font-weight:400"> · </span>${esc(r.targetRole || '目标岗位')}</h1>
        <div class="ws-sub">
          ${c.title ? `<span>${esc(c.title)}</span>` : ''}
          ${c.years ? `<span>· ${esc(c.years)} 年经验</span>` : ''}
          ${c.city ? `<span>· ${esc(c.city)}</span>` : ''}
          <span>· ${esc(fmtDate(r.createdAt))}</span>
          ${r.fileName ? `<span>· 来源：${esc(r.fileName)}</span>` : ''}
        </div>
      </div>
      ${fit != null ? `<div class="ring-wrap" style="margin-left:auto">
        <div class="ring" style="--p:${fit};position:relative"><span>${fit}</span></div>
        <div class="ring-label">岗位匹配</div>
      </div>` : ''}
      <div class="ws-actions">
        <button class="btn btn-ghost btn-sm" id="export-btn">导出 Markdown</button>
      </div>
    </div>

    <div class="tabs" id="tabs">
      ${TABS.map((t) => {
        const count = tabCount(t.key);
        return `<button class="tab ${state.tab === t.key ? 'on' : ''}" data-tab="${t.key}">
          ${t.label}${count ? `<span class="count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="panel" id="panel"></div>
  `;

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === state.tab));
    renderPanel();
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    window.open(`/api/analyses/${r.id}/export.md`, '_blank');
  });

  renderPanel();
}

function tabCount(key) {
  const r = state.record;
  if (!r) return 0;
  if (key === 'topics') return (r.topics || []).length;
  if (key === 'courses') return (r.courses || []).filter((c) => (c.stages || []).length).length;
  if (key === 'materials') return (r.materials || []).filter((m) => !m.error).length;
  if (key === 'report') return r.report ? 1 : 0;
  if (key === 'quiz') return (r.quizzes || []).length;
  if (key === 'review') return (r.attempts || []).length;
  if (key === 'mock') return (r.mocks || []).length;
  return 0;
}

function renderPanel() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  const fn = {
    profile: panelProfile,
    study: panelStudy,
    courses: panelCourses,
    topics: panelTopics,
    materials: panelMaterials,
    report: panelReport,
    quiz: panelQuiz,
    mock: panelMock,
    review: panelReview,
    plan: panelPlan,
  }[state.tab];
  panel.innerHTML = fn ? fn() : '';
  panel.style.animation = 'none';
  void panel.offsetWidth;
  panel.style.animation = '';
  if (state.tab === 'profile') bindProfile();
  if (state.tab === 'study') bindStudy();
  if (state.tab === 'courses') bindCourses();
  if (state.tab === 'topics') bindTopics();
  if (state.tab === 'materials') bindMaterials();
  if (state.tab === 'report') bindReport();
  if (state.tab === 'quiz') bindQuiz();
  if (state.tab === 'mock') bindMock();
  if (state.tab === 'review') bindReview();
  if (state.tab === 'plan') bindPlan();
}

/* ---------- 画像 ---------- */

function panelProfile() {
  const r = state.record;
  const p = r.profile || {};
  const c = p.candidate || {};
  const skills = p.skills || [];
  const exps = p.experiences || [];
  const projs = p.projects || [];
  const coverage = r.coverage || [];
  const requiredCov = coverage.filter((c) => c.required !== false);
  const coveredCount = requiredCov.filter((c) => c.covered).length;
  const courseByGroup = new Map((r.courses || []).map((c) => [c.group, c]));

  return `
    <div class="parse-strip">
      <div class="ps-item"><b>${skills.length}</b><span>项技能</span></div>
      <div class="ps-item"><b>${exps.length}</b><span>段经历</span></div>
      <div class="ps-item"><b>${projs.length}</b><span>个项目</span></div>
      <div class="ps-item"><b>${(p.risks || []).length}</b><span>个风险点</span></div>
      <div class="ps-item"><b>${(r.topics || []).length}</b><span>个考点</span></div>
      <div class="ps-item"><b>${(r.materials || []).filter((m) => !m.error).length}</b><span>篇资料</span></div>
    </div>

    ${coverage.length ? `<div class="card coverage-card">
      <div class="card-title">技能覆盖<span class="line"></span>
        <span class="cov-sum">${coveredCount}/${requiredCov.length} 已覆盖</span>
      </div>
      <p class="cov-intro">简历里出现的每一个技术大类都会单独成组、单独排课，不会因为模型“挑重点”被整类丢掉。</p>
      <div class="cov-grid">
        ${coverage.map((c) => {
          const course = courseByGroup.get(c.group);
          const chapters = (course?.stages || []).reduce((n, s) => n + (s.chapters || []).length, 0);
          const cls = c.covered ? (course ? 'ok' : 'pending') : c.required === false ? 'optional' : 'miss';
          return `<button class="cov-item ${cls}" data-cov="${esc(c.name)}" data-cov-group="${esc(c.group || '')}" title="${esc(c.evidence || '')}">
            <span class="cov-ic">${c.covered ? '✓' : c.required === false ? '·' : '!'}</span>
            <span class="cov-name">${esc(c.name)}</span>
            <span class="cov-sub">${course ? `${chapters} 章` : c.covered ? '待排课' : c.required === false ? '非必考' : '缺失'}</span>
          </button>`;
        }).join('')}
      </div>
      <p class="cov-hint">${coveredCount < requiredCov.length ? '有技能没落到分组里，点一下即可补排。' : '点任意技能可直接进入对应课程。'}</p>
    </div>` : ''}

    <div class="card identity-card">
      <div class="card-title">简历识别结果<span class="line"></span><span style="font-size:11.5px;font-weight:500;color:var(--muted)">从原文自动抽取，可核对</span></div>
      <div class="id-grid">
        <div><span>姓名</span><b>${esc(c.name || '未识别')}</b></div>
        <div><span>当前身份</span><b>${esc(c.title || '未识别')}</b></div>
        <div><span>工作年限</span><b>${c.years ? `${esc(c.years)} 年` : '未识别'}</b></div>
        <div><span>城市</span><b>${esc(c.city || '未识别')}</b></div>
        <div><span>教育背景</span><b>${esc(c.education || '未识别')}</b></div>
        <div><span>目标岗位</span><b>${esc(r.targetRole || p.targetRole?.title || '未指定')}</b></div>
      </div>
    </div>

    <div class="card summary-card" style="margin-top:14px">
      <div class="title-sm">人物画像</div>
      <p>${esc(p.summary || '暂无画像')}</p>
      <div class="chips" style="margin-top:14px">
        ${p.targetRole?.level ? `<span class="chip">目标级别：${esc(p.targetRole.level)}</span>` : ''}
        ${p.targetRole?.reason ? `<span class="chip brand">${esc(p.targetRole.reason)}</span>` : ''}
      </div>
    </div>

    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-title">技能盘点<span class="line"></span></div>
        <div class="chips">
          ${skills.map((s) => `<span class="chip" title="${esc(s.evidence)}"><b>${esc(s.name)}</b>${s.level ? ` · ${esc(s.level)}` : ''}</span>`).join('') || '<span class="chip">暂无</span>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">面试优势<span class="line"></span></div>
        <ul class="list-clean">${(p.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('') || '<li>暂无</li>'}</ul>
        ${(p.missing || []).length ? `<div class="title-sm" style="margin:16px 0 8px">岗位需要但简历没体现</div>
          <div class="chips">${p.missing.map((m) => `<span class="chip gap">${esc(m)}</span>`).join('')}</div>` : ''}
      </div>
    </div>

    ${(p.risks || []).length ? `<div class="card" style="margin-top:14px">
      <div class="card-title">面试官会质疑的点<span class="line"></span><span style="font-size:11.5px;font-weight:500;color:var(--muted)">提前准备说法</span></div>
      ${p.risks.map((risk, i) => `<div class="risk">
        <div class="n">${i + 1}</div>
        <div>
          <h5>${esc(risk.point)}</h5>
          ${risk.why ? `<p>${esc(risk.why)}</p>` : ''}
          ${risk.probe ? `<div class="probe">可能这样问：${esc(risk.probe)}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>` : ''}

    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-title">工作经历<span class="line"></span></div>
        <div class="timeline">
          ${(p.experiences || []).map((e) => `<div class="tl-item">
            <div class="tl-head"><b>${esc(e.company)}</b><span>${esc(e.role)}</span><span>${esc(e.period)}</span></div>
            <ul class="list-clean" style="margin-top:6px">${(e.highlights || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
          </div>`).join('') || '<div style="font-size:13px;color:var(--muted)">暂无</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-title">项目<span class="line"></span></div>
        ${(p.projects || []).map((pr) => `<div style="padding-bottom:14px">
          <div style="font-size:14px;font-weight:600">${esc(pr.name)}<span style="font-weight:400;color:var(--muted);font-size:12.5px">　${esc(pr.role)}</span></div>
          <div style="font-size:13px;color:var(--text-2);margin-top:4px;line-height:1.7">${esc(pr.desc)}</div>
          ${pr.impact ? `<div style="font-size:12.5px;color:var(--brand-deep);margin-top:6px">结果：${esc(pr.impact)}</div>` : ''}
          ${(pr.stack || []).length ? `<div class="chips" style="margin-top:8px">${pr.stack.map((s) => `<span class="chip" style="font-size:11.5px;padding:2px 7px">${esc(s)}</span>`).join('')}</div>` : ''}
        </div>`).join('') || '<div style="font-size:13px;color:var(--muted)">暂无</div>'}
      </div>
    </div>

    <div class="grid-2" style="margin-top:14px">
      <div class="card">
        <div class="card-title">JD 对比<span class="line"></span>
          ${r.jd ? `<a class="btn btn-quiet btn-sm" href="/api/analyses/${r.id}/jd.md" download>下载</a><button class="btn btn-quiet btn-sm" id="jd-rerun">重新对比</button>` : ''}
        </div>
        ${r.jd ? jdView(r.jd) : `
          <p class="jd-hint">把目标职位的 JD 原文贴进来，AI 逐条对照简历：哪些要求扛得住、哪些是缺口、面试前 7 天优先补什么。</p>
          <textarea id="jd-text" rows="6" placeholder="粘贴 JD 原文（岗位职责 + 任职要求）…"></textarea>
          <div style="text-align:right;margin-top:10px"><button class="btn btn-brand btn-sm" id="jd-run">开始对比</button></div>`}
      </div>
      <div class="card">
        <div class="card-title">简历评审<span class="line"></span>
          ${r.resumeReview ? `<a class="btn btn-quiet btn-sm" href="/api/analyses/${r.id}/resume-review.md" download>下载</a><button class="btn btn-quiet btn-sm" id="review-rerun">重新评审</button>` : ''}
        </div>
        ${r.resumeReview ? reviewView(r.resumeReview) : `
          <p class="jd-hint">面试官视角逐行审你的简历：哪些表述一定会被追问、写法有什么硬伤、怎么改写成接得住追问的句子。</p>
          <div style="text-align:right;margin-top:10px"><button class="btn btn-brand btn-sm" id="review-run">开始评审</button></div>`}
      </div>
    </div>
  `;
}

/* ---- JD 对比 / 简历评审渲染 ---- */

function jdView(jd) {
  return `
    <div class="jd-head">
      <div class="ring" style="--p:${jd.fitScore || 0};width:52px;height:52px"><span style="font-size:14px">${jd.fitScore || 0}</span></div>
      <p>${esc(jd.headline || '')}</p>
    </div>
    ${(jd.matches || []).length ? `<div class="jd-sec"><b>扛得住的（${jd.matches.length}）</b>
      ${jd.matches.map((m) => `<div class="jd-row ok"><span class="jd-tag">${esc(m.strength || '够用')}</span><div><div class="jd-jd">${esc(m.jd)}</div><div class="jd-ev">${esc(m.evidence)}</div></div></div>`).join('')}
    </div>` : ''}
    ${(jd.gaps || []).length ? `<div class="jd-sec"><b>缺口（${jd.gaps.length}）</b>
      ${jd.gaps.map((m) => `<div class="jd-row miss"><span class="jd-tag">${esc(m.severity || '中')}</span><div><div class="jd-jd">${esc(m.jd)}</div><div class="jd-ev">${esc(m.why)}</div></div></div>`).join('')}
    </div>` : ''}
    ${(jd.actions || []).length ? `<div class="jd-sec"><b>面试前优先做</b><ul class="list-clean">${jd.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
    ${(jd.talking || []).length ? `<div class="jd-sec"><b>把缺口说成故事</b><ul class="list-clean">${jd.talking.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
  `;
}

function reviewView(rv) {
  return `
    <p class="jd-headline">${esc(rv.headline || '')}</p>
    ${(rv.grill || []).length ? `<div class="jd-sec"><b>一定会被追问（${rv.grill.length}）</b>
      ${rv.grill.map((g) => `<div class="rv-row">
        <div class="rv-quote">“${esc(g.quote)}”</div>
        <div class="fq"><b>追问：</b>${esc(g.question)}</div>
        ${g.risk ? `<div class="fq gap-text"><b>接不住的后果：</b>${esc(g.risk)}</div>` : ''}
        ${g.prepare ? `<div class="fq ok-text"><b>准备：</b>${esc(g.prepare)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
    ${(rv.rewrite || []).length ? `<div class="jd-sec"><b>改写建议（${rv.rewrite.length}）</b>
      ${rv.rewrite.map((r) => `<div class="rv-row">
        <div class="rv-quote">“${esc(r.before)}”</div>
        <div class="rv-after">改为：${esc(r.after)}</div>
        ${r.why ? `<div class="fq">${esc(r.why)}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}
    ${(rv.cut || []).length ? `<div class="jd-sec"><b>建议删掉或弱化</b><ul class="list-clean">${rv.cut.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  `;
}

function bindProfile() {
  const runJd = (id) => {
    const jdText = document.getElementById('jd-text')?.value || '';
    if (jdText.trim().length < 30) return toast('JD 内容太短，请粘贴完整职位描述', 'err');
    runJob(
      api(`/api/analyses/${state.record.id}/jd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdText }),
      }),
      'JD 对比',
      ['读取 JD 要求', '逐条对照简历', '输出补齐动作'],
    )
      .then(async () => {
        await refreshRecord();
        renderPanel();
      })
      .catch(() => {});
  };
  const jdRun = document.getElementById('jd-run');
  if (jdRun) jdRun.addEventListener('click', runJd);
  const jdRerun = document.getElementById('jd-rerun');
  if (jdRerun) jdRerun.addEventListener('click', () => {
    const prev = state.record.jd?.jdText || '';
    state.record.jd = null;
    renderPanel();
    setTimeout(() => {
      const box = document.getElementById('jd-text');
      if (box) box.value = prev;
    }, 0);
  });

  const reviewRun = document.getElementById('review-run');
  if (reviewRun) {
    reviewRun.addEventListener('click', () => {
      runJob(
        api(`/api/analyses/${state.record.id}/resume-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
        '简历评审',
        ['逐行模拟追问', '生成改写建议'],
      )
        .then(async () => {
          await refreshRecord();
          renderPanel();
        })
        .catch(() => {});
    });
  }
  const reviewRerun = document.getElementById('review-rerun');
  if (reviewRerun) reviewRerun.addEventListener('click', () => {
    state.record.resumeReview = null;
    renderPanel();
    setTimeout(() => document.getElementById('review-run')?.click(), 0);
  });

  on('[data-cov]', 'click', (e) => {
    const btn = e.currentTarget;
    const group = btn.dataset.covGroup;
    const name = btn.dataset.cov;
    const course = (state.record.courses || []).find((c) => c.group === group);
    if (course) {
      state.courseId = course.id;
      state.chapterId = null;
      state.tab = 'courses';
      renderWorkspace();
      return;
    }
    if (group) {
      generateCourses([group]);
      return;
    }
    toast(`「${name}」还没有对应分组，重新分析一次即可强制覆盖`, 'err');
  });
}

/* ---------- 系统课程 ---------- */

function allChapters(course) {
  return (course?.stages || []).flatMap((stage) => (stage.chapters || []).map((chapter) => ({ stage, chapter })));
}

function courseStats(course) {
  const list = allChapters(course).map((x) => x.chapter);
  const prog = state.record?.progress || {};
  return {
    total: list.length,
    done: list.filter((c) => c.lesson).length,
    learned: list.filter((c) => prog[c.id] === 'learned').length,
    mastered: list.filter((c) => prog[c.id] === 'mastered').length,
  };
}

function currentCourse() {
  const courses = (state.record?.courses || []).filter((c) => (c.stages || []).length);
  return courses.find((c) => c.id === state.courseId) || courses[0] || null;
}

function panelCourses() {
  const r = state.record;
  const groups = r.groups || [];
  if (!groups.length) return emptyState('还没有课程', '先完成一次简历分析，系统会按技术大类排课', '重新分析', 'home');

  const courses = (r.courses || []).filter((c) => (c.stages || []).length);

  if (!courses.length) {
    return `<div class="card course-empty">
      <div class="card-title">系统课程<span class="line"></span></div>
      <p class="course-empty-desc">按简历里的每个技术大类，各排一门「从入门到精通」的课：4 个阶段、每阶段 5-6 章（全书 20-24 章），每章都能生成完整讲义。不再是一堆零散考点。</p>
      <div class="course-empty-actions">
        <button class="btn btn-brand" data-action="courses-all">一键排课（全部 ${groups.length} 类）</button>
      </div>
      <div class="group-chips">
        ${groups.map((g) => `<button class="group-chip" data-gen-course="${esc(g.name)}">
          <b>${esc(g.name)}</b><span>${(g.topics || []).length} 个考点</span><em>排课</em>
        </button>`).join('')}
      </div>
    </div>`;
  }

  const course = currentCourse();
  if (state.chapterId) {
    const hit = allChapters(course).find((x) => x.chapter.id === state.chapterId);
    if (hit) return lessonView(course, hit.stage, hit.chapter);
    state.chapterId = null;
  }
  return courseOverview(course, courses);
}

function courseOverview(course, courses) {
  const stats = courseStats(course);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const pending = (state.record.groups || []).filter((g) => !courses.some((c) => c.group === g.name));

  let no = 0;
  return `<div class="course-layout">
    <aside class="course-nav">
      <div class="cn-title">课程 <span>${courses.length}</span></div>
      ${courses
        .map((c) => {
          const s = courseStats(c);
          const p = s.total ? Math.round((s.done / s.total) * 100) : 0;
          return `<button class="course-tab ${c.id === course.id ? 'on' : ''}" data-course="${esc(c.id)}">
            <div class="ct-row"><span class="ct-name">${esc(c.group)}</span><span class="ct-pct">${p}%</span></div>
            <div class="ct-meta">${s.done}/${s.total} 讲 · 约 ${c.totalHours || '—'} 小时</div>
            <i class="ct-bar"><b style="width:${p}%"></b></i>
          </button>`;
        })
        .join('')}
      ${pending.length ? `<div class="cn-sub">待排课 · ${pending.length}</div>
        ${pending.map((g) => `<button class="course-tab pending" data-gen-course="${esc(g.name)}">
          <span class="ct-name">${esc(g.name)}</span>
          <span class="ct-meta">${(g.topics || []).length} 个考点 · 点击排课</span>
        </button>`).join('')}
        <button class="btn btn-ghost btn-sm cn-all" data-action="courses-all">全部排课（${pending.length} 类）</button>` : ''}
    </aside>

    <div class="course-main">
      <div class="course-hero">
        <div class="eyebrow">系统课程 · 从入门到精通</div>
        <h2>${esc(course.title || course.group)}</h2>
        ${course.subtitle ? `<p class="course-sub">${esc(course.subtitle)}</p>` : ''}
        <div class="course-chips">
          ${course.totalHours ? `<span class="chip">约 ${course.totalHours} 小时</span>` : ''}
          <span class="chip">面试权重 ${stars(course.interviewWeight || 3)}</span>
          ${course.topicCoverage ? `<span class="chip ${course.topicCoverage.covered >= course.topicCoverage.total ? 'brand' : 'gap'}" title="${esc((course.topicCoverage.missing || []).join('、'))}">考点覆盖 ${course.topicCoverage.covered}/${course.topicCoverage.total}</span>` : ''}
          <span class="chip brand">${stats.done}/${stats.total} 章有讲义</span>
          ${stats.mastered + stats.learned ? `<span class="chip" title="点章节行末的状态按钮切换">已掌握 ${stats.mastered} · 已学 ${stats.learned}</span>` : ''}
          ${course.fallback ? '<span class="chip gap">按考点自动兜底排课</span>' : ''}
        </div>
        ${course.outcome ? `<div class="course-outcome">学完能达到：${esc(course.outcome)}</div>` : ''}
        <div class="course-progress"><i style="width:${pct}%"></i></div>
        <div class="course-tools">
          <div class="depth-switch compact" id="lesson-depth">
            ${Object.entries(DEPTH_LABEL).map(([k, v]) => `<button type="button" data-depth="${k}" class="${state.lessonDepth === k ? 'on' : ''}">${v}</button>`).join('')}
          </div>
          <button class="btn btn-brand btn-sm" id="gen-remaining" ${stats.done >= stats.total ? 'disabled' : ''}>补齐讲义（每次最多 4 章）</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="regen-course" title="按当前标准重排这门课的大纲（同名章节的讲义会保留）">重排大纲</button>
          <button class="btn btn-ghost btn-sm" id="dl-course">下载整门课</button>
          <button class="btn btn-ghost btn-sm" id="print-course">打印</button>
        </div>
        <div class="course-tip">讲义按「${DEPTH_LABEL[state.lessonDepth]}」档生成；换档后点单章「重写」即可升级深度。</div>
      </div>

      ${(course.stages || [])
        .map((stage, si) => {
          const chapters = stage.chapters || [];
          const rows = chapters
            .map((ch) => {
              no += 1;
              return chapterRow(course, stage, ch, no);
            })
            .join('');
          const undone = chapters.filter((c) => !c.lesson).length;
          return `<section class="course-stage">
            <div class="stage-head">
              <span class="stage-idx">${String(si + 1).padStart(2, '0')}</span>
              <div class="stage-title">
                <h3>${esc(stage.name)}</h3>
                ${stage.goal ? `<p>${esc(stage.goal)}</p>` : ''}
              </div>
              ${undone ? `<button class="btn btn-quiet btn-sm" data-gen-stage="${esc(stage.key)}">补齐本阶段 ${undone} 章</button>` : '<span class="stage-done">✓ 本阶段已完成</span>'}
            </div>
            <div class="chapter-list">${rows}</div>
          </section>`;
        })
        .join('')}
    </div>
  </div>`;
}

function chapterRow(course, stage, ch, no) {
  const done = Boolean(ch.lesson);
  const st = (state.record?.progress || {})[ch.id] || 'none';
  const stMeta = { none: ['未学', ''], learned: ['已学', 'brand'], mastered: ['已掌握', 'brand'] }[st];
  return `<div class="chapter-row ${done ? 'done' : ''} ${st !== 'none' ? 'learned' : ''}">
    <div class="ch-no">${String(no).padStart(2, '0')}</div>
    <div class="ch-main">
      <div class="ch-title">${esc(ch.title)}
        <span class="badge lv-${esc(ch.level || '进阶')}">${esc(ch.level || '进阶')}</span>
        ${ch.hours ? `<span class="badge">${esc(ch.hours)}h</span>` : ''}
        ${done ? `<span class="badge brand">讲义 · ${DEPTH_LABEL[ch.lesson.depth] || '中等'}</span>` : ''}
        ${ch.lessonError ? '<span class="badge gap">生成失败</span>' : ''}
      </div>
      ${ch.goal ? `<div class="ch-goal">${esc(ch.goal)}</div>` : ''}
      ${(ch.keyQuestions || []).length || (ch.checkpoints || []).length ? `<details class="ch-more">
        <summary>面试会怎么问 · 通关标准</summary>
        <div class="ch-more-body">
          ${(ch.keyQuestions || []).length ? `<div><b>可能被问</b>${ch.keyQuestions.map((q) => `<div class="fq">· ${esc(q)}</div>`).join('')}</div>` : ''}
          ${(ch.checkpoints || []).length ? `<div style="margin-top:6px"><b>通关标准</b>${ch.checkpoints.map((c) => `<div class="fq">☐ ${esc(c)}</div>`).join('')}</div>` : ''}
        </div>
      </details>` : ''}
    </div>
    <div class="ch-actions">
      <button class="btn btn-quiet btn-sm ch-prog" data-progress="${esc(ch.id)}" title="点击切换：未学 → 已学 → 已掌握"><b>${stMeta[0]}</b></button>
      ${done
        ? `<button class="btn btn-quiet btn-sm" data-open-chapter="${esc(ch.id)}">阅读讲义</button>
           <button class="btn btn-quiet btn-sm" data-gen-lesson="${esc(ch.id)}">重写</button>`
        : `<button class="btn btn-brand btn-sm" data-gen-lesson="${esc(ch.id)}">生成讲义</button>`}
    </div>
  </div>`;
}

function lessonView(course, stage, chapter) {
  const current = chapter.lesson;
  const hist = state.lessonVersion && current?.history?.[state.lessonVersion - 1];
  const l = hist?.data || current;
  const stats = courseStats(course);

  return `<div class="lesson-page">
    <div class="lesson-top">
      <button class="btn btn-quiet btn-sm" id="back-course">← 返回课程目录</button>
      <div class="lesson-crumb">${esc(course.title || course.group)}<span>/</span>${esc(stage.name)}<span>/</span>${esc(chapter.title)}</div>
      <span class="spacer"></span>
      <div class="depth-switch compact" id="lesson-depth">
        ${Object.entries(DEPTH_LABEL).map(([k, v]) => `<button type="button" data-depth="${k}" class="${state.lessonDepth === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>
      <button class="btn btn-brand btn-sm" id="gen-lesson-one">${current ? `按「${DEPTH_LABEL[state.lessonDepth]}」重写` : '生成本章讲义'}</button>
      ${current?.history?.length ? `<button class="btn btn-quiet btn-sm" id="lesson-history">历史版本 ${current.history.length}</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="dl-lesson">下载本章</button>
      <button class="btn btn-ghost btn-sm" id="print-lesson">打印</button>
    </div>

    ${hist ? `<div class="version-banner">
      <span>正在查看历史版本 v${current.history.length - state.lessonVersion + 1}（${DEPTH_LABEL[l.depth] || l.depth}，${esc(fmtDate(l.createdAt))}）</span>
      <button class="btn btn-quiet btn-sm" id="exit-lesson-version">返回当前版本</button>
    </div>` : ''}

    ${state.lessonHistOpen && current?.history?.length ? `<div class="history-list" style="margin-bottom:14px">
      ${current.history.map((h, i) => `<div class="history-row ${state.lessonVersion === i + 1 ? 'on' : ''}">
        <span class="hv">v${current.history.length - i}</span>
        <span class="hd">${DEPTH_LABEL[h.depth] || h.depth || '—'} · ${esc(fmtDate(h.createdAt))}</span>
        <button class="btn btn-quiet btn-sm" data-lesson-version="${i + 1}">查看</button>
      </div>`).join('')}
    </div>` : ''}

    <article class="lesson">
      <header class="lesson-head">
        <div class="eyebrow">${esc(stage.name)} · 第 ${stats.total ? allChapters(course).findIndex((x) => x.chapter.id === chapter.id) + 1 : 1} / ${stats.total} 章</div>
        <h1>${esc(chapter.title)}</h1>
        ${chapter.goal ? `<p class="lesson-goal">${esc(chapter.goal)}</p>` : ''}
        ${chapter.why ? `<p class="lesson-why">${esc(chapter.why)}</p>` : ''}
      </header>

      ${!l ? `<div class="lesson-missing">
        <p>这一章还没有生成讲义。</p>
        <button class="btn btn-brand" id="gen-lesson-empty">生成本章讲义</button>
      </div>` : lessonBody(l, chapter)}
    </article>
  </div>`;
}

function lessonBody(l, chapter) {
  const sections = l.sections || [];
  return `
    ${(l.objectives || []).length ? `<section class="lesson-block">
      <h3>学习目标</h3>
      <ul class="lesson-objectives">${l.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
    </section>` : ''}

    ${(l.roadmap || []).length ? `<section class="lesson-block">
      <h3>本节的位置</h3>
      ${l.roadmap.map((r) => `<div class="roadmap-row">
        ${r.section ? `<b>${esc(r.section)}</b>` : ''}
        <ul>${(r.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`).join('')}
    </section>` : ''}

    ${sections.map((s, i) => `<section class="lesson-block lesson-sec">
      <h3><span class="sec-no">${String(i + 1).padStart(2, '0')}</span>${esc(s.heading)}</h3>
      ${s.body ? `<div class="prose">${md(s.body)}</div>` : ''}
      ${s.code ? `<pre class="lesson-code"><code>${esc(s.code)}</code></pre>` : ''}
      ${s.interviewAngle ? `<div class="interview-angle"><b>面试视角</b>${esc(s.interviewAngle)}</div>` : ''}
    </section>`).join('')}

    ${l.walkthrough?.case ? `<section class="lesson-block walkthrough">
      <h3>实战推演</h3>
      <p class="wt-case">${esc(l.walkthrough.case)}</p>
      <ol class="wt-steps">${(l.walkthrough.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </section>` : ''}

    ${(l.qa || []).length ? `<section class="lesson-block">
      <h3>追问与应答</h3>
      ${l.qa.map((q) => `<div class="qa">
        <button class="qa-q" type="button"><span class="q-mark">Q</span><span>${esc(q.q)}</span><span class="arrow">▾</span></button>
        <div class="qa-a">${q.a ? `<div>${esc(q.a)}</div>` : ''}${q.trap ? `<div class="trap">⚠️ ${esc(q.trap)}</div>` : ''}</div>
      </div>`).join('')}
    </section>` : ''}

    ${(l.pitfalls || []).length ? `<section class="lesson-block">
      <h3>容易答错</h3>
      <div class="pitfalls">${l.pitfalls.map((p) => `<div class="pitfall">${esc(p)}</div>`).join('')}</div>
    </section>` : ''}

    ${(l.exercises || []).length ? `<section class="lesson-block">
      <h3>动手练习</h3>
      <div class="exercises">${l.exercises.map((e, i) => `<div class="exercise">
        <div class="ex-title">${i + 1}. ${esc(e.task)}</div>
        ${e.hint ? `<div class="ex-hint">提示：${esc(e.hint)}</div>` : ''}
        ${e.standard ? `<div class="ex-standard">参考做法：${esc(e.standard)}</div>` : ''}
      </div>`).join('')}</div>
    </section>` : ''}

    ${(l.selfCheck || []).length ? `<section class="lesson-block">
      <h3>自测</h3>
      <div class="self-check">${l.selfCheck.map((s, i) => `<details class="self-item">
        <summary>${i + 1}. ${esc(s.q)}</summary>
        <div>${esc(s.answer)}</div>
      </details>`).join('')}</div>
    </section>` : ''}

    ${(l.references || []).length ? `<section class="lesson-block">
      <h3>延伸阅读</h3>
      <ul class="refs">${l.references.map((r) => `<li><b>${esc(r.title)}</b>${r.note ? `　${esc(r.note)}` : ''}</li>`).join('')}</ul>
    </section>` : ''}

    ${(l.sources || []).length ? `<section class="lesson-block sources-block">
      <h3>参考来源<span class="src-note">全网检索，点击可核对原文</span></h3>
      <ol class="sources">${l.sources.map((s) => `<li>
        ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : `<span>${esc(s.title || '来源')}</span>`}
        ${s.url ? `<span class="src-host">${esc(hostOf(s.url))}</span>` : ''}
      </li>`).join('')}</ol>
    </section>` : ''}
  `;
}


/* ---------- 知识点图谱 ---------- */

function bindCourses() {
  on('[data-course]', 'click', (e) => {
    state.courseId = e.currentTarget.dataset.course;
    state.chapterId = null;
    state.lessonVersion = 0;
    state.lessonHistOpen = false;
    renderPanel();
  });

  on('[data-gen-course]', 'click', (e) => {
    e.stopPropagation();
    generateCourses([e.currentTarget.dataset.genCourse]);
  });

  on('[data-open-chapter]', 'click', (e) => {
    state.chapterId = e.currentTarget.dataset.openChapter;
    state.lessonVersion = 0;
    state.lessonHistOpen = false;
    renderPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  on('[data-gen-lesson]', 'click', (e) => {
    e.stopPropagation();
    generateLessons([e.currentTarget.dataset.genLesson]);
  });

  on('[data-gen-stage]', 'click', (e) => {
    const course = currentCourse();
    const stage = (course?.stages || []).find((s) => s.key === e.currentTarget.dataset.genStage);
    const ids = (stage?.chapters || []).filter((c) => !c.lesson).map((c) => c.id);
    if (ids.length) generateLessons(ids);
  });

  const remaining = document.getElementById('gen-remaining');
  if (remaining) remaining.addEventListener('click', () => generateLessons());

  // 章节学习进度：未学 → 已学 → 已掌握 → 未学
  on('[data-progress]', 'click', async (e) => {
    const chapterId = e.currentTarget.dataset.progress;
    const prog = state.record?.progress || {};
    const cur = prog[chapterId] || 'none';
    const next = cur === 'none' ? 'learned' : cur === 'learned' ? 'mastered' : 'none';
    try {
      const { progress } = await api(`/api/analyses/${state.record.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId, status: next }),
      });
      state.record.progress = progress;
      renderPanel();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  const regen = document.getElementById('regen-course');
  if (regen) {
    regen.addEventListener('click', () => {
      const course = currentCourse();
      if (!course) return;
      const ok = window.confirm(
        `按当前标准重排「${course.group}」的大纲（4 阶段 × 5-6 章）？\n\n同名章节的讲义会保留，标题变了的章节需要重新生成讲义。`,
      );
      if (ok) generateCourses([course.group]);
    });
  }

  // 课程目录上的深度切换：只影响后续生成，不自动重写
  document.querySelectorAll('#lesson-depth [data-depth]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.lessonDepth = btn.dataset.depth;
      localStorage.setItem('if-depth', state.lessonDepth);
      document.querySelectorAll('#lesson-depth [data-depth]').forEach((b) => b.classList.toggle('on', b.dataset.depth === state.lessonDepth));
      const tip = document.querySelector('.course-tip');
      if (tip) tip.textContent = `讲义按「${DEPTH_LABEL[state.lessonDepth]}」档生成；换档后点单章「重写」即可升级深度。`;
    });
  });

  const dlCourse = document.getElementById('dl-course');
  if (dlCourse) {
    dlCourse.addEventListener('click', () => {
      const c = currentCourse();
      if (c) window.open(`/api/analyses/${state.record.id}/courses/${c.id}.md`, '_blank');
    });
  }
  const printCourse = document.getElementById('print-course');
  if (printCourse) printCourse.addEventListener('click', () => window.print());

  /* ---- 讲义页 ---- */
  const back = document.getElementById('back-course');
  if (back) {
    back.addEventListener('click', () => {
      state.chapterId = null;
      state.lessonVersion = 0;
      state.lessonHistOpen = false;
      renderPanel();
    });
  }

  const genOne = document.getElementById('gen-lesson-one') || document.getElementById('gen-lesson-empty');
  if (genOne) genOne.addEventListener('click', () => generateLessons([state.chapterId]));

  const dlLesson = document.getElementById('dl-lesson');
  if (dlLesson) {
    dlLesson.addEventListener('click', () => {
      const c = currentCourse();
      if (c && state.chapterId) window.open(`/api/analyses/${state.record.id}/courses/${c.id}/chapters/${state.chapterId}.md`, '_blank');
    });
  }
  const printLesson = document.getElementById('print-lesson');
  if (printLesson) printLesson.addEventListener('click', () => window.print());

  const historyBtn = document.getElementById('lesson-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      state.lessonHistOpen = !state.lessonHistOpen;
      renderPanel();
    });
  }

  on('[data-lesson-version]', 'click', (e) => {
    state.lessonVersion = Number(e.currentTarget.dataset.lessonVersion);
    state.lessonHistOpen = true;
    renderPanel();
  });

  const exitVersion = document.getElementById('exit-lesson-version');
  if (exitVersion) {
    exitVersion.addEventListener('click', () => {
      state.lessonVersion = 0;
      renderPanel();
    });
  }

  on('.qa-q', 'click', (e) => e.currentTarget.closest('.qa').classList.toggle('open'));
}

function sortedTopics() {
  return (state.record?.topics || [])
    .slice()
    .sort((a, b) => b.priority - a.priority || Number(b.gap) - Number(a.gap) || String(a.title).localeCompare(String(b.title)));
}

function graphSvg() {
  const groups = state.record?.groups || [];
  const mats = new Set((state.record.materials || []).filter((m) => !m.error).map((m) => m.topicId));

  let y = 54;
  const nodes = [];
  const groupNodes = [];
  groups.forEach((g) => {
    const startY = y;
    g.topics.forEach((t) => {
      nodes.push({ t, y });
      y += 30;
    });
    groupNodes.push({ name: g.name, y: (startY + y - 30) / 2, count: g.topics.length });
    y += 18;
  });
  const H = Math.max(300, y + 20);
  const centerY = H / 2;

  const edge = (x1, y1, x2, y2, cls) =>
    `<path class="gedge ${cls}" d="M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}" />`;

  const edges = [];
  const groupSvgs = [];
  const topicSvgs = [];

  groupNodes.forEach((g, gi) => {
    edges.push(edge(120, centerY, 372, g.y, 'g1'));
    groupSvgs.push(`<g class="gnode group" data-group="${gi}">
      <circle cx="372" cy="${g.y}" r="7" />
      <text x="388" y="${g.y + 4}" class="g-label">${esc(g.name)}</text>
      <text x="388" y="${g.y + 18}" class="g-count">${g.count} 个考点</text>
    </g>`);
  });

  nodes.forEach(({ t, y: ny }) => {
    const gi = groupNodes.findIndex((g) => g.name === t.group);
    const gy = gi >= 0 ? groupNodes[gi].y : centerY;
    edges.push(edge(372, gy, 640, ny, 'g2'));
    const done = mats.has(t.id);
    const cls = ['topic-node', t.gap ? 'gap' : '', done ? 'done' : '', t.priority >= 5 ? 'hot' : ''].filter(Boolean).join(' ');
    const fill = done ? '#2bb6a0' : t.priority >= 5 ? '#0f766e' : t.priority >= 4 ? '#5eead4' : '#c4cfcd';
    topicSvgs.push(`<g class="${cls}" data-node="${esc(t.id)}">
      <title>${esc(t.title)}｜${esc(t.level)}｜重要度 ${t.priority}${t.gap ? '｜简历缺口' : ''}${done ? '｜已有资料' : ''}</title>
      <circle cx="640" cy="${ny}" r="${t.priority >= 5 ? 6 : 5}" fill="${fill}" />
      <text x="654" y="${ny + 4}" class="n-label">${esc(t.title.length > 22 ? `${t.title.slice(0, 22)}…` : t.title)}</text>
      ${done ? `<text x="896" y="${ny + 4}" class="n-done" text-anchor="end">资料✓</text>` : ''}
    </g>`);
  });

  return `<svg class="kg" viewBox="0 0 900 ${H}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="知识点图谱">
    <defs><linearGradient id="hubGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5eead4" /><stop offset="100%" stop-color="#2bb6a0" />
    </linearGradient></defs>
    ${edges.join('')}
    <g class="hub">
      <circle cx="120" cy="${centerY}" r="52" fill="url(#hubGrad)" opacity="0.16" />
      <circle cx="120" cy="${centerY}" r="34" fill="url(#hubGrad)" />
      <text x="120" y="${centerY + 4}" text-anchor="middle" class="hub-label">${esc((state.record.targetRole || '目标岗位').slice(0, 6))}</text>
    </g>
    ${groupSvgs.join('')}
    ${topicSvgs.join('')}
  </svg>`;
}

function panelTopics() {
  const r = state.record;
  const groups = r.groups || [];
  if (!groups.length) return emptyState('还没有知识点', '重新分析一次试试', '重新分析', 'home');

  const materials = new Map((r.materials || []).filter((m) => !m.error).map((m) => [m.topicId, m]));
  const list = sortedTopics();
  const undone = list.slice(0, 5).filter((t) => !materials.has(t.id));

  return `
    <div class="card graph-card">
      <div class="card-title">简历知识图谱<span class="line"></span>
        <span class="graph-legend">
          <span><i class="dot hot"></i>必问</span>
          <span><i class="dot"></i>一般</span>
          <span><i class="dot done"></i>已有资料</span>
          <span><i class="dot gap"></i>简历缺口</span>
        </span>
      </div>
      <p class="graph-hint">从简历里的每一句往外扩散，长成面试会追问的考点树。点节点跳到对应模块。</p>
      <div class="graph-wrap">${graphSvg()}</div>
    </div>

    <div class="card module-card">
      <div class="card-title">学习模块（按优先级）<span class="line"></span>
        <span class="module-sub">优先级 = 面试出现概率 × 简历相关度</span>
        ${undone.length ? `<button class="btn btn-brand btn-sm" id="gen-top">先生成前 ${undone.length} 个</button>` : ''}
      </div>
      <div class="module-list">
        ${list.map((t, i) => moduleRow(t, i + 1, materials.get(t.id))).join('')}
      </div>
    </div>

    <div class="action-bar">
      <span class="info">已选 <b id="sel-count">${state.selected.size}</b> / ${(r.topics || []).length} 个知识点</span>
      <button class="btn btn-quiet btn-sm" id="toggle-all">全选 / 反选</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="quiz-btn">生成测验</button>
      <button class="btn btn-brand btn-sm" id="material-btn">生成所选资料</button>
    </div>
  `;
}

function moduleRow(t, rank, mat) {
  const on = state.selected.has(t.id);
  return `<div class="module-row ${mat ? 'has-mat' : ''}" id="m-${esc(t.id)}">
    <span class="rank ${rank <= 3 ? 'top' : ''}">${rank}</span>
    <button class="checkbox ${on ? 'on' : ''}" data-check="${esc(t.id)}" aria-label="选择">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
    <div class="module-main">
      <div class="module-title">${esc(t.title)}</div>
      <div class="topic-badges">
        <span class="badge lv-${esc(t.level)}">${esc(t.level)}</span>
        <span class="badge stars" title="重要度">${stars(t.priority)}</span>
        ${t.gap ? '<span class="badge gap">简历缺口</span>' : ''}
        ${t.relation ? `<span class="badge">${esc(t.relation)}</span>` : ''}
        ${state.flash?.has(t.id) ? '<span class="badge" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c">✦ 新拓展</span>' : ''}
        <span class="badge">${esc(t.group || '')}</span>
      </div>
      ${t.reason ? `<p class="topic-reason">${esc(t.reason)}</p>` : ''}
      ${t.interviewerFocus || (t.followups || []).length ? `<details style="margin-top:6px">
        <summary>面试官关注点与追问</summary>
        <div class="topic-more">
          ${t.interviewerFocus ? `<div><b>他在意什么：</b>${esc(t.interviewerFocus)}</div>` : ''}
          ${(t.followups || []).length ? `<div style="margin-top:6px"><b>可能追问：</b></div>${t.followups.map((f) => `<div class="fq">· ${esc(f)}</div>`).join('')}</div>` : ''}
        </div>
      </details>` : ''}
    </div>
    <div class="module-actions">
      ${mat
        ? `<span class="mat-state done">资料✓ ${DEPTH_LABEL[mat.depth] || ''}</span>
           <button class="btn btn-quiet btn-sm" data-open-mat="${esc(t.id)}">查看</button>`
        : `<span class="mat-state">未生成</span>
           <button class="btn btn-brand btn-sm" data-gen-one="${esc(t.id)}">生成资料</button>`}
      <button class="btn btn-quiet btn-sm" data-expand="${esc(t.id)}">✦ 拓展</button>
    </div>
  </div>`;
}

function bindTopics() {
  on('[data-check]', 'click', (e) => {
    const id = e.currentTarget.dataset.check;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    e.currentTarget.classList.toggle('on', state.selected.has(id));
    const cnt = document.getElementById('sel-count');
    if (cnt) cnt.textContent = state.selected.size;
  });

  on('[data-expand]', 'click', (e) => {
    e.stopPropagation();
    expandTopic(e.currentTarget.dataset.expand);
  });

  on('[data-gen-one]', 'click', (e) => {
    e.stopPropagation();
    generateMaterials(false, [e.currentTarget.dataset.genOne]);
  });

  on('[data-open-mat]', 'click', (e) => {
    e.stopPropagation();
    state.materialId = e.currentTarget.dataset.openMat;
    state.tab = 'materials';
    renderWorkspace();
  });

  on('.topic-node', 'click', (e) => {
    const id = e.currentTarget.dataset.node;
    const row = document.getElementById(`m-${id}`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  });

  const toggle = document.getElementById('toggle-all');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const all = state.record.topics || [];
      const allOn = state.selected.size === all.length;
      state.selected = allOn ? new Set() : new Set(all.map((t) => t.id));
      renderPanel();
    });
  }

  const genTop = document.getElementById('gen-top');
  if (genTop) genTop.addEventListener('click', () => generateTop(5));

  const matBtn = document.getElementById('material-btn');
  if (matBtn) matBtn.addEventListener('click', () => generateMaterials());

  const quizBtn = document.getElementById('quiz-btn');
  if (quizBtn) quizBtn.addEventListener('click', () => generateQuiz());
}

/* ---------- 资料 ---------- */

function panelMaterials() {
  const r = state.record;
  const materials = (r.materials || []).filter((m) => !m.error);
  const missing = (r.topics || []).length - materials.length;

  if (!materials.length) {
    const top = sortedTopics().slice(0, 5);
    return emptyState(
      '还没有生成复习资料',
      `按优先级生成面试官视角的复习笔记：一句话本质、原理、答题框架、追问与坑。当前深度「${DEPTH_LABEL[state.depth]}」。`,
      top.length ? `生成优先级最高的 ${top.length} 个` : '生成全部资料',
      'materials-top',
    );
  }

  const current = materials.find((m) => m.topicId === state.materialId) || materials[0];
  const hist = state.viewVersion && current.history?.[state.viewVersion - 1];
  const view = hist ? hist.data : current;
  const list = sortedTopics();

  return `
    <div class="mat-toolbar">
      <div class="depth-switch compact" id="mat-depth">
        ${Object.entries(DEPTH_LABEL).map(([k, v]) => `<button type="button" data-depth="${k}" class="${state.depth === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>
      <button class="btn btn-brand btn-sm" id="regen-current">按「${DEPTH_LABEL[state.depth]}」重写这篇</button>
      <span class="spacer"></span>
      <button class="btn btn-quiet btn-sm" id="expand-current">✦ 拓展关联考点</button>
      <button class="btn btn-ghost btn-sm" id="download-current">下载这篇</button>
      <button class="btn btn-ghost btn-sm" id="print-btn">打印 / 存 PDF</button>
      <button class="btn btn-ghost btn-sm" id="export-md">导出全部</button>
    </div>
    ${missing > 0 ? `<div class="mat-tip">还有 ${missing} 个模块没生成资料，左侧带虚线圆点的可以直接点开生成。</div>` : ''}
    <div class="material-layout">
      <nav class="material-nav">
        ${list
          .map((t) => {
            const done = materials.find((m) => m.topicId === t.id);
            if (!done) {
              return `<button class="nav-item pending" data-gen="${esc(t.id)}">
                <span class="dot"></span><span>${esc(t.title)}</span><span class="nav-cta">生成</span>
              </button>`;
            }
            return `<button class="nav-item ${done.topicId === current.topicId ? 'on' : ''} done" data-mat="${esc(t.id)}">
              <span class="dot"></span><span>${esc(t.title)}</span>
            </button>`;
          })
          .join('')}
      </nav>
      <div class="material-body">${materialBody(view, current)}</div>
    </div>
  `;
}

function materialBody(m, current) {
  if (!m) return '';
  const fw = m.answerFramework || [];
  const history = current?.history || [];
  const isOld = Boolean(state.viewVersion);
  return `
    ${isOld ? `<div class="version-banner">
      <span>正在查看历史版本 v${state.viewVersion}（${DEPTH_LABEL[m.depth] || m.depth || '—'}，${esc(fmtDate(m.createdAt))}）</span>
      <button class="btn btn-quiet btn-sm" id="exit-version">返回当前版本</button>
    </div>` : ''}
    <div class="mat-head">
      <div class="chips" style="margin-bottom:10px">
        <span class="badge lv-${esc(m.level || '进阶')}">${esc(m.level || '')}</span>
        <span class="badge brand">${DEPTH_LABEL[m.depth] || '中等'}</span>
        <span class="badge">${esc(m.group || '')}</span>
        ${m.gap ? '<span class="badge gap">简历缺口</span>' : ''}
        ${current?.version ? `<span class="badge">v${current.version}</span>` : ''}
      </div>
      <div class="mat-head-actions">
        <button class="btn btn-quiet btn-sm" id="download-this">下载 .md</button>
        ${history.length ? `<button class="btn btn-quiet btn-sm" id="history-btn">历史版本 ${history.length}</button>` : ''}
      </div>
      <h2>${esc(m.topicTitle)}</h2>
      ${m.oneLine ? `<div class="one-line">${esc(m.oneLine)}</div>` : ''}
      ${state.historyOpen && history.length ? `<div class="history-list">
        ${history.map((h, i) => `<div class="history-row ${state.viewVersion === i + 1 ? 'on' : ''}">
          <span class="hv">v${history.length - i}</span>
          <span class="hd">${DEPTH_LABEL[h.depth] || h.depth || '—'} · ${esc(fmtDate(h.createdAt))}</span>
          <button class="btn btn-quiet btn-sm" data-view-version="${i + 1}">查看</button>
          <button class="btn btn-quiet btn-sm" data-dl-version="${i + 1}">下载</button>
        </div>`).join('')}
      </div>` : ''}
    </div>

    ${(m.core || []).length ? `<div class="block">
      <h4>必须记住</h4>
      <ul class="core-list">${m.core.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>` : ''}

    ${m.principle ? `<div class="block">
      <h4>原理讲透</h4>
      <div class="prose">${md(m.principle)}</div>
    </div>` : ''}

    ${m.resumeHook ? `<div class="block">
      <h4>简历入口</h4>
      <div class="hook">${esc(m.resumeHook)}</div>
    </div>` : ''}

    ${fw.length ? `<div class="block">
      <h4>答题框架（照着说）</h4>
      <div class="steps">${fw.map((s) => `<div class="step">
        <span class="n"></span>
        <div><b>${esc(s.step || '')}</b><span>${esc(s.say || '')}</span></div>
      </div>`).join('')}</div>
    </div>` : ''}

    ${(m.followups || []).length ? `<div class="block">
      <h4>追问与应答</h4>
      ${m.followups.map((f) => `<div class="qa">
        <button class="qa-q" type="button"><span class="q-mark">Q</span><span>${esc(f.q)}</span><span class="arrow">▾</span></button>
        <div class="qa-a">
          ${f.a ? `<div>${esc(f.a)}</div>` : ''}
          ${f.trap ? `<div class="trap">⚠️ ${esc(f.trap)}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>` : ''}

    ${(m.pitfalls || []).length ? `<div class="block">
      <h4>容易答错</h4>
      <div class="pitfalls">${m.pitfalls.map((p) => `<div class="pitfall">${esc(p)}</div>`).join('')}</div>
    </div>` : ''}

    ${(m.bonus || []).length ? `<div class="block">
      <h4>加分项</h4>
      <div class="bonus">${m.bonus.map((b) => `<div class="bonus-item">${esc(b)}</div>`).join('')}</div>
    </div>` : ''}

    ${m.drill?.question ? `<div class="block">
      <h4>自测</h4>
      <div class="drill">
        <p class="q">${esc(m.drill.question)}</p>
        ${m.drill.hint ? `<div class="h">提示：${esc(m.drill.hint)}</div>` : ''}
      </div>
    </div>` : ''}

    ${(m.references || []).length ? `<div class="block">
      <h4>延伸阅读</h4>
      <ul class="refs">${m.references.map((rf) => `<li><b>${esc(rf.title)}</b>${rf.note ? `　${esc(rf.note)}` : ''}</li>`).join('')}</ul>
    </div>` : ''}

    ${(m.sources || []).length ? `<div class="block sources-block">
      <h4>参考来源<span class="src-note">全网检索，点击可核对原文</span></h4>
      <ol class="sources">${m.sources.map((s) => `<li>
        ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : `<span>${esc(s.title || '来源')}</span>`}
        ${s.url ? `<span class="src-host">${esc(hostOf(s.url))}</span>` : ''}
      </li>`).join('')}</ol>
    </div>` : ''}
  `;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function renderMaterialBody() {
  const body = document.querySelector('.material-body');
  const m = (state.record.materials || []).find((x) => x.topicId === state.materialId);
  if (!body || !m) return;
  const hist = state.viewVersion && m.history?.[state.viewVersion - 1];
  body.innerHTML = materialBody(hist ? hist.data : m, m);
  bindMaterials();
}

function bindMaterials() {
  on('[data-mat]', 'click', (e) => {
    state.materialId = e.currentTarget.dataset.mat;
    state.viewVersion = 0;
    state.historyOpen = false;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.mat === state.materialId));
    renderMaterialBody();
    document.querySelector('.material-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  on('[data-gen]', 'click', (e) => {
    const id = e.currentTarget.dataset.gen;
    state.materialId = id;
    generateMaterials(false, [id]);
  });

  on('.qa-q', 'click', (e) => e.currentTarget.closest('.qa').classList.toggle('open'));

  on('#mat-depth [data-depth]', 'click', (e) => {
    state.depth = e.currentTarget.dataset.depth;
    localStorage.setItem('if-depth', state.depth);
    document.querySelectorAll('#mat-depth [data-depth]').forEach((b) => b.classList.toggle('on', b.dataset.depth === state.depth));
    const regen = document.getElementById('regen-current');
    if (regen) regen.textContent = `按「${DEPTH_LABEL[state.depth]}」重写这篇`;
  });

  const regen = document.getElementById('regen-current');
  if (regen) {
    regen.addEventListener('click', () => {
      if (!state.materialId) return;
      generateMaterials(false, [state.materialId], { force: true });
    });
  }

  const dl = document.getElementById('download-this');
  if (dl) {
    dl.addEventListener('click', () => {
      const v = state.viewVersion || 0;
      window.open(`/api/analyses/${state.record.id}/materials/${state.materialId}.md${v ? `?version=${v}` : ''}`, '_blank');
    });
  }

  const histBtn = document.getElementById('history-btn');
  if (histBtn) {
    histBtn.addEventListener('click', () => {
      state.historyOpen = !state.historyOpen;
      renderMaterialBody();
    });
  }

  on('[data-view-version]', 'click', (e) => {
    state.viewVersion = Number(e.currentTarget.dataset.viewVersion);
    state.historyOpen = true;
    renderMaterialBody();
  });

  on('[data-dl-version]', 'click', (e) => {
    const v = Number(e.currentTarget.dataset.dlVersion);
    window.open(`/api/analyses/${state.record.id}/materials/${state.materialId}.md?version=${v}`, '_blank');
  });

  const exitVersion = document.getElementById('exit-version');
  if (exitVersion) {
    exitVersion.addEventListener('click', () => {
      state.viewVersion = 0;
      renderMaterialBody();
    });
  }

  const more = document.getElementById('more-mat');
  if (more) more.addEventListener('click', () => generateMaterials(true));

  const expandCur = document.getElementById('expand-current');
  if (expandCur) expandCur.addEventListener('click', () => expandTopic(state.materialId));

  const printBtn = document.getElementById('print-btn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  const exportMd = document.getElementById('export-md');
  if (exportMd) exportMd.addEventListener('click', () => window.open(`/api/analyses/${state.record.id}/export.md`, '_blank'));
}

/* ---------- 面试报告 ---------- */

function panelReport() {
  const r = state.record;
  const rep = r.report;

  if (!rep) {
    return `<div class="card report-empty">
      <div class="card-title">面试准备报告<span class="line"></span></div>
      <p class="report-intro">把简历、知识点、已生成的资料和全网检索结果合成一份判断：你现在能不能过、会卡在哪、先学什么、怎么排时间。</p>
      <div class="depth-switch" id="report-depth">
        ${Object.entries(DEPTH_LABEL).map(([k, v]) => `<button type="button" data-depth="${k}" class="${state.reportDepth === k ? 'on' : ''}"><b>${v}</b><span>${DEPTH_DESC[k]}</span></button>`).join('')}
      </div>
      <button class="btn btn-brand" id="gen-report">生成面试准备报告</button>
    </div>`;
  }

  return `
    <div class="report-head">
      <div class="rh-main">
        <div class="eyebrow">面试准备报告 · ${DEPTH_LABEL[rep.depth] || '中等'}档</div>
        <h2>${esc(rep.headline || '')}</h2>
        <div class="chips" style="margin-top:10px">
          <span class="chip ${rep.verdict?.fit === '匹配' ? 'brand' : 'gap'}">匹配度：${esc(rep.verdict?.fit || '—')}</span>
          <span class="chip">通过概率：${esc(rep.verdict?.passProbability || '—')}</span>
          <span class="chip">${esc(fmtDate(rep.createdAt))}</span>
          ${rep.version ? `<span class="chip">v${rep.version}</span>` : ''}
        </div>
      </div>
      <div class="rh-actions">
        <button class="btn btn-brand btn-sm" id="dl-report">下载报告 .md</button>
        <button class="btn btn-ghost btn-sm" id="regen-report">按「${DEPTH_LABEL[state.reportDepth]}」重新生成</button>
      </div>
    </div>

    <div class="report-layout">
      <div>
        <div class="card">
          <div class="card-title">总体判断<span class="line"></span></div>
          <div class="prose">${md(rep.verdict?.summary || '')}</div>
          ${(rep.strengths || []).length ? `<div class="title-sm" style="margin:16px 0 8px">能打的点</div>
            <ul class="list-clean">${rep.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        </div>

        ${(rep.gaps || []).length ? `<div class="card" style="margin-top:14px">
          <div class="card-title">致命短板<span class="line"></span></div>
          ${rep.gaps.map((g, i) => `<div class="gap-item">
            <span class="gn">${i + 1}</span>
            <div>
              <h5>${esc(g.point)}</h5>
              ${g.impact ? `<p class="impact">${esc(g.impact)}</p>` : ''}
              ${g.fix ? `<p class="fix">怎么补：${esc(g.fix)}</p>` : ''}
            </div>
          </div>`).join('')}
        </div>` : ''}

        ${(rep.path || []).length ? `<div class="card" style="margin-top:14px">
          <div class="card-title">学习路径<span class="line"></span></div>
          <div class="path">${rep.path.map((p) => `<div class="path-item">
            <div class="path-dot"></div>
            <div>
              <h5>${esc(p.phase)}</h5>
              ${p.goal ? `<p class="goal">${esc(p.goal)}</p>` : ''}
              <ul class="list-clean">${(p.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
            </div>
          </div>`).join('')}</div>
        </div>` : ''}

        ${(rep.interviewSim || []).length ? `<div class="card" style="margin-top:14px">
          <div class="card-title">各轮面试预演<span class="line"></span></div>
          <div class="rounds">${rep.interviewSim.map((rd) => `<div class="round">
            <h5>${esc(rd.round)}</h5>
            ${(rd.focus || []).length ? `<div class="chips">${rd.focus.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
            <ul class="list-clean" style="margin-top:8px">${(rd.typicalQuestions || []).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          </div>`).join('')}</div>
        </div>` : ''}
      </div>

      <aside>
        <div class="card">
          <div class="card-title">模块优先级<span class="line"></span></div>
          <div class="report-modules">
            ${(rep.modules || []).map((m) => {
              const done = (r.materials || []).some((x) => x.topicId === m.topicId && !x.error);
              return `<div class="rm ${done ? 'done' : ''}">
                <span class="rm-order">${m.order}</span>
                <div class="rm-main">
                  <div class="rm-title">${esc(m.title)}</div>
                  <div class="rm-meta">${stars(m.priority)}${m.hours ? ` · ${esc(m.hours)}` : ''}${m.depth ? ` · ${esc(m.depth)}` : ''}</div>
                  ${m.why ? `<p class="rm-why">${esc(m.why)}</p>` : ''}
                </div>
                ${done
                  ? `<button class="btn btn-quiet btn-sm" data-open-mat="${esc(m.topicId)}">查看</button>`
                  : m.topicId
                    ? `<button class="btn btn-brand btn-sm" data-gen-one="${esc(m.topicId)}">生成</button>`
                    : ''}
              </div>`;
            }).join('')}
          </div>
        </div>

        ${(rep.sources || []).length ? `<div class="card sources-block" style="margin-top:14px">
          <div class="card-title">参考来源<span class="line"></span></div>
          <ol class="sources">${rep.sources.map((s) => `<li>
            ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : `<span>${esc(s.title || '来源')}</span>`}
            ${s.url ? `<span class="src-host">${esc(hostOf(s.url))}</span>` : ''}
            ${s.note ? `<div class="src-note">${esc(s.note)}</div>` : ''}
          </li>`).join('')}</ol>
        </div>` : ''}
      </aside>
    </div>
  `;
}

function bindReport() {
  const gen = document.getElementById('gen-report');
  if (gen) gen.addEventListener('click', () => generateReport());

  const regen = document.getElementById('regen-report');
  if (regen) regen.addEventListener('click', () => generateReport());

  on('#report-depth [data-depth]', 'click', (e) => {
    state.reportDepth = e.currentTarget.dataset.depth;
    localStorage.setItem('if-depth', state.reportDepth);
    document.querySelectorAll('#report-depth [data-depth]').forEach((b) => b.classList.toggle('on', b.dataset.depth === state.reportDepth));
  });

  const dl = document.getElementById('dl-report');
  if (dl) dl.addEventListener('click', () => window.open(`/api/analyses/${state.record.id}/report.md`, '_blank'));

  on('[data-gen-one]', 'click', (e) => generateMaterials(false, [e.currentTarget.dataset.genOne]));
  on('[data-open-mat]', 'click', (e) => {
    state.materialId = e.currentTarget.dataset.openMat;
    state.tab = 'materials';
    renderWorkspace();
  });
}

/* ---------- 测验 ---------- */

function panelQuiz() {
  const r = state.record;
  const quiz = (r.quizzes || []).find((q) => q.id === state.quizId) || (r.quizzes || [])[(r.quizzes || []).length - 1];

  if (!quiz) {
    return emptyState(
      '还没有测验',
      '基于你选中的知识点出一套题，选择题 + 简答 + 场景设计，提交后 AI 逐题打分并指出漏掉的点。',
      '生成测验（8 道）',
      'quiz-new',
    );
  }

  const doneAttempt = (r.attempts || []).find((a) => a.quizId === quiz.id);
  const answered = quiz.questions.filter((q) => {
    const v = state.answers[q.id];
    return v !== undefined && String(v).trim() !== '';
  }).length;

  return `
    <div class="quiz-head">
      <h2>${esc(quiz.title)}</h2>
      <span class="chip">${quiz.questions.length} 题</span>
      <span class="chip">${esc(fmtDate(quiz.createdAt))}</span>
      ${doneAttempt ? `<span class="chip brand">已提交过，得分 ${doneAttempt.grade.total}</span>` : ''}
      <span style="margin-left:auto"></span>
      <button class="btn btn-quiet btn-sm" id="quiz-new">换一套</button>
    </div>

    ${quiz.questions
      .map((q, i) => {
        const val = state.answers[q.id];
        const isChoice = q.type === 'choice';
        return `<div class="q-card">
          <div class="q-top">
            <span class="q-no">${i + 1}</span>
            <span class="badge lv-${esc(q.difficulty)}">${esc(q.difficulty)}</span>
            <span class="badge">${isChoice ? '单选' : q.type === 'design' ? '场景设计' : '简答'}</span>
            <span class="badge">${q.points} 分</span>
            <span class="chip" style="margin-left:auto;font-size:11px">${esc(q.topicTitle)}</span>
          </div>
          <p class="q-text">${esc(q.question)}</p>
          ${isChoice
            ? `<div class="options">${q.options
                .map(
                  (o, oi) => `<label class="option ${String(val) === String(oi) ? 'on' : ''}" data-q="${esc(q.id)}" data-oi="${oi}">
                    <span class="k">${String.fromCharCode(65 + oi)}</span><span>${esc(o)}</span>
                  </label>`,
                )
                .join('')}</div>`
            : `<textarea class="textarea" data-answer="${esc(q.id)}" placeholder="${q.type === 'design' ? '写出你的完整思路：先说什么、再说什么、怎么处理追问…' : '尽量写成能直接说出口的话'}" style="min-height:${q.type === 'design' ? 150 : 110}px">${esc(val || '')}</textarea>`}
        </div>`;
      })
      .join('')}

    <div class="quiz-foot">
      <span style="font-size:13px;color:var(--text-2)">已作答 <b>${answered}</b> / ${quiz.questions.length}</span>
      <div class="progress-line" style="flex:1;min-width:120px"><i style="width:${(answered / quiz.questions.length) * 100}%"></i></div>
      <button class="btn btn-brand" id="submit-quiz">提交批改</button>
    </div>
  `;
}

function bindQuiz() {
  const r = state.record;
  const quiz = (r.quizzes || []).find((q) => q.id === state.quizId) || (r.quizzes || [])[(r.quizzes || []).length - 1];

  on('.option', 'click', (e) => {
    e.preventDefault();
    const id = e.currentTarget.dataset.q;
    state.answers[id] = e.currentTarget.dataset.oi;
    document.querySelectorAll(`.option[data-q="${id}"]`).forEach((o) => o.classList.toggle('on', o === e.currentTarget));
    updateQuizProgress();
  });

  on('[data-answer]', 'input', (e) => {
    state.answers[e.currentTarget.dataset.answer] = e.currentTarget.value;
    updateQuizProgress();
  });

  const newBtn = document.getElementById('quiz-new');
  if (newBtn) newBtn.addEventListener('click', () => generateQuiz(null, true));

  const submit = document.getElementById('submit-quiz');
  if (submit && quiz) submit.addEventListener('click', () => submitQuiz(quiz));
}

function updateQuizProgress() {
  const quiz = (state.record.quizzes || []).find((q) => q.id === state.quizId);
  if (!quiz) return;
  const answered = quiz.questions.filter((q) => {
    const v = state.answers[q.id];
    return v !== undefined && String(v).trim() !== '';
  }).length;
  const foot = document.querySelector('.quiz-foot');
  if (!foot) return;
  const num = foot.querySelector('b');
  if (num) num.textContent = answered;
  const bar = foot.querySelector('.progress-line i');
  if (bar) bar.style.width = `${(answered / quiz.questions.length) * 100}%`;
}

async function submitQuiz(quiz) {
  const unanswered = quiz.questions.filter((q) => {
    const v = state.answers[q.id];
    return v === undefined || String(v).trim() === '';
  });
  if (unanswered.length && !confirm(`还有 ${unanswered.length} 题没作答，未答按 0 分计。确定提交吗？`)) return;

  try {
    await runJob(
      api(`/api/analyses/${state.record.id}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: quiz.id, answers: state.answers }),
      }),
      '正在批改你的答卷',
      ['逐题对照评分点', '定位知识缺口'],
    );
    await refreshRecord();
    state.tab = 'review';
    state.attemptId = state.record.attempts[state.record.attempts.length - 1].id;
    renderWorkspace();
    toast('批改完成，看看复盘');
  } catch (err) {
    /* 浮层已提示 */
  }
}

/* ---------- 复盘 ---------- */

function answerDisplay(it) {
  if (it.userAnswer === '' || it.userAnswer == null) return '未作答';
  if (it.type === 'choice') {
    const idx = Number(it.userAnswer);
    const text = it.options?.[idx];
    if (text) return `${String.fromCharCode(65 + idx)}. ${esc(text)}`;
  }
  return esc(it.userAnswer);
}

function panelReview() {
  const r = state.record;
  const attempts = r.attempts || [];
  if (!attempts.length) {
    return emptyState('还没有测验记录', '先做一套测验，提交后这里会给出分数、逐题点评和薄弱知识点。', '去做测验', 'go-quiz');
  }
  const attempt = attempts.find((a) => a.id === state.attemptId) || attempts[attempts.length - 1];
  const g = attempt.grade;
  const quiz = (r.quizzes || []).find((q) => q.id === attempt.quizId);
  const color = g.total >= 78 ? '#0d9488' : g.total >= 60 ? '#d97706' : '#d92d20';

  return `
    <div class="score-hero">
      <div style="display:grid;place-items:center">
        <div class="ring big-ring" style="--p:${g.total};position:relative;background:conic-gradient(${color} calc(${g.total} * 1%), #e8f1ef 0)">
          <span>${g.total}</span>
        </div>
        <div class="lvl" style="font-size:12.5px;font-weight:600;color:${color};margin-top:8px">${esc(g.level)}</div>
      </div>
      <div>
        <div class="chips" style="margin-bottom:12px">
          <span class="chip">${attempts.length} 次测验</span>
          <span class="chip">${esc(fmtDate(attempt.createdAt))}</span>
          ${quiz ? `<span class="chip">${esc(quiz.title)}</span>` : ''}
        </div>
        <div class="dims">
          ${[
            ['concept', '概念准确性'],
            ['depth', '理解深度'],
            ['expression', '表达结构'],
          ]
            .map(([k, label]) => {
              const d = g.dimensions?.[k] || { score: 0, comment: '' };
              return `<div class="dim-row">
                <span class="t">${label}</span>
                <div class="bar"><i style="width:${d.score}%"></i></div>
                <span class="v">${d.score}</span>
              </div>`;
            })
            .join('')}
        </div>
        ${g.summary ? `<p style="font-size:13.5px;line-height:1.8;color:var(--text-2);margin:16px 0 0">${esc(g.summary)}</p>` : ''}
      </div>
    </div>

    ${attempts.length > 1 ? `<div class="chips" style="margin-top:14px">
      ${attempts.map((a, i) => `<button class="chip ${a.id === attempt.id ? 'brand' : ''}" data-attempt="${esc(a.id)}" style="cursor:pointer">第 ${i + 1} 次 · ${a.grade.total} 分</button>`).join('')}
    </div>` : ''}

    ${(g.weakTopics || []).length ? `<div class="card" style="margin-top:14px">
      <div class="card-title">最该补的短板<span class="line"></span></div>
      ${g.weakTopics.map((w) => `<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)">
        <span class="badge stars">${stars(w.severity)}</span>
        <div><div style="font-size:13.5px;font-weight:600">${esc(w.topicTitle)}</div>
        <div style="font-size:12.5px;color:var(--muted)">${esc(w.reason)}</div></div>
      </div>`).join('')}
    </div>` : ''}

    <div class="card" style="margin-top:14px">
      <div class="card-title">逐题复盘<span class="line"></span><span style="font-size:11.5px;color:var(--muted);font-weight:500">点开看漏掉的点</span></div>
      ${(g.items || [])
        .map((it, i) => {
          const ratio = it.max ? it.score / it.max : 0;
          const cls = ratio >= 0.85 ? 'tag-ok' : ratio >= 0.5 ? 'tag-half' : 'tag-bad';
          const label = ratio >= 0.85 ? '答得好' : ratio >= 0.5 ? '半对' : '未达标';
          return `<div class="review-item">
            <div class="review-head">
              <span class="q-no">${i + 1}</span>
              <span class="${cls}">${it.score} / ${it.max}　${label}</span>
              <span class="badge">${esc(it.topicTitle || '')}</span>
            </div>
            <p class="review-q">${esc(it.question)}</p>
            <div class="answer-box ${it.userAnswer ? '' : 'empty'}">${answerDisplay(it)}</div>
            ${it.verdict ? `<div style="font-size:13px;color:var(--text-2);margin-bottom:8px">${esc(it.verdict)}</div>` : ''}
            ${(it.missed || []).length ? `<div style="margin-bottom:8px">
              <div class="title-sm" style="margin-bottom:4px">漏掉的点</div>
              <ul class="list-clean">${it.missed.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
            </div>` : ''}
            ${it.better ? `<div class="better-box"><b>更好的答法：</b>${esc(it.better)}</div>` : ''}
            ${it.knowledgeGap ? `<div class="trap" style="margin-top:8px">知识缺口：${esc(it.knowledgeGap)}</div>` : ''}
          </div>`;
        })
        .join('')}
    </div>

    ${(g.nextActions || []).length ? `<div class="card" style="margin-top:14px">
      <div class="card-title">接下来 3 天<span class="line"></span></div>
      <ul class="list-clean">${g.nextActions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      <div style="margin-top:16px"><button class="btn btn-brand" id="plan-btn">生成 7 天提升计划</button></div>
    </div>` : ''}
  `;
}

function bindReview() {
  on('[data-attempt]', 'click', (e) => {
    state.attemptId = e.currentTarget.dataset.attempt;
    renderPanel();
  });
  const btn = document.getElementById('plan-btn');
  if (btn) btn.addEventListener('click', generatePlan);
}

/* ---------- 计划 ---------- */

function panelPlan() {
  const r = state.record;
  const p = r.plan;
  if (!p) {
    return emptyState('还没有提升计划', '基于测验暴露的短板，生成一份 7 天可执行的冲刺计划：每天 2-3 个任务，含开口练。', '生成 7 天计划', 'plan-new');
  }
  return `
    <div class="card summary-card">
      <div class="title-sm">诊断</div>
      <h2 class="plan-head">${esc(p.headline || '')}</h2>
      <div class="chips" style="margin-top:10px">
        <span class="chip">${esc(fmtDate(p.createdAt))}</span>
        <span class="chip brand">${(p.days || []).length} 天计划</span>
      </div>
    </div>

    ${(p.focus || []).length ? `<div class="card" style="margin-top:14px">
      <div class="card-title">优先补强<span class="line"></span></div>
      ${p.focus.map((f) => `<div class="focus-item">
        <h5>${esc(f.topicTitle)}</h5>
        <p>${esc(f.why)}</p>
        <ul class="list-clean">${(f.how || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>` : ''}

    <div class="card" style="margin-top:14px">
      <div class="card-title">日程<span class="line"></span></div>
      ${(p.days || []).map((d) => `<div class="day-row">
        <div><span class="day-tag">${esc(d.day)}</span></div>
        <div>
          <div class="day-goal">${esc(d.goal)}</div>
          ${(d.tasks || []).map((t) => `<div class="task">
            ${t.time ? `<span class="tm">${esc(t.time)}</span>` : ''}
            <span>${esc(t.task)}</span>
            ${t.type ? `<span class="ty">${esc(t.type)}</span>` : ''}
          </div>`).join('')}
        </div>
      </div>`).join('')}
    </div>

    ${(p.resources || []).length ? `<div class="card" style="margin-top:14px">
      <div class="card-title">可用资源<span class="line"></span></div>
      <ul class="refs">${p.resources.map((rf) => `<li><b>${esc(rf.type || '')}</b>　${esc(rf.title)}${rf.note ? `　<span style="color:var(--muted)">${esc(rf.note)}</span>` : ''}</li>`).join('')}</ul>
    </div>` : ''}

    ${p.nextRound ? `<div class="card" style="margin-top:14px">
      <div class="card-title">下一轮验收<span class="line"></span></div>
      <div class="prose">${md(p.nextRound)}</div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-brand btn-sm" id="again-quiz">再做一套测验</button>
        <button class="btn btn-ghost btn-sm" id="export-final">导出完整手册</button>
      </div>
    </div>` : ''}
  `;
}

function bindPlan() {
  const q = document.getElementById('again-quiz');
  if (q) q.addEventListener('click', () => generateQuiz(null, true));
  const ex = document.getElementById('export-final');
  if (ex) ex.addEventListener('click', () => window.open(`/api/analyses/${state.record.id}/export.md`, '_blank'));
}

/* ---------- 空状态 ---------- */

function emptyState(title, desc, actionLabel, action) {
  return `<div class="empty">
    <div class="ic">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    </div>
    <h3>${esc(title)}</h3>
    <p>${esc(desc)}</p>
    ${actionLabel ? `<button class="btn btn-brand" data-action="${esc(action)}">${esc(actionLabel)}</button>` : ''}
  </div>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'materials-all') generateMaterials(true);
  if (a === 'materials-top') generateTop(5);
  if (a === 'courses-all') generateCourses();
  if (a === 'report-new') generateReport();
  if (a === 'quiz-new') generateQuiz();
  if (a === 'go-quiz') { state.tab = 'quiz'; renderWorkspace(); }
  if (a === 'plan-new') generatePlan();
  if (a === 'home') location.hash = '#/';
});

/* ---------------- 生成动作 ---------------- */

async function refreshRecord() {
  state.record = await api(`/api/analyses/${state.record.id}`);
}

/** 静默任务：不弹浮层，用于分析完成后的后台排课 */
async function pollJobQuiet(jobId) {
  for (let i = 0; i < 360; i += 1) {
    const job = await api(`/api/jobs/${jobId}`);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.error || '处理失败');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('生成超时，请稍后重试');
}

async function generateCourses(names = null) {
  const r = state.record;
  if (!r) return;
  const one = names?.length ? names[0] : '';
  try {
    const res = await runJob(
      api(`/api/analyses/${r.id}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(names?.length ? { names } : { auto: false }),
      }),
      one ? `正在排「${one}」的课程` : '正在按技术大类排课',
      one ? ['按 4 阶段排课', '每阶段 5-6 章，铺满面试面'] : ['每个技术大类一门课', '4 阶段 / 20-24 章'],
    );
    await refreshRecord();
    const list = state.record.courses || [];
    const want = (one && list.find((c) => c.group === one)) || list.find((c) => (c.stages || []).length);
    if (want) state.courseId = want.id;
    state.chapterId = null;
    state.tab = 'courses';
    renderWorkspace();
    toast(res.added?.length ? `已排好 ${res.added.length} 门课程` : '课程已是最新');
  } catch (err) {
    /* 浮层已提示 */
  }
}

async function generateLessons(chapterIds = null) {
  const r = state.record;
  const course = currentCourse();
  if (!r || !course) return;

  let ids = chapterIds?.length
    ? chapterIds
    : allChapters(course).filter((x) => !x.chapter.lesson).map((x) => x.chapter.id);
  ids = [...new Set(ids)];
  if (!ids.length) return toast('所有章节都已有讲义了');

  const batch = ids.slice(0, 4);
  try {
    await runJob(
      api(`/api/analyses/${r.id}/courses/${course.id}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIds: batch, depth: state.lessonDepth }),
      }),
      '正在写章节讲义',
      [`按「${DEPTH_LABEL[state.lessonDepth]}」写 ${batch.length} 节`, '先检索真实资料，再成文并标注来源'],
    );
    await refreshRecord();
    state.lessonVersion = 0;
    state.lessonHistOpen = false;
    renderWorkspace();
    toast(ids.length > batch.length ? `已生成 ${batch.length} 章，还剩 ${ids.length - batch.length} 章` : '讲义已生成');
  } catch (err) {
    /* 浮层已提示 */
  }
}

/** 分析完成后的后台动作：按技术大类自动排课，并生成第一节课讲义 */
async function autoBuildCourses() {
  const r = state.record;
  if (!r) return;
  if ((r.courses || []).some((c) => (c.stages || []).length)) return;

  try {
    const res = await pollJobQuiet(
      (
        await api(`/api/analyses/${r.id}/courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto: true }),
        })
      ).jobId,
    );
    await refreshRecord();

    const courses = state.record.courses || [];
    const first = courses.find((c) => (c.stages || []).length);
    if (first && !state.courseId) state.courseId = first.id;
    if (state.tab === 'profile' || state.tab === 'courses') renderWorkspace();

    if (first) {
      const pending = allChapters(first).find((x) => !x.chapter.lesson);
      if (pending) {
        await pollJobQuiet(
          (
            await api(`/api/analyses/${r.id}/courses/${first.id}/lessons`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chapterIds: [pending.chapter.id], depth: 'standard' }),
            })
          ).jobId,
        );
        await refreshRecord();
        if (state.tab === 'courses') renderWorkspace();
      }
    }

    if (res.added?.length) toast(`已按技术大类排好 ${res.added.length} 门课程`);
  } catch (err) {
    console.error('[auto courses]', err);
  }
}

async function expandTopic(topicId) {
  if (!topicId) return;
  try {
    const res = await runJob(
      api(`/api/analyses/${state.record.id}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId, count: 4 }),
      }),
      '正在拓展关联考点',
      ['检索相关知识', '生成关联考点'],
    );
    state.flash = new Set((res.added || []).map((t) => t.id));
    await refreshRecord();
    (res.added || []).forEach((t) => state.selected.add(t.id));
    state.tab = 'topics';
    renderWorkspace();
    toast(res.added?.length ? `新增 ${res.added.length} 个关联考点` : '没有找到值得新增的考点（都不重复）');
  } catch (err) {
    /* 浮层已提示 */
  }
}

async function generateMaterials(all = false, onlyIds = null, opts = {}) {
  const r = state.record;
  const generated = new Set((r.materials || []).filter((m) => !m.error).map((m) => m.topicId));
  let ids;
  if (onlyIds && onlyIds.length) {
    // 指定生成（含按当前深度重写已有资料）
    ids = onlyIds;
  } else if (all) {
    ids = (r.topics || []).map((t) => t.id).filter((id) => !generated.has(id));
  } else {
    ids = [...state.selected].filter((id) => !generated.has(id));
  }

  if (!ids.length) {
    if (generated.size) {
      state.tab = 'materials';
      if (!state.materialId) state.materialId = [...generated][0];
      renderWorkspace();
      toast('选中的知识点都已经有资料了');
    } else {
      toast('请先勾选要生成资料的知识点', 'err');
    }
    return;
  }

  const rewriting = Boolean(onlyIds?.length && onlyIds.every((id) => generated.has(id)));
  try {
    await runJob(
      api(`/api/analyses/${r.id}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: ids, depth: state.depth }),
      }),
      rewriting ? '正在重写这篇资料' : '正在写复习资料',
      ids.length > 1
        ? [`按「${DEPTH_LABEL[state.depth]}」逐篇生成（共 ${ids.length} 个）`, '检索资料并把来源一并保存']
        : [`按「${DEPTH_LABEL[state.depth]}」生成`, '检索资料并把来源一并保存'],
    );
    await refreshRecord();
    if (!opts.silent) {
      state.tab = 'materials';
      state.materialId = ids[0];
    }
    state.viewVersion = 0;
    state.historyOpen = false;
    renderWorkspace();
    if (state.tab === 'materials') toast(rewriting ? '已按新深度重写' : '资料已生成');
    else toast(`资料已生成，可到「复习资料」查看`);
  } catch (err) {
    /* 浮层已提示 */
  }
}

/** 自动生成优先级最高的 N 个模块（silent：不切换页面，仅后台生成） */
async function generateTop(n = 5, silent = false) {
  const r = state.record;
  if (!r) return;
  const generated = new Set((r.materials || []).filter((m) => !m.error).map((m) => m.topicId));
  const ids = sortedTopics().filter((t) => !generated.has(t.id)).slice(0, n).map((t) => t.id);
  if (!ids.length) return toast('优先级最高的模块都已有资料了');
  await generateMaterials(false, ids, { silent });
}

async function generateReport() {
  const r = state.record;
  try {
    await runJob(
      api(`/api/analyses/${r.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth: state.reportDepth }),
      }),
      '正在生成面试准备报告',
      ['检索岗位面经与行业资料', '汇总成报告：判断 / 排序 / 路径'],
    );
    await refreshRecord();
    state.tab = 'report';
    renderWorkspace();
    toast('报告已生成');
  } catch (err) {
    /* 浮层已提示 */
  }
}

async function generateQuiz(topicIds, forceNew = false) {
  const r = state.record;
  const ids = topicIds && topicIds.length ? topicIds : [...state.selected];
  const picked = ids.length ? ids : (r.topics || []).map((t) => t.id);
  const count = Math.min(12, Math.max(6, picked.length + 2));

  if (!picked.length) return toast('没有可考察的知识点', 'err');

  try {
    const res = await runJob(
      api(`/api/analyses/${r.id}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: picked, count }),
      }),
      '正在出题',
      ['选择题 + 简答 + 场景设计'],
    );
    await refreshRecord();
    state.answers = {};
    state.quizId = res.quiz?.id || (state.record.quizzes || []).slice(-1)[0]?.id;
    state.tab = 'quiz';
    renderWorkspace();
    toast(forceNew ? '新的一套题已生成' : '题目已生成');
  } catch (err) {
    /* 浮层已提示 */
  }
}

async function generatePlan() {
  const r = state.record;
  const attempt = r.attempts?.[r.attempts.length - 1];
  if (!attempt) return toast('先完成一次测验', 'err');
  try {
    await runJob(
      api(`/api/analyses/${r.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id }),
      }),
      '正在排提升计划',
      ['按短板与出现概率排序', '生成 7 天可执行日程'],
    );
    await refreshRecord();
    state.tab = 'plan';
    renderWorkspace();
    toast('计划已生成');
  } catch (err) {
    /* 浮层已提示 */
  }
}

/* ---------------- 模拟面试 ---------------- */

function mockReportView(session) {
  const report = session.report || {};
  const answers = session.answers || [];
  const score = Math.max(0, Math.min(100, Number(report.overall) || 0));
  return `
    <div class="mock-report">
      <div class="mr-head">
        <div class="ring" style="--p:${score};width:64px;height:64px"><span style="font-size:17px">${score}</span></div>
        <div>
          <div class="mr-verdict">${esc(report.verdict || '')}</div>
          <div class="mr-sub">面试官视角评分，宁低勿高——低分是提醒，不是否定</div>
        </div>
        <a class="btn btn-quiet btn-sm" style="margin-left:auto" href="/api/analyses/${state.record.id}/mocks/${session.id}.md" download>下载复盘</a>
      </div>
      ${(report.dimensions || []).length ? `<div class="jd-sec"><b>分维度</b>
        ${report.dimensions.map((d) => `<div class="mr-dim">
          <div class="mr-dim-head"><b>${esc(d.name)}</b><span>${d.score}</span></div>
          <div class="course-progress" style="margin:4px 0 6px"><i style="width:${Math.max(0, Math.min(100, d.score))}%"></i></div>
          <div class="fq">${esc(d.comment)}</div>
        </div>`).join('')}
      </div>` : ''}
      ${(report.highlights || []).length ? `<div class="jd-sec"><b>加分回答</b><ul class="list-clean">${report.highlights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(report.misses || []).length ? `<div class="jd-sec"><b>没接住的追问</b><ul class="list-clean">${report.misses.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(report.practice || []).length ? `<div class="jd-sec"><b>接下来 7 天练什么</b><ul class="list-clean">${report.practice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${answers.length ? `<div class="jd-sec"><b>逐题参考答案（${answers.length} 题）</b>
        ${answers.map((a) => `<div class="mq-card">
          <div class="mq-head">
            <span class="mq-no">${a.no}</span>
            <div class="mq-q">${esc(a.question)}</div>
          </div>
          ${a.intent ? `<div class="fq"><b>为什么问这题：</b>${esc(a.intent)}</div>` : ''}
          ${a.verdict ? `<div class="mq-verdict">${esc(a.verdict)}</div>` : ''}
          <div class="mq-ref">${esc(a.reference).replace(/\n/g, '<br />')}</div>
          ${(a.followups || []).length ? `<div class="mq-fu">${a.followups.map((f) => `<div>↳ ${esc(f)}</div>`).join('')}</div>` : ''}
        </div>`).join('')}
      </div>` : ''}
    </div>
  `;
}

function panelMock() {
  const r = state.record;
  if (!(r.groups || []).length) {
    return emptyState('先完成简历分析', '模拟面试要基于简历和考点提问，先上传简历完成一次分析', '返回', 'home');
  }
  const sessions = r.mocks || [];
  const active = sessions.find((s) => s.id === state.mockId) || sessions[0] || null;
  if (active && state.mockId !== active.id) state.mockId = active.id;

  const sessionChips = sessions.length
    ? `<div class="mock-sessions">
        ${sessions.map((s, i) => `<button class="chip ${s.id === active?.id ? 'brand' : ''}" data-mock-open="${esc(s.id)}">
          第 ${sessions.length - i} 场 · ${s.status === 'done' ? `已评分 ${s.report?.overall ?? '—'} 分` : s.status === 'live' ? '进行中' : '已结束'}
        </button>`).join('')}
      </div>`
    : '';

  if (!active) {
    return `<div class="card course-empty">
      <div class="card-title">模拟面试<span class="line"></span></div>
      <p class="course-empty-desc">AI 面试官按你的简历和考点连续追问 8-10 题：项目深挖 → 原理机制 → 线上排障 → 系统设计。像真面试一样一次只问一个问题，答完出一份面试官视角的评分报告。<br /><b>建议口头回答再说要点</b>——练的就是开口，不是打字。</p>
      <div class="course-empty-actions">
        <button class="btn btn-brand" data-mock-start="standard">开始标准面试</button>
        <button class="btn btn-ghost" data-mock-start="pressure">压力面模式</button>
      </div>
    </div>`;
  }

  const live = active.status === 'live';
  return `<div class="card mock-card">
    <div class="card-title">模拟面试<span class="line"></span>
      <span class="chip ${active.mode === 'pressure' ? 'gap' : 'brand'}">${active.mode === 'pressure' ? '压力面' : '标准'}</span>
      ${live ? `<span class="chip">第 ${active.questionNo} 问 · 进行中</span>` : `<span class="chip brand">已评分</span>`}
      <button class="btn btn-quiet btn-sm" data-mock-start="standard" style="margin-left:auto">再练一场</button>
    </div>
    ${sessionChips}
    <div class="mock-log" id="mock-log">
      ${active.transcript.map((m) => `<div class="m-msg ${m.role === 'candidate' ? 'me' : 'itv'}">
        <div class="m-who">${m.role === 'candidate' ? '你' : '面试官'}${m.probe ? `<span class="m-probe">追问点：${esc(m.probe)}</span>` : ''}</div>
        <div class="m-text">${esc(m.content).replace(/\n/g, '<br />')}</div>
      </div>`).join('')}
    </div>
    ${live ? `
    <div class="mock-input">
      <textarea id="mock-answer" rows="3" placeholder="回答面试官的问题…（口头答完再把要点打进来，效果最好）"></textarea>
      <div class="mock-input-bar">
        <button class="btn btn-ghost btn-sm mic-btn" id="mock-mic" hidden title="语音输入：说出来的话自动转成文字填进输入框">🎤 说话</button>
        <span class="mock-hint">Ctrl / ⌘ + Enter 发送</span>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="mock-finish">结束并出报告</button>
        <button class="btn btn-brand btn-sm" id="mock-send" ${active.done ? 'disabled' : ''}>发送回答</button>
      </div>
    </div>` : active.report ? mockReportView(active) : '<p class="mock-hint">这场面试没有生成报告。</p>'}
  </div>`;
}

function bindMock() {
  on('[data-mock-start]', 'click', async (e) => {
    const mode = e.currentTarget.dataset.mockStart || 'standard';
    try {
      showOverlay(mode === 'pressure' ? '压力面面试官进场' : '面试官进场', ['组织考点', '设计开场问题']);
      const { session } = await api(`/api/analyses/${state.record.id}/mock/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      hideOverlay();
      state.record.mocks = [session, ...(state.record.mocks || []).filter((m) => m.id !== session.id)];
      state.mockId = session.id;
      renderPanel();
      setTimeout(() => document.getElementById('mock-log')?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50);
    } catch (err) {
      overlayError(err.message);
    }
  });

  on('[data-mock-open]', 'click', (e) => {
    state.mockId = e.currentTarget.dataset.mockOpen;
    renderPanel();
  });

  const send = async () => {
    const box = document.getElementById('mock-answer');
    const session = (state.record.mocks || []).find((m) => m.id === state.mockId);
    const answer = box?.value.trim();
    if (!box || !answer) return;
    if (!session || session.status !== 'live') return;
    // 发送时停掉语音识别，避免它继续往旧输入框里写
    const micBtn = document.getElementById('mock-mic');
    if (micBtn?._rec) { try { micBtn._rec.stop(); } catch { /* ignore */ } }
    box.disabled = true;
    document.getElementById('mock-send').disabled = true;
    box.value = '';
    // 先把候选人的回答乐观渲染出来
    session.transcript.push({ role: 'candidate', content: answer, at: new Date().toISOString() });
    renderPanel();
    const log = document.getElementById('mock-log');
    if (log) log.scrollTop = log.scrollHeight;
    document.getElementById('mock-answer')?.focus();
    try {
      const { session: next } = await api(`/api/analyses/${state.record.id}/mock/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, answer }),
      });
      state.record.mocks = [next, ...(state.record.mocks || []).filter((m) => m.id !== next.id)];
      state.mockId = next.id;
      renderPanel();
      setTimeout(() => document.getElementById('mock-log')?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50);
    } catch (err) {
      toast(err.message, 'err');
      box.disabled = false;
      const sendBtn = document.getElementById('mock-send');
      if (sendBtn) sendBtn.disabled = false;
    }
  };

  const sendBtn = document.getElementById('mock-send');
  if (sendBtn) sendBtn.addEventListener('click', send);
  const box = document.getElementById('mock-answer');
  if (box) {
    box.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    box.focus();
  }

  // 语音输入：浏览器原生识别（Chrome/Edge/Safari），不支持时按钮自动隐藏
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('mock-mic');
  if (mic && !SR) mic.remove();
  if (mic && SR) {
    mic.hidden = false;
    let rec = null;
    let listening = false;
    let base = '';
    mic.addEventListener('click', () => {
      if (listening) {
        try { rec.stop(); } catch { /* ignore */ }
        return;
      }
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      // 保留输入框里已打的内容，语音续在后面
      const cur = box.value.trimEnd();
      base = cur ? `${cur}${/[。！？.!?\n]$/.test(cur) ? '\n' : '。'}\n` : '';
      rec.onresult = (e) => {
        let final = '';
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t;
          else interim += t;
        }
        if (final) base += final;
        box.value = base + interim;
      };
      rec.onstart = () => {
        listening = true;
        mic.classList.add('rec');
        mic.textContent = '■ 停止';
      };
      rec.onend = () => {
        listening = false;
        mic.classList.remove('rec');
        mic.textContent = '🎤 说话';
        box.focus();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') toast('麦克风权限被拒绝，请在浏览器地址栏的权限设置里允许', 'err');
        else if (e.error === 'network') toast('语音服务连不上（这个浏览器的语音识别可能需要特定网络）', 'err');
      };
      try { rec.start(); } catch { /* 已在运行 */ }
      mic._rec = rec;
    });
  }

  const finish = document.getElementById('mock-finish');
  if (finish) {
    finish.addEventListener('click', () => {
      const session = (state.record.mocks || []).find((m) => m.id === state.mockId);
      if (!session) return;
      const partial = session.transcript.filter((m) => m.role === 'candidate').length;
      if (partial < 2 && !window.confirm(`目前只回答了 ${partial} 题，回答太少报告会不准。确定现在结束？`)) return;
      runJob(
        api(`/api/analyses/${state.record.id}/mock/finish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        }),
        '面试官写评审笔记',
        ['回顾完整对话', '逐维度评分', '逐题写参考答案'],
      )
        .then(async () => {
          const record = await api(`/api/analyses/${state.record.id}`);
          state.record = record;
          renderPanel();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
        .catch(() => {});
    });
  }
}

/* ---------------- 启动 ---------------- */

async function boot() {
  window.addEventListener('scroll', () => {
    $topbar.classList.toggle('scrolled', window.scrollY > 4);
  });

  try {
    state.health = await api('/api/health');
  } catch (err) {
    toast('无法连接服务端', 'err');
  }
  try {
    state.usage = await api('/api/usage');
  } catch {
    /* 用量展示失败不影响主流程 */
  }
  try {
    const { items } = await api('/api/analyses');
    state.history = items;
  } catch {
    /* 历史列表失败不阻塞 */
  }
  renderTopbar();
  route();
}

function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/a\/([^/?]+)(?:\?(.*))?$/);
  if (m) {
    const params = new URLSearchParams(m[2] || '');
    state.pendingTab = params.get('tab');
    state.pendingMaterial = params.get('mat');
    openAnalysis(m[1]);
  } else renderHome();
}

window.addEventListener('hashchange', route);
boot();

/* ---------------- AI 随问（划词问 AI + 右下角对话抽屉） ---------------- */

const chat = {
  open: false,
  messages: [], // { role, content, quote? }
  busy: false,
  seed: null, // { selection, context }
};

const TAB_LABEL = {
  profile: '简历画像',
  study: '速学',
  topics: '知识点图谱',
  courses: '系统课程',
  materials: '复习资料',
  report: '面试报告',
  quiz: '测验',
  review: '复盘',
  plan: '计划',
};

/* ---------- 划词浮出按钮 ---------- */

const $fab = document.createElement('button');
$fab.id = 'ask-fab';
$fab.className = 'hidden';
$fab.type = 'button';
$fab.innerHTML = `<span class="fab-ic">✦</span>问 AI`;
document.body.appendChild($fab);

function currentSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 2000) return null;
  const node = sel.anchorNode;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !$app.contains(el) || el.closest('#ai-drawer, #ask-fab, input, textarea, [contenteditable]')) return null;
  return { text, rect: sel.getRangeAt(0).getBoundingClientRect(), el };
}

function selectionContext(el) {
  const heading = el.closest('h1, h2, h3, .ch-title, .card-title, .lesson-head')?.innerText?.trim();
  const page = TAB_LABEL[state.tab] || '';
  return [page, heading].filter(Boolean).join(' · ').slice(0, 300);
}

function positionFab(rect) {
  const fab = $fab;
  fab.classList.remove('hidden');
  const w = fab.offsetWidth || 92;
  const h = fab.offsetHeight || 36;
  const left = Math.min(Math.max(8, rect.right - w), window.innerWidth - w - 8);
  const top = rect.top - h - 8 < 8 ? rect.bottom + 8 : rect.top - h - 8;
  fab.style.left = `${left}px`;
  fab.style.top = `${Math.max(8, top + window.scrollY)}px`;
}

document.addEventListener('pointerup', (e) => {
  if (e.target instanceof Element && (e.target.closest('#ai-drawer') || e.target.closest('#ask-fab'))) return;
  // 等浏览器完成选区结算
  setTimeout(() => {
    const hit = currentSelection();
    if (hit) positionFab(hit.rect);
    else $fab.classList.add('hidden');
  }, 10);
});
document.addEventListener('scroll', () => $fab.classList.add('hidden'), true);

/* ---------- 右下角对话抽屉 ---------- */

const $drawer = document.createElement('div');
$drawer.id = 'ai-drawer';
$drawer.innerHTML = `
  <div class="ai-head">
    <div class="ai-title"><span class="ai-dot"></span>AI 随问<small>结合你的简历与目标岗位回答</small></div>
    <div class="ai-head-btns">
      <button type="button" class="ai-mini" id="ai-new" title="清空当前话题，重新开始">新话题</button>
      <button type="button" class="ai-mini" id="ai-close" title="收起">✕</button>
    </div>
  </div>
  <div class="ai-msgs" id="ai-msgs"></div>
  <div class="ai-empty" id="ai-empty">
    <p><b>选中页面里的任意内容</b>，点「问 AI」就能得到结合你简历的讲解。</p>
    <p>也可以直接在下方输入问题继续追问。</p>
  </div>
  <div class="ai-input-row">
    <textarea id="ai-input" rows="1" placeholder="继续追问…（Enter 发送，Shift+Enter 换行）"></textarea>
    <button type="button" class="ai-send" id="ai-send" title="发送">➤</button>
  </div>`;
document.body.appendChild($drawer);
const $aiMsgs = $drawer.querySelector('#ai-msgs');
const $aiEmpty = $drawer.querySelector('#ai-empty');
const $aiInput = $drawer.querySelector('#ai-input');

function renderChat() {
  $drawer.classList.toggle('open', chat.open);
  const items = chat.messages
    .map((m) => {
      if (m.role === 'user') {
        const quote = m.quote
          ? `<blockquote class="ai-quote">${esc(m.quote)}</blockquote>`
          : '';
        return `<div class="ai-msg user"><div class="ai-bubble">${quote}${esc(m.display || m.content).replace(/\n/g, '<br>')}</div></div>`;
      }
      if (m.role === 'error') {
        return `<div class="ai-msg err">${esc(m.content)}</div>`;
      }
      return `<div class="ai-msg bot"><div class="ai-bubble">${md(m.content)}</div></div>`;
    })
    .join('');
  $aiMsgs.innerHTML =
    items + (chat.busy ? `<div class="ai-msg bot"><div class="ai-bubble typing"><i></i><i></i><i></i></div></div>` : '');
  $aiEmpty.style.display = chat.messages.length || chat.busy ? 'none' : '';
  if (chat.open) $aiMsgs.scrollTop = $aiMsgs.scrollHeight;
  $aiInput.disabled = chat.busy;
  $drawer.querySelector('#ai-send').disabled = chat.busy;
}

async function sendChat() {
  const text = $aiInput.value.trim();
  $aiInput.value = '';
  $aiInput.style.height = 'auto';

  if (chat.busy) return;
  if (!text && !chat.pendingSeed) return;

  let userMsg;
  if (chat.pendingSeed) {
    const { selection } = chat.pendingSeed;
    userMsg = {
      role: 'user',
      quote: selection,
      display: '结合我的简历，把这段内容讲清楚：核心是什么、为什么重要、面试会怎么问、最容易错在哪。',
      content: `【我选中了这段内容】\n${selection}\n\n【我的问题】请结合我的简历和目标岗位，把这段内容讲清楚：核心是什么、为什么重要、面试会怎么问、最常见的错误理解是什么。`,
    };
    chat.pendingSeed = null;
  } else {
    userMsg = { role: 'user', content: text };
  }

  chat.messages.push(userMsg);
  chat.busy = true;
  renderChat();

  try {
    const res = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisId: state.record?.id || '',
        selection: chat.seed?.selection || '',
        context: chat.seed?.context || '',
        messages: chat.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    chat.messages.push({ role: 'assistant', content: res.reply });
  } catch (err) {
    chat.messages.push({ role: 'error', content: err.message || '回答失败，请重试' });
  } finally {
    chat.busy = false;
    renderChat();
  }
}

function openChatDrawer(seed = null) {
  chat.open = true;
  if (seed) {
    chat.seed = seed;
    chat.pendingSeed = seed;
    // 恢复这条分析的历史对话（仅当当前抽屉是空的）
    if (!chat.messages.length && state.record?.chats?.length) {
      chat.messages = state.record.chats.slice(-10).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
        quote: m.role === 'user' && m.content.startsWith('【我选中了这段内容】') ? m.content.split('【我的问题】')[0].replace('【我选中了这段内容】\n', '').trim() : '',
        display: m.role === 'user' ? m.content.split('【我的问题】')[1]?.trim() : '',
      })).filter((m) => m.display || m.role === 'assistant');
    }
  }
  renderChat();
  setTimeout(() => $aiInput.focus(), 150);
}

$fab.addEventListener('click', (e) => {
  e.preventDefault();
  const hit = currentSelection();
  const selection = hit?.text || chat.lastSelection || '';
  if (hit) chat.lastSelection = hit.text;
  if (!selection) return;
  const context = hit ? selectionContext(hit.el) : '';
  $fab.classList.add('hidden');
  window.getSelection()?.removeAllRanges();
  openChatDrawer({ selection, context });
  sendChat();
});

$drawer.querySelector('#ai-close').addEventListener('click', () => {
  chat.open = false;
  renderChat();
});
$drawer.querySelector('#ai-new').addEventListener('click', () => {
  chat.messages = [];
  chat.seed = null;
  chat.pendingSeed = null;
  chat.lastSelection = '';
  renderChat();
});
$drawer.querySelector('#ai-send').addEventListener('click', sendChat);
$aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
$aiInput.addEventListener('input', () => {
  $aiInput.style.height = 'auto';
  $aiInput.style.height = `${Math.min(96, $aiInput.scrollHeight)}px`;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chat.open) {
    chat.open = false;
    renderChat();
  }
});

/* ---------------- 速学中心（闪卡 / 速览卡 / 费曼检验 / 每日速学） ---------------- */

const study = { daily: null, fcIdx: 0, fcBack: false, busy: false };

const GRADE_BTNS = [
  { g: 0, label: '忘了', cls: 'g0' },
  { g: 1, label: '想了很久', cls: 'g1' },
  { g: 2, label: '记得', cls: 'g2' },
  { g: 3, label: '秒答', cls: 'g3' },
];
const DUE_IN_LABEL = (d) => (d <= 0 ? '现在' : d === 1 ? '明天' : `${d} 天后`);

async function fetchDaily() {
  if (!state.record) return;
  try {
    study.daily = await api(`/api/analyses/${state.record.id}/daily`);
  } catch {
    study.daily = null;
  }
}

function panelStudy() {
  const r = state.record || {};
  const cards = r.flashcards || [];
  const d = study.daily;
  const dueCount = d ? d.dueCount : cards.filter((c) => c.dueAt <= Date.now()).length;

  const hero = `
    <div class="study-hero card">
      <div class="study-hero-main">
        <div class="eyebrow">每日速学</div>
        <h2>今天先刷 ${Math.max(dueCount, 0)} 张到期卡，再攻一个新知识点</h2>
        <p class="study-sub">间隔重复 + 费曼检验：少量高频，把短期记忆炼成长期能力。</p>
      </div>
      <div class="study-stats">
        <div class="ss-item"><b>${cards.length}</b><span>闪卡总数</span></div>
        <div class="ss-item hot"><b>${Math.max(dueCount, 0)}</b><span>到期待复习</span></div>
        <div class="ss-item"><b>${d ? d.mastered : 0}</b><span>已长期掌握</span></div>
      </div>
      ${cards.length ? `<a class="btn btn-ghost btn-sm" style="position:absolute;right:18px;bottom:16px" href="/api/analyses/${r.id}/anki.txt" download title="下载 Anki 可导入的 TSV 文件">导出 Anki</a>` : ''}
    </div>`;

  const fcSection = cards.length
    ? `<div id="fc-stage"></div>`
    : `<div class="card study-block">
        <h3>🃏 闪卡记忆</h3>
        <p class="study-desc">把你的知识点做成问答闪卡：正面是面试官的问法，背面是采分点。按遗忘曲线安排复习，答完翻卡自评，忘了就重来。</p>
        <button class="btn btn-brand" data-gen-fc>生成第一批闪卡（约 12 张）</button>
      </div>`;

  const topicOpts = (selected) =>
    (r.topics || [])
      .map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.title)}（P${t.priority}）</option>`)
      .join('');

  const quickCards = r.quickCards || [];
  const quickSection = `
    <div class="card study-block">
      <h3>⚡ 5 分钟速览卡</h3>
      <p class="study-desc">拿到一个陌生知识点，5 分钟建立框架：是什么 → 为什么必考 → 核心机制 → 面试怎么问 → 最容易错在哪。</p>
      <div class="study-form-row">
        <select id="qc-topic" class="input">${topicOpts(study.qcTopic)}</select>
        <button class="btn btn-ghost" data-gen-qc>生成速览卡</button>
      </div>
      <div id="qc-list">
        ${quickCards.length ? quickCards.map(quickCardHtml).join('') : ''}
      </div>
    </div>`;

  const feynman = r.feynman || [];
  const feynSection = `
    <div class="card study-block">
      <h3>🎤 费曼检验</h3>
      <p class="study-desc">用自己的话把一个知识点讲一遍，AI 像面试官一样批改：说对了什么、漏了什么、错在哪、下一句追问会是什么。</p>
      <div class="study-form-row">
        <select id="fy-topic" class="input">${topicOpts(study.fyTopic)}</select>
      </div>
      <textarea id="fy-text" class="input" rows="5" placeholder="用你自己的话讲清楚这个知识点，像面试现场作答一样……（至少几十个字）"></textarea>
      <div class="study-form-row">
        <button class="btn btn-brand" data-feynman>提交复述，等批改</button>
        <span class="study-hint">建议口述后凭记忆打字，检验的是「讲出来」而不是「看得懂」。</span>
      </div>
      <div id="fy-list">${feynman.length ? feynman.slice().reverse().map(feynmanHtml).join('') : ''}</div>
    </div>`;

  return `${hero}<div class="study-daily" id="study-daily"></div>${fcSection}${quickSection}${feynSection}`;
}

function quickCardHtml(c) {
  return `
    <details class="qc-card" data-qc="${c.topicId}">
      <summary>
        <b>${esc(c.topicTitle)}</b>
        <span class="qc-tldr">${esc(c.tldr)}</span>
      </summary>
      <div class="qc-body">
        <p class="qc-why">${esc(c.why)}</p>
        <ol class="qc-core">${(c.core || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        ${c.mentalModel ? `<div class="qc-model">🧠 <b>心智模型</b>：${esc(c.mentalModel)}</div>` : ''}
        ${(c.howAsked || []).length ? `<div class="qc-asked"><b>面试会怎么问</b><ul>${c.howAsked.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
        ${c.trap ? `<div class="qc-trap">⚠️ 最容易错：${esc(c.trap)}</div>` : ''}
        ${(c.minute && (c.minute.a || c.minute.b || c.minute.c)) ? `
          <div class="qc-minute">
            <span><b>0-1min</b>${esc(c.minute.a)}</span>
            <span><b>1-3min</b>${esc(c.minute.b)}</span>
            <span><b>3-5min</b>${esc(c.minute.c)}</span>
          </div>` : ''}
        ${c.goDeeper ? `<p class="qc-deeper">👉 ${esc(c.goDeeper)}</p>` : ''}
      </div>
    </details>`;
}

function feynmanHtml(g) {
  return `
    <details class="fy-card" data-fy="${g.id}">
      <summary>
        <span class="fy-score ${g.score >= 80 ? 'hi' : g.score >= 60 ? 'mid' : 'lo'}">${g.score}</span>
        <b>${esc(g.topicTitle)}</b>
        <span class="fy-verdict">${esc(g.verdict)}</span>
      </summary>
      <div class="fy-body">
        <div class="fy-grid">
          <div class="fy-col ok"><b>✓ 说对了</b><ul>${(g.got || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="dim">—</li>'}</ul></div>
          <div class="fy-col miss"><b>△ 漏了</b><ul>${(g.missed || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="dim">—</li>'}</ul></div>
          <div class="fy-col wrong"><b>✗ 说错了</b>
            <ul>${(g.wrong || []).map((w) => `<li>「${esc(w.claim)}」→ <b>${esc(w.truth)}</b>${w.why ? `<br><span class="dim">${esc(w.why)}</span>` : ''}</li>`).join('') || '<li class="dim">—</li>'}</ul>
          </div>
        </div>
        ${g.upgrade ? `<div class="fy-upgrade">面试官追问：<b>${esc(g.upgrade)}</b></div>` : ''}
        ${g.nextStep ? `<p class="fy-next">👉 ${esc(g.nextStep)}</p>` : ''}
      </div>
    </details>`;
}

function flashcardHtml(c) {
  const back = c.back || [];
  return `
    <div class="fc-stage ${study.fcBack ? 'show-back' : ''}" data-fc="${c.id}">
      <div class="fc-meta"><span class="fc-type">${esc(c.type)}</span><span class="fc-topic">${esc(c.topicTitle || '')}</span><span class="fc-count">第 ${study.fcIdx + 1} / ${study.daily.due.length} 张</span></div>
      <div class="fc-card" data-flip>
        <div class="fc-front"><p>${esc(c.front)}</p></div>
        ${study.fcBack ? `
          <div class="fc-back">
            <ul>${back.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
            ${c.mnemonic ? `<div class="fc-mne">🪝 ${esc(c.mnemonic)}</div>` : ''}
          </div>` : ''}
      </div>
      ${study.fcBack
        ? `<div class="fc-grades">${GRADE_BTNS.map((g) => `<button class="fc-grade ${g.cls}" data-grade="${g.g}">${g.label}<small>${g.g === 0 ? '1 天后再来' : g.g === 1 ? '3 天后' : g.g === 2 ? '7 天后' : '30 天后'}</small></button>`).join('')}</div>`
        : `<button class="btn btn-brand fc-reveal" data-flip>翻卡看答案</button>`}
    </div>`;
}

function renderFcStage() {
  const el = document.getElementById('fc-stage');
  if (!el || !study.daily) return;
  const due = study.daily.due || [];
  if (study.fcIdx >= due.length) {
    el.innerHTML = `
      <div class="card study-block fc-done">
        <h3>🎉 到期卡已刷完</h3>
        <p class="study-desc">今天安排的复习完成了。下一批到期：${(study.daily.upcoming || []).map((u) => `${DUE_IN_LABEL(u.dueIn)}「${esc(u.front.slice(0, 18))}…」`).join('、') || '—'}</p>
        <button class="btn btn-ghost" data-gen-fc>再生成一批新卡</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="card study-block">
      <h3>🃏 闪卡复习</h3>
      ${flashcardHtml(due[study.fcIdx])}
    </div>`;
}

function renderDaily() {
  const el = document.getElementById('study-daily');
  if (!el || !study.daily) return;
  const d = study.daily;
  const parts = [];
  if (d.freshTopic) {
    parts.push(`
      <div class="daily-row">
        <div class="daily-ic">🌱</div>
        <div class="daily-main">
          <b>今日新知识点：${esc(d.freshTopic.title)}</b>
          <p>${esc(d.freshTopic.reason || '优先级最高、但你还没系统学过的考点')}</p>
        </div>
        <div class="daily-acts">
          <button class="btn btn-brand btn-sm" data-qc-topic="${d.freshTopic.id}">5 分钟速览</button>
          <button class="btn btn-ghost btn-sm" data-mat-topic="${d.freshTopic.id}">生成资料</button>
        </div>
      </div>`);
  }
  for (const w of d.weakTopics || []) {
    parts.push(`
      <div class="daily-row warn">
        <div class="daily-ic">🎯</div>
        <div class="daily-main">
          <b>费曼弱项：${esc(w.topicTitle)}（${w.score} 分）</b>
          <p>上次复述被批出漏洞，今天再讲一遍试试。</p>
        </div>
        <div class="daily-acts"><button class="btn btn-ghost btn-sm" data-fy-topic="${w.topicId}">重新费曼</button></div>
      </div>`);
  }
  if ((d.upcoming || []).length && d.dueCount === 0) {
    parts.push(`
      <div class="daily-row ok">
        <div class="daily-ic">✅</div>
        <div class="daily-main"><b>没有到期卡片</b><p>下一张：${DUE_IN_LABEL(d.upcoming[0].dueIn)}。可以先攻上面的新知识点。</p></div>
      </div>`);
  }
  el.innerHTML = parts.join('');
}

async function refreshStudy() {
  await fetchDaily();
  renderDaily();
  renderFcStage();
}

function bindStudy() {
  study.fcBack = false;
  study.fcIdx = 0;
  refreshStudy();
}

/* 速学交互：一次绑定、事件委托（面板/卡片会反复重渲染） */
let studyDelegated = false;
function bindStudyOnce() {
  if (studyDelegated) return;
  studyDelegated = true;

  document.addEventListener('click', (e) => {
    if (state.tab !== 'study' || !state.record) return;
    const hit = (sel) => e.target.closest?.(sel);
    const panel = document.getElementById('panel');

    // 生成闪卡
    if (hit('[data-gen-fc]')) {
      if (study.busy) return;
      study.busy = true;
      runJob(
        api(`/api/analyses/${state.record.id}/flashcards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 12 }) }),
        '生成闪卡', ['把知识点做成问答卡'],
      )
        .then(async (res) => {
          state.record.flashcards = res.flashcards;
          study.fcIdx = 0;
          study.fcBack = false;
          renderPanel(); // 空态分支没有 #fc-stage 容器，整面板重渲染
          await refreshStudy();
        })
        .catch(() => {})
        .finally(() => { study.busy = false; });
      return;
    }

    // 翻卡
    if (hit('[data-flip]')) {
      study.fcBack = true;
      renderFcStage();
      return;
    }

    // 自评
    const gradeBtn = hit('[data-grade]');
    if (gradeBtn) {
      const stage = gradeBtn.closest('[data-fc]');
      const cardId = stage?.dataset.fc;
      if (!cardId) return;
      gradeBtn.disabled = true;
      api(`/api/analyses/${state.record.id}/flashcards/${cardId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: Number(gradeBtn.dataset.grade) }),
      })
        .then(() => {
          const card = study.daily?.due?.[study.fcIdx];
          const g = Number(gradeBtn.dataset.grade);
          if (card) card.stage = g === 0 ? 0 : Math.min((card.stage || 0) + (g >= 2 ? 2 : 1), 4);
          study.fcIdx += 1;
          study.fcBack = false;
          renderFcStage();
          fetchDaily().then(renderDaily);
        })
        .catch((err) => {
          gradeBtn.disabled = false;
          toast(err.message || '提交失败');
        });
      return;
    }

    // 生成速览卡
    if (hit('[data-gen-qc]')) {
      const topicId = panel?.querySelector('#qc-topic')?.value;
      if (!topicId) return;
      study.qcTopic = topicId;
      runJob(
        api(`/api/analyses/${state.record.id}/quickcard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId }) }),
        '生成速览卡', ['5 分钟速览卡'],
      )
        .then((res) => {
          state.record.quickCards = res.quickCards;
          const list = panel.querySelector('#qc-list');
          const existing = list.querySelector(`[data-qc="${topicId}"]`);
          const html = quickCardHtml(res.card);
          if (existing) existing.outerHTML = html;
          else list.insertAdjacentHTML('afterbegin', html);
          list.querySelector(`[data-qc="${topicId}"]`)?.setAttribute('open', '');
          refreshStudy();
        })
        .catch(() => {});
      return;
    }

    // 费曼检验
    if (hit('[data-feynman]')) {
      const topicId = panel?.querySelector('#fy-topic')?.value;
      const explanation = panel?.querySelector('#fy-text')?.value.trim();
      if (!topicId) return;
      if (!explanation || explanation.length < 10) return toast('复述太短了，多写几句再提交');
      study.fyTopic = topicId;
      runJob(
        api(`/api/analyses/${state.record.id}/feynman`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, explanation }) }),
        '费曼批改', ['面试官批改中'],
      )
        .then((res) => {
          state.record.feynman = res.feynman;
          const ta = panel.querySelector('#fy-text');
          if (ta) ta.value = '';
          const list = panel.querySelector('#fy-list');
          list.insertAdjacentHTML('afterbegin', feynmanHtml(res.grade));
          list.firstElementChild.setAttribute('open', '');
          refreshStudy();
        })
        .catch(() => {});
      return;
    }

    // 每日速学行内按钮
    const qcJump = hit('[data-qc-topic]');
    if (qcJump) {
      study.qcTopic = qcJump.dataset.qcTopic;
      const sel = panel?.querySelector('#qc-topic');
      if (sel) sel.value = study.qcTopic;
      sel?.closest('.study-block').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const fyJump = hit('[data-fy-topic]');
    if (fyJump) {
      study.fyTopic = fyJump.dataset.fyTopic;
      const sel = panel?.querySelector('#fy-topic');
      if (sel) sel.value = study.fyTopic;
      sel?.closest('.study-block').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const matJump = hit('[data-mat-topic]');
    if (matJump) {
      generateMaterials(false, [matJump.dataset.matTopic]);
    }
  });
}
bindStudyOnce();
