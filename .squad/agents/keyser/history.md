# Keyser — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** HTML/CSS/JS static site, GitHub Actions, GitHub Pages, GitHub REST API
- **Repo:** https://github.com/jongalloway

## Learnings

- Drafted the product requirements document at `docs/PRD.md` for the GitHubDashboard project.
- Confirmed the preferred architecture is GitHub Actions generating a JSON data file consumed by a static HTML/CSS/JS dashboard on GitHub Pages.
- Captured a clean interface contract: workflow fetches GitHub API data for `jongalloway`, emits repo-level JSON, and the frontend renders the dashboard from that file.
- Recorded default product decisions for v1: 10 most recently updated public repos, daily refresh plus manual trigger, exclude archived repos, and exclude forks by default.
- Noted key coordination paths for future team work: `docs/PRD.md`, `.squad/agents/keyser/history.md`, and `.squad/decisions/inbox/keyser-prd-draft.md`.
- Revised the PRD to focus on developers managing many GitHub Copilot / Cloud Agent-assisted repositories rather than generic repo monitoring.
- Prioritized release readiness, Copilot activity detection, priority issues, and pending review queues as the core dashboard signals.
- Expanded the data contract to include `releases`, `copilot_activity`, `priority_issues`, and `pending_reviews`, while keeping the existing default scope decisions unchanged.
- Updated `docs/PRD.md` to remove person-specific references and rewrite the user stories and requirements in reusable user-centric language.
- Captured a new product constraint that the monitored GitHub account must come from repository configuration such as `GITHUB_USERNAME`, making the project template-friendly for any GitHub user.
- Analyzed Squad detection approaches for the dashboard. Recommended mirroring the existing Copilot detection pattern: check `.squad/team.md` via Contents API (1 call/repo) + filter for `squad/` branch prefix in already-fetched data. MVP is ~50 lines per pipeline file. Decision documented in `.squad/decisions/inbox/keyser-squad-detection.md`.

## Team Coordination (2026-05-23T09:22:49Z)

Scribe consolidated team deliverables:
- **Fenster (DevOps):** GitHub Actions pipeline complete — `update-dashboard.yml`, `scripts/fetch-data.js`, deployment ready
- **McManus (Frontend):** Dashboard UI complete — static bundle, GitHub Pages-friendly, framework-free rendering
- **Hockney (Tester):** Test plan created — 148 test cases covering pipeline, UI, deployment, configuration

All decisions (D001-D005) merged into `.squad/decisions.md`. Orchestration logs created for handoff tracking.

## Learnings (2026-05-24)

- Issue #10 (stale branches): GitHub `/branches` endpoint returns `name` + `commit.sha` but **no commit date**. Getting per-branch commit dates requires N+1 API calls — rejected as too expensive.
- Chose total non-default branch count as a zero-cost staleness proxy. Count > 5 triggers `many-branches` signal; badge tones at warning when > 10. Documented in `.squad/decisions/inbox/keyser-branch-staleness.md`.
- Pattern: always check whether needed data is already in a fetched array before designing a new API call. `getBranches()` returns the full list; filtering it is free.
- PR #22 opened for issue #10.

## Learnings (2026-05-24T15:30:34Z — Issue #12 Copilot agent/bot activity)

- The existing `copilot_activity` already captures copilot-agent PRs well: `getPullSource` checks `author.login.includes('copilot')`, which catches `copilot-swe-agent[bot]`. The gap was general `[bot]`-suffix authors not named 'copilot'.
- Added `isBotAuthor(login)` helper (checks `endsWith('[bot]')`) and `botPulls` computed from already-fetched `pulls` array — zero new API calls.
- Added `bot_pr_count` to `copilot_activity` and a `'bot-pr'` signal; `last_activity_at` now includes bot PR timestamps.
- Improved `getCopilotLabel()` output from verbose `'X branches · Y PRs · Z linked issues'` to readable `'Active (3 PRs)'` / `'No activity'`.
- Removed accidental double-counting of draft PRs in the old label logic (copilot_open_pr_count already includes drafts).
- PR #23 opened for issue #12.
