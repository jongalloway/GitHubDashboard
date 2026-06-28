# Hockney — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** HTML/CSS/JS, GitHub Actions, GitHub Pages
- **Goal:** Ensure dashboard quality, data integrity, and edge case handling

## Learnings

- 2026-05-23T09:22:49Z: Created comprehensive test plan at `docs/test-plan.md` with 148 test cases covering data pipeline, UI rendering, GitHub Actions workflow, Pages deployment, and configuration templating.
- Test plan includes validation for Keyser's PRD requirements, Fenster's data pipeline integration, and McManus's frontend rendering contract.
- Scribe consolidated all team decisions (D001-D005) into `.squad/decisions.md` for official project record.
- 2026-05-23T03:38:13-07:00: Auth implementation session — appended 98 additional test cases covering Device Flow auth, token management, API integration, caching, sign-in/sign-out, error scenarios, security, and browser compatibility to `docs/test-plan.md`. Total test coverage now 246 cases.
- 2026-06-01T00:00:00Z: Reviewed consolidated single test system and CI wiring. Verified canonical `test/` directory alignment in `vitest.config.js` and `.github/workflows/ci-tests.yml`, confirmed `npm test` runs 4 files / 15 tests in ~1.17s, and flagged lightweight suite plus remaining integration/E2E risk areas.
- 2026-06-27T22:30:33-07:00: Validated McManus's Phase 1 Kanban strip tests (issue #43). Full suite 68 passed / 3 skipped across 9 files. `deriveKanbanLane` coverage is strong: all 4 lanes, full precedence chain, exact 14-day boundary (both sides), `pushed_at`→`last_commit_date` fallback, null fields, empty object, and `now`-injection determinism all covered. Minor untested paths: `has_workflows:true` + `latest_run:null`, and non-failing CI conclusions (success/cancelled). `renderKanbanStrip` DOM rendering has zero test coverage — acceptable for Phase 1 per spec priority. APPROVED.
- 2026-06-27T23:30:21-07:00: REJECTED Fenster's #47 blocked-lane data tests. Suite passed 109/3-skipped but four gaps found: (1) no multi-repo isolation test — the critical "one repo error must not break others" path is untested; (2) network-exception (fetch throws) path in `_fetchJsonSoft`/`_paginateSoft` not exercised; (3) non-blocking conclusions `cancelled`, `neutral`, `skipped` never asserted; (4) `_paginateSoft` Link-header pagination behavior not tested. Happy-path and basic 403/404 degradation are solid. Fixes should come from Hockney (not Fenster) per reviewer-lockout protocol.
- 2026-06-27T23:48:18-07:00: Added 11 tests to `test/blocked-lane-data.test.js` closing all four #47 gaps per reviewer-lockout protocol. Key lesson: `_fetchRepoDetails` has an outer try/catch that returns a fallback object (never null) — `filter(Boolean)` is a safety net that won't filter anything in normal operation but the code path is still exercised. `_paginateSoft` mid-pagination 403 uses `return items` (not `break`) so items collected before the error ARE returned. Vitest's `vi.fn(async ...)` mock pattern with URL pattern matching is the correct style for this codebase's integration tests. Suite: 109 → 120 passing. No production defects found.
