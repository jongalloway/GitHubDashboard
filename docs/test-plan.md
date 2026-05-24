# GitHubDashboard Test Plan & Validation Checklist

**Author:** Hockney (Tester)  
**Date:** 2026-05-23  
**Status:** Draft MVP

This document serves as both a comprehensive test plan and a reusable validation checklist for GitHubDashboard. Each section contains test cases with checkboxes that can be marked during development and QA. Tests are organized by data pipeline, UI rendering, edge cases, and end-to-end integration.

---

## Part 1: Data Pipeline Tests

### 1.1 Workflow Trigger & Configuration

- [ ] Workflow file exists at `.github/workflows/generate-dashboard.yml`
- [ ] Workflow triggers on schedule (recommended: daily, e.g., `0 0 * * *`)
- [ ] Manual trigger via workflow dispatch is enabled (`workflow_dispatch`)
- [ ] `GITHUB_USERNAME` is read from repository secrets or variables
- [ ] Workflow fails gracefully if `GITHUB_USERNAME` is not configured
- [ ] Workflow logs include timestamp and configuration values (redacted secrets)
- [ ] Scheduled and manual runs produce identical JSON structure

### 1.2 API Authentication & Rate Limits

- [ ] Workflow uses `GITHUB_TOKEN` (auto-provided by Actions context)
- [ ] Rate limit is checked before fetching repos
- [ ] Error handling for rate limit exceeded (HTTP 403)
- [ ] Rate limit headers are logged for troubleshooting
- [ ] Workflow includes `Content-Type: application/vnd.github.v3+json` headers where needed
- [ ] PAT or token refresh mechanism is in place (if using custom token)

### 1.3 Repository Fetching & Selection

- [ ] API call to `/users/{GITHUB_USERNAME}/repos` succeeds
- [ ] All non-fork, non-archived repositories are considered
- [ ] **Forks are excluded** from the top 10 (per PRD: "recommended default")
- [ ] **Archived repos are excluded** from the top 10 (per PRD: "recommended default")
- [ ] Repositories are sorted by `pushed_at` (last push date) in descending order
- [ ] Exactly 10 repositories are selected (or fewer if user has fewer than 10 active repos)
- [ ] Selected repos are stored in the JSON output under `repos[]`
- [ ] Each repo includes:
  - [ ] `name` (repo name)
  - [ ] `full_name` (owner/repo)
  - [ ] `html_url` (direct GitHub link)
  - [ ] `description` (or `null` if not provided)
  - [ ] `primary_language` (or `null`)
  - [ ] `updated_at` (timestamp)
  - [ ] `pushed_at` (timestamp)
  - [ ] `default_branch` (string, typically "main" or "master")
  - [ ] `open_issues_count` (integer)
  - [ ] `open_pull_requests_count` (integer)
  - [ ] `last_commit_date` (latest commit on default branch)
  - [ ] `is_fork` (boolean)
  - [ ] `is_archived` (boolean)
  - [ ] `topics` (array, may be empty)

### 1.4 Release Data Fetching & Enrichment

- [ ] For each repo, workflow queries the GitHub API for releases
- [ ] Latest release is identified by `published_at` (most recent)
- [ ] Release object includes:
  - [ ] `latest_tag` (tag name or `null` if no releases)
  - [ ] `latest_published_at` (ISO timestamp)
  - [ ] `commits_since_latest` (integer count, or `0` if no releases)
  - [ ] `has_release` (boolean)
  - [ ] `release_overdue` (boolean, based on default threshold of 10 commits)
- [ ] Commits since latest release are counted correctly on the default branch
- [ ] Repos with no releases have `has_release: false` and `latest_tag: null`
- [ ] Repos with no commits since last release have `commits_since_latest: 0`

### 1.5 Branch Detection & Copilot Activity Signals

- [ ] Workflow queries branches for each repo
- [ ] Branches matching `copilot/*` pattern are detected
- [ ] `copilot_branch_count` is accurate
- [ ] `copilot_branches` array lists all matching branch names
- [ ] If no Copilot branches exist, arrays are empty `[]`
- [ ] Copilot PRs are detected by:
  - [ ] Author is `github-copilot[bot]`
  - [ ] OR PR is labeled with Copilot-related labels (`copilot`, `ai`, etc.)
- [ ] `copilot_open_pr_count` and `copilot_draft_pr_count` are accurate
- [ ] Draft PR detection correctly identifies `isDraft: true` PRs
- [ ] Copilot-labeled issues are counted in `copilot_labeled_issue_count`
- [ ] `last_activity_at` reflects the most recent Copilot-related action (branch, PR, issue)
- [ ] `signals` array includes only applicable signals:
  - [ ] `"copilot-branch"` if any `copilot/*` branches exist
  - [ ] `"copilot-draft-pr"` if draft PRs from Copilot exist
  - [ ] `"copilot-labeled-issue"` if labeled issues exist
- [ ] Empty repo has `copilot_activity` with all counts at 0 and `signals: []`

### 1.6 Priority Issue Selection

- [ ] For each repo, workflow fetches open issues
- [ ] Issues are scored/ranked by:
  - [ ] Labels: `priority`, `bug`, `critical`, `urgent` (higher weight)
  - [ ] Age: issues older than 14 days (stale threshold) score higher
  - [ ] Triage status: unlabeled or unassigned issues score higher
- [ ] Top 3-5 priority issues are selected per repo
- [ ] Each issue in `priority_issues[]` includes:
  - [ ] `number` (issue number)
  - [ ] `title` (issue title)
  - [ ] `html_url` (direct GitHub link)
  - [ ] `labels` (array of label names)
  - [ ] `created_at` (ISO timestamp)
  - [ ] `age_days` (calculated days since creation)
  - [ ] `is_unassigned` (boolean)
  - [ ] `is_unlabeled` (boolean)
  - [ ] `priority_reason` (e.g., `"priority-label"`, `"stale"`, `"unassigned"`)
- [ ] If no issues exist, `priority_issues: []`
- [ ] Issue selection logic correctly handles:
  - [ ] Issues with multiple priority labels
  - [ ] Very old issues (>60 days)
  - [ ] Recently created issues (<1 day)

### 1.7 Pending Review Detection

- [ ] For each repo, workflow fetches open PRs
- [ ] PRs awaiting review are identified by:
  - [ ] `state: "open"` (not closed or merged)
  - [ ] Review status indicates pending reviews
  - [ ] Draft status is tracked separately
- [ ] Each PR in `pending_reviews.items[]` includes:
  - [ ] `number` (PR number)
  - [ ] `title` (PR title)
  - [ ] `html_url` (direct GitHub link)
  - [ ] `author` (PR author, including bot accounts)
  - [ ] `is_draft` (boolean)
  - [ ] `awaiting_review` (boolean)
  - [ ] `created_at` (ISO timestamp)
  - [ ] `updated_at` (ISO timestamp)
  - [ ] `requested_reviewers` (array of usernames)
  - [ ] `source` (e.g., `"copilot"`, `"user"`, `"unknown"`)
- [ ] `pending_reviews.count` matches the length of `pending_reviews.items[]`
- [ ] Copilot-authored PRs have `source: "copilot"`
- [ ] User-authored PRs have `source: "user"`
- [ ] If no pending PRs, `pending_reviews: { count: 0, items: [] }`

### 1.8 Next Steps Heuristics

- [ ] `next_steps.status` is one of: `"needs-attention"`, `"active"`, `"quiet"`
- [ ] `next_steps.signals[]` includes applicable signals:
  - [ ] `"release-overdue"` if `releases.release_overdue: true`
  - [ ] `"prs-need-review"` if `pending_reviews.count > 0`
  - [ ] `"issues-need-triage"` if any priority issue is unassigned or unlabeled
  - [ ] `"copilot-work-ready"` if Copilot has open/draft PRs awaiting review
  - [ ] `"recently-active"` if recent commits in last 7 days
- [ ] Status is determined by signal priority:
  - [ ] `"needs-attention"` if any critical signals present (release overdue, unreviewed Copilot work)
  - [ ] `"active"` if recent activity but no urgent signals
  - [ ] `"quiet"` if no recent activity and no urgent signals
- [ ] `next_steps.summary` is a readable, one-sentence human summary
- [ ] Summary correctly reflects all present signals
- [ ] Empty repo (no issues, no PRs, no releases) has `status: "quiet"` and `signals: []`

### 1.9 JSON Output Schema Validation

- [ ] Generated JSON is valid JSON (no syntax errors)
- [ ] Root object includes:
  - [ ] `generated_at` (ISO timestamp of generation time)
  - [ ] `owner` (GitHub username from config)
  - [ ] `repo_count` (number of repos in array, 0-10)
  - [ ] `repos` (array of repo objects)
- [ ] JSON is placed at `docs/dashboard-data.json`
- [ ] JSON matches the PRD schema shape
- [ ] JSON is minified (no unnecessary whitespace)
- [ ] Generated JSON is human-readable when pretty-printed
- [ ] All timestamps are in ISO 8601 format (e.g., `2026-05-23T02:22:49-07:00`)

### 1.10 Error Handling & Resilience

- [ ] Workflow handles missing `GITHUB_USERNAME`: logs error, exits with non-zero code
- [ ] Workflow handles API failures (timeouts, 5xx errors): retries or logs gracefully
- [ ] Workflow handles rate limit (HTTP 403): logs warning, outputs partial data if safe
- [ ] Workflow handles repo with missing description: outputs `null`
- [ ] Workflow handles repo with no default branch: uses fallback or logs error
- [ ] Workflow handles incomplete release data (missing date): uses fallback or `null`
- [ ] Workflow handles API field changes gracefully (missing optional fields)
- [ ] All errors are logged with context (repo name, API endpoint, error message)
- [ ] Workflow does not crash on a single repo's API failure; continues with remaining repos

---

## Part 2: Dashboard UI Tests

### 2.1 JSON Loading & Parsing

- [ ] Dashboard HTML loads successfully
- [ ] Dashboard fetches `docs/dashboard-data.json` on page load
- [ ] JSON is parsed without errors
- [ ] Error state is shown if JSON fails to load (e.g., 404, network error)
- [ ] Dashboard handles empty repo list (`repo_count: 0`)
- [ ] Dashboard re-renders if JSON is refreshed (manual refresh or scheduled reload)

### 2.2 Repository Card Rendering

- [ ] One card is rendered per repository
- [ ] Card includes repository name (link to GitHub)
- [ ] Card includes description (or placeholder if missing)
- [ ] Card includes last commit date (formatted as relative date, e.g., "2 days ago")
- [ ] Card includes primary language (with color coding if provided)
- [ ] Card includes open issues count (linked to issues page)
- [ ] Card includes open pull requests count (linked to PRs page)
- [ ] Card layout is responsive and readable on desktop (1024px+)
- [ ] Card layout is readable on mobile (320px+)
- [ ] Card is not broken when text is very long (wrapping works)
- [ ] Card is not broken when description is missing

### 2.3 Release Information Display

- [ ] Release card section shows latest tag (e.g., "v0.3.0")
- [ ] Release section shows release date (formatted as relative date)
- [ ] Release section shows commits since latest release (red indicator if > 10)
- [ ] "No releases" state is clearly shown if `has_release: false`
- [ ] Release-overdue indicator shows (visual highlight) if `release_overdue: true`
- [ ] Release section links to releases page on GitHub
- [ ] Release dates are formatted as relative dates (e.g., "3 weeks ago")

### 2.4 Copilot Activity Badge & Signals

- [ ] Copilot activity badge is visible if any `copilot_activity.signals` are present
- [ ] Badge shows count of Copilot branches and PRs (e.g., "2 branches, 1 PR")
- [ ] Badge includes visual icon or label indicating Copilot presence
- [ ] Badge is clickable/expandable to show Copilot branches and PR links
- [ ] Copilot branches are listed with clickable links
- [ ] Copilot PR links are included with PR numbers and titles
- [ ] Badge color/styling distinguishes it from other card elements
- [ ] Badge does not appear if no Copilot activity exists
- [ ] Badge correctly shows draft PR indicator if present

### 2.5 Priority Issues Display

- [ ] Priority issues section shows up to 3-5 top issues
- [ ] Each issue includes number, title, and link to GitHub
- [ ] Issue labels are displayed with appropriate styling
- [ ] Issue age is shown (e.g., "13 days old")
- [ ] Unassigned issues have visual indicator
- [ ] Unlabeled issues have visual indicator
- [ ] Priority reason is documented (e.g., "priority-label", "stale")
- [ ] "No priority issues" state is shown if empty
- [ ] Issue list does not appear if no issues exist

### 2.6 Pending Review Section

- [ ] Pending reviews count is displayed
- [ ] Each PR includes number, title, author, and link to GitHub
- [ ] Draft PR status is visually indicated
- [ ] Copilot-authored PRs are visually distinguished
- [ ] Requested reviewer names are shown
- [ ] PR creation and last update dates are shown (relative format)
- [ ] "No pending reviews" state is shown if empty
- [ ] Review section does not appear if no pending PRs exist

### 2.7 Next Steps Indicator

- [ ] Next steps status is displayed prominently (e.g., "needs-attention", "active", "quiet")
- [ ] Status color-coding is consistent:
  - [ ] Red/urgent for "needs-attention"
  - [ ] Yellow/moderate for "active"
  - [ ] Gray/neutral for "quiet"
- [ ] Status summary text is displayed and readable
- [ ] Summary text matches the computed signals (release overdue, PRs need review, etc.)
- [ ] Clicking status shows or highlights relevant signals
- [ ] Status is updated when JSON is refreshed

### 2.8 Responsive & Mobile Layout

- [ ] Cards stack vertically on mobile (< 768px width)
- [ ] Cards are side-by-side on desktop (>= 1024px)
- [ ] Touch-friendly tap targets (minimum 44x44px)
- [ ] Text is readable on mobile without horizontal scrolling
- [ ] Images/icons scale appropriately
- [ ] Dark theme is consistent across all screen sizes
- [ ] No layout shift or jank when page loads

### 2.9 Date & Time Formatting

- [ ] Dates are shown in relative format (e.g., "2 days ago", "3 weeks ago")
- [ ] Relative date calculation is accurate
- [ ] Tooltip or hover shows absolute date (ISO or readable format)
- [ ] "Today" is shown for same-day activity
- [ ] "Tomorrow" or "x hours ago" is not used (relative format only)
- [ ] Dates older than 1 year show full date, not relative

### 2.10 Empty & Error States

- [ ] Empty state is shown when `repo_count: 0` with helpful message
- [ ] Empty state includes link to configure `GITHUB_USERNAME`
- [ ] Error state is shown when JSON fails to load (404, timeout, etc.)
- [ ] Error state includes retry button
- [ ] Error state logs error message to browser console
- [ ] Loading state (spinner or message) is shown while fetching JSON
- [ ] All states have appropriate styling and are readable

---

## Part 3: Edge Cases & Data Integrity

### 3.1 Repositories with Missing Data

- [ ] Repo with **no description**: card still renders, description area is empty or shows placeholder
- [ ] Repo with **no releases**: `has_release: false`, `latest_tag: null`, `commits_since_latest: 0`
- [ ] Repo with **no primary language**: language field is `null`, UI shows no language badge
- [ ] Repo with **no default branch** (rare): workflow handles gracefully or uses fallback
- [ ] Repo with **`open_issues_count: 0` and `open_pull_requests_count: 0`**: card renders without error
- [ ] Repo with **no commits** on default branch: `last_commit_date: null`, UI shows "no commits" or placeholder

### 3.2 Repositories with Extreme Data

- [ ] Repo with **50+ open issues**: `priority_issues[]` is still limited to 3-5 items
- [ ] Repo with **20+ open PRs**: `pending_reviews.count` is accurate, list may be paginated/limited in UI
- [ ] Repo with **very long description** (>500 chars): card layout does not break, text truncates
- [ ] Repo with **very old releases** (>5 years): `last_published_at` is formatted correctly, no calculation errors
- [ ] Repo with **no releases but 100+ commits**: `release_overdue: true` is set correctly

### 3.3 Copilot Activity Edge Cases

- [ ] Repo with **Copilot branches but no open PRs**: `copilot_branch_count > 0`, `copilot_open_pr_count: 0`
- [ ] Repo with **Copilot draft PR but no Copilot branches**: `copilot_draft_pr_count > 0`, `copilot_branch_count: 0`
- [ ] Repo with **Copilot-labeled issue but no Copilot PRs**: issue is counted in activity, signals are accurate
- [ ] Repo with **multiple `copilot/*` branches**: all are listed, count is accurate
- [ ] Repo with **Copilot PR from 6 months ago** (stale): `last_activity_at` is accurate

### 3.4 Priority Issue Selection

- [ ] All top issues are marked with `priority-label` or `bug` or `critical` label: they appear in priority list
- [ ] Issue **older than 60 days** is ranked higher (stale heuristic)
- [ ] Issue that is **unassigned AND unlabeled**: highest priority score
- [ ] Issue with **3+ labels**: correctly parsed, none are duplicated
- [ ] Issue with **no labels and assigned**: may not appear in priority list if not old
- [ ] Issue **created 1 hour ago**: correctly shows `age_days: 0`

### 3.5 Release Readiness Heuristics

- [ ] Repo with **0 releases and 50 commits**: `release_overdue: true`
- [ ] Repo with **latest release 1 month ago and 5 commits since**: `release_overdue: false` (under 10-commit threshold)
- [ ] Repo with **latest release 1 month ago and 15 commits since**: `release_overdue: true` (over 10-commit threshold)
- [ ] Repo with **release from 2 months ago and 0 commits**: `release_overdue: false`
- [ ] Repo with **pre-release tag**: does not count as release (or handled as special case)

### 3.6 Status Indicator Edge Cases

- [ ] All repos in **"quiet" status**: dashboard shows all gray, no urgency
- [ ] All repos in **"needs-attention" status**: dashboard shows all red/high urgency
- [ ] Mix of statuses: colors and sorting are correct
- [ ] Repo with **multiple urgent signals** (release overdue + Copilot work ready): correct status
- [ ] Repo with **only "recently-active" signal**: status is "active", not "quiet"

### 3.7 Configuration & User Handling

- [ ] Workflow with **`GITHUB_USERNAME` not set**: error is logged, build does not fail silently
- [ ] Workflow with **`GITHUB_USERNAME` set to non-existent user**: API returns empty repo list, JSON is still valid
- [ ] Workflow with **`GITHUB_USERNAME` set to org (not user)**: either works (if org) or error is clear
- [ ] User with **only 5 repos** (fewer than 10): `repo_count: 5`, all 5 are shown
- [ ] User with **100+ repos**: exactly 10 are selected (by `pushed_at` order)

### 3.8 Fork & Archive Handling

- [ ] **Forks created by user**: excluded from top 10 (per PRD default)
- [ ] **Forks user is actively working on** (recent commits): may need explicit handling (confirm with PRD)
- [ ] **Archived repos**: excluded from top 10 (per PRD default)
- [ ] **Archived repos with Copilot work**: still excluded (archive takes precedence)
- [ ] Filter logic does not remove more than necessary repos

---

## Part 4: Integration & End-to-End Tests

### 4.1 Workflow Execution

- [ ] Scheduled workflow runs at configured time (daily)
- [ ] Manual workflow dispatch via GitHub Actions UI succeeds
- [ ] Workflow logs show:
  - [ ] Start and end timestamps
  - [ ] Configuration values (redacted secrets)
  - [ ] Number of repos fetched
  - [ ] Any API errors or rate limit warnings
  - [ ] JSON file path and size
- [ ] Workflow completes in < 5 minutes (reasonable time)
- [ ] Workflow does not exceed GitHub Actions rate limits or job timeout (6 hours)

### 4.2 JSON Generation & Artifact Storage

- [ ] Workflow generates JSON file at `docs/dashboard-data.json`
- [ ] JSON is committed to repository (or generated as artifact)
- [ ] JSON is committed with a clear message (e.g., "Update dashboard data")
- [ ] Commit includes timestamp
- [ ] Commit does not include secrets or sensitive data
- [ ] JSON file is included in GitHub Pages build

### 4.3 GitHub Pages Deployment

- [ ] GitHub Pages is enabled for the repository
- [ ] GitHub Pages source is set to `main` branch, `/docs` folder (or configured root)
- [ ] Dashboard HTML (`docs/index.html`) is deployed
- [ ] JSON data file (`docs/dashboard-data.json`) is deployed
- [ ] Site is accessible at `https://{owner}.github.io/{repo}/`
- [ ] Site is accessible from a fresh browser (not cached)
- [ ] HTTPS is enforced (if available)
- [ ] Deployment does not fail due to missing files

### 4.4 Dashboard Refresh Cycle

- [ ] Workflow runs and generates new JSON
- [ ] JSON is committed to the repository
- [ ] GitHub Pages automatically serves the new JSON
- [ ] Dashboard page fetches and renders updated JSON
- [ ] All changes (new repos, updated issues, release info) appear on dashboard
- [ ] Refresh takes < 5 minutes from workflow trigger to live dashboard

### 4.5 Manual Refresh

- [ ] User can trigger workflow manually via GitHub Actions > "Run workflow"
- [ ] Manual trigger includes an input field for `GITHUB_USERNAME` (optional override)
- [ ] Manual run produces identical output to scheduled run (same config)
- [ ] Manual run results are reflected on dashboard within minutes

### 4.6 Error Recovery & Retry

- [ ] If workflow fails due to API timeout, it logs error and exits gracefully
- [ ] If workflow partially succeeds (e.g., 8 of 10 repos), JSON includes partial data and logs warning
- [ ] If JSON file is corrupted, dashboard shows error state (not blank page)
- [ ] User can manually retry workflow from Actions UI
- [ ] Previous JSON is preserved if new run fails

### 4.7 Cross-Repository Validation

- [ ] Test with 3+ different users' accounts (if safe/allowed)
- [ ] Verify data for each user is isolated and correct
- [ ] Verify fork of the project for new user works without code changes
- [ ] Verify configuration is as simple as setting `GITHUB_USERNAME`

### 4.8 Feature Completeness End-to-End

- [ ] Complete flow: schedule triggers → workflow runs → API fetches repos → JSON written → Pages deployed → dashboard renders
- [ ] Dashboard displays all repo cards with correct data
- [ ] Release info is visible and accurate
- [ ] Copilot badges appear for active repos
- [ ] Priority issues are listed with correct links
- [ ] Next steps indicators reflect current state
- [ ] All links (repo, issues, PRs, releases) point to correct GitHub URLs

---

## Part 5: Performance & Quality

### 5.1 Workflow Performance

- [ ] Workflow completes in < 2 minutes (typical)
- [ ] API calls are batched where possible (single call per repo type)
- [ ] No unnecessary API calls are made
- [ ] Rate limit usage is logged and reviewed
- [ ] Workflow does not make duplicate requests

### 5.2 Dashboard Performance

- [ ] Dashboard loads in < 2 seconds on broadband (desktop)
- [ ] JSON parsing is fast (< 100ms)
- [ ] Card rendering is smooth (no jank)
- [ ] No console errors or warnings (except expected external scripts)
- [ ] Lighthouse performance score is > 80 (desktop)
- [ ] Mobile performance score is > 70

### 5.3 Data Freshness

- [ ] Dashboard data is never older than scheduled interval (e.g., 24 hours)
- [ ] Manual refresh provides same freshness as scheduled refresh
- [ ] Timestamps in JSON match workflow execution time (within 1 minute)

### 5.4 Browser Compatibility

- [ ] Dashboard loads and renders in Chrome/Chromium (latest)
- [ ] Dashboard loads and renders in Firefox (latest)
- [ ] Dashboard loads and renders in Safari (latest)
- [ ] Dashboard loads and renders in Edge (latest)
- [ ] No JavaScript errors in any browser

### 5.5 Accessibility (Basic)

- [ ] Cards have readable text contrast (WCAG AA minimum)
- [ ] Links are underlined or clearly marked
- [ ] Colors are not the only means of conveying information (labels + colors)
- [ ] Page is navigable with keyboard (Tab, Enter)
- [ ] Status badges have text alternatives (not icon-only)

---

## Part 6: Documentation & Reusability

### 6.1 README & Setup Instructions

- [ ] README.md includes clear fork & configure instructions
- [ ] README explains how to set `GITHUB_USERNAME`
- [ ] README explains how to verify the workflow runs
- [ ] README includes troubleshooting section
- [ ] README includes screenshot or GIF of dashboard
- [ ] README includes link to live example (if public)

### 6.2 Code Quality & Comments

- [ ] Workflow YAML is commented and readable
- [ ] Dashboard JavaScript is clean and maintainable
- [ ] CSS is organized and documented
- [ ] Hardcoded values (thresholds, limits) are explained or configurable
- [ ] No debug or test code is left in production files

### 6.3 Configuration & Extensibility

- [ ] `GITHUB_USERNAME` is the only required configuration
- [ ] All thresholds (release overdue, stale days, etc.) are clearly defined
- [ ] Comments explain how to override thresholds (if desired)
- [ ] No hardcoded values for configurable parameters
- [ ] Future extensibility points are noted (e.g., private repos, custom filters)

---

## Part 7: Authentication & Private Mode

### 7.1 Device Flow Authentication - Happy Path

- [ ] Sign-in button is visible in the header when unauthenticated
- [ ] Clicking sign-in triggers GitHub App Device Flow start
- [ ] API response includes device code, user code, and verification URL
- [ ] Device code panel displays verification URL (`github.com/login/device`)
- [ ] Device code panel displays user code (8-10 character alphanumeric)
- [ ] User can copy/click user code in the panel
- [ ] Panel shows "Waiting for authorization…" status during polling
- [ ] Polling interval is correct (5-second intervals recommended)
- [ ] After user completes auth at verification URL, polling detects authorization
- [ ] Bearer token is received in API response
- [ ] Access token is stored in `sessionStorage` under key `ghd.auth.session.v1`
- [ ] Access token includes expiration time and refresh token
- [ ] Panel closes on successful auth
- [ ] Device code panel is removed from DOM after success

### 7.2 Device Flow - User Cancellation

- [ ] Cancel button is present in device code panel during polling
- [ ] Clicking cancel closes the panel and stops polling
- [ ] Device code is cleared from memory
- [ ] App remains in public/unauthenticated state
- [ ] User can retry sign-in after cancellation
- [ ] No error banner is shown on user-initiated cancel

### 7.3 Device Flow - Polling Timeout & Expiry

- [ ] Device flow starts with device code expiry time (typically 15 minutes)
- [ ] If polling exceeds expiry time without authorization, polling stops
- [ ] Error message is displayed: "Device code expired. Please try again."
- [ ] User can click retry to restart the flow
- [ ] Old device code is cleared and new code is requested
- [ ] App does not get stuck in polling state after expiry

### 7.4 Device Flow - Network Errors During Polling

- [ ] If network error occurs during polling (e.g., timeout), error is caught
- [ ] Error banner is shown with message like "Network error during sign-in"
- [ ] Error includes a "Retry" button
- [ ] Retry continues polling with the same device code (if still valid)
- [ ] Multiple network errors eventually trigger timeout error (not infinite retry)
- [ ] App does not enter an unrecoverable state

### 7.5 Device Flow - Invalid/Expired Device Code Rejection

- [ ] If token endpoint rejects device code with `error: "expired_token"`, polling stops
- [ ] User is prompted to start a new flow
- [ ] App does not attempt to use expired device code
- [ ] UI clearly indicates the code has expired

### 7.6 Owner Verification - Match Success

- [ ] After token is received, app calls `GET /user` to fetch signed-in user login
- [ ] Signed-in user login is compared to configured `GITHUB_USERNAME`
- [ ] If logins match, owner verification succeeds
- [ ] Auth session is stored with `owner` and `login` fields
- [ ] Device code panel closes
- [ ] Header changes from "Public view" to "Private view"
- [ ] Private mode UI controls become visible (refresh button, sign-out)

### 7.7 Owner Verification - User Mismatch

- [ ] If signed-in user login does NOT match configured owner, access is denied
- [ ] Auth session is immediately cleared from `sessionStorage`
- [ ] Private cache is cleared from `localStorage`
- [ ] Error banner is displayed: "Sign-in failed: user is not the configured owner"
- [ ] App reverts to public/unauthenticated state
- [ ] User is invited to sign out from GitHub and try again with correct account
- [ ] Device code panel closes on mismatch

### 7.8 Owner Verification - API Failure

- [ ] If `GET /user` fails (e.g., 401 Unauthorized, network error), error is caught
- [ ] Error banner is shown: "Failed to verify user. Please try again."
- [ ] Current auth session is NOT automatically cleared
- [ ] User can retry verification
- [ ] If retry continues to fail, suggest sign-out and retry
- [ ] App does not render private data if verification fails

### 7.9 Cache Manager - Write & Read

- [ ] After private repo fetch completes, cache is written to `localStorage`
- [ ] Cache key is `ghd.private.cache.v1`
- [ ] Cache object includes `schemaVersion`, `owner`, `source`, `fetchedAt`, `repoCatalog`, `dashboard`
- [ ] Cache can be read back from `localStorage` without errors
- [ ] Data read from cache matches data written
- [ ] Cache persists across page reloads (until hard stale or manual clear)
- [ ] Writing new cache overwrites old cache without data corruption

### 7.10 Cache Manager - Soft Stale Detection

- [ ] Cache includes `softStaleAt` timestamp (15 minutes after `fetchedAt`)
- [ ] On app load, if current time > `softStaleAt`, cache is marked as soft stale
- [ ] Soft stale cache is still rendered (showing cached data to user)
- [ ] Soft stale cache triggers automatic background refresh
- [ ] "Refresh private data" button is visible when cache is soft stale
- [ ] User can click to refresh immediately if desired
- [ ] Background refresh runs without blocking UI

### 7.11 Cache Manager - Hard Stale Detection

- [ ] Cache includes `hardStaleAt` timestamp (24 hours after `fetchedAt`)
- [ ] If current time > `hardStaleAt`, cache is discarded
- [ ] Discarded cache is deleted from `localStorage`
- [ ] App shows public dashboard while fetching fresh private data
- [ ] User is notified: "Private cache expired. Refreshing…"
- [ ] After refresh completes, private data is rendered

### 7.12 Cache Manager - Schema Version Mismatch

- [ ] If cached data has `schemaVersion !== 1`, cache is discarded
- [ ] User is notified of cache format change (if applicable)
- [ ] Fresh data is fetched to populate new schema
- [ ] App does not crash on schema version mismatch

### 7.13 Cache Manager - Owner Mismatch in Cache

- [ ] Cached data includes `owner` field
- [ ] If authenticated user's `owner` !== cached `owner`, cache is discarded
- [ ] Fresh data is fetched for the current owner
- [ ] Multiple owners can use same browser without cache conflicts

### 7.14 Cache Manager - Clear on Sign-Out

- [ ] Sign-out button clears auth session from `sessionStorage`
- [ ] Sign-out also clears private cache from `localStorage`
- [ ] Both `ghd.auth.session.v1` and `ghd.private.cache.v1` are removed
- [ ] Header reverts to "Public view"
- [ ] Private UI controls (refresh, sign-out) are hidden
- [ ] Dashboard reverts to showing public data only
- [ ] User can sign in again after sign-out

### 7.15 Browser Fetch Pipeline - Repo Selection

- [ ] On authentication, app fetches ALL owner repos (public + private) via `GET /user/repos`
- [ ] Pagination is handled correctly (GitHub API returns paginated results)
- [ ] Selection rules are applied:
  - [ ] Exclude forks (`is_fork: false` filter)
  - [ ] Exclude archived (`is_archived: false` filter)
  - [ ] Sort by `pushed_at` or `updated_at` in descending order
  - [ ] Limit to 10 repos (if user has >10)
- [ ] Selected repos match the same selection logic as public pipeline
- [ ] Repo catalog is stored in cache with all necessary metadata

### 7.16 Browser Fetch Pipeline - Data Normalization

- [ ] Fetched private repo data is normalized to same shape as `data/dashboard.json`
- [ ] Each repo includes: `name`, `full_name`, `html_url`, `description`, `primary_language`, etc.
- [ ] Release data is fetched and structured identically to public pipeline
- [ ] Copilot signals are detected and structured identically
- [ ] Priority issues are computed using same heuristics
- [ ] Pending reviews are computed using same rules
- [ ] Next steps status is computed using same signals
- [ ] Normalized dashboard object is stored in cache under `dashboard` key

### 7.17 Browser Fetch Pipeline - Rate Limiting

- [ ] App enforces max 3-4 concurrent API requests (e.g., concurrent repo detail fetches)
- [ ] Requests are queued when limit is reached
- [ ] Queue is processed FIFO as requests complete
- [ ] Rate limit headers are parsed from API responses
- [ ] If rate limit is reached, app waits or shows user-friendly message
- [ ] App does not make 50+ simultaneous requests

### 7.18 Browser Fetch Pipeline - Partial Failure Handling

- [ ] If one repo detail call fails (e.g., 404 for releases), that repo is not skipped entirely
- [ ] Other data for that repo is still shown (name, description, link)
- [ ] Failed fields are populated with safe defaults (empty arrays, null)
- [ ] Error is logged to console with context (repo name, endpoint, error)
- [ ] App does not fail on partial failures; continues fetching remaining repos
- [ ] User is notified if significant data is missing (optional banner)

### 7.19 Browser Fetch Pipeline - Token Expiry & Refresh

- [ ] If API returns 401 Unauthorized (token expired), refresh token flow is triggered
- [ ] Refresh token endpoint is called with stored `refreshToken`
- [ ] New access token and refresh token are received and stored in `sessionStorage`
- [ ] Original failed request is automatically retried with new token
- [ ] User is not interrupted (refresh happens transparently)
- [ ] If refresh also fails, user is prompted to sign in again

### 7.20 App Bootstrap - Unauthenticated Load

- [ ] On initial load with no auth session, app fetches `data/dashboard.json` (public data)
- [ ] Public data is parsed and rendered
- [ ] Header shows "Public view"
- [ ] Sign-in button is visible and enabled
- [ ] Private UI controls are hidden
- [ ] No errors in console

### 7.21 App Bootstrap - Authenticated + Fresh Cache

- [ ] On load, app detects `ghd.auth.session.v1` in `sessionStorage`
- [ ] App checks for `ghd.private.cache.v1` in `localStorage`
- [ ] If cache exists and is not stale, cache is rendered immediately
- [ ] Header shows "Private view" with last refresh timestamp
- [ ] User sees private dashboard without waiting for network fetch
- [ ] Background refresh starts asynchronously (visible as "Refreshing…" indicator)

### 7.22 App Bootstrap - Authenticated + Soft-Stale Cache

- [ ] On load with soft-stale cache (`current time > softStaleAt`):
  - [ ] Cache is rendered immediately to user
  - [ ] "Refresh private data" button is visible
  - [ ] Background refresh runs automatically
  - [ ] Status shows "Refreshing private data…"
- [ ] User can interact with dashboard while refresh runs
- [ ] When refresh completes, dashboard is updated in-place (no full page reload)

### 7.23 App Bootstrap - Authenticated + Hard-Stale Cache

- [ ] On load with hard-stale cache (`current time > hardStaleAt`):
  - [ ] Cache is discarded
  - [ ] Public dashboard is shown as placeholder
  - [ ] Status shows "Refreshing private data…"
  - [ ] Fresh private data is fetched
  - [ ] When fetch completes, private dashboard replaces public
  - [ ] No error is shown; refresh is silent from user's perspective

### 7.24 App Bootstrap - Authenticated + No Cache

- [ ] On load with valid auth but no private cache:
  - [ ] Public dashboard is shown immediately
  - [ ] Status shows "Fetching private data…"
  - [ ] Fetch pipeline runs in background
  - [ ] When complete, private dashboard replaces public
  - [ ] No error is shown

### 7.25 App Bootstrap - Background Refresh Completes

- [ ] After background refresh finishes, new data is available in `localStorage`
- [ ] Dashboard is re-rendered with new data (in-place update, not page reload)
- [ ] Last refresh timestamp is updated
- [ ] User sees up-to-date private data
- [ ] Status indicator shows refresh complete

### 7.26 UI State - Sign-In Button Visibility

- [ ] Sign-in button is visible when `sessionStorage` has no auth session
- [ ] Sign-in button is hidden when `sessionStorage` contains valid auth session
- [ ] Button text is clear: "Sign in with GitHub" or similar
- [ ] Button is clickable and properly styled

### 7.27 UI State - Device Code Panel

- [ ] Device code panel appears at top of page during auth flow
- [ ] Panel includes device code (user code) prominently
- [ ] Panel includes verification URL with link or copy button
- [ ] Panel includes cancel button
- [ ] Panel shows polling status/spinner
- [ ] Panel layout is responsive and readable on mobile
- [ ] Panel does not cover critical content

### 7.28 UI State - Private/Public Badge

- [ ] Header shows "Public view" when unauthenticated
- [ ] Header shows "Private view" when authenticated
- [ ] Badge includes last refresh timestamp when authenticated
- [ ] Badge styling is visually distinct
- [ ] Badge text is clear and unambiguous

### 7.29 UI State - Refresh & Sign-Out Controls

- [ ] "Refresh private data" button is only visible when authenticated
- [ ] Clicking refresh triggers background fetch of private data
- [ ] Refresh button shows loading indicator during fetch
- [ ] "Sign out" button is only visible when authenticated
- [ ] Clicking sign-out clears session and cache, reverts to public view
- [ ] Both buttons are easily accessible in header

### 7.30 UI State - Error Banner on Auth Failure

- [ ] Auth errors display prominent error banner (not just console)
- [ ] Error messages are user-friendly (e.g., "Failed to sign in. Please try again.")
- [ ] Error banner includes relevant details (if safe to display)
- [ ] Error banner has dismiss button or auto-dismisses after timeout
- [ ] Error does not block the dashboard (public view is still shown)

### 7.31 Security - Tokens Never in localStorage

- [ ] Tokens are NEVER stored in `localStorage`
- [ ] Tokens are stored only in `sessionStorage`
- [ ] `sessionStorage` is cleared on browser tab close (automatic per browser spec)
- [ ] No backup or cache of tokens exists in `localStorage`

### 7.32 Security - Tokens Never Logged

- [ ] App does not log tokens to browser console (no `console.log(token)`)
- [ ] App does not render tokens in DOM (no `innerHTML` with token)
- [ ] App does not include tokens in error messages shown to user
- [ ] Code review confirms no debug logging of sensitive data

### 7.33 Security - Tokens Never in URLs

- [ ] Tokens are never included in query strings (no `?token=...`)
- [ ] Tokens are never included in URL fragments (no `#token=...`)
- [ ] API calls use `Authorization: Bearer <token>` header only
- [ ] No tokens appear in browser history or back/forward navigation

### 7.34 Security - XSS Prevention with textContent

- [ ] User data (repo names, descriptions, issue titles) is rendered with `textContent`, not `innerHTML`
- [ ] GitHub API data is never injected as raw HTML
- [ ] Links are created via `<a href>` elements (safe) not string concatenation
- [ ] No `innerHTML` operations on untrusted data
- [ ] Code review confirms safe rendering practices

### 7.35 Security - Session Cleared on Browser Tab Close

- [ ] `sessionStorage` is automatically cleared when browser tab closes (per browser spec)
- [ ] App does not store tokens in `localStorage` as fallback
- [ ] On app reload in new tab, if `sessionStorage` is empty, no auth session exists
- [ ] User must sign in again in new tab

### 7.36 Security - Rate Limit Jitter

- [ ] Polling interval includes jitter (e.g., 5s ± random 0-500ms) to prevent thundering herd
- [ ] If multiple users poll simultaneously, requests are distributed

### 7.37 Security - Refresh Token Rotation

- [ ] Each time refresh token is used, a new refresh token is issued
- [ ] Old refresh token is discarded
- [ ] App stores new refresh token in `sessionStorage`
- [ ] Refresh token reuse is detected and rejected by API (security best practice)

---

## Validation Checklist Summary

Use this summary table to track overall test completion:

| Test Category | Tests | Passed | Failed | Blocked | Notes |
|---|---|---|---|---|---|
| Data Pipeline | 43 | [ ] | [ ] | [ ] | |
| Dashboard UI | 30 | [ ] | [ ] | [ ] | |
| Edge Cases | 27 | [ ] | [ ] | [ ] | |
| Integration | 26 | [ ] | [ ] | [ ] | |
| Performance | 13 | [ ] | [ ] | [ ] | |
| Documentation | 9 | [ ] | [ ] | [ ] | |
| **Authentication & Private Mode** | **98** | [ ] | [ ] | [ ] | |
| **TOTAL** | **246** | [ ] | [ ] | [ ] | |

---

## Test Execution Notes

### Before Running Tests
1. Ensure all code is merged to `main` and reviewed.
2. Verify all dependencies are installed.
3. Create a test account or use a real GitHub account with permission to test.
4. Document any test data (repos, issues, PRs) used for validation.

### During Testing
- Mark each test with ✓ (passed), ✗ (failed), or ⏸ (blocked).
- Log any failures with reproduction steps.
- Note any test environment issues (e.g., network, API rate limits).
- Take screenshots of UI tests for evidence.

### After Testing
- Document any bugs found, with severity and reproduction steps.
- Create GitHub issues for failed tests.
- Update this plan if new edge cases are discovered.
- Archive test data or reset test environment.

---

## Sign-Off

- [ ] All tests executed
- [ ] All critical tests passed
- [ ] Edge cases validated
- [ ] Performance acceptable
- [ ] Documentation reviewed
- [ ] Ready for production deployment

**Signed by:** _____________________ (QA/Tester)  
**Date:** _____________________
