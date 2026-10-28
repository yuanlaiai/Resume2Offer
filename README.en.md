<div align="center">

# Resume2Offer



**👉 [Live Demo (no API key needed, sample data built in)](https://resume2offer-demo.app.workbuddy.host/?sharecode=DPUZJPMNW4)**
**The answers were in your resume all along.**

Resume-driven AI interview coach — upload your resume → get the questions *you* will actually be asked → a full course per technology → interviewer-style study material → graded quizzes → a 7-day sprint plan.

English | [中文文档](README.md)

</div>

---

## What it is

Most "AI interview question banks" are generic: everyone drills the same 500 questions. Resume2Offer works the other way — it reads your resume the way a senior interviewer would, finds what you wrote that will be probed, what you *didn't* write but the role requires, and every number you'll be asked to justify. Then it turns that into a full prep pipeline:

- **Knowledge-point map** — 24-36 concrete exam points grouped by technology, cross-checked against your resume so nothing is silently dropped
- **A real course per technology** — 4 stages (basics → depth → practice on *your* projects → pressure interview), 20-24 chapters each, with per-chapter lessons you can generate on demand
- **Interviewer-style material** — answer frameworks, follow-up chains, traps to avoid, with optional live web search and cited sources
- **Mock interview** — an AI interviewer that asks one question at a time, digs into vague answers, and ends with a strict scorecard
- **Quiz → grade → plan** — graded attempts, per-question review, and a 7-day plan targeting your weak spots
- **Quick study** — spaced-repetition flashcards, 5-minute cheat sheets, Feynman checks, and a daily queue
- **Cancel anytime, survive a refresh** — long jobs run server-side, so reloading or closing the tab never kills them; the progress panel has a *Cancel* button that aborts the in-flight model call, and a reloaded page picks the same job back up automatically

Works for any role: engineering, algorithms, product, ops, marketing — the interviewer adapts its style.

## Quick start

```bash
git clone https://github.com/yuanlaiai/Resume2Offer.git
cd resume2offer && npm install
cp .env.example .env    # set LLM_API_KEY (any OpenAI-compatible API works)
npm start               # → http://localhost:8787
```

No key? `npm run demo` runs the whole flow on built-in sample data. The demo mode is **read-only and privacy-safe**: whatever visitors upload is never parsed or stored — everything is answered with a built-in, desensitized sample (fictional persona), nothing is written to disk, and deleting records is blocked.

## Tech stack

Deliberately light: **5 runtime dependencies, zero build step**.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 20 (pure ESM) | No TypeScript, no transpile |
| Backend | Express 4 + multer | Plain middleware, no framework magic |
| Resume parsing | pdf-parse + mammoth | Local PDF/DOCX text extraction |
| Frontend | Vanilla JS / CSS / SVG | SPA, no framework, no bundler, zero frontend deps |
| Storage | Single JSON file (`data/db.json`) | Atomic writes, throttled pre-write backups, self-healing on boot |
| LLM | Any OpenAI-compatible API | OpenAI / DeepSeek / Moonshot / Qwen / GLM / local Ollama |
| Web search (optional) | Tavily / Bocha / Brave / Serper / SearXNG / custom | Pluggable adapters, normalized results, graceful degradation |
| Voice input (optional) | Browser Web Speech API | Pure frontend, no third-party service |
| Test & CI | Self-contained test scripts + GitHub Actions | Offline suites + demo-mode end-to-end on Node 20 / 22 |
| Deploy | Docker / docker compose | HEALTHCHECK built in, data volume mount |

## Highlights

- **OpenAI-compatible LLM** — DeepSeek, OpenAI, Moonshot, Qwen, GLM, local Ollama, anything that speaks `/chat/completions`
- **Pluggable web search** (optional) — Tavily / Bocha / Brave / Serper / self-hosted SearXNG
- **Privacy-first** — data stays in one JSON file on your own machine; optional `ACCESS_TOKEN` for public deployments; automatic rotating backups
- **Token usage dashboard** built in
- Node ≥ 20, no database, no build step, 5 runtime dependencies

Full docs (in Chinese, with screenshots): **[README.md](README.md)**

## API surface (short version)

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze` | Upload resume → parse → knowledge points |
| `POST /api/analyses/:id/courses` | Generate course outlines |
| `POST /api/analyses/:id/courses/:cid/lessons` | Generate chapter lessons |
| `POST /api/analyses/:id/mock/start` / `turn` / `finish` | Mock interview + scorecard |
| `POST /api/analyses/:id/jd` | Compare resume against a pasted JD |
| `POST /api/analyses/:id/resume-review` | Interviewer-style resume rewrite suggestions |
| `GET /api/analyses/:id/export.md` | Export everything as Markdown |

## License

MIT
