# Decision Log: PRs #18–#26 Batch Merge

**Author:** Keyser  
**Date:** 2026-05-24  
**Scope:** All 9 squad feature PRs merged into main in dependency order

## Summary

Nine squad PRs were reviewed for Copilot inline comments, fixed, and merged into main sequentially. All conflicts were resolved by keeping both sets of changes (additive merges).

## Merge Order and Changes

| PR | Branch | Feature | Copilot Fix Applied |
|----|--------|---------|---------------------|
| #18 | squad/8-actions-workflow-status | CI workflow badge | Extended `ciFailure` to include `timed_out`, `startup_failure`, `action_required` |
| #19 | squad/9-dependabot-alerts | Dependabot security badge | Changed "high severity alert(s)" → "high security alert(s)" |
| #20 | squad/11-last-commit-date | Last commit activity badge | Replaced custom date formatter with existing `formatRelativeDate()` |
| #21 | squad/14-code-scanning-alerts | Code scanning badge | Changed severity fallback `\|\| 'warning'` → `\|\| ''` to silently ignore unknown severities |
| #22 | squad/10-stale-branches | Branch count badge | Renamed `branch_count` → `non_default_branch_count` everywhere; added `manyBranches` signal |
| #23 | squad/12-copilot-activity | Bot PR detection | Clean merge — no conflicts |
| #24 | squad/13-repo-traffic | Traffic views/clones badge | Restructured `getTrafficViews` → `getTrafficData` fetching both `/traffic/views` and `/traffic/clones`; changed label to "unique visitors" |
| #25 | squad/15-discussion-activity | Discussions enabled badge | Fixed decisions doc: "no REST API" → accurate explanation; restored missing history.md section heading |
| #26 | squad/16-17-health-and-tags | License + README health badge | Added `[404, 409]` to `checkHasReadme` allow-statuses; added release tag-only comment |

## Cross-Cutting Commit (pre-merge)

- Added `.badge.danger` CSS rule to main before any PR merges so all branches could reference it. Used hardcoded red values (`rgba(239,68,68,…)`) since `--danger` is orange in this theme.

## Post-Merge Commit

- Added default field stubs to `js/github-client.js` for all 9 new fields: `workflow_status`, `security_alerts`, `code_scanning`, `traffic`, `discussions_enabled`, `license`, `has_readme`, `non_default_branch_count`, `is_private`.

## Key Decisions

- **Conflict resolution strategy:** Always keep ALL changes from both sides — never discard a feature. `Promise.all` grows one entry per PR.
- **`github-client.js` deferred:** Browser client parity was intentionally deferred until after all 9 PRs merged, to avoid compounding conflicts in that file.
- **Bug fixed during merge:** PR #22 merge caught a missing closing `}` in `summarizeNextSteps` introduced during PR #19's conflict resolution. Fixed in place.
