# Squad Decisions

## Active Decisions

### D001: PRD Draft — Static-Site Architecture (Keyser, 2026-05-23)
Draft the PRD around a static-site architecture with GitHub Actions generating a JSON data artifact for a GitHub Pages dashboard. Defaults: top 10 recent public repos, exclude archived/forks, daily refresh, vanilla HTML/CSS/JS.

### D002: PRD Reusable Template Shift (Keyser, 2026-05-23)
Revise the PRD so GitHubDashboard is a reusable template for any GitHub user, with the monitored account provided through `GITHUB_USERNAME` repository configuration instead of hardcoded usernames.

### D003: PRD Copilot Focus Shift (Keyser, 2026-05-23)
Revise the PRD so GitHubDashboard is primarily a cross-repository dashboard for developers using GitHub Copilot to manage many active projects. Surface release readiness, Copilot activity heuristics, priority issues, and pending reviews.

### D004: Phase 1 Pipeline Delivery (Fenster, 2026-05-23)
Ship Phase 1 as a single GitHub Actions workflow that refreshes `data/dashboard.json`, commits generated data back to repository, and stages GitHub Pages artifact from repo static assets plus generated data file. Include temporary deployment-only `index.html` fallback.

### D005: Dashboard UI Asset Contract (McManus, 2026-05-23)
Ship the dashboard UI as a plain static asset bundle (`index.html`, `css/style.css`, `js/app.js`) with `data/dashboard.json` as the only runtime data dependency. Client-side rendering, framework-free, GitHub Pages compatible.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

## 2026-06 Testing Consolidation Decisions

### D006: Canonical Test Directory And Node Vitest Lane (McManus, 2026-06-01)
Use `test/` as the single canonical Vitest directory for default local and CI runtime, with `vitest.config.js` targeting `test/**/*.test.js` under `environment: 'node'`.

### D007: Minimal Default Test Command Contract (McManus, 2026-06-01)
Keep `npm test` mapped to `vitest run` as the strict default lane and avoid requiring `jsdom` in the baseline path.

### D008: CI Watches Canonical Test Inputs (Fenster, 2026-06-01)
Align `ci-tests.yml` to monitor canonical test inputs (`test/**`, `vitest.config.js`, `package*.json`) as well as source paths that tests exercise (`js/**`, `css/**`, `scripts/**`, `data/**`, `index.html`, `manifest.json`, `sw.js`) and the workflow file itself, then execute `npm test` directly to enforce failures.

### D009: CI Test Workflow Separation From Pages Deployment (Fenster, 2026-06-01)
Run tests in dedicated `ci-tests.yml` instead of embedding test execution into `update-dashboard.yml`, preserving clean branch-aware validation and deployment behavior.
