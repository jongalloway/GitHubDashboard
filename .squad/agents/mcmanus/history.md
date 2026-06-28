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

### Review Findings (D034, D035)
- **Keyser:** APPROVE + drift-risk note: `CI_FAILING` set and `WORKING_WINDOW_MS` duplicated from kanban-strip.js. Values currently consistent; follow-up: extract `GHD.KanbanConstants` if set expands.
- **Hockney:** Initial REJECT due to gap #7 (grid-exclusion dedup untested). Gap closed by Hockney with 2 new integration tests. Final: APPROVED.

## Key Learnings

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

