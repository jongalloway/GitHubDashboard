# Decision: Security Badge Design (Issue #9)

**Agent:** McManus
**Date:** 2026-05-24T15:30:34-07:00
**Issue:** #9 — Show Dependabot security alerts per repo

## Decisions Made

### 1. Badge hidden when total === 0
When `security_alerts.total === 0` (either no alerts or API returned 403/404 with no data), the badge is not rendered. This avoids noise for repos without alerts or repos where the token lacks `security_events` scope.

**Rationale:** The `paginate()` function returns `[]` for both "empty results" and "allowStatuses match" (403/404). There's no way to distinguish at the badge level. Hiding on zero is cleaner than showing a "0 alerts" badge.

### 2. Tone hierarchy: danger > warning > neutral
- `danger` (red): any critical alerts present
- `warning` (yellow): high alerts present, no critical
- `neutral` (grey): only medium/low alerts

**Rationale:** Matches existing badge tone conventions in `buildWorkflowBadge` (danger for failure, warning for pending, neutral for informational).

### 3. Security alerts listed first in `summarizeNextSteps` summary
Critical/high security alerts are prepended before release-overdue, PR review, and triage signals.

**Rationale:** Security vulnerabilities are the highest priority signal and should be immediately visible in the "Next steps" panel summary text.

### 4. No separate "security_events scope required" UI affordance
No user-visible warning is shown when the API returns 403. The badge simply doesn't appear.

**Rationale:** The dashboard is read-only and most users won't notice the absence of a badge for repos without alerts. A confusing "permissions error" badge would be worse UX than silence.
