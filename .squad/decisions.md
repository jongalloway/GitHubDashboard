# Squad Decisions

## Active Decisions

### D024: Phase 1 Kanban Strip Lane Derivation (McManus, 2026-06-27)
**Issue:** #43 | **Branch:** `squad/43-kanban-strip` | **Status:** APPROVED

Implement `deriveKanbanLane()` pure function with deterministic lane precedence (top-down: Blocked > Needs Attention > Working > Healthy). Use `pushed_at` as primary date source (always available); fall back to `last_commit_date`. "Needs Attention" uses existing `pending_reviews.count` without Dependabot sub-filtering. 14-day boundary (`pushed_at <= now - 14 days` inclusive, millisecond precision). Closed repos excluded from lane counts. Function exported on `window.GHD.KanbanStrip` for testability; injects `now` parameter for determinism in tests.

**Accepted trade-off:** Blocked lane empty for public/unauthenticated users (pre-existing `workflow_status` and `security_alerts` data gap in pipeline — issue #47 filed for future pipeline work).

### D025: Phase 1 Kanban Strip Top Pick Bar — Read-Only Deep-Link (Jon Galloway / Keyser, 2026-06-27)
**Issue:** #43 | **PR:** #48 | **Status:** APPROVED

Top Pick surfaces Dependabot-merged deep-link to `https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot`. Zero write-scope risk in Phase 1. Bar hidden when no Dependabot PRs detected. Single URL works for any authenticated user. Unauthed users redirected to GitHub sign-in (acceptable). Phase 2+ may add one-click merge if user upgrades to `pull_requests: write` PAT scope.

### D026: Phase 1 Kanban Strip UI & Theme (McManus, 2026-06-27)
**Issue:** #43 | **Status:** APPROVED

Lane buttons: "Needs Attention" amber (`--squad` token, #f59e0b dark / #92400e light). Dark + light theme support via existing tokens. Mobile responsive: ≤640px collapses lane labels. Lane filter interaction: clicking button dims non-matching cards (opacity 0.3); class `.kanban-dimmed` preserves layout. Card repo identification via `data-repo` attribute matched against `data-kanban-lane`. CSS.escape() applied defensively (low risk, no user input).

### D027: Phase 1 Kanban Strip Test Coverage (Hockney, 2026-06-27)
**Issue:** #43 | **Status:** APPROVED

All four lanes reachable in unit tests: Blocked (CI + security), Needs Attention, Working, Healthy. Top-down precedence validated (4-way chain). 14-day boundary tested (14d → working, 14d+1ms → healthy). Edge cases: null date fallbacks, empty repo, `now` injection determinism. Three minor untested paths accepted for Phase 1 (negligible production risk): `has_workflows: true` + no runs; non-failing CI conclusions; invalid date strings. DOM rendering tests (zero coverage) deferred to Phase 2 (requires jsdom). **Result:** 68/68 tests pass, no regressions.

### D028: Phase 1 Kanban Strip — Blocked-Lane Data Gap Ruling (Keyser, 2026-06-27)
**Issue:** #43 | **Follow-up:** #47 | **Status:** APPROVED / ACCEPT AS-IS

**Finding:** `workflow_status` and `security_alerts` hardcoded to empty defaults in ALL paths (authenticated + public). Pipeline comment labels these "Auth-only fields" but fetch logic never implemented in either branch.

**Consequence:** Blocked lane always empty for ALL users today, not just public.

**Ruling:** ACCEPT AS-IS for Phase 1 shipment. Lane-derivation logic is correct — when pipeline populates these fields (future work), Blocked lane will activate automatically without kanban-strip changes. Primary Phase 1 value is Working/Needs Attention/Healthy triage, which works today. Code flagged with `DATA GAP` comments.

**Fix belongs in data pipeline** (`github-client.js`), not UI. Filed issue #47 (Fenster: implement `workflow_status` + `security_alerts` fetching in authenticated path).

### D029: PR #48 Phase 1 Review Fixes — Code Quality Polish (McManus, 2026-06-27)
**PR:** #48 | **Status:** APPROVED / MERGED

Three refinements applied to Phase 1 Kanban strip (code-review comments post-approval; no correctness issues):

1. **Reuse `closed` set in `renderRepos()`:** Cache `const closed = getClosedRepos()` once, reuse for Kanban filter instead of re-parsing localStorage on every render.
2. **Single source of truth for Top Pick URL:** Consume `topPick.url` from `_findTopPick()` result in render, eliminate duplicate URL string literal.
3. **Export `_isDependabotPR` and `_findTopPick`:** Added to `GHD.KanbanStrip` exports for testability; 14 new unit tests added (68 → 82 tests passing). Tests explicitly validate `url` return value (ties decision #2).

No behavior changes. Tests: 68 → 82 passing (all green).

### D030: Blocked-Lane Data Pipeline — Workflow Status + Security Alerts (Fenster, 2026-06-27)
**Issue:** #47 | **Branch:** `squad/47-blocked-lane-data` | **Status:** APPROVED  
**PR:** #49 (Closes #47) | **Reviewed by:** Keyser | **Tested by:** Hockney

Implement `workflow_status` and `security_alerts` fetching in the **authenticated (PAT) browser path** of `js/github-client.js` so the Kanban Blocked lane activates for repos with failing CI or open Dependabot security alerts.

**Endpoint choices:**
- Workflow status: `GET /repos/{owner}/{repo}/actions/runs?per_page=1` — single call returning latest run conclusion across all workflows; minimal signal for Blocked lane check.
- Security alerts: `GET /repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100` — Dependabot severity maps cleanly to four buckets (`critical`, `high`, `medium`, `low`).

**Degradation:** Any non-OK response (403, 404, 422, missing scope) returns `has_workflows: false` / `total: 0` silently — no console errors, no UI artifacts. Consistent with D019 (auth-only fields default to empty).

**Architecture:**
- Pure parse helpers (`_parseWorkflowRun`, `_parseSecurityAlerts`) exported on `GHD.GitHubClient` for testability.
- Soft HTTP helpers (`_fetchJsonSoft`, `_paginateSoft`) added as graceful degradation layer.
- Parallel execution in existing `Promise.all` (+2 API calls per repo, reuses concurrency limiter).
- Public path (`_fetchRepoDetailsPublic`) unchanged — stays zeroed per D028 ruling.

**PAT Scope caveat:** Silent-zero is acceptable for Blocked lane. When PAT lacks `security_events` scope, dashboard works correctly with fewer blocking signals. Informational note in README recommended (non-blocking for merge).

**Test coverage:** 27 new tests covering parser edge cases, all four blocking conclusions, non-blocking conclusions (`cancelled`, `neutral`, `skipped`), severity counting with fallbacks, case-insensitive matching, and full integration tests including 403/404 degradation. 120 total tests passing, no regressions.

### D031: Issue #47 Test Coverage Gaps — Identification and Closure (Hockney, 2026-06-27)
**Issue:** #47 | **Branch:** `squad/47-blocked-lane-data` | **Status:** REJECT → CLOSED

**Initial rejection identified four coverage gaps:**
1. Multi-repo isolation NOT tested (CRITICAL) — `_runWithConcurrency` + `filter(Boolean)` path never exercised with multiple repos where one fails.
2. Network exception path (`_fetchJsonSoft`/`_paginateSoft` catch branch) NOT tested — all degradation tests used HTTP 403/404, never actual thrown exceptions.
3. Non-blocking conclusions (`cancelled`, `neutral`, `skipped`) NOT asserted — only `success` and `in-progress/null` tested as non-blocking.
4. `_paginateSoft` pagination (Link-header multi-page) NOT tested — no verification of multi-page accumulation or pagination error handling.

**All four gaps closed:** 11 new tests added covering:
- Multi-repo isolation (2 tests): 403 on one repo while others succeed; hard fetch exception on one repo triggers outer catch + fallback.
- Network exceptions (3 tests): `TypeError`, `AbortError` on first/subsequent fetch attempts.
- Non-blocking conclusions (3 tests): `cancelled`, `neutral`, `skipped` each confirmed non-blocking.
- Pagination (3 tests): 2-page Link-header accumulation; mid-pagination 403 stops cleanly; mid-pagination network throw swallowed.

**Final result:** 120 tests passing (was 109), no production defects, all regressions addressed. Rejection resolved.

## Proposals / Under Discussion

### P001: "What Should I Work On Next?" — Vibe-Coding Kanban Lanes (Keyser, 2026-06-27)
**Status:** Proposal (under discussion)  
**Requested by:** Jon Galloway

Add a compact Kanban lane header + priority-ranked "next action" recommendation to help a developer with many active vibe-coded projects glance at the dashboard and immediately know: (1) which project needs attention, (2) what the right-sized task is for a free 30-minute slot.

**Five auto-derived lanes** (no new API calls needed, all data exists in existing signals):
- 🚨 **Blocked:** CI failing OR critical/high security alerts
- 👀 **Needs Review:** Open PRs awaiting human review (including bot PRs)
- 🔧 **Working:** Recent activity within 7 days AND no blocking signals
- 📦 **Release Ready:** 10+ commits since last release AND not blocked
- ✅ **Up-to-Date:** None of the above — healthy, no action needed

**Priority scoring heuristic** (higher = do first): Critical security (+50), CI failing (+40), Bot PRs ready (+30), Human PRs awaiting review (+25), Release overdue (+15), Priority issues (+10), Copilot PRs ready (+20).

**Effort buckets:** ⚡ Quick win (< 5 min), 🔨 Focused work (15-30 min), 🏗️ Deep work (> 30 min).

**State overrides:** Pin (existing), Close (existing), Snooze N days (new localStorage), Manual lane override (new localStorage), Notes (existing), Release N/A (existing).

**Phased rollout:** Phase 1 = Kanban header + "Suggested Next" banner + effort badges + snooze button. Phase 2 = drill-down actions + lane override UI + sort-by-priority. Phase 3 = Gist-backed sync + historical trends + keyboard shortcuts.

**Key insight:** UI/UX reorganization of existing signals into actionable priority queue. Zero new API calls for Phase 1. Engineering work: ~50 lines scoring logic + ~100 lines Kanban component.

**Open questions:** Lane count optimal? Stale threshold (30 vs 14 days)? Effort buckets useful? Include all repos or just active 10? Inline "Merge All Dependabot" button or just deep-links?

**Risks:** localStorage loss on cache clear (Phase 3 mitigation: export/import), scoring weights feeling wrong (make configurable), stale lane overrides (prune on refresh).

---

### P002: UX Proposal — Vibe-Coding Glance-and-Go Kanban Board (McManus, 2026-06-27)
**Status:** Proposal (under discussion)  
**Requested by:** Jon Galloway  
**Needs Keyser review for:** lane state persistence contract, write-action PAT scope requirements

Add a compact 5-lane Kanban header board above existing repo-card grid. Lanes map to already-computed `next_steps.status` signals. No new API calls needed. State overrides (pin, snooze, manual lane move) persist in `localStorage` only.

**Lane mapping:**
| Lane | Signal Source | Color |
|------|--------------|-------|
| Blocked | `needs-attention` + critical security / CI failing | Red `--danger` |
| Needs Attention | `needs-attention` (non-critical) | Amber `--warning` |
| In Progress | `active` + commit in last 14d | Blue `--info` |
| Up-To-Date | `quiet` + no overdue signals | Green `--success` |
| Idle / Stale | any + last commit > 90d | Grey `--neutral` |

A single "Top Pick" callout bar sits between Kanban header and repo cards, surfacing best 30-min action across all repos.

**Interaction model:** glance board → click chip → scroll-to or expand card → act via one-click links/affordances.

**Tradeoffs:**
- **Drag-and-drop:** Native HTML5 drag API possible but keyboard fallback mandatory. Recommend context-menu "move to lane" button as primary, drag as progressive enhancement.
- **localStorage-only state:** Per-browser only (acceptable for solo vibe-coding); cross-device sync deferred to Phase 3 (GitHub Gist option).
- **Mobile density:** 5 horizontal lanes won't fit < 640 px. Collapse to vertical scrollable pill-row or single "Focus" lane with count badges.
- **Write actions (merge Dependabot):** Requires `pull_requests: write` PAT scope (not guaranteed). Must check PAT scopes or gracefully degrade to GitHub link.
- **Top Pick algorithm:** Needs Keyser sign-off on scoring weights (data/state decision). Simple scoring: security > CI > review count > release > stale.

---

### P003: Dependabot Action Phasing — Top Pick Bar Read-Only Phase 1 (Jon Galloway via Coordinator, 2026-06-27)
**Status:** Proposal / clarification (direction set, awaiting implementation)

For the "What Should I Work On Next?" Kanban feature, the **Top Pick 30-minute action should ship in Phase 1 as a safe, read-only deep-link** to GitHub's filtered Dependabot PR list.

**Phase 1 (safe, immediate):** Top Pick bar surfaces quick-win recommendations (esp. Dependabot merges) as deep-links to GitHub's filtered PR list. Zero write-scope risk. Users click link, review in GitHub, merge manually.

**Phase 2+ (richer in-app actions):** Implement one-click "Merge all Dependabot PRs" button and similar write-action affordances — requires `pull_requests: write` PAT scope (not guaranteed present, optional).

**Rationale:** Validate the priority-scoring model in production before adding write-scope actions. User gets immediate value (glance → identify quick win → one click to GitHub), while richer in-app actions roll out once model is proven and user has upgraded their PAT if needed.

**Dependency:** Complements P001 (architecture) and P002 (UX) — clarifies Phase 1 scope boundary around Dependabot/bot PR handling.

---

### P005: Kanban Lane Model — 4-Lane Simplification (Jon Galloway, 2026-06-27)
**Status:** Proposal (direction confirmed)  
**Requested by:** Jon Galloway  

Simplify the vibe-coding Kanban board from 5 lanes to **4 lanes** to improve glance-and-go speed and reduce cognitive overhead:

| Lane | Signal Source | Purpose |
|------|--------------|---------|
| 🔴 **Blocked** | CI failing OR critical/high security alerts | Requires immediate fix |
| 🟡 **Needs Attention** | Open PRs awaiting human review (non-critical signals) | Waiting on me |
| 🔵 **Working** | Recent activity pushed within last **14 days** | Currently active |
| 🟢 **Healthy** | No blockers, no recent activity beyond 14 days | Stable/maintained |

**Key Change:** Collapse `Up-to-Date` and `Idle/Stale` (from original P001) into single `Healthy` lane. Rationale: fewer lanes = faster mental model; 14-day window covers 1–2 weekends of vibe-coding activity.

---

### P006: Backlog Strip — Pick-Back-Up Window 15–120 Days (Jon Galloway, 2026-06-27)
**Status:** Proposal (direction confirmed)  
**Requested by:** Jon Galloway  
**Depends on:** P005 (4-lane model)  

Add a **separate collapsible "📋 Backlog" strip** below the 4-lane Kanban board (NOT a 5th lane) to surface recently-stale projects worth reviving.

**Definition:** Repo is Backlog when `pushed_at` is **> 14 days AND ≤ 120 days ago**, excluding repos already in Blocked/Needs Attention lanes.

**Why separate strip, not lane:** The Kanban board answers "what's my **current status**?" Backlog answers "what could I **revive**?" Different affordances, different cognitive mode. Backlog repos pull out of Healthy count (no double-counting).

**Rendering:** Horizontal scrollable chip row (repo name + "last pushed X weeks ago" label). Click to scroll-to or highlight full card below. Collapsed by default; expand on click.

**Lifecycle:**
- **Snooze 30d:** `localStorage` key `ghd_snooze_{repo}` = ISO timestamp
- **Archive/Dismiss:** `localStorage` key `ghd_archived` = Set of repo names

**Integration with Top Pick:** When no Blocked/Needs Attention/Working repos exist, Top Pick may suggest a Backlog revival (lowest scoring priority). Always tagged 🔨 Focused work (15–30 min).

**Phasing:** Display-only strip in Phase 1.5; snooze/archive + Top Pick integration Phase 2.

**Open:** Jon chose 120-day window to catch slower-burn projects; 90-day alternative discussed. Collapsed by default recommended.

---

### D032: Backlog Strip Design Decisions — Collapse + Grid-Exclusion (Jon Galloway, 2026-06-28)
**Issue:** #44 — Phase 1.5 Backlog "Pick Back Up" Strip | **Branch:** `squad/44-backlog-strip` | **Status:** RATIFIED

Two design decisions carried from #42/#44 proposals:

1. **Collapse by default:** Backlog strip renders collapsed on every page load. No localStorage persistence in Phase 1.5. Expand-on-demand keeps the 4-lane Kanban board the visual focus.

2. **Strip-only, no grid duplication:** Backlog repos are pulled **entirely out of the main card grid** — they appear ONLY in the collapsible strip. No backlog repo appears as a full card in the grid below the strip. Grid count (Healthy lane) excludes backlog repos.

**Rationale:** Answers open questions from P006. Resolves implementation ambiguity for Phase 1.5 ship.

### D033: Backlog Strip Classifier Rule + Grid-Exclusion Implementation (McManus, 2026-06-28)
**Issue:** #44 | **Branch:** `squad/44-backlog-strip` | **Status:** IMPLEMENTED + APPROVED

**Classifier contract (`GHD.BacklogStrip.isBacklogRepo(repo, now)`):**
- Returns `true` iff: `pushed_at` age **> 14 days AND ≤ 120 days**, AND NOT Blocked (CI failure OR security alerts), AND NOT Needs Attention (pending reviews)
- Uses `pushed_at` as primary; falls back to `last_commit_date` on missing/invalid date
- Returns `false` for null/undefined date, repos > 120 days old, Blocked, or Needs Attention — these are never shown in backlog strip
- Pure, testable, exported on `GHD.BacklogStrip`; injects `now` for determinism

**Grid-exclusion integration** (in `renderRepos()` in `js/app.js`):
- Build `backlogSet` (Set of repo names) via `BacklogStrip.isBacklogRepo` check on all repos
- Filter out `backlogSet` from `pinnedRepos` and `normalRepos` before rendering grid cards
- Pass repos with `backlogSet` excluded to `renderKanbanStrip()` → Healthy lane count is accurate
- Pass `_currentRepos.filter(r => backlogSet.has(r.name))` to `renderBacklogStrip()` → strip-only render

**Files:** `js/backlog-strip.js` (new IIFE), `js/app.js` (renderRepos integration), `index.html` (strip region + script), `css/style.css` (strip styling), `test/backlog-strip.test.js` (31 tests).

**Result:** 151 → 153 passing tests (3 skipped pre-existing). No regressions.

### D034: Keyser Review — Backlog Strip Correctness + Drift-Risk Warning (Keyser, 2026-06-28)
**Issue:** #44 | **Branch:** `squad/44-backlog-strip` | **Status:** APPROVED

**Verdict:** ✅ APPROVE for Phase 1.5 merge. All ratified requirements satisfied.

**Drift-risk finding:** McManus re-implements `CI_FAILING` set and `WORKING_WINDOW_MS` constant inline rather than calling `deriveKanbanLane`. Values are currently consistent but duplication creates two sources of truth.

**Ruling:** Accept for Phase 1.5 (small, well-tested duplication). **File follow-up to extract shared constants** (`GHD.KanbanConstants: { CI_FAILING, WORKING_WINDOW_MS }`) if the set ever expands or lane logic changes.

**Non-blocking UX edge case:** Pinned repos that age into 15–120d window will silently move from card grid to backlog strip. User who pinned for visibility loses grid presence. Recommend documenting or filtering pinned repos out in Phase 2.

### D035: Hockney Test Review — Gap #7 Closure + Final Verdict (Hockney, 2026-06-28)
**Issue:** #44 | **Branch:** `squad/44-backlog-strip` | **Status:** REJECT → CLOSED (gap found and fixed)

**Gap #7:** Integration test for grid-exclusion dedup untested. Original test only asserted what IS in backlog, never what is NOT in grid. Test comment acknowledged the gap.

**Fix (2 new tests):** Added `'BacklogStrip — renderRepos integration contract (app.js pattern)'` describe block:
1. Replicate exact Set-building loop from app.js. Assert backlog repo NOT in gridRepos, working/dormant repos remain in grid, mutual exclusion holds.
2. Verify closed repos excluded from both backlog and grid (closed > backlog precedence).

**Result:** 151 → 153 passing | 3 skipped. Full suite green, no regressions. Grid-exclusion contract verified.

### D036: Squad-CLI Release Pipeline Workflows — Deletion Decision (Fenster, 2026-06-28)
**PR:** #52 (`squad/fix-release-workflow`) | **Status:** APPROVED / MERGED (squash)

Remove `squad-release.yml` immediately (PR #52 merged). Flag five additional Squad-CLI release/CI boilerplate workflows for follow-up removal by team lead with user awareness.

**Context:** Squad-CLI installs a `dev → preview → insider → main` versioned npm release pipeline as boilerplate. GitHubDashboard is a **static GitHub Pages dashboard** — no published npm package, no versioned releases, no `version` field in `package.json`, no `CHANGELOG.md`. The pipeline is entirely inapplicable.

`squad-release.yml` was triggering on every push to `main` and failing immediately:
1. `package.json` has no `version` field → `node -e "console.log(require('./package.json').version)"` returns `"undefined"`
2. No `CHANGELOG.md` exists → grep exits 1 on every run
3. Test step runs `node --test test/*.cjs` — no `.cjs` files exist; repo uses Vitest (`npm test`, `.test.js`)

**Workflow Audit — Full Classification:**

| Workflow | Decision | Reason |
|----------|----------|--------|
| `squad-release.yml` | **REMOVE** (PR #52) | Fails every push to main; version/CHANGELOG checks meaningless for static site |
| `squad-ci.yml` | **REMOVE** (follow-up) | References dev/preview/insider branches (don't exist); wrong test command; superseded by ci-tests.yml |
| `squad-docs.yml` | **REMOVE** (follow-up) | Triggers on `preview` branch (doesn't exist); deploys `docs/` dir — conflicts with update-dashboard.yml |
| `squad-insider-release.yml` | **REMOVE** (follow-up) | `insider` branch doesn't exist; npm release boilerplate; wrong test command |
| `squad-preview.yml` | **REMOVE** (follow-up) | `preview` branch doesn't exist; checks CHANGELOG.md (missing); wrong test command |
| `squad-promote.yml` | **REMOVE** (follow-up) | Full dev→preview→main promotion model; none of those branches exist |
| `squad-heartbeat.yml` | **KEEP** | Issue/PR triage and Copilot auto-assign; functional squad workflow |
| `squad-issue-assign.yml` | **KEEP** | Routes squad:* label assignments; functional |
| `squad-label-enforce.yml` | **KEEP** | Label namespace mutual exclusivity; functional |
| `squad-triage.yml` | **KEEP** | Routes squad-labeled issues to team members; functional |
| `sync-squad-labels.yml` | **KEEP** | Syncs issue labels from team.md; functional |
| `ci-tests.yml` | **KEEP** ✅ | Correct CI: `npm ci` + `npm test` (Vitest); proper path filters |
| `update-dashboard.yml` | **KEEP** ✅ | Core deployment pipeline for static site |

**Rationale for Deletion (not gating/skipping):** Option (b) — adding guards like `if: package.json has version` — was considered and rejected. A workflow that does nothing meaningful on every push is noise, not value. The release pipeline model itself is wrong for this repo; graceful no-ops don't fix that. Deletion is the correct engineering answer.

**Follow-Up:** The five additional REMOVE candidates (squad-ci, squad-docs, squad-insider-release, squad-preview, squad-promote) should be cleaned up in a follow-up PR. Currently harmless (non-main branches don't exist = no trigger), but they add confusion. Recommend bundling into a single "cleanup boilerplate workflows" PR with team lead awareness.
