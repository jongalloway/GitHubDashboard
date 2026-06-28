# Decision Drop: mcmanus-57-scoring
**Issue:** #57 | **Branch:** `feat/57-backlog-scoring` | **Author:** McManus | **Date:** 2026-06-28

## Decision: Backlog Scoring Module + Top Pick Revival (Issue #57)

### Problem
When no Blocked or Needs-Attention repos exist, the Top Pick bar was blank (hidden). Phase 2 requires it to suggest the best Backlog repo to revive instead.

### Decisions Made

#### D1: Self-contained `js/backlog-scoring.js` module
New IIFE following the `release-pressure-indicator.js` pattern (`root.GHD.BacklogScoring = api; module.exports = api`). Pure functions only — no DOM, no API calls. Two exports:
- `scoreBacklogRepo(repo, now)` — deterministic numeric score (0–90)
- `findTopBacklogPick(repos, now)` — highest-scored repo or null

#### D2: Scoring formula (four independent components, separate caps)
| Component | Max | Signal |
|---|---|---|
| Recency | 50 | `(120 - ageDays) / 106 * 50` — linear across 14-120d window |
| Open issues | 20 | `min(open_issues_count, 20)` |
| Copilot/Squad | 10 | Copilot open PRs (+5), signals array non-empty (+5); Squad fallback (+3) |
| Release pressure | 10 | `min(commits_since_latest, 10)` |

**Tiebreaker:** `repo.name` ascending (alphabetical, stable across input order permutations).

**Accepted trade-off:** Recency dominates (~56% of max score). This is intentional — the Backlog window is 14-120 days and freshness is the primary revival signal. A 30d repo with issues beats a 100d dormant repo even without other signals (D4 test proves this).

#### D3: Top Pick bar gating in `kanban-strip.js`
Gate logic lives in `renderKanbanStrip` where `laneMap` is already computed (single source of truth for lane counts). `_findTopPick` is unchanged (existing tests remain green). New flow:
1. Try existing Dependabot pick first.
2. If null AND `laneMap['blocked'].length === 0 && laneMap['needs-attention'].length === 0` → call `GHD.BacklogScoring.findTopBacklogPick(backlogRepos, now)`.
3. If found → `{ type: 'backlog', pick }` → renders with "Pick this back up" prompt + green link.
4. If not found (empty backlog) → no bar shown (graceful hide).

`renderKanbanStrip(repos, backlogRepos)` — `backlogRepos` is an optional second param; existing callers that omit it get `undefined` → backlog path skipped safely.

#### D4: `_renderTopPickBar` extension via new `type === 'backlog'` branch
Kept `type` discriminator pattern consistent with existing `type === 'dependabot'`. Added `top-pick-link--backlog` CSS modifier for green tint (signals "all clear, revival opportunity" vs blue "security action needed").

#### D5: Snooze hook deferred
Issue #56 (snooze) integration is additive. The `findTopBacklogPick` call site in `renderKanbanStrip` can filter `backlogRepos` by snooze state before passing the array. No hook needed in the scoring module itself.

### Files Changed
- `js/backlog-scoring.js` — new module
- `js/kanban-strip.js` — `renderKanbanStrip` signature + `_renderTopPickBar` backlog branch
- `js/app.js` — pass `backlogReposArr` to `renderKanbanStrip`
- `index.html` — add `<script src="js/backlog-scoring.js" defer>`
- `css/style.css` — `.top-pick-link--backlog` dark + light + hover variants
- `test/backlog-scoring.test.js` — 34 new tests (211 → 211 total, +34 new)

### Test Results
- 211 tests pass, 3 skipped — no regressions
- 34 new tests covering: null/empty fallbacks, zero-signal baseline, recency ordering, issue cap, release cap, copilot signal, squad fallback, boundary (30d-with-issues > 100d-dormant), tiebreaker determinism, URL safety (XSS clamp)
