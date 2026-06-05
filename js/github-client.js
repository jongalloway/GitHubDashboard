// ============================================================
// GHD GitHubClient — Browser-side private data fetch pipeline
// ============================================================
// Fetches all owner repos, applies the same selection rules as
// scripts/fetch-data.js, fetches repo details, and normalizes
// into the same dashboard.json payload shape.
//
// Heuristic parity with scripts/fetch-data.js:
//   release-overdue  : >10 commits ahead of latest tag
//   prs-need-review  : open PRs requiring attention
//   issues-need-triage: unassigned or unlabeled issues
//   copilot-work-ready: copilot/ branches or copilot draft PRs
//
// Note: Per-PR review state API calls are intentionally skipped
// to keep browser API usage reasonable. Non-draft open PRs are
// conservatively included in pending-review counts (equivalent
// to the server path's "no review state → include" branch).
// ============================================================

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const API_BASE = 'https://api.github.com';
  const MAX_REPOS = 10;
  const RELEASE_OVERDUE_THRESHOLD = 10;
  const STALE_DAYS = 14;
  const PRIORITY_ISSUE_LIMIT = 3;
  const MAX_CONCURRENT = 4;

  // ── Auth headers ─────────────────────────────────────────

  function _headers(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function _headersPublic() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  // ── HTTP helpers ─────────────────────────────────────────

  function _getNextLink(linkHeader) {
    if (!linkHeader) return null;
    const next = linkHeader.split(',').find((p) => p.includes('rel="next"'));
    if (!next) return null;
    const match = next.match(/<([^>]+)>/);
    return match ? match[1] : null;
  }

  function _createApiError(prefix, response, url) {
    const status = response.status;
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = response.headers.get('retry-after');
    const ssoHeader = response.headers.get('x-github-sso');
    const error = new Error(`${prefix} (${status}): ${url}`);
    error.status = status;
    error.url = url;
    error.rateLimitRemaining = rateLimitRemaining;
    error.retryAfter = retryAfter;
    error.ssoHeader = ssoHeader;
    error.isRateLimited = rateLimitRemaining === '0' || retryAfter !== null;
    error.ssoRequired = Boolean(ssoHeader);
    return error;
  }

  async function _fetchJson(url, token) {
    const response = await fetch(url, { headers: _headers(token) });
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok) {
      throw _createApiError('GitHub API failed', response, url);
    }
    return response.json();
  }

  async function _paginate(url, token) {
    const items = [];
    let nextUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: _headers(token) });
      if (response.status === 404 || response.status === 409) break;
      if (!response.ok) {
        throw _createApiError('Paginate failed', response, nextUrl);
      }
      const page = await response.json();
      if (Array.isArray(page)) items.push(...page);
      nextUrl = _getNextLink(response.headers.get('link'));
    }
    return items;
  }

  async function _fetchJsonPublic(url) {
    const response = await fetch(url, { headers: _headersPublic() });
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok) throw new Error(`GitHub API failed (${response.status}): ${url}`);
    return response.json();
  }

  async function _paginatePublic(url) {
    const items = [];
    let nextUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: _headersPublic() });
      if (response.status === 404 || response.status === 409) break;
      if (!response.ok) throw new Error(`Paginate failed (${response.status}): ${nextUrl}`);
      const page = await response.json();
      if (Array.isArray(page)) items.push(...page);
      nextUrl = _getNextLink(response.headers.get('link'));
    }
    return items;
  }

  // ── Concurrency limiter ──────────────────────────────────

  async function _runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let index = 0;

    async function worker() {
      while (index < tasks.length) {
        const i = index++;
        try {
          results[i] = await tasks[i]();
        } catch (_) {
          results[i] = null;
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(limit, tasks.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  }

  // ── Heuristic helpers (mirrors scripts/fetch-data.js) ────

  function _daysBetween(dateString) {
    if (!dateString) return null;
    const value = new Date(dateString).getTime();
    if (!Number.isFinite(value)) return null;
    return Math.floor(Math.max(Date.now() - value, 0) / (1000 * 60 * 60 * 24));
  }

  function _isRecent(dateString) {
    const age = _daysBetween(dateString);
    return age !== null && age <= STALE_DAYS;
  }

  function _maxTimestamp(...timestamps) {
    const values = timestamps
      .flat()
      .filter(Boolean)
      .map((v) => new Date(v).getTime())
      .filter(Number.isFinite);
    if (!values.length) return null;
    return new Date(Math.max(...values)).toISOString();
  }

  function _normalizeLabels(labels) {
    if (!Array.isArray(labels)) return [];
    return labels
      .map((l) => (typeof l === 'string' ? l : l.name || ''))
      .filter(Boolean);
  }

  function _hasCopilotSignal(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return t.includes('copilot') || t.includes('coding agent') || t.includes('cloud agent');
  }

  function _getPullSource(pull) {
    const author = pull.user?.login || '';
    const headRef = pull.head?.ref || '';
    const labelNames = _normalizeLabels(pull.labels).map((l) => l.toLowerCase());
    if (
      author.toLowerCase().includes('copilot') ||
      headRef.toLowerCase().startsWith('copilot/') ||
      labelNames.some((l) => l.includes('copilot')) ||
      _hasCopilotSignal(pull.title) ||
      _hasCopilotSignal(pull.body || '')
    ) {
      return 'copilot';
    }
    return 'human';
  }

  function _issuePriority(issue) {
    const labels = _normalizeLabels(issue.labels).map((l) => l.toLowerCase());
    const ageDays = _daysBetween(issue.created_at) ?? 0;
    const isUnassigned =
      !Array.isArray(issue.assignees) || issue.assignees.length === 0;
    const isUnlabeled = labels.length === 0;

    if (labels.some((l) => l.startsWith('priority'))) {
      return { score: 100, reason: 'priority-label', ageDays, isUnassigned, isUnlabeled };
    }
    if (labels.some((l) => l.includes('critical') || l.includes('sev:critical'))) {
      return { score: 90, reason: 'critical-label', ageDays, isUnassigned, isUnlabeled };
    }
    if (labels.includes('bug') || labels.some((l) => l.startsWith('type:bug'))) {
      return { score: 80, reason: 'bug-label', ageDays, isUnassigned, isUnlabeled };
    }
    if (isUnassigned || isUnlabeled) {
      return { score: 70, reason: 'needs-triage', ageDays, isUnassigned, isUnlabeled };
    }
    if (ageDays >= STALE_DAYS) {
      return { score: 60, reason: 'age', ageDays, isUnassigned, isUnlabeled };
    }
    return { score: 0, reason: null, ageDays, isUnassigned, isUnlabeled };
  }

  function _buildPriorityIssues(issueRecords) {
    return issueRecords
      .map((issue) => {
        const p = _issuePriority(issue);
        return {
          number: issue.number,
          title: issue.title,
          html_url: issue.html_url,
          labels: _normalizeLabels(issue.labels),
          created_at: issue.created_at,
          age_days: p.ageDays,
          is_unassigned: p.isUnassigned,
          is_unlabeled: p.isUnlabeled,
          priority_reason: p.reason,
          score: p.score
        };
      })
      .filter((i) => i.priority_reason)
      .sort((a, b) => b.score - a.score || b.age_days - a.age_days)
      .slice(0, PRIORITY_ISSUE_LIMIT)
      .map(({ score, ...issue }) => issue);
  }

  function _summarizeNextSteps({
    releaseOverdue,
    pendingReviewCount,
    triageIssueCount,
    copilotWorkReady,
    squadWorkReady,
    hasRecentActivity,
    hasRelease
  }) {
    const parts = [];
    if (releaseOverdue) {
      parts.push(hasRelease ? 'Release is overdue' : 'Recent commits have not shipped in a release');
    }
    if (pendingReviewCount > 0) {
      parts.push(`${pendingReviewCount} PR${pendingReviewCount === 1 ? '' : 's'} need review`);
    }
    if (triageIssueCount > 0) {
      parts.push(`${triageIssueCount} issue${triageIssueCount === 1 ? '' : 's'} need triage`);
    }
    if (copilotWorkReady) {
      parts.push('Copilot work looks ready');
    }
    if (squadWorkReady) {
      parts.push('Squad work in progress');
    }
    if (parts.length > 0) return `${parts.join(', ')}.`;
    if (hasRecentActivity) return 'Repository is active with recent commits or discussion.';
    return 'Repository is quiet right now.';
  }

  // ── Repo detail fetcher ───────────────────────────────────

  async function _fetchRepoDetails(repo, token) {
    const fullName = repo.full_name;
    const defaultBranch = repo.default_branch || 'main';

    try {
      const [issuesAndPrs, pulls, branches, squadTeamFile] = await Promise.all([
        _paginate(
          `${API_BASE}/repos/${fullName}/issues?state=open&per_page=100&sort=updated&direction=desc`,
          token
        ),
        _paginate(
          `${API_BASE}/repos/${fullName}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
          token
        ),
        _paginate(`${API_BASE}/repos/${fullName}/branches?per_page=100`, token),
        _fetchJson(`${API_BASE}/repos/${fullName}/contents/.squad/team.md`, token)
      ]);

      // Last commit date on default branch
      let lastCommitDate = null;
      try {
        const commit = await _fetchJson(
          `${API_BASE}/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`,
          token
        );
        if (commit?.commit) {
          lastCommitDate =
            commit.commit.committer?.date || commit.commit.author?.date || null;
        }
      } catch (_) {}

      // Latest release + commits ahead
      let releaseInfo = {
        latest_tag: null,
        latest_published_at: null,
        commits_since_latest: 0,
        has_release: false,
        release_overdue: false
      };
      try {
        const release = await _fetchJson(
          `${API_BASE}/repos/${fullName}/releases/latest`,
          token
        );
        if (release?.tag_name) {
          let commitsSince = 0;
          try {
            const comparison = await _fetchJson(
              `${API_BASE}/repos/${fullName}/compare/${encodeURIComponent(release.tag_name)}...${encodeURIComponent(defaultBranch)}`,
              token
            );
            if (comparison?.ahead_by !== undefined) {
              commitsSince = comparison.ahead_by;
            }
          } catch (_) {}

          releaseInfo = {
            latest_tag: release.tag_name,
            latest_published_at: release.published_at || release.created_at || null,
            commits_since_latest: commitsSince,
            has_release: true,
            release_overdue: commitsSince > RELEASE_OVERDUE_THRESHOLD
          };
        }
      } catch (_) {}

      // GitHub Pages
      let pagesInfo = { enabled: false };
      try {
        const pagesData = await _fetchJson(`${API_BASE}/repos/${fullName}/pages`, token);
        if (pagesData) {
          const deployments = await _fetchJson(
            `${API_BASE}/repos/${fullName}/deployments?environment=github-pages&per_page=1`,
            token
          );
          const latestDeploy = Array.isArray(deployments) && deployments.length ? deployments[0] : null;
          pagesInfo = {
            enabled: true,
            url: pagesData.html_url || null,
            status: pagesData.status || 'unknown',
            deployed_at: latestDeploy?.created_at || null
          };
        }
      } catch (_) {}

      // Issues (exclude PRs that GitHub returns in issues endpoint)
      const issueRecords = issuesAndPrs.filter((item) => !item.pull_request);
      const openIssuesCount = issueRecords.length;

      const triageIssues = issueRecords.filter((issue) => {
        const p = _issuePriority(issue);
        return p.isUnassigned || p.isUnlabeled;
      });
      const priorityIssues = _buildPriorityIssues(issueRecords);

      // Pending review items
      // Note: per-PR review state API calls are skipped for browser efficiency.
      // Draft PRs: include only if copilot-sourced or has requested reviewers.
      // Non-draft PRs: include all (conservative — matches the server "no review state → include" path).
      const pendingReviewItems = pulls
        .filter((pull) => {
          const source = _getPullSource(pull);
          const hasRequestedReviewers =
            (pull.requested_reviewers?.length || 0) > 0 ||
            (pull.requested_teams?.length || 0) > 0;
          if (pull.draft) {
            return source === 'copilot' || hasRequestedReviewers;
          }
          return true;
        })
        .map((pull) => ({
          number: pull.number,
          title: pull.title,
          html_url: pull.html_url,
          author: pull.user?.login || 'unknown',
          is_draft: pull.draft || false,
          awaiting_review: true,
          created_at: pull.created_at,
          updated_at: pull.updated_at,
          requested_reviewers: [
            ...(pull.requested_reviewers || []).map((r) => r.login),
            ...(pull.requested_teams || []).map((t) => t.slug)
          ],
          source: _getPullSource(pull)
        }));

      // Copilot signals
      const copilotBranches = branches
        .map((b) => b.name)
        .filter((name) => name.toLowerCase().startsWith('copilot/'));

      const copilotPulls = pulls.filter((p) => _getPullSource(p) === 'copilot');
      const copilotIssues = issueRecords.filter((issue) =>
        _normalizeLabels(issue.labels).some((l) => l.toLowerCase().includes('copilot'))
      );

      const copilotSignals = [];
      if (copilotBranches.length > 0) copilotSignals.push('copilot-branch');
      if (copilotPulls.length > 0) copilotSignals.push('copilot-open-pr');
      if (copilotPulls.some((p) => p.draft)) copilotSignals.push('copilot-draft-pr');
      if (copilotIssues.length > 0) copilotSignals.push('copilot-label');

      // Squad signals
      const squadBranches = branches
        .map((b) => b.name)
        .filter((name) => name.toLowerCase().startsWith('squad/'));

      const squadPulls = pulls.filter((pull) =>
        (pull.head?.ref || '').toLowerCase().startsWith('squad/')
      );

      const squadSignals = [];
      if (squadTeamFile) squadSignals.push('squad-enabled');
      if (squadBranches.length > 0) squadSignals.push('squad-branch');
      if (squadPulls.length > 0) squadSignals.push('squad-open-pr');

      // Release overdue: if no release, use recent commit activity as proxy
      const hasRelease = releaseInfo.has_release;
      const releaseOverdue = hasRelease
        ? releaseInfo.release_overdue
        : _isRecent(lastCommitDate || repo.pushed_at);
      releaseInfo.release_overdue = releaseOverdue;

      const prsNeedReview = pendingReviewItems.length > 0;
      const issuesNeedTriage = triageIssues.length > 0;
      const copilotWorkReady =
        copilotBranches.length > 0 || copilotPulls.some((p) => p.draft);

      const squadWorkReady = squadBranches.length > 0 || squadPulls.some((p) => p.draft);

      const signals = [];
      if (releaseOverdue) signals.push('release-overdue');
      if (prsNeedReview) signals.push('prs-need-review');
      if (issuesNeedTriage) signals.push('issues-need-triage');
      if (copilotWorkReady) signals.push('copilot-work-ready');
      if (squadWorkReady) signals.push('squad-work-ready');

      const recentActivityAt = _maxTimestamp(
        repo.pushed_at,
        lastCommitDate,
        issueRecords.map((i) => i.updated_at),
        pulls.map((p) => p.updated_at)
      );
      const hasRecentActivity = _isRecent(recentActivityAt);

      const nextStepSignals =
        signals.length > 0 ? signals : [hasRecentActivity ? 'active' : 'quiet'];
      const nextStepStatus =
        signals.length > 0 ? 'needs-attention' : hasRecentActivity ? 'active' : 'quiet';

      return {
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        primary_language: repo.language,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at,
        default_branch: repo.default_branch,
        open_issues_count: openIssuesCount,
        open_pull_requests_count: pulls.length,
        last_commit_date: lastCommitDate,
        is_fork: repo.fork,
        is_archived: repo.archived,
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        releases: releaseInfo,
        copilot_activity: {
          copilot_branch_count: copilotBranches.length,
          copilot_branches: copilotBranches,
          copilot_open_pr_count: copilotPulls.length,
          copilot_draft_pr_count: copilotPulls.filter((p) => p.draft).length,
          copilot_labeled_issue_count: copilotIssues.length,
          last_activity_at: _maxTimestamp(
            copilotPulls.map((p) => p.updated_at),
            copilotIssues.map((i) => i.updated_at)
          ),
          signals: copilotSignals
        },
        squad_activity: {
          squad_enabled: !!squadTeamFile,
          squad_branch_count: squadBranches.length,
          squad_branches: squadBranches,
          squad_open_pr_count: squadPulls.length,
          signals: squadSignals
        },
        priority_issues: priorityIssues,
        pending_reviews: {
          count: pendingReviewItems.length,
          items: pendingReviewItems
        },
        non_default_branch_count: branches.filter((b) => b.name !== repo.default_branch).length,
        is_private: repo.private === true,
        workflow_status: { has_workflows: false, latest_run: null },
        security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        code_scanning: { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 },
        traffic: null,
        discussions_enabled: repo.has_discussions === true,
        license: repo.license?.spdx_id || null,
        has_readme: null,
        pages: pagesInfo,
        next_steps: {
          status: nextStepStatus,
          signals: nextStepSignals,
          summary: _summarizeNextSteps({
            releaseOverdue,
            pendingReviewCount: pendingReviewItems.length,
            triageIssueCount: triageIssues.length,
            copilotWorkReady,
            squadWorkReady,
            hasRecentActivity,
            hasRelease
          })
        }
      };
    } catch (_) {
      // Partial fallback — return minimal record so the repo still appears
      const hasRecentActivity = _isRecent(repo.pushed_at || repo.updated_at);
      return {
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        primary_language: repo.language,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at,
        default_branch: repo.default_branch,
        open_issues_count: 0,
        open_pull_requests_count: 0,
        last_commit_date: null,
        is_fork: repo.fork,
        is_archived: repo.archived,
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        releases: {
          latest_tag: null,
          latest_published_at: null,
          commits_since_latest: 0,
          has_release: false,
          release_overdue: false
        },
        copilot_activity: {
          copilot_branch_count: 0,
          copilot_branches: [],
          copilot_open_pr_count: 0,
          copilot_draft_pr_count: 0,
          copilot_labeled_issue_count: 0,
          last_activity_at: null,
          signals: []
        },
        squad_activity: {
          squad_enabled: false,
          squad_branch_count: 0,
          squad_branches: [],
          squad_open_pr_count: 0,
          signals: []
        },
        non_default_branch_count: 0,
        is_private: repo.private === true,
        workflow_status: { has_workflows: false, latest_run: null },
        security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        code_scanning: { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 },
        traffic: null,
        discussions_enabled: repo.has_discussions === true,
        license: repo.license?.spdx_id || null,
        has_readme: null,
        pages: { enabled: false },
        priority_issues: [],
        pending_reviews: { count: 0, items: [] },
        next_steps: {
          status: hasRecentActivity ? 'active' : 'quiet',
          signals: [hasRecentActivity ? 'active' : 'quiet'],
          summary: hasRecentActivity
            ? 'Repository is active with recent commits or discussion.'
            : 'Repository is quiet right now.'
        }
      };
    }
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Fetch all owner repos, apply server-parity selection rules,
   * fetch details for the top 10, and return a normalized payload
   * matching the shape of data/dashboard.json plus a repoCatalog.
   *
   * @param {string} token - Valid GitHub access token
   * @param {string} owner - GitHub login of the repo owner
   * @returns {{ repoCatalog, dashboard }}
   */
  async function fetchPrivateDashboard(token, owner) {
    // Fetch ALL repos the authenticated user owns (public + private)
    const allRepos = await _paginate(
      `${API_BASE}/user/repos?visibility=all&affiliation=owner&per_page=100&sort=pushed&direction=desc`,
      token
    );

    // Selection rules: exclude forks, exclude archived, sort by pushed_at desc, top 10
    const selectedRepos = allRepos
      .filter((r) => !r.fork && !r.archived)
      .sort((a, b) => {
        const da = new Date(a.pushed_at || a.updated_at || 0).getTime();
        const db = new Date(b.pushed_at || b.updated_at || 0).getTime();
        return db - da;
      })
      .slice(0, MAX_REPOS);

    // Lightweight repo catalog (does not include raw API payloads)
    const repoCatalog = selectedRepos.map((repo) => ({
      full_name: repo.full_name,
      name: repo.name,
      html_url: repo.html_url,
      visibility: repo.visibility || (repo.private ? 'private' : 'public'),
      description: repo.description || null,
      primary_language: repo.language || null,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
      default_branch: repo.default_branch,
      is_fork: repo.fork,
      is_archived: repo.archived,
      topics: Array.isArray(repo.topics) ? repo.topics : []
    }));

    // Fetch details with concurrency cap
    const tasks = selectedRepos.map((repo) => () => _fetchRepoDetails(repo, token));
    const repoDetails = await _runWithConcurrency(tasks, MAX_CONCURRENT);
    const validRepos = repoDetails.filter(Boolean);

    const generatedAt = new Date().toISOString();

    return {
      repoCatalog,
      dashboard: {
        generated_at: generatedAt,
        owner,
        repo_count: validRepos.length,
        repos: validRepos
      }
    };
  }

  // ── Public (unauthenticated) repo detail fetcher ────────

  async function _fetchRepoDetailsPublic(repo) {
    const fullName = repo.full_name;
    const defaultBranch = repo.default_branch || 'main';

    try {
      const [issuesAndPrs, pulls] = await Promise.all([
        _paginatePublic(
          `${API_BASE}/repos/${fullName}/issues?state=open&per_page=100&sort=updated&direction=desc`
        ),
        _paginatePublic(
          `${API_BASE}/repos/${fullName}/pulls?state=open&per_page=100&sort=updated&direction=desc`
        )
      ]);

      let lastCommitDate = null;
      try {
        const commit = await _fetchJsonPublic(
          `${API_BASE}/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`
        );
        if (commit?.commit) {
          lastCommitDate =
            commit.commit.committer?.date || commit.commit.author?.date || null;
        }
      } catch (_) {}

      let releaseInfo = {
        latest_tag: null,
        latest_published_at: null,
        commits_since_latest: 0,
        has_release: false,
        release_overdue: false
      };
      try {
        const release = await _fetchJsonPublic(
          `${API_BASE}/repos/${fullName}/releases/latest`
        );
        if (release?.tag_name) {
          let commitsSince = 0;
          try {
            const comparison = await _fetchJsonPublic(
              `${API_BASE}/repos/${fullName}/compare/${encodeURIComponent(release.tag_name)}...${encodeURIComponent(defaultBranch)}`
            );
            if (comparison?.ahead_by !== undefined) {
              commitsSince = comparison.ahead_by;
            }
          } catch (_) {}

          releaseInfo = {
            latest_tag: release.tag_name,
            latest_published_at: release.published_at || release.created_at || null,
            commits_since_latest: commitsSince,
            has_release: true,
            release_overdue: commitsSince > RELEASE_OVERDUE_THRESHOLD
          };
        }
      } catch (_) {}

      // GitHub Pages (public endpoint — available without auth for public repos)
      let pagesInfo = { enabled: false };
      try {
        const pagesData = await _fetchJsonPublic(`${API_BASE}/repos/${fullName}/pages`);
        if (pagesData) {
          const deployments = await _fetchJsonPublic(
            `${API_BASE}/repos/${fullName}/deployments?environment=github-pages&per_page=1`
          );
          const latestDeploy = Array.isArray(deployments) && deployments.length ? deployments[0] : null;
          pagesInfo = {
            enabled: true,
            url: pagesData.html_url || null,
            status: pagesData.status || 'unknown',
            deployed_at: latestDeploy?.created_at || null
          };
        }
      } catch (_) {}

      const issueRecords = issuesAndPrs.filter((item) => !item.pull_request);
      const openIssuesCount = issueRecords.length;

      const triageIssues = issueRecords.filter((issue) => {
        const p = _issuePriority(issue);
        return p.isUnassigned || p.isUnlabeled;
      });
      const priorityIssues = _buildPriorityIssues(issueRecords);

      // Non-draft PRs only — draft state requires auth for accurate detection
      const pendingReviewItems = pulls
        .filter((pull) => !pull.draft)
        .map((pull) => ({
          number: pull.number,
          title: pull.title,
          html_url: pull.html_url,
          author: pull.user?.login || 'unknown',
          is_draft: false,
          awaiting_review: true,
          created_at: pull.created_at,
          updated_at: pull.updated_at,
          requested_reviewers: [
            ...(pull.requested_reviewers || []).map((r) => r.login),
            ...(pull.requested_teams || []).map((t) => t.slug)
          ],
          source: _getPullSource(pull)
        }));

      // Copilot signals from PRs/issues only (branches need extra API call)
      const copilotPulls = pulls.filter((p) => _getPullSource(p) === 'copilot');
      const copilotIssues = issueRecords.filter((issue) =>
        _normalizeLabels(issue.labels).some((l) => l.toLowerCase().includes('copilot'))
      );

      const copilotSignals = [];
      if (copilotPulls.length > 0) copilotSignals.push('copilot-open-pr');
      if (copilotPulls.some((p) => p.draft)) copilotSignals.push('copilot-draft-pr');
      if (copilotIssues.length > 0) copilotSignals.push('copilot-label');

      const hasRelease = releaseInfo.has_release;
      const releaseOverdue = hasRelease
        ? releaseInfo.release_overdue
        : _isRecent(lastCommitDate || repo.pushed_at);
      releaseInfo.release_overdue = releaseOverdue;

      const prsNeedReview = pendingReviewItems.length > 0;
      const issuesNeedTriage = triageIssues.length > 0;
      const copilotWorkReady = copilotPulls.some((p) => p.draft);

      const signals = [];
      if (releaseOverdue) signals.push('release-overdue');
      if (prsNeedReview) signals.push('prs-need-review');
      if (issuesNeedTriage) signals.push('issues-need-triage');
      if (copilotWorkReady) signals.push('copilot-work-ready');

      const recentActivityAt = _maxTimestamp(
        repo.pushed_at,
        lastCommitDate,
        issueRecords.map((i) => i.updated_at),
        pulls.map((p) => p.updated_at)
      );
      const hasRecentActivity = _isRecent(recentActivityAt);

      const nextStepSignals =
        signals.length > 0 ? signals : [hasRecentActivity ? 'active' : 'quiet'];
      const nextStepStatus =
        signals.length > 0 ? 'needs-attention' : hasRecentActivity ? 'active' : 'quiet';

      return {
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        primary_language: repo.language,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at,
        default_branch: repo.default_branch,
        open_issues_count: openIssuesCount,
        open_pull_requests_count: pulls.length,
        last_commit_date: lastCommitDate,
        is_fork: repo.fork,
        is_archived: repo.archived,
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        releases: releaseInfo,
        copilot_activity: {
          copilot_branch_count: 0,
          copilot_branches: [],
          copilot_open_pr_count: copilotPulls.length,
          copilot_draft_pr_count: copilotPulls.filter((p) => p.draft).length,
          copilot_labeled_issue_count: copilotIssues.length,
          last_activity_at: _maxTimestamp(
            copilotPulls.map((p) => p.updated_at),
            copilotIssues.map((i) => i.updated_at)
          ),
          signals: copilotSignals
        },
        squad_activity: {
          squad_enabled: false,
          squad_branch_count: 0,
          squad_branches: [],
          squad_open_pr_count: 0,
          signals: []
        },
        priority_issues: priorityIssues,
        pending_reviews: {
          count: pendingReviewItems.length,
          items: pendingReviewItems
        },
        non_default_branch_count: 0,
        is_private: false,
        workflow_status: { has_workflows: false, latest_run: null },
        security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        code_scanning: { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 },
        traffic: null,
        discussions_enabled: repo.has_discussions === true,
        license: repo.license?.spdx_id || null,
        has_readme: null,
        pages: pagesInfo,
        next_steps: {
          status: nextStepStatus,
          signals: nextStepSignals,
          summary: _summarizeNextSteps({
            releaseOverdue,
            pendingReviewCount: pendingReviewItems.length,
            triageIssueCount: triageIssues.length,
            copilotWorkReady,
            squadWorkReady: false,
            hasRecentActivity,
            hasRelease
          })
        }
      };
    } catch (_) {
      const hasRecentActivity = _isRecent(repo.pushed_at || repo.updated_at);
      return {
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        primary_language: repo.language,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at,
        default_branch: repo.default_branch,
        open_issues_count: 0,
        open_pull_requests_count: 0,
        last_commit_date: null,
        is_fork: repo.fork,
        is_archived: repo.archived,
        topics: Array.isArray(repo.topics) ? repo.topics : [],
        releases: {
          latest_tag: null,
          latest_published_at: null,
          commits_since_latest: 0,
          has_release: false,
          release_overdue: false
        },
        copilot_activity: {
          copilot_branch_count: 0,
          copilot_branches: [],
          copilot_open_pr_count: 0,
          copilot_draft_pr_count: 0,
          copilot_labeled_issue_count: 0,
          last_activity_at: null,
          signals: []
        },
        squad_activity: {
          squad_enabled: false,
          squad_branch_count: 0,
          squad_branches: [],
          squad_open_pr_count: 0,
          signals: []
        },
        non_default_branch_count: 0,
        is_private: false,
        workflow_status: { has_workflows: false, latest_run: null },
        security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        code_scanning: { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 },
        traffic: null,
        discussions_enabled: repo.has_discussions === true,
        license: repo.license?.spdx_id || null,
        has_readme: null,
        pages: { enabled: false },
        priority_issues: [],
        pending_reviews: { count: 0, items: [] },
        next_steps: {
          status: hasRecentActivity ? 'active' : 'quiet',
          signals: [hasRecentActivity ? 'active' : 'quiet'],
          summary: hasRecentActivity
            ? 'Repository is active with recent commits or discussion.'
            : 'Repository is quiet right now.'
        }
      };
    }
  }

  /**
   * Fetch public repos for an owner without authentication.
   * Returns the same payload shape as fetchPrivateDashboard.
   * Auth-only fields (workflow status, dependabot, code scanning, traffic)
   * default to null/empty — same as the private path's catch-block fallback.
   *
   * Rate limiting: unauthenticated calls are limited to 60/hour per IP.
   * We mitigate by fetching only 10 repos and skipping branch-list calls.
   *
   * @param {string} owner - GitHub login of the repo owner
   * @returns {{ dashboard }}
   */
  async function fetchPublicDashboard(owner) {
    const allRepos = await _paginatePublic(
      `${API_BASE}/users/${owner}/repos?type=owner&sort=pushed&direction=desc&per_page=100`
    );

    const selectedRepos = allRepos
      .filter((r) => !r.fork && !r.archived)
      .sort((a, b) => {
        const da = new Date(a.pushed_at || a.updated_at || 0).getTime();
        const db = new Date(b.pushed_at || b.updated_at || 0).getTime();
        return db - da;
      })
      .slice(0, MAX_REPOS);

    const tasks = selectedRepos.map((repo) => () => _fetchRepoDetailsPublic(repo));
    const repoDetails = await _runWithConcurrency(tasks, MAX_CONCURRENT);
    const validRepos = repoDetails.filter(Boolean);

    const generatedAt = new Date().toISOString();

    return {
      dashboard: {
        generated_at: generatedAt,
        owner,
        repo_count: validRepos.length,
        repos: validRepos
      }
    };
  }

  GHD.GitHubClient = {
    fetchPrivateDashboard,
    fetchPublicDashboard
  };
}(window.GHD));
