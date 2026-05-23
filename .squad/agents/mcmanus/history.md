# McManus — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** HTML/CSS/JS static site, GitHub Pages
- **Goal:** Clean, responsive dashboard showing repo cards with status info

## Learnings

- 2026-05-23T02:22:49-07:00: Phase 2 UI ships as a GitHub Pages-friendly static bundle with `index.html`, `css/style.css`, `js/app.js`, and previewable sample data in `data/dashboard.json`.
- 2026-05-23T02:22:49-07:00: The dashboard sorts repos by `next_steps.status`, highlights Copilot-linked PRs separately, and treats the JSON data file as the only runtime dependency.
- 2026-05-23T03:38:13-07:00: Private auth system implemented via GitHub App Device Flow. Three new JS files: `js/auth.js` (session manager), `js/cache.js` (localStorage private cache), `js/github-client.js` (browser fetch pipeline). All use `window.GHD` namespace; IIFEs only — no ES modules.
- 2026-05-23T03:38:13-07:00: The browser-side GitHub fetch pipeline matches server heuristics (`scripts/fetch-data.js`) for release-overdue (>10 commits), issues-need-triage, copilot signals, and next_steps computation. Per-PR review state API calls are intentionally skipped in the browser path (conservative fallback: include all non-draft open PRs).
- 2026-05-23T03:38:13-07:00: The `CLIENT_ID` placeholder in `js/auth.js` must be replaced with a real GitHub App client ID before private mode works. The app logs a console warning if the placeholder value is still in place when auth is attempted.
- 2026-05-23T03:38:13-07:00: Tokens are stored in `sessionStorage` only (`ghd.auth.session.v1`). Normalized private dashboard data goes in `localStorage` (`ghd.private.cache.v1`). Raw API responses are never cached. Cache soft-stale at 15 min, hard-stale at 24 hr.
- 2026-05-23T03:38:13-07:00: `app.js` always fetches `data/dashboard.json` first on every load; private data path runs after public render completes. All existing rendering functions are preserved unchanged.

## Team Coordination (2026-05-23T09:22:49Z)

Scribe consolidated team deliverables:
- **Keyser (Lead):** PRD finalized and approved — Copilot focus + reusability + static architecture locked
- **Fenster (DevOps):** GitHub Actions pipeline complete — `update-dashboard.yml`, `scripts/fetch-data.js`, deployment ready
- **Hockney (Tester):** Test plan created — 148 test cases covering pipeline, UI, deployment, configuration

All decisions (D001-D005) merged into `.squad/decisions.md`. Orchestration logs created for handoff tracking.

## Team Coordination (2026-05-23T03:38:13-07:00)

Scribe session completed:
- **McManus + Hockney:** Auth implementation session — private mode via GitHub App Device Flow complete
  - Frontend: `js/auth.js`, `js/cache.js`, `js/github-client.js` — full browser-side fetch pipeline
  - Integration: `app.js`, `index.html`, `style.css` updated with auth UI and flow control
  - Testing: 98 additional test cases appended to `docs/test-plan.md`
  - Decisions: D006 (mcmanus-auth-implementation) logged with 5 implementation choices pending Keyser review
- **Scribe:** Merged 4 decision inbox items into `decisions.md`. Orchestration logs written for session handoff.
