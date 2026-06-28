# Fenster — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** GitHub Actions, GitHub REST API, GitHub Pages
- **Goal:** Automated data pipeline that fetches repo info and deploys the dashboard

## Learnings

- Built Phase 1 as a single GitHub Actions workflow that refreshes `data/dashboard.json`, commits the generated file, and deploys a Pages artifact in the same run.
- Kept the pipeline reusable by reading the monitored account from `vars.GITHUB_USERNAME` and relying on the built-in `GITHUB_TOKEN` for API access.
- Added a deployment-only placeholder `index.html` fallback in the workflow so Pages remains publishable before frontend assets land.

## Team Coordination (2026-05-23T09:22:49Z)

Scribe consolidated team deliverables:
- **Keyser (Lead):** PRD finalized and approved — Copilot focus + reusability + static architecture locked
- **McManus (Frontend):** Dashboard UI complete — static bundle, GitHub Pages-friendly, framework-free rendering
- **Hockney (Tester):** Test plan created — 148 test cases covering pipeline, UI, deployment, configuration

All decisions (D001-D005) merged into `.squad/decisions.md`. Orchestration logs created for handoff tracking.

## Learnings (2026-05-23 Squad Detection)

- Mirrored the Copilot detection pattern (branch prefix, PR head ref, Contents API file check) to add Squad detection to both `scripts/fetch-data.js` (server pipeline) and `js/github-client.js` (browser pipeline).
- Squad signals: `squad-enabled` (team.md exists), `squad-branch` (squad/ prefix branches), `squad-open-pr` (PRs from squad/ branches), `squad-work-ready` (composite signal for next_steps).
- The browser `_fetchJson` already returns null on 404, making it a drop-in for the Contents API check without extra error handling.
- Both pipelines now emit `squad_activity` in the same shape, keeping the dashboard.json contract consistent for the frontend.

## Learnings (2026-05-24 Client-Only Architecture)

- Migrated from server-side data pipeline to pure client-side architecture per Jon's decision: `data/dashboard.json` is no longer served from GitHub Pages.
- Workflow simplified from two jobs (update-data + deploy) to two jobs (build + deploy) — removed schedule cron, `contents: write` permission, Node.js setup, validate step, and fetch step.
- `app.js` `init()` now checks PAT presence first; unauthenticated visitors see a clean "Connect your GitHub account" state instead of a 404 error.
- `_backgroundRefresh` failure with no cache now renders the connect state (not a silent `_setAuthUI('public')` that left the content area in an ambiguous skeleton state).
- `scripts/fetch-data.js` kept intact for local development; `data/` remains gitignored.
- README setup reduced from 5 config steps to 3 infrastructure steps + "sign in in the UI" — no repository variables needed.
- Decision written to `.squad/decisions/inbox/fenster-client-only-architecture.md`.

## Learnings (2026-06-01 CI Test Wiring)

- Added a dedicated `.github/workflows/ci-tests.yml` workflow instead of changing deploy flow, so GitHub Pages behavior in `update-dashboard.yml` remains isolated and predictable.
- CI tests now run on both `push` and `pull_request`, but only for code-relevant paths (`js/**`, `css/**`, `scripts/**`, top-level app entry files, and package manifests) to keep runtime fast.
- Used `actions/setup-node@v6` with npm cache and `npm ci --prefer-offline --no-audit` to keep cold-start and install time low.
- Test execution is `npm test --if-present`, which aligns with expected frontend test script adoption and avoids breaking CI before test scripts are introduced.

## Learnings (2026-06-27 Blocked-Lane Data Pipeline — Issue #47)

- **Endpoints used:**
  - `GET /repos/{owner}/{repo}/actions/runs?per_page=1` — fetches the single latest workflow run for CI status
  - `GET /repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100` — fetches all open Dependabot security alerts; paginates to collect full count

- **Data shape attached:**
  - `workflow_status: { has_workflows: bool, latest_run: { conclusion, status, html_url, name, run_started_at } | null }`
    - `has_workflows: false, latest_run: null` when API returns 403/404, or when `workflow_runs` array is empty
  - `security_alerts: { total: int, critical: int, high: int, medium: int, low: int }`
    - All zeros when API returns 403/404 or when no open alerts exist

- **How `deriveKanbanLane` expectations were matched:** The function in `kanban-strip.js` checks `repo.workflow_status?.has_workflows === true` AND `CI_FAILING.has(repo.workflow_status?.latest_run?.conclusion)`. Empty runs deliberately set `has_workflows: false` so repos with no runs are not blocked. Security alerts use `security_alerts.total > 0`. Both shapes were derived from reading the existing lane-derivation logic — no UI changes needed.

- **Graceful-degradation behavior:** Two new soft helpers (`_fetchJsonSoft`, `_paginateSoft`) return `null`/`[]` on any non-OK response (403, 404, missing scope) without throwing. Both fetch functions (`_fetchWorkflowStatus`, `_fetchDependabotAlerts`) additionally wrap in try/catch. Public path is entirely unaffected (still hardcoded to defaults). Authenticated path silently zeroes out the fields when the user's PAT lacks `security_events` scope or the repo has no Actions enabled.

- **Architecture note:** Both fetchers run in the initial `Promise.all` in `_fetchRepoDetails` alongside issues/PRs/branches — parallel, no sequential overhead. Pure parse helpers (`_parseWorkflowRun`, `_parseSecurityAlerts`) are exported on `GHD.GitHubClient` for unit testing without needing to mock network calls.

- **Test result:** 109 tests pass (82 previous + 27 new in `test/blocked-lane-data.test.js`).

## Learnings (2026-06-01 CI Canonical Test System)

- Standardized CI trigger paths to the canonical Vitest test directory `test/**` and removed duplicate watcher coverage for `tests/**`.
- Standardized test config trigger coverage to `vitest.config.js` only, matching repository configuration.
- Switched CI execution from `npm test --if-present` to `npm test` now that the canonical test script exists in `package.json`, making failures visible instead of silently skipping test execution.

## Learnings (2026-06-28 PR #49 Review Fixes)

- **Un-awaited promise in soft helper:** `return response.json()` (without `await`) inside a try/catch does NOT catch JSON parse errors — the rejection escapes the catch block and propagates to the caller. Always `await` the parse inside try so malformed-JSON responses degrade to null as intended rather than bubbling into `Promise.all` as an unhandled rejection.
- `_paginateSoft` was already safe (used `const page = await response.json()` inside try); only `_fetchJsonSoft` needed fixing.
- **README PAT scope accuracy:** The classic `repo` scope grants write access — it is NOT read-only even if the dashboard only reads. Avoid describing it as "read-only"; instead, note the dashboard only performs reads but recommend fine-grained tokens for least-privilege users.

## Learnings (2026-06-27 PAT Scopes Documentation)

- Added "### PAT Scopes" subsection to README.md right after Quick Setup to document scope requirements for Blocked lane security alerts (`security_events` scope) and core features (`repo` scope), emphasizing graceful degradation when scopes are absent.
