# Decision: Phase 1 Kanban Strip Implementation (McManus, 2026-06-27)

**Issue:** #43  
**Branch:** `squad/43-kanban-strip`  
**Status:** Implementation complete, pending Keyser lane-rule review and Hockney test validation

---

## Implementation Decisions

### 1. Lane derivation using `pushed_at` not `last_commit_date` for "Working"

`pushed_at` comes directly from the GitHub REST repo list response and is always available (public and private mode). `last_commit_date` requires a separate API call to the commits endpoint and may be `null` in the browser fallback path. Rule: use `pushed_at` first; fall back to `last_commit_date`.

### 2. `pending_reviews.count` for "Needs Attention"

The existing `repo.pending_reviews.count` field captures all non-draft open PRs (Dependabot, Copilot, human) conservatively. Phase 1 uses this count directly without further sub-classification. Dependabot PRs are only identified by author-name scan in Top Pick — they are NOT filtered out of the Needs Attention count.

### 3. `deriveKanbanLane` exported via `window.GHD.KanbanStrip` for testability

The pure function is exposed on the GHD namespace so the `vm.runInThisContext` test pattern (used by `github-client.test.js`) can access it without any extra exports. No `module.exports` guard needed.

### 4. Top Pick: cross-repo Dependabot deep-link

URL: `https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot`  
Rationale: single URL works for any authenticated user, no per-repo URL construction needed, zero write-scope risk. If user is not signed in on GitHub, link redirects to GitHub sign-in — acceptable behavior.  
Bar hidden when no Dependabot PRs detected. No fallback suggestion rendered in Phase 1 (hide > show stale noise).

### 5. Lane filter interaction: dim non-matching cards

Clicking a lane button dims (opacity 0.3) cards that don't match the selected lane and scrolls to the first match. Toggling the same lane button clears the filter. CSS class `.kanban-dimmed` applied rather than `display:none` to preserve layout. Card identification uses `data-repo` attribute (added to `buildRepoCard`) matched against `data-kanban-lane` set by `renderKanbanStrip`.

### 6. Closed repos excluded from lane counts

`renderKanbanStrip` receives `_currentRepos.filter(r => !getClosedRepos().has(r.name))` — closed cards are already hidden in the DOM, so they should not inflate lane counts.

### 7. Amber color for "Needs Attention" uses existing `--squad` token

No `--warning` CSS token exists in the design system. `--squad` (#f59e0b dark / #92400e light) is amber/golden and visually reads as "caution/attention". Reuses an existing token rather than introducing a new one.

---

## Data Gaps (for Keyser to decide)

1. **`workflow_status` in public mode**: `has_workflows` is `false` and `latest_run` is `null` for public/unauthenticated users. CI failure signal is **unavailable** without auth. The Blocked lane may appear empty for public users even if repos have failing CI. Mitigation options: (a) accept as-is — public view is always limited, (b) fetch latest workflow run in the public client pipeline.

2. **`security_alerts` in public mode**: Always 0 — requires `security_events` PAT scope. Same mitigation options as above.

Both gaps are pre-existing data limitations, not introduced by Phase 1. Phase 1 degrades gracefully (0 repos in Blocked lane for public users). The code has a comment flagging both gaps inline.
