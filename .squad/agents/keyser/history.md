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

## Learnings (2026-05-24 — Issue #15 Discussion activity)

- Issue #15 (Show discussion activity per repo): Used Option A — `has_discussions` is available on the REST API repo object (already fetched), no additional API calls or GraphQL needed. Added `discussions_enabled: repo.has_discussions === true` to the data pipeline output and `buildDiscussionsBadge` in the frontend. Badge shows `💬 Discussions` with neutral tone when discussions are enabled. Approach is zero-cost in terms of API rate limits.


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

## Learnings (2026-05-24 — PRs #18–#26 batch merge)

- Sequential PR merges into main accumulate conflicts in `scripts/fetch-data.js` and `js/app.js` — each merge must keep ALL prior additions or later PRs break. Promise.all destructuring grows by one entry per feature PR; track carefully.
- When a PR branch uses `getTrafficViews` (flat shape) but the Copilot fix requires both views and clones, restructure to `getTrafficData` returning `{ views: { count, uniques }, clones: { count, uniques } }` — the frontend badge must be updated to match.
- `allowStatuses: [404]` on `checkHasReadme` should also include `409` (Conflict — repo is empty); caught via Copilot inline review.
- CSS `.badge.danger` (red) cannot use `--danger` CSS variable since that's orange in this theme; use hardcoded `rgba(239,68,68,…)` / `#fca5a5` / `#dc2626` instead.
- When merging PRs that touch the same branch-level history docs, git can auto-merge them cleanly (no conflict) — only `fetch-data.js` and `app.js` reliably conflict.
- `github-client.js` (browser client) and `scripts/fetch-data.js` (server pipeline) must stay in structural parity: after merging new fields server-side, immediately add matching stubs client-side.
- All 9 PRs (#18–#26) merged into main in order. PRs auto-closed on GitHub upon merge.

## Learnings (2026-06-27 — Vibe-Coding Kanban Proposal)

- Drafted a "What should I work on next?" proposal: auto-derived Kanban lanes (Blocked → Needs Review → Working → Release Ready → Up-to-Date) from existing dashboard signals, priority scoring heuristic for 30-min work slots, and phased rollout. Discussion only, no code. Proposal at `.squad/decisions/inbox/keyser-vibe-kanban-proposal.md`.
- Key insight: zero new API calls needed — all lane logic derivable from data already fetched (workflow_status, security_alerts, pending_reviews, pushed_at, release_overdue).
- Integrated a "Backlog (3-month stale)" concept into the vibe-coding Kanban proposal: repos pushed >14d and ≤90d ago render as a separate strip below the 4-lane board, pulled out of Healthy. Discussion/proposal only — no code. See `.squad/decisions/inbox/keyser-vibe-backlog.md`.

## Learnings (2026-06-27 — Phase 1 Kanban Review, issue #43)

- Reviewed McManus's Phase 1 kanban-strip implementation. APPROVED. Lane derivation is correct, deterministic, testable, and matches the agreed P005 4-lane model.
- Key finding: `workflow_status` and `security_alerts` are never fetched in ANY code path (auth or public) in `github-client.js` — Blocked lane is empty for everyone, not just public viewers. Accepted as-is for Phase 1; follow-up pipeline issue needed for Fenster.
- Good test pattern: all 18 tests use injected `now` parameter for deterministic time assertions without mocking `Date.now()`.

## Learnings (2026-06-27 — Issue #47 Blocked Lane Data Review)

- Reviewed Fenster's #47 implementation (blocked-lane data pipeline). APPROVED. Shape match confirmed: `_parseWorkflowRun` and `_parseSecurityAlerts` output exactly matches what `deriveKanbanLane` reads. Graceful degradation via `_fetchJsonSoft`/`_paginateSoft` is solid — 403/404/missing scope → safe zeros, no thrown errors. +2 API calls per repo is acceptable cost.
- PAT scope ruling: silent-zero degradation is correct behavior when `security_events` scope is missing. Recommended a non-blocking README note documenting the scope requirement for full Blocked-lane functionality.

## Learnings (2026-06-28 — Issue #44 Backlog Strip Review)

- Reviewed McManus's Phase 1.5 Backlog strip implementation. **APPROVED.** All seven ratified requirements satisfied: boundary math exact (strictly >14d, ≤120d), Blocked/Needs-Attention guard clauses run before age check, no double-counting in grid/Kanban/strip, collapsed by default, zero new API calls, null-date safe exclusion.
- **Drift risk flagged (non-blocking):** `CI_FAILING` set and `WORKING_WINDOW_MS = 14d` are duplicated verbatim between `kanban-strip.js` and `backlog-strip.js`. `isBacklogRepo` re-implements Blocked/Needs-Attention checks rather than calling `deriveKanbanLane`. Values are identical today but could diverge if CI conclusions expand. Recommend extracting a shared `GHD.KanbanConstants` module if `CI_FAILING` ever changes.
- **No-double-count pattern confirmed:** `backlogSet` is excluded from `pinnedRepos`, `normalRepos`, AND the `renderKanbanStrip` input in one consistent pass in `renderRepos()`. Any future strip feature should follow this same three-exclusion pattern.
- **UX edge case noted:** Pinned repos aging into the 15–120d window silently disappear from the card grid into the collapsed backlog strip. Technically correct per P006 but worth a future UX decision on pin-vs-backlog interaction.

## Learnings (2026-06-28 — Issue #42 Phase 2 Decomposition)

- Decomposed Phase 2 into 3 sub-issues (#55, #56, #57). Key split rationale: scoring algorithm + revival UI are inseparable (ship together), but chips/drill-down and snooze are independently shippable.
- Snooze logic is testable without chips UI (pure localStorage expiry math), but the snooze *affordance* (button) lives on chips — soft dependency, not blocking.
- Added `squad:keyser` label to #57 (scoring algorithm) for architecture review of the heuristic before implementation. Pattern: label yourself on issues requiring design sign-off, not just implementation.