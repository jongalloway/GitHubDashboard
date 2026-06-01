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

## Learnings (2026-06-01 CI Canonical Test System)

- Standardized CI trigger paths to the canonical Vitest test directory `test/**` and removed duplicate watcher coverage for `tests/**`.
- Standardized test config trigger coverage to `vitest.config.js` only, matching repository configuration.
- Switched CI execution from `npm test --if-present` to `npm test` now that the canonical test script exists in `package.json`, making failures visible instead of silently skipping test execution.
