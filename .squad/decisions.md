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

### D010: Client-Only Architecture — Remove Server-Side Data Pipeline (Fenster, 2026-05-24)
Remove `data/dashboard.json` from GitHub Pages deployment entirely. Deploy only static app shell (HTML/CSS/JS/icons/manifest/sw.js). All dashboard data fetched client-side via browser GitHub API calls using stored Personal Access Token. Removes requirement to configure `DASHBOARD_OWNER` repository variable and removes daily scheduled workflow runs.

### D011: Squad Detection in Data Pipelines (Fenster, 2026-05-23)
Add Squad detection to both pipelines (server `scripts/fetch-data.js` and browser `js/github-client.js`) using `.squad/team.md` existence check plus branch/PR prefix filtering. Emit `squad_activity` object with same shape from both pipelines to keep dashboard.json contract uniform.

### D012: Branch Staleness Display Strategy (Keyser, 2026-05-24)
Use total non-default branch count as MVP proxy for staleness. No additional API calls. Signal threshold: `branch_count > 5` → `many-branches`. Badge tone: `count > 10` → `warning`, else `neutral`.

### D013: Copilot Agent/Bot Activity Tracking (Keyser, 2026-05-24)
Extend Copilot detection to include `[bot]`-suffix authors (Dependabot, Renovate, etc.). Add `isBotAuthor(login)` helper, compute `bot_pr_count`, add `bot-pr` signal. Improve label to show `'Active (3 PRs)'` / `'Active (2 branches)'`. Only count open PRs — merged/closed bot activity deferred.

### D014: Show Discussion Activity per Repo (Keyser, 2026-05-24)
Use `has_discussions` from existing REST repo object. No additional API calls required. Add `buildDiscussionsBadge(repo)` returning neutral badge when `discussions_enabled` is true. GraphQL option rejected — added complexity not justified for `value:low` feature.

### D015: PRs #18–#26 Batch Merge (Keyser, 2026-05-24)
Nine squad feature PRs merged into main in dependency order: CI workflow badge, Dependabot security badge, last commit activity badge, code scanning badge, branch count badge, bot PR detection, traffic views/clones, discussions enabled, license + README health badge. All conflicts resolved by keeping both sets of changes (additive merges).

### D016: Badge Tooltips Implementation (McManus, 2026-05-25)
Implement rich hover tooltips on all repo dashboard badges using CSS `[data-tooltip]::after` pseudo-element approach — no JavaScript required. `buildBadge()` signature extended with optional 4th tooltip parameter. Tooltips auto-adapt to user's theme. Multi-line supported via `white-space: pre-line`.

### D017: Light Mode, PWA, and Squad Badge UI (McManus, 2026-05-23)
Theme architecture: dark in `:root`, light overrides via `html[data-theme="light"]`. Flash prevention via `js/theme.js` in `<head>` with immediate `init()` IIFE. PWA using single SVG icon with `"sizes": "any"` and maskable purpose. Squad badge conditional on `squad_enabled` (unlike Copilot which always renders).

### D018: Replace Device Flow OAuth with PAT Modal Auth (McManus, 2026-05-23)
Replace GitHub App Device Flow with simple fine-grained Personal Access Token (PAT) modal input. Single owner use case — OAuth complexity unjustified. PAT persists in localStorage (`ghd_token`, `ghd_login`). Validation on page load via silent `GET /user` call. No expiry or owner mismatch checking.

### D019: Public Owner Detection & Unauthenticated Dashboard View (McManus, 2026-05-25)
Owner resolution priority: `config.json` `"owner"` field > GitHub Pages hostname detection > null (sign-in prompt). Skip branch-list API calls in public mode (save 1 per repo). Auth-only fields default to null/empty: `workflow_status`, `security_alerts`, `code_scanning`, `traffic`, `has_readme`. Non-draft PR filtering skipped.

### D020: Security Badge Design (McManus, 2026-05-24)
Hide security badge when total === 0 (avoids noise). Tone hierarchy: danger (red) for any critical, warning (yellow) for high without critical, neutral (grey) for medium/low only. List security alerts first in next_steps summary. No separate "scope required" UI affordance when API returns 403.

### D021: Minimal Default Test Command Contract (McManus, 2026-06-01)
Keep `npm test` mapped to `vitest run` as strict default lane. Scope to `test/**/*.test.js` with `environment: 'node'`. Avoid requiring `jsdom` in baseline path. Covers high-value unit tests (data heuristics, signal logic, auth, cache).

### D022: CI Watches Canonical Test Inputs (Fenster, 2026-06-01)
Align `ci-tests.yml` to monitor canonical test inputs (`test/**`, `vitest.config.js`, `package*.json`) as well as source paths tests exercise (`js/**`, `css/**`, `scripts/**`, `data/**`, `index.html`, `manifest.json`, `sw.js`) and workflow file itself, then execute `npm test` directly.

### D023: Workflow Badge Link Wrapping Strategy (McManus, 2026-05-24)
When `workflow_status.latest_run.html_url` present, CI badge wrapped in `<a>` tag (opens in new tab) rather than adding button/icon affordance. Consistent with GitHub's own badge behavior. Badge-link class resets anchor styling.
