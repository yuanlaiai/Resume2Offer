# Contributing to Resume2Offer

Thanks for considering a contribution! The project is intentionally small: **zero frontend framework, zero database, 5 runtime dependencies**. Please keep that spirit.

## Development setup

```bash
git clone https://github.com/yuanlaiai/Resume2Offer.git
cd resume2offer
npm install
cp .env.example .env   # fill in LLM_API_KEY (any OpenAI-compatible API)
npm run demo           # or: no-key demo mode with built-in sample data
npm start              # http://localhost:8787
```

## Ground rules

- **No new runtime dependencies** unless discussed first. The server is Express + multer + a few parsers; the frontend is vanilla ES modules.
- **All prompts live in `server/prompts.js`.** If you're changing model behavior, change it there — not inline in pipeline code.
- **Strict JSON contracts.** Model outputs are parsed with `chatJSON()` and normalized in `server/pipeline.js` (`normalizeXxx` functions). New fields must survive missing/invalid model output.
- **Data compatibility.** `data/db.json` is the whole store. Don't break records written by older versions — add load-time healing in `server/store.js` if needed (see `fixFileName`).
- **Tests are offline.** `npm test` must pass without any API key. Add pure-function tests to `scripts/coverage.mjs` / `scripts/filename.mjs` etc. when you touch parsing, coverage, or export logic.

## Workflow

1. Fork & create a branch: `feat/xxx` or `fix/xxx`.
2. Make your change, run `npm test`.
3. If the change affects a user-visible flow, verify it once with a real model locally and note it in the PR.
4. Update `README.md` (feature list + 更新日志) when behavior changes.
5. Open a PR using the template. Chinese or English both fine.

## Good first issues

Look for issues labeled `good first issue` — usually small UI or prompt improvements. If you want to take on something bigger (e.g. multi-user, vector store integration), open a proposal issue first.
