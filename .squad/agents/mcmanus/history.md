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
- 2026-05-23T17:05:16-07:00: Replaced GitHub App Device Flow auth with a fine-grained PAT input modal. All Device Flow code (client ID, device code polling, token refresh) removed from `js/auth.js`. New API: `signIn()` (returns Promise resolving to `{login}` or null), `signOut()`, `getToken()`, `isAuthenticated()`, `getValidToken()`, `getSession()`, `ready` (silent page-load validation promise).
- 2026-05-23T17:05:16-07:00: PAT modal is injected into DOM by `auth.js` on first `signIn()` call. Modal includes: explanation, link to github.com/settings/tokens?type=beta, required permissions note, password input, Sign in + Cancel buttons, inline error on 401/403. Token stored in `localStorage` as `ghd_token`, login as `ghd_login`.
- 2026-05-23T17:05:16-07:00: PAT tokens never expire so `getValidToken()` is a simple passthrough (no refresh logic needed). `getSession()` returns `{login, owner: login}` for backward compat with `_backgroundRefresh()` in `app.js`. The `ready` promise does a silent GET /user on page load and clears the stored token if it's invalid (401/403).
- 2026-05-23T17:05:16-07:00: `app.js` updated: removed all Device Flow refs (`authPanel`, `deviceCode`, `authDeviceLink`, `authStatus`, `cancelAuthBtn`, `_pollCancelled`); `_handleSignIn` now just `await Auth.signIn()` and handles result; `_setAuthUI` simplified (no 'signing-in' state); awaits `Auth.ready` before `isAuthenticated()` check on page load.
- 2026-05-23T03:38:13-07:00: Tokens are stored in `sessionStorage` only (`ghd.auth.session.v1`). Normalized private dashboard data goes in `localStorage` (`ghd.private.cache.v1`). Raw API responses are never cached. Cache soft-stale at 15 min, hard-stale at 24 hr.
- 2026-05-23T03:38:13-07:00: `app.js` always fetches `data/dashboard.json` first on every load; private data path runs after public render completes. All existing rendering functions are preserved unchanged.
- 2026-05-23T18:42:30-07:00: Light/dark theme implemented via `html[data-theme]` selector. `js/theme.js` runs immediately (no defer) to prevent FOUC. Theme preference stored in `localStorage('ghd_theme')`, falls back to `prefers-color-scheme`. Toggle exposed via `GHD.Theme.toggle()`.
- 2026-05-23T18:42:30-07:00: PWA support: manifest.json with SVG icon, sw.js with cache-first statics / network-first data, apple-mobile-web-app meta tags. Service worker registered from theme.js on load.
- 2026-05-23T18:42:30-07:00: Squad badge renders conditionally when `repo.squad_activity.squad_enabled` is truthy. Shows branch count if > 0. New `--squad` / `--squad-soft` CSS vars in both themes. `squadRepos` added to summary config and accumulator.

- 2026-05-24T15:30:34-07:00: Traffic badge added via `getTrafficViews()` in `fetch-data.js` using `/repos/{owner}/{repo}/traffic/views`. Returns null on 403/404/451 (no push access). `buildTrafficBadge()` in `app.js` shows 👁️ unique visitor count with tooltip; hidden entirely when `repo.traffic` is null — no "No data" fallback. Traffic is informational only, no needs-attention signal.
- 2026-05-24T15:30:34-07:00: Pattern confirmed: add new optional API calls to the `Promise.all` in `buildRepoRecord` and always provide `null` fallback in both the success record and the catch-block fallback. Badge functions should return `null` for absent data and be filtered out at the `buildStatusBadges` call site.

- 2026-05-24T15:30:34-07:00: License/README health badge (#16) added via `buildLicenseBadge()`. License SPDX comes from existing `repo.license.spdx_id` (zero extra API cost). README presence uses `checkHasReadme()` which calls `GET /repos/{owner}/{repo}/readme` with `allowStatuses:[404]` — returns `true`/`false`. Badge shows warning tone only for active non-fork repos missing either field. Both `license` and `has_readme` fields added to the success and fallback records in `buildRepoRecord`.
- 2026-05-24T15:30:34-07:00: Tag/release freshness (#17) covered by extending existing `getReleaseLabel()` to append relative age from `latest_published_at` (e.g. `v1.2.3 · 4 commits ahead · 3 weeks ago`). No new badge created — genuinely additive to existing release badge with zero new API calls.

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
