# McManus — History Archive

**Archived:** 2026-06-27 (summarized from 15,852 bytes history.md)

## Summary of Major Accomplishments

### Authentication System (May 2026)
- Replaced GitHub App Device Flow with fine-grained PAT input modal (2026-05-23)
- Implemented `js/auth.js`, `js/cache.js`, `js/github-client.js` with `window.GHD` namespace
- PAT tokens stored in localStorage; session validation via silent GET /user on page load
- Added `signIn()`, `signOut()`, `getToken()`, `isAuthenticated()`, `getValidToken()` API

### UI Theme & PWA Support (May 2026)
- Light/dark theme system via `html[data-theme]` selector; preference stored in localStorage (2026-05-23)
- Flash prevention via `js/theme.js` running immediately (no defer)
- PWA support: manifest.json with SVG icon, service worker with cache-first statics / network-first data
- Apple mobile meta tags for app-like install experience

### Badge & Status Enhancements (May 2026)
- Rich hover tooltips on all badges using CSS `[data-tooltip]::after` pseudo-elements (2026-05-25)
- Multi-line tooltip support via `white-space: pre-line`; backward-compatible `buildBadge()` signature
- Activity badge: compact relative time (today/Nd/Nw/Nmo/Ny ago) with absolute date tooltip
- Code scanning badge with severity priority (critical > error > high); 403 handling for repos without CodeQL
- Traffic badge (visitors/clones) with 403/404 graceful fallback
- License + README health badge with SPDX lookup and README presence check
- Dependabot security alerts with critical/high signal routing to needs-attention status

### Public Mode & Owner Auto-Detection (May 2026)
- Auto-detect owner from GitHub Pages hostname (`{username}.github.io`) (2026-05-25)
- Public dashboard fetch via unauthenticated API calls (60 req/hour limit)
- Skip branch-list calls in public mode; signal gaps acceptable for v1
- `config.json` override pattern for explicit owner specification

### Testing & Frontend Heuristics (June 2026)
- Minimal fast Vitest lane: `npm test` → `vitest run` with `test/**/*.test.js` (2026-06-01)
- Refactored `scripts/fetch-data.js` for safe import in tests (moved validation to `main()`)
- Exported pure heuristics: `normalizeLabels`, `issuePriority`, `buildPriorityIssues`, `summarizeNextSteps`
- Consolidated to canonical `test/` directory; retired browser-heavy tests from `tests/`
- Test suite stabilized: 4 files, 15 tests, ~1s runtime

### Kanban Strip Phase 1 (June 2026)
- 4-lane strip above repo grid: Blocked (CI + security) > Needs Attention (reviews) > Working (14-day push) > Healthy
- Top Pick bar with Dependabot detection and deep-link to GitHub filtered PR list
- Lane filter interactivity: click button → dim non-matching cards (opacity 0.3)
- Card identification via `data-repo` and `data-kanban-lane` attributes
- 18 initial unit tests covering all lanes, precedence, edge cases; evolved to 82 tests post-review
- Identified data gaps: `workflow_status` and `security_alerts` not yet fetched in authenticated path (filed issue #47)

### PR #48 Review Fixes (June 2026)
- Reuse `getClosedRepos()` Set instead of re-parsing localStorage per render
- Single source of truth for Top Pick URL: consume from `_findTopPick()` result
- Exported `_isDependabotPR` and `_findTopPick` helpers for testability
- 14 additional tests added; suite grew from 68 → 82 passing

## Key Decisions Ratified
- CSS-first tooltip implementation (D016)
- Light mode + PWA + Squad badge UI (D017)
- PAT modal auth over OAuth (D018)
- Public owner detection & unauthenticated view (D019)
- Security badge design hierarchy (D020)
- Minimal test command contract (D021)
- CI test input monitoring (D022)
- Workflow badge link wrapping (D023)
- Kanban strip phase 1 implementation (D024-D029)

## Test Coverage Evolution
- Initial browser fetch pipeline: 98 test cases
- Core heuristics + cache + auth: 15 tests in canonical lane
- Kanban strip: 18 tests → 82 tests (post-review additions)
- **Current status:** 68 core tests passing (no regressions)
