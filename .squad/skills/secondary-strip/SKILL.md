# Skill: Secondary Strip — Collapsible Sub-Board Below Kanban

**Category:** Frontend / UI Component Pattern  
**Applies to:** GitHubDashboard — static vanilla JS/HTML/CSS, GitHub Pages

## Pattern

A "secondary strip" is a collapsible UI region that sits **below** the primary Kanban board and surfaces a distinct subset of repos that answer a different question than the Kanban lanes (e.g., "what could I revive?" vs. "what is my current status?").

Use this pattern when:
- A repo category has its own semantic meaning that would pollute the primary board's clarity
- The category is secondary — you don't need to see it on every page load (collapsed by default)
- The display is informational only — no lane interaction, no dimming

## Structure

```
#kanban-strip-region          ← primary Kanban strip (always visible)
#backlog-strip-region         ← secondary strip (collapsed by default)
  .backlog-strip-toggle       ← button: "📋 Backlog (N) ▸"
  .backlog-strip-body[hidden] ← chip row, revealed on click
    .backlog-chip-row
      .backlog-chip × N       ← repo name + relative age + link
.content-panel                ← main card grid (repos excluded from strip)
```

## Key Conventions

### 1. Classifier function
Always write a pure, exported, `now`-injected classifier:
```js
function isBacklogRepo(repo, now) {
  const ts = typeof now === 'number' ? now : Date.now();
  // ... checks ...
}
```
- No DOM side-effects
- Falls back safely for missing/invalid dates
- Exported on the module namespace for unit testability

### 2. Module pattern
Follow the same IIFE/`window.GHD` namespace pattern as `kanban-strip.js`:
```js
window.GHD = window.GHD || {};
(function (GHD) {
  'use strict';
  // ...
  GHD.BacklogStrip = { isBacklogRepo, deriveBacklogRepos, renderBacklogStrip, _formatBacklogAge };
})(window.GHD);
```

### 3. Grid exclusion in renderRepos()
Compute a `Set` of repo names **before** filtering `pinnedRepos`/`normalRepos`:
```js
const backlogSet = new Set();
if (BacklogStrip && BacklogStrip.isBacklogRepo) {
  for (const r of _currentRepos) {
    if (!closed.has(r.name) && BacklogStrip.isBacklogRepo(r, now)) {
      backlogSet.add(r.name);
    }
  }
}
const pinnedRepos = _currentRepos.filter(r => ... && !backlogSet.has(r.name));
const normalRepos = _currentRepos.filter(r => ... && !backlogSet.has(r.name));
```
Also pass `backlogSet` exclusion to `renderKanbanStrip` so the Kanban lane counts stay accurate.

### 4. Collapsed by default
The strip always starts collapsed on every `render*Strip()` call. No localStorage persistence needed for Phase 1 — snooze/archive are Phase 2 concerns.

### 5. CSS conventions
- Toggle button uses `border-bottom-left-radius: 0; border-bottom-right-radius: 0` when `aria-expanded="true"` to visually attach to the body
- Body div has `border-top: none` to complete the seamless join
- Chip row uses `flex-wrap: wrap` (desktop) / `flex-wrap: nowrap; overflow-x: auto` (mobile `≤640px`)
- Colors use CSS custom properties (`var(--text-muted)`, `var(--accent)`, `var(--border)`) — never hard-coded hex

### 6. Relative age formatter
For time ranges > 1 week, use a `_format*Age(pushedAt, now)` helper that:
- Takes `now` as a parameter (not `Date.now()` internally) for test determinism
- Chooses weeks vs. months based on age: `< 28 days → "N weeks ago"`, `≥ 28 days → "N months ago"`
- Returns `''` for null or invalid dates

## Files (Backlog Strip as reference implementation)

| File | Role |
|------|------|
| `js/backlog-strip.js` | Classifier + renderer (IIFE module) |
| `css/style.css` | `.backlog-strip-*` + `.backlog-chip*` CSS |
| `index.html` | `#backlog-strip-region` div + `<script>` tag |
| `js/app.js` | `backlogSet` computation + `renderBacklogStrip` call in `renderRepos()` |
| `test/backlog-strip.test.js` | 31 unit tests (classifier boundaries + formatter + multi-repo) |

## Test Coverage Requirements

For any secondary strip classifier, cover:
- Exactly at the lower boundary (excluded)
- 1ms past the lower boundary (included)
- Exactly at the upper boundary (included)
- 1ms past the upper boundary (excluded)
- Lane-precedence exclusions (Blocked, Needs Attention)
- Missing/null date → false
- `now` injection determinism
- Multi-repo isolation (one excluded repo doesn't affect others)
- `deriveBacklogRepos` returns correct subset across a mixed list
