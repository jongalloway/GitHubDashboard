# McManus — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** HTML/CSS/JS static site, GitHub Pages
- **Goal:** Clean, responsive dashboard showing repo cards with status info

## Learnings

- 2026-05-24T15:30:34-07:00: Code scanning badge (Issue #14) added via `getCodeScanningAlerts()` in `fetch-data.js` and `buildCodeScanBadge()` in `app.js`. The code-scanning API returns 403 for repos without CodeQL enabled — handled via `allowStatuses: [403, 404, 451, 422]` in `paginate()`. Severity priority for badge text: critical → error → high → total; tones: danger for critical/error, warning for high, neutral for medium/low. Signal `code-alerts` fires when `critical + high + error > 0`, pushing to needs-attention. Null-safe via `?? 0` / `|| 0` guards throughout.

- 2026-05-24T15:30:34-07:00: Activity badge (Issue #11) added to `buildStatusBadges` via new `buildActivityBadge(repo)` function. Returns null when `last_commit_date` is absent or unparseable — caller filters with `if (activityBadge)` pattern matching `buildSecurityBadge`. Compact time text (today/Nd ago/Nw ago/Nmo ago/Ny ago) is built inline rather than reusing `formatRelativeDate` (which only goes to weeks and returns verbose "N weeks ago" strings). Full ISO date shown as `title` tooltip via `formatAbsoluteDate`. Color tones: success ≤30d, neutral 31–90d, warning 91–365d, danger >365d.

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
