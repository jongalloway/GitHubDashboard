# Decision: Blocked-Lane Data Pipeline — Workflow Status + Security Alerts

**Agent:** Fenster  
**Issue:** #47  
**Branch:** `squad/47-blocked-lane-data`  
**Date:** 2026-06-27

## Decision

Implement `workflow_status` and `security_alerts` fetching in the **authenticated (PAT) browser path** of `js/github-client.js` so the Kanban Blocked lane activates for repos with failing CI or open Dependabot security alerts.

## Endpoint Choices

### Workflow status: `GET /repos/{owner}/{repo}/actions/runs?per_page=1`

Chosen over `/repos/{owner}/{repo}/actions/workflows` + per-workflow runs because:
- A single call returning the most recent run across all workflows is the minimal signal needed for the Blocked lane check
- `deriveKanbanLane` only needs `latest_run.conclusion` — no per-workflow breakdown required
- Per-workflow run fetching would add N additional calls per repo (N = number of workflow files)

### Security alerts: `GET /repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100`

Chosen over code-scanning alerts because:
- Dependabot alerts are the primary security signal relevant to the `security_alerts` field shape already defined (`total`, `critical`, `high`, `medium`, `low`)
- Code-scanning alerts are separately tracked under `code_scanning` (already in the schema, already zeroed)
- Dependabot alert `security_advisory.severity` maps cleanly to the four buckets

## Scope / Permission Handling

Both endpoints require a PAT with appropriate permissions:
- Actions API: requires `repo` scope (or fine-grained `actions: read`)
- Dependabot alerts: requires `repo` scope (or fine-grained `security_events: read`) AND admin access on private repos

**Degradation strategy:** Any non-OK response (403, 404, 422, missing scope) returns `has_workflows: false` / `total: 0` silently — no console errors, no thrown exceptions, no UI artifacts. This is consistent with D019's ruling that auth-only fields default to empty.

## Empty Runs Interpretation

When `workflow_runs` array is empty (repo has Actions configured but has never run), `has_workflows` is set to `false`. Rationale: an empty run history is not a blocking signal. A repo with workflows that have never run is equivalent to no-CI from the Blocked lane perspective.

## Architecture Alignment

- Pure parse helpers (`_parseWorkflowRun`, `_parseSecurityAlerts`) separated from fetch logic, exported on `GHD.GitHubClient` for unit testability — consistent with existing export pattern
- Soft HTTP helpers (`_fetchJsonSoft`, `_paginateSoft`) added as a layer below the existing strict helpers — same pattern, different error contract
- Parallel execution: both fetchers run in the existing `Promise.all` in `_fetchRepoDetails`, adding ~2 API calls per repo with no sequential overhead
- Public path (`_fetchRepoDetailsPublic`) intentionally unchanged — stays zeroed per D028 ruling

## Reviewed by

Awaiting Keyser review + Hockney validation before merge.
