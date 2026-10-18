/* Interview Forge — 前端（零依赖，原生 JS） */

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
  const res = await fetch(path, opts);
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
  const newBtn = state.record ? `<a class="btn btn-ghost btn-sm" href="#/">新建分析</a>` : '';
  $topRight.innerHTML = `${modelPill}${newBtn}`;
}

/* ---------------- 首页 ---------------- */

function renderHome() {
  state.record = null;
  renderTopbar();
  const notReady = state.health && !state.health.ready;

  $app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Interview Forge</div>
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
          <label for="role">目标岗位</label>
          <input class="input" id="role" name="targetRole" placeholder="例如：AI 应用开发工程师 / 高级后端 / 产品经理" maxlength="60" />
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

        <div class="upload-actions">
          <button class="btn btn-brand btn-lg btn-block" id="submit-btn" type="submit">生成知识点与复习方案</button>
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

  document.getElementById('sample-btn').addEventListener('click', async () => {
    try {
      const { text } = await api('/api/sample');
      document.querySelector('.mode-switch button[data-mode="text"]').click();
      document.getElementById('resume-text').value = text;
      if (!document.getElementById('role').value) document.getElementById('role').value = 'AI 应用开发工程师';
      toast('已填入示例简历，可以直接生成');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.getElementById('upload-form').addEventListener('submit', submitAnalyze);
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
}

async function submitAnalyze(e) {
  e.preventDefault();
  if (state.submitting) return;
  if (state.health && !state.health.ready) {
    toast('服务端还没有配置 LLM_API_KEY，请先配置或用 npm run demo 启动', 'err');
    return;
  }

  const role = (document.getElementById('role')?.value || '').trim();
  const level = document.getElementById('level')?.value || '';
  const form = new FormData();
  form.append('targetRole', role);
  form.append('level', level);

  if (state.mode === 'text') {
    const text = (document.getElementById('resume-text')?.value || '').trim();
    if (text.length < 40) return toast('简历内容太短，至少 40 字', 'err');
    form.append('text', text);
  } else {
    if (!state.file) return toast('请先选择简历文件', 'err');
    form.append('resume', state.file);
  }

  state.submitting = true;
  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '分析中…';
  }

  try {
    const result = await runJob(
      api('/api/analyze', { method: 'POST', body: form }),
      '正在读懂你的简历',
      ['读懂简历：拆解经历与技能', '推导知识点：按岗位重要性排序'],
    );
    state.selected = new Set((result.topics || []).map((t) => t.id));
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
  { key: 'topics', label: '知识点' },
  { key: 'materials', label: '复习资料' },
  { key: 'quiz', label: '测验' },
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
    if (state.pendingMaterial) state.materialId = state.pendingMaterial;
    state.tab = defaultTab(record);
    if (state.pendingTab && TABS.some((t) => t.key === state.pendingTab)) state.tab = state.pendingTab;
    state.pendingTab = null;
    state.pendingMaterial = null;
    renderWorkspace();
  } catch (err) {
    toast(err.message, 'err');
    location.hash = '#/';
  }
}

function defaultTab(record) {
  if (record.plan) return 'plan';
  if (record.attempts?.length) return 'review';
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
  if (key === 'materials') return (r.materials || []).filter((m) => !m.error).length;
  if (key === 'quiz') return (r.quizzes || []).length;
  if (key === 'review') return (r.attempts || []).length;
  return 0;
}

function renderPanel() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  const fn = {
    profile: panelProfile,
    topics: panelTopics,
    materials: panelMaterials,
    quiz: panelQuiz,
    review: panelReview,
    plan: panelPlan,
  }[state.tab];
  panel.innerHTML = fn ? fn() : '';
  panel.style.animation = 'none';
  void panel.offsetWidth;
  panel.style.animation = '';
  if (state.tab === 'profile') bindProfile();
  if (state.tab === 'topics') bindTopics();
  if (state.tab === 'materials') bindMaterials();
  if (state.tab === 'quiz') bindQuiz();
  if (state.tab === 'review') bindReview();
  if (state.tab === 'plan') bindPlan();
}

/* ---------- 画像 ---------- */

function panelProfile() {
  const r = state.record;
  const p = r.profile || {};
  const c = p.candidate || {};
  const skills = p.skills || [];

  return `
    <div class="card summary-card">
      <div class="title-sm">人物画像</div>
      <p>${esc(p.summary || '暂无画像')}</p>
      <div class="chips" style="margin-top:14px">
        ${c.education ? `<span class="chip">${esc(c.education)}</span>` : ''}
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
  `;
}

function bindProfile() {}

/* ---------- 知识点 ---------- */

function panelTopics() {
  const r = state.record;
  const groups = r.groups || [];
  if (!groups.length) return emptyState('还没有知识点', '重新分析一次试试', '重新分析', 'home');

  return `
    ${groups.map((g) => `<div class="card group-card">
      <div class="group-head">
        <div>
          <h3>${esc(g.name)}</h3>
          ${g.why ? `<p>${esc(g.why)}</p>` : ''}
        </div>
        <span class="chip" style="margin-left:auto;flex:none;font-size:11px">${g.topics.length} 个</span>
      </div>
      ${g.topics.map((t) => topicRow(t)).join('')}
    </div>`).join('')}

    <div class="action-bar">
      <span class="info">已选 <b id="sel-count">${state.selected.size}</b> / ${(r.topics || []).length} 个知识点</span>
      <button class="btn btn-quiet btn-sm" id="toggle-all">全选 / 反选</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="quiz-btn">生成测验</button>
      <button class="btn btn-brand btn-sm" id="material-btn">生成复习资料</button>
    </div>
  `;
}

function topicRow(t) {
  const on = state.selected.has(t.id);
  return `<div class="topic" data-id="${esc(t.id)}">
    <button class="checkbox ${on ? 'on' : ''}" data-check="${esc(t.id)}" aria-label="选择">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
    <div class="topic-main">
      <div class="topic-title">${esc(t.title)}</div>
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
        <summary style="font-size:12px;color:var(--brand-deep);cursor:pointer">面试官关注点与追问</summary>
        <div class="topic-more">
          ${t.interviewerFocus ? `<div><b>他在意什么：</b>${esc(t.interviewerFocus)}</div>` : ''}
          ${(t.followups || []).length ? `<div style="margin-top:6px"><b>可能追问：</b></div>${t.followups.map((f) => `<div class="fq">· ${esc(f)}</div>`).join('')}` : ''}
        </div>
      </details>` : ''}
      <div style="margin-top:8px">
        <button class="btn btn-quiet btn-sm" data-expand="${esc(t.id)}">✦ 围绕它拓展关联考点</button>
      </div>
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

  const toggle = document.getElementById('toggle-all');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const all = state.record.topics || [];
      const allOn = state.selected.size === all.length;
      state.selected = allOn ? new Set() : new Set(all.map((t) => t.id));
      renderPanel();
    });
  }

  const matBtn = document.getElementById('material-btn');
  if (matBtn) matBtn.addEventListener('click', generateMaterials);

  const quizBtn = document.getElementById('quiz-btn');
  if (quizBtn) quizBtn.addEventListener('click', generateQuiz);
}

/* ---------- 资料 ---------- */

function panelMaterials() {
  const r = state.record;
  const materials = (r.materials || []).filter((m) => !m.error);
  const missing = (r.topics || []).length - materials.length;

  if (!materials.length) {
    return emptyState(
      '还没有生成复习资料',
      '按知识点生成面试官视角的复习笔记：一句话本质、原理、答题框架、追问与坑。首次生成 8 个知识点约需 1~2 分钟。',
      '生成全部资料',
      'materials-all',
    );
  }

  const current = materials.find((m) => m.topicId === state.materialId) || materials[0];
  const groups = r.groups || [];

  return `
    <div class="mat-toolbar">
      <button class="btn btn-brand btn-sm" id="expand-current">✦ 拓展这个知识点的关联考点</button>
      <button class="btn btn-ghost btn-sm" id="print-btn">打印 / 存 PDF</button>
      <button class="btn btn-ghost btn-sm" id="export-md">导出全部 Markdown</button>
      ${missing > 0 ? `<button class="btn btn-ghost btn-sm" id="more-mat">继续生成剩余 ${missing} 个</button>` : ''}
    </div>
    <div class="material-layout">
      <nav class="material-nav">
        ${groups
          .map((g) => {
            const items = g.topics.filter((t) => materials.some((m) => m.topicId === t.id));
            if (!items.length) return '';
            return `<div class="nav-group">${esc(g.name)}</div>
              ${items
                .map((t) => {
                  const done = materials.find((m) => m.topicId === t.id);
                  return `<button class="nav-item ${done?.topicId === current.topicId ? 'on' : ''} done" data-mat="${esc(t.id)}">
                    <span class="dot"></span><span>${esc(t.title)}</span>
                  </button>`;
                })
                .join('')}`;
          })
          .join('')}
      </nav>
      <div class="material-body">${materialBody(current)}</div>
    </div>
  `;
}

function materialBody(m) {
  if (!m) return '';
  const fw = m.answerFramework || [];
  return `
    <div class="mat-head">
      <div class="chips" style="margin-bottom:10px">
        <span class="badge lv-${esc(m.level || '进阶')}">${esc(m.level || '')}</span>
        <span class="badge">${esc(m.group || '')}</span>
        ${m.gap ? '<span class="badge gap">简历缺口</span>' : ''}
      </div>
      <h2>${esc(m.topicTitle)}</h2>
      ${m.oneLine ? `<div class="one-line">${esc(m.oneLine)}</div>` : ''}
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
  `;
}

function bindMaterials() {
  on('[data-mat]', 'click', (e) => {
    state.materialId = e.currentTarget.dataset.mat;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', n.dataset.mat === state.materialId));
    const body = document.querySelector('.material-body');
    const m = (state.record.materials || []).find((x) => x.topicId === state.materialId);
    if (body) {
      body.innerHTML = materialBody(m);
      bindMaterials();
      body.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  on('.qa-q', 'click', (e) => e.currentTarget.closest('.qa').classList.toggle('open'));

  const more = document.getElementById('more-mat');
  if (more) more.addEventListener('click', () => generateMaterials(true));

  const expandCur = document.getElementById('expand-current');
  if (expandCur) expandCur.addEventListener('click', () => expandTopic(state.materialId));

  const printBtn = document.getElementById('print-btn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  const exportMd = document.getElementById('export-md');
  if (exportMd) exportMd.addEventListener('click', () => window.open(`/api/analyses/${state.record.id}/export.md`, '_blank'));
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
  if (a === 'quiz-new') generateQuiz();
  if (a === 'go-quiz') { state.tab = 'quiz'; renderWorkspace(); }
  if (a === 'plan-new') generatePlan();
  if (a === 'home') location.hash = '#/';
});

/* ---------------- 生成动作 ---------------- */

async function refreshRecord() {
  state.record = await api(`/api/analyses/${state.record.id}`);
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

async function generateMaterials(all = false) {
  const r = state.record;
  const generated = new Set((r.materials || []).filter((m) => !m.error).map((m) => m.topicId));
  let ids;
  if (all) ids = (r.topics || []).map((t) => t.id).filter((id) => !generated.has(id));
  else ids = [...state.selected].filter((id) => !generated.has(id));

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

  try {
    await runJob(
      api(`/api/analyses/${r.id}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: ids }),
      }),
      '正在写复习资料',
      ids.length > 1 ? [`逐个知识点生成（共 ${ids.length} 个）`, '整理答题框架与追问'] : ['生成复习资料'],
    );
    await refreshRecord();
    state.tab = 'materials';
    state.materialId = ids[0];
    renderWorkspace();
    toast('资料已生成');
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
