# McManus — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** HTML/CSS/JS static site, GitHub Pages
- **Goal:** Clean, responsive dashboard showing repo cards with status info

## Current Focus (Phase 1.5)

### Backlog Strip Implementation (2026-06-28)
- ✅ DELIVERED: `js/backlog-strip.js` with pure classifier `isBacklogRepo(repo, now)`
- ✅ Age window: > 14 days AND ≤ 120 days (uses `pushed_at`, falls back to `last_commit_date`)
- ✅ Exclusions: Blocked (CI failure + security alerts) and Needs Attention (pending reviews) repos never shown
- ✅ Grid-exclusion: backlog repos pulled entirely OUT of main card grid (no duplication with Healthy lane)
- ✅ Integration: `renderRepos()` computes `backlogSet` → filters from pinned/normal repos → passes to Kanban strip
- ✅ DOM: collapsed toggle header "📋 Backlog (N) ▸", chip row with age labels ("N weeks/months ago")
- ✅ Tests: 31 new unit tests covering boundaries, lane precedence, grid-exclusion dedup, date fallbacks
- ✅ Result: 151 passing initially; Hockney added 2 integration tests for gap #7 → 153 final
- 2026-05-24T15:30:34-07:00: Implemented Issue #8 — GitHub Actions workflow status badge. `getLatestWorkflowRun()` uses `allowStatuses: [403, 404, 451]` so private/Actions-disabled repos return null cleanly. Badge is omitted entirely when `has_workflows: false` (no badge-clutter for repos without CI).
- 2026-05-24T15:30:34-07:00: Workflow badge wraps in `<a>` tag when `html_url` is present so users can click through to the run directly. Used existing `buildBadge()` helper then wrapped in anchor — cleaner than building the anchor first and duplicating badge class logic.
- 2026-05-24T15:30:34-07:00: CI failure is added as a `ci-failing` signal (triggers `needs-attention`) and also surfaces in `summarizeNextSteps` as "CI is failing" at the top of the parts list — higher priority than release/review signals.

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

### Review Findings (D034, D035)
- **Keyser:** APPROVE + drift-risk note: `CI_FAILING` set and `WORKING_WINDOW_MS` duplicated from kanban-strip.js. Values currently consistent; follow-up: extract `GHD.KanbanConstants` if set expands.
- **Hockney:** Initial REJECT due to gap #7 (grid-exclusion dedup untested). Gap closed by Hockney with 2 new integration tests. Final: APPROVED.

## Key Learnings

- **Release Pressure Indicator (2026-06-28):** When building a second SVG bar component, mirror the recency-bar IIFE pattern exactly — same export block (`root.GHD.X = api; module.exports = api`), same `createSvgElement` helper, same wrapper/SVG/title/track/fill structure. This makes the component Vitest-testable without any changes to the test harness.
- **Tone bucket design:** For percent-based indicators, three equal-ish buckets (<33% good, 33–65% warning, ≥66% critical) with explicit `clamp(0, 100)` on the percent value provides clean testable boundaries and prevents overflows from high commit counts.
- **Graceful degradation pattern:** Pure model function returns `{ hasPressure: false }` (never throws) for any missing/invalid data. Builder checks `!model.hasPressure` and returns null. This keeps both the model and the DOM layer individually testable and safe in production.
- **Module-level flag reset discipline:** State flags like `_isExpanded` must be reset at the TOP of every render function, not only on the non-early-return path. Missing the reset on empty/early-return means stale state bleeds into the next render, requiring an extra click to recover expected behavior. Canonical fix: `_isExpanded = false` as the very first statement in `renderBacklogStrip`.
- **Chip URL hardening:** GitHub API repo objects carry both `url` (API endpoint, e.g. `https://api.github.com/repos/…`) and `html_url` (human-facing page). Never fall back to `repo.url` in UI links. Correct fallback chain: `html_url` → build from `full_name` → `'#'`. Always apply an http(s) guard (`/^https?:\/\//i.test(raw)`) and clamp anything else to `'#'` to prevent XSS via `javascript:` URIs. Extract this as a named helper (`_safeRepoUrl`) and export it for unit-testability without needing DOM/jsdom.

- Backlog strip is display-only in Phase 1.5 (no snooze/archive/localStorage); Phase 2 will add state persistence and Top Pick integration
- Classifier pure function pattern (`isBacklogRepo(repo, now)`) matches `deriveKanbanLane` for testability; `now` injection enables deterministic tests
- Grid-exclusion pattern: build exclusion set first, filter all downstream render paths (grid cards + Kanban lanes), no double-counting possible
- Constant duplication creates drift risk; recommend extracting shared constants to single source of truth for future maintenance

## Next Steps (Phase 2)

- Snooze (localStorage `ghd_snooze_{repo}` = ISO timestamp) + Archive (localStorage set)
- Collapse state persistence (localStorage `ghd_backlog_expanded`)
- Top Pick integration: suggest backlog revival when no Blocked/Needs Attention/Working repos exist
- Consider filtering pinned repos out of backlog to avoid silent grid removal (UX edge case from D034)

