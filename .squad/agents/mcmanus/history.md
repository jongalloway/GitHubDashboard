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

- Backlog strip is display-only in Phase 1.5 (no snooze/archive/localStorage); Phase 2 will add state persistence and Top Pick integration
- Classifier pure function pattern (`isBacklogRepo(repo, now)`) matches `deriveKanbanLane` for testability; `now` injection enables deterministic tests
- Grid-exclusion pattern: build exclusion set first, filter all downstream render paths (grid cards + Kanban lanes), no double-counting possible
- Constant duplication creates drift risk; recommend extracting shared constants to single source of truth for future maintenance

## Next Steps (Phase 2)

- Snooze (localStorage `ghd_snooze_{repo}` = ISO timestamp) + Archive (localStorage set)
- Collapse state persistence (localStorage `ghd_backlog_expanded`)
- Top Pick integration: suggest backlog revival when no Blocked/Needs Attention/Working repos exist
- Consider filtering pinned repos out of backlog to avoid silent grid removal (UX edge case from D034)

