# GitHubDashboard Product Requirements Document (PRD)

**Owner:** Project Owner  
**Author:** Keyser  
**Date:** 2026-05-23T02:22:49-07:00  
**Status:** Draft

## 1. Problem Statement
The user is using GitHub Copilot, especially the Cloud/Coding Agent workflow, to create and move multiple repositories forward in parallel. The bottleneck is no longer starting projects; it is keeping up with what is happening across those repos: which ones are active, which need a release, where Copilot has produced work that needs human review, and which issues are most important to address next. GitHubDashboard should reduce that cross-repository scanning overhead by presenting the user's 10 most recently updated repositories in one place with actionable release, issue, PR, and Copilot activity signals. The project should also work as a reusable template that any GitHub user can fork and configure with their own GitHub username.

## 2. Goals & Non-Goals

### Goals
- Provide a single dashboard for the user's 10 most recently updated GitHub repositories.
- Prioritize cross-repo visibility for Copilot-driven development workflows.
- Surface release readiness, active issues, pending reviews, and Copilot activity per repository.
- Highlight likely next steps using simple but actionable attention indicators.
- Refresh data automatically without requiring local scripts or a server.
- Keep hosting and operations lightweight by using GitHub Pages and GitHub Actions.
- Keep the project reusable so any GitHub user can fork it and configure their own account.

### Non-Goals
- Full project management, sprint planning, or issue triage workflows.
- Real-time updates or live polling of the GitHub API in the browser.
- Editing issues, pull requests, releases, or repository settings from the dashboard.
- Support for multiple GitHub accounts in v1.
- Deep analytics such as contributor trends, code churn, or velocity reporting.
- Deep Copilot telemetry beyond what can be inferred from GitHub-native objects such as branches, pull requests, labels, and authorship.

## 3. User Stories
- As a user, I want to see my 10 most recently updated repositories in one view so I can quickly understand what is active.
- As a user, I want to know which repositories need a release so I can keep Copilot-generated projects shipping.
- As a user, I want to see where Copilot or the Cloud Agent has created branches or pull requests so I know what needs human review.
- As a user, I want to see open issues and the top priority issues per repository so I can focus on the work most likely to unblock progress.
- As a user, I want simple next-step indicators so I can decide what deserves attention first without opening every repo.
- As a user, I want the dashboard to refresh automatically so the view stays useful with minimal maintenance.
- As a user, I want each repository card to link directly to GitHub so I can jump from summary to action in one click.
- As a user, I want to configure the dashboard for my own GitHub account without changing source code so the project is easy to reuse.

## 4. Features (MVP)
1. **Dashboard page** showing the user's 10 most recently updated repositories, optimized for monitoring multiple Copilot-assisted projects.
2. **Repository summary card** for each repo with:
   - Repository name
   - Description
   - Last commit date
   - Primary language
   - Open issues count
   - Open pull requests count
   - Latest release tag and release date (or explicit no-release state)
   - Commits since latest release
   - Copilot activity badge(s)
   - Link to the repository
3. **Release readiness module** that surfaces:
   - Repos with no releases but recent commits
   - Repos whose commits since latest release exceed a release-overdue threshold
   - Latest release recency so the user can see what is falling behind
4. **Active issues dashboard** per repo that surfaces:
   - Open issue count
   - Unassigned or unlabeled issues needing triage
   - Priority issues based on labels such as `priority`, `bug`, `critical`, or age/staleness
5. **Copilot activity signals** that detect likely GitHub Copilot / Cloud Agent activity using:
   - `copilot/*` or similarly named Copilot work branches
   - Copilot-authored or Copilot-labeled pull requests
   - Copilot-related labels on issues or pull requests
6. **PR review queue** showing PRs awaiting review across repos, with emphasis on:
   - Copilot-authored draft PRs that appear ready for human review
   - Any PRs waiting on reviewer action
7. **Next steps indicators** based on actionable heuristics, such as:
   - Release overdue
   - PRs need review
   - Issues need triage
   - Copilot work ready
   - Recently active repo
8. **Automated refresh** using a scheduled GitHub Actions workflow.
9. **Manual refresh** through workflow dispatch.
10. **Static deployment** to GitHub Pages.
11. **Reusable account configuration** via a repository secret or variable (for example `GITHUB_USERNAME`) so the template can be configured without code changes.

## 5. Architecture Overview
GitHubDashboard will use a static-site architecture with a scheduled data pipeline:

1. A GitHub Actions workflow runs on a schedule (recommended default: daily) and on manual trigger.
2. The workflow reads the configured GitHub username from a repository secret or repository variable such as `GITHUB_USERNAME`.
3. The workflow calls the GitHub REST API for the configured GitHub username.
4. The workflow selects the 10 most recently updated repositories and enriches each with release, issue, pull request, branch, and Copilot activity fields.
5. The workflow computes repo-level heuristics for release readiness, priority issues, pending reviews, and next-step indicators.
6. The workflow writes a generated JSON data file into the site output.
7. A static HTML/CSS/JavaScript page reads the JSON file and renders the dashboard.
8. GitHub Pages publishes the static site through Actions.

### Architectural Principles
- **Static-first:** precompute data in CI rather than calling the API from the browser.
- **Low ops:** no backend service, database, or runtime hosting.
- **Readable outputs:** generated JSON should be simple enough to inspect manually.
- **Action-oriented:** precompute concise indicators that answer release, review, and issue-priority questions at a glance.
- **Progressive enhancement:** core dashboard must remain usable without any framework dependency.
- **Template-friendly:** account-specific settings such as the GitHub username must come from repository configuration, not hardcoded values.

## 6. Data Model

### Repository Fields
Each repository record should include:

- `name`: repository name
- `full_name`: owner/repo
- `html_url`: GitHub repository URL
- `description`: repository description
- `primary_language`: dominant language
- `updated_at`: repository last updated timestamp
- `pushed_at`: last push timestamp
- `default_branch`: default branch name
- `open_issues_count`: count of open issues
- `open_pull_requests_count`: count of open pull requests
- `last_commit_date`: latest commit timestamp on default branch
- `is_fork`: whether the repo is a fork
- `is_archived`: whether the repo is archived
- `topics`: repository topics (optional for v1 rendering, useful for future filtering)
- `releases`: object describing latest release state and release readiness
- `copilot_activity`: object describing Copilot/Cloud Agent signals in the repository
- `priority_issues`: array of top issues selected by labels, age, or missing triage metadata
- `pending_reviews`: object describing open PRs awaiting review
- `next_steps`: object describing attention indicators

### Suggested JSON Shape
```json
{
  "generated_at": "2026-05-23T02:22:49-07:00",
  "owner": "{GITHUB_USERNAME}",
  "repo_count": 10,
  "repos": [
    {
      "name": "GitHubDashboard",
      "full_name": "{GITHUB_USERNAME}/GitHubDashboard",
      "html_url": "https://github.com/{GITHUB_USERNAME}/GitHubDashboard",
      "description": "Reusable GitHub activity dashboard",
      "primary_language": "JavaScript",
      "updated_at": "2026-05-23T02:22:49-07:00",
      "pushed_at": "2026-05-23T02:22:49-07:00",
      "default_branch": "main",
      "open_issues_count": 5,
      "open_pull_requests_count": 3,
      "last_commit_date": "2026-05-23T02:22:49-07:00",
      "is_fork": false,
      "is_archived": false,
      "topics": ["dashboard", "github-pages"],
      "releases": {
        "latest_tag": "v0.3.0",
        "latest_published_at": "2026-05-01T12:00:00-07:00",
        "commits_since_latest": 14,
        "has_release": true,
        "release_overdue": true
      },
      "copilot_activity": {
        "copilot_branch_count": 2,
        "copilot_branches": ["copilot/fix-release-card", "copilot/triage-queue"],
        "copilot_open_pr_count": 1,
        "copilot_draft_pr_count": 1,
        "copilot_labeled_issue_count": 2,
        "last_activity_at": "2026-05-22T18:30:00-07:00",
        "signals": ["copilot-branch", "copilot-draft-pr"]
      },
      "priority_issues": [
        {
          "number": 42,
          "title": "Release dashboard does not flag unreleased commits",
          "html_url": "https://github.com/{GITHUB_USERNAME}/GitHubDashboard/issues/42",
          "labels": ["bug", "priority:high"],
          "created_at": "2026-05-10T09:00:00-07:00",
          "age_days": 13,
          "is_unassigned": true,
          "is_unlabeled": false,
          "priority_reason": "priority-label"
        }
      ],
      "pending_reviews": {
        "count": 2,
        "items": [
          {
            "number": 18,
            "title": "Add release readiness summary",
            "html_url": "https://github.com/{GITHUB_USERNAME}/GitHubDashboard/pull/18",
            "author": "github-copilot[bot]",
            "is_draft": true,
            "awaiting_review": true,
            "created_at": "2026-05-22T16:00:00-07:00",
            "updated_at": "2026-05-22T17:30:00-07:00",
            "requested_reviewers": ["configured-reviewer"],
            "source": "copilot"
          }
        ]
      },
      "next_steps": {
        "status": "needs-attention",
        "signals": [
          "release-overdue",
          "prs-need-review",
          "issues-need-triage",
          "copilot-work-ready"
        ],
        "summary": "Release is overdue, two PRs need review, and one high-priority issue is unassigned."
      }
    }
  ]
}
```

### Next Steps Heuristics (Default Proposal)
- **Release overdue** when `releases.commits_since_latest` exceeds the default threshold, or when a repo has no releases and has meaningful recent commit activity.
- **PRs need review** when one or more open PRs are awaiting reviewer action, including Copilot-authored draft PRs that are ready for human review.
- **Issues need triage** when open issues are unassigned, unlabeled, or aging without recent updates.
- **Copilot work ready** when Copilot/Cloud Agent activity is present and there is at least one open Copilot PR or draft PR awaiting human review.
- **active** when there has been recent commit, issue, or PR activity.
- **quiet** when there is no recent activity and no urgent signals.

Recommended default stale threshold for v1: **14 days**. The user can override this later. Recommended default release-overdue threshold for v1: **10 commits since the latest release**.

## 7. Tech Decisions
- **Frontend:** Vanilla HTML, CSS, and JavaScript.
- **Data pipeline:** GitHub Actions workflow using the GitHub REST API and a configured GitHub username from repository secrets or variables.
- **Hosting:** GitHub Pages deployed via Actions.
- **Rendering model:** Static asset bundle plus generated JSON data file.
- **Framework policy:** No frontend framework for v1 to keep build complexity and maintenance low.
- **Reuse model:** Treat the repository as a reusable template that any GitHub user can fork and configure for their own account.

### Why These Decisions
- The project scope is small and benefits from minimal tooling.
- GitHub-native infrastructure keeps credentials, scheduling, deployment, and account configuration in one platform.
- Static hosting is cheaper, safer, and simpler than adding a backend.
- The required Copilot, release, PR, and issue signals can be derived from GitHub-native APIs without introducing a custom service.
- Parameterizing the GitHub username makes the project reusable without requiring source edits for each fork.

## 8. Milestones

### Phase 1 — Data Pipeline
- Create Actions workflow with schedule and manual trigger.
- Read `{GITHUB_USERNAME}` from repository configuration.
- Fetch repo data for the configured GitHub username from the GitHub API.
- Select the 10 most recently updated repos.
- Enrich each repo with latest release metadata, commits since latest release, open issue data, open PR data, and Copilot branch/activity signals.
- Calculate priority issues, pending review queues, and next-step indicators.
- Output a versioned JSON data file for the site.

### Phase 2 — Dashboard UI
- Build the static dashboard page.
- Render one card per repository from the JSON file.
- Show release readiness, Copilot activity, priority issues, pending reviews, and repo links.
- Add visual emphasis for repos that need a release, need review, or contain ready Copilot work.
- Ensure responsive layout for desktop-first use, with reasonable mobile support.

### Phase 3 — Polish & Deploy
- Tune visual hierarchy and status labeling.
- Add empty/error states for missing or partial data.
- Add an at-a-glance summary treatment so the user can quickly answer release, review, issue-priority, and activity questions.
- Deploy to GitHub Pages via Actions.
- Validate scheduled refresh and manual refresh flows.
- Document the fork-and-configure setup so the project is easy to reuse.

## 9. Open Questions
These should be confirmed by the user before implementation hardens, but recommended defaults are included.

1. **Should forks be included?**  
   **Recommended default:** Exclude forks unless they have direct recent activity from the user and are intentionally active.

2. **Should archived repositories be included?**  
   **Recommended default:** Exclude archived repos from the top 10 dashboard list.

3. **What counts as a stale PR?**  
   **Recommended default:** No update for 14 days.

4. **How should next-step indicators be prioritized?**  
   **Recommended default:** `needs-attention` > `active` > `quiet`.

5. **Should the site support light, dark, or both themes?**  
   **Recommended default:** Start with dark-first styling and add system-theme support if design time allows.

6. **Should private repositories be included?**  
   **Recommended default:** No for GitHub Pages v1, unless the user explicitly wants a private-only generated site workflow.

7. **Should the dashboard show only public repositories from `{GITHUB_USERNAME}` or also pinned/specific repos?**  
   **Recommended default:** Show the 10 most recently updated public repos for the configured GitHub username, with a future option for manual overrides.

## 10. Success Criteria
The MVP is successful when:
- The user can open one GitHub Pages URL and quickly answer: which of my projects need a release?
- The user can see where GitHub Copilot / Cloud Agent has been working and what needs human review.
- The user can identify the most important issues across active repositories without opening every repo.
- The user can tell which repos are most active right now based on commits, issues, PRs, and Copilot signals.
- The dashboard refreshes automatically through GitHub Actions without manual local work.
- The implementation remains simple enough to maintain as a reusable project template.
