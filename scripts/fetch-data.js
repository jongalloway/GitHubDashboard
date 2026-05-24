#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE_URL = 'https://api.github.com';
const MAX_REPOS = 10;
const RELEASE_OVERDUE_THRESHOLD = 10;
const STALE_DAYS = 14;
const PRIORITY_ISSUE_LIMIT = 3;

const owner = process.env.DASHBOARD_OWNER?.trim();
const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || '';
const generatedAt = process.env.GENERATED_AT_OVERRIDE?.trim() || new Date().toISOString();
const now = new Date(generatedAt);

if (!owner) {
  console.error('DASHBOARD_OWNER is required. Configure it as a repository variable in GitHub Actions.');
  process.exit(1);
}

const defaultHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'GitHubDashboard/1.0'
};

if (token) {
  defaultHeaders.Authorization = `Bearer ${token}`;
}

function log(message) {
  console.log(`[fetch-data] ${message}`);
}

function warn(message) {
  console.warn(`[fetch-data] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toApiUrl(endpoint) {
  return endpoint.startsWith('http') ? endpoint : new URL(endpoint, API_BASE_URL).toString();
}

function getNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const nextLink = linkHeader
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith('rel="next"'));

  if (!nextLink) {
    return null;
  }

  const match = nextLink.match(/<([^>]+)>/);
  return match ? match[1] : null;
}

function parseErrorMessage(text, status) {
  if (!text) {
    return `GitHub API request failed with status ${status}.`;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    return text;
  }

  return text;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }

  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (remaining === 0 && Number.isFinite(reset) && reset > 0) {
    const resetDelay = Math.max((reset * 1000) - Date.now(), 1000);
    return Math.min(resetDelay, 60000);
  }

  return Math.min((attempt + 1) * 5000, 30000);
}

async function fetchJson(endpoint, { context = 'GitHub API request', allowStatuses = [], retries = 3 } = {}) {
  const url = toApiUrl(endpoint);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, { headers: defaultHeaders });

    if (allowStatuses.includes(response.status)) {
      return null;
    }

    if (response.ok) {
      return response.json();
    }

    const bodyText = await response.text();
    const message = parseErrorMessage(bodyText, response.status);
    const isRetryable = [403, 429, 502, 503, 504].includes(response.status);

    if (isRetryable && attempt < retries) {
      const delayMs = getRetryDelayMs(response, attempt);
      warn(`${context} hit a retryable error (${response.status}: ${message}). Retrying in ${Math.ceil(delayMs / 1000)}s.`);
      await sleep(delayMs);
      continue;
    }

    throw new Error(`${context} failed (${response.status}): ${message}`);
  }

  throw new Error(`${context} failed after ${retries + 1} attempts.`);
}

async function paginate(endpoint, options = {}) {
  const items = [];
  let nextUrl = toApiUrl(endpoint);
  let attempt = 0;
  const retries = options.retries ?? 3;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: defaultHeaders });

    if (options.allowStatuses?.includes(response.status)) {
      return items;
    }

    if (!response.ok) {
      const bodyText = await response.text();
      const message = parseErrorMessage(bodyText, response.status);
      const isRetryable = [403, 429, 502, 503, 504].includes(response.status);

      if (isRetryable && attempt < retries) {
        const delayMs = getRetryDelayMs(response, attempt);
        warn(`${options.context || 'Pagination request'} hit a retryable error (${response.status}: ${message}). Retrying in ${Math.ceil(delayMs / 1000)}s.`);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      throw new Error(`${options.context || 'Pagination request'} failed (${response.status}): ${message}`);
    }

    attempt = 0;
    const pageItems = await response.json();
    items.push(...pageItems);
    nextUrl = getNextLink(response.headers.get('link'));
  }

  return items;
}

function maxTimestamp(...timestamps) {
  const values = timestamps
    .flat()
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!values.length) {
    return null;
  }

  return new Date(Math.max(...values)).toISOString();
}

function daysBetween(dateString) {
  if (!dateString) {
    return null;
  }

  const value = new Date(dateString).getTime();
  if (!Number.isFinite(value)) {
    return null;
  }

  const diffMs = Math.max(now.getTime() - value, 0);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isRecent(dateString) {
  const ageDays = daysBetween(dateString);
  return ageDays !== null && ageDays <= STALE_DAYS;
}

function normalizeLabels(labels = []) {
  return labels.map((label) => (typeof label === 'string' ? label : label.name || '')).filter(Boolean);
}

function hasCopilotSignal(text = '') {
  const normalized = text.toLowerCase();
  return normalized.includes('copilot') || normalized.includes('coding agent') || normalized.includes('cloud agent');
}

function getPullSource(pull, labels = []) {
  const author = pull.user?.login || '';
  const headRef = pull.head?.ref || '';
  const labelNames = normalizeLabels(labels).map((label) => label.toLowerCase());

  if (
    author.toLowerCase().includes('copilot') ||
    headRef.toLowerCase().startsWith('copilot/') ||
    labelNames.some((label) => label.includes('copilot')) ||
    hasCopilotSignal(pull.title) ||
    hasCopilotSignal(pull.body || '')
  ) {
    return 'copilot';
  }

  return 'human';
}

function issuePriority(issue) {
  const labels = normalizeLabels(issue.labels).map((label) => label.toLowerCase());
  const ageDays = daysBetween(issue.created_at) ?? 0;
  const isUnassigned = !Array.isArray(issue.assignees) || issue.assignees.length === 0;
  const isUnlabeled = labels.length === 0;

  if (labels.some((label) => label.startsWith('priority'))) {
    return { score: 100, reason: 'priority-label', ageDays, isUnassigned, isUnlabeled };
  }

  if (labels.some((label) => label.includes('critical') || label.includes('sev:critical'))) {
    return { score: 90, reason: 'critical-label', ageDays, isUnassigned, isUnlabeled };
  }

  if (labels.includes('bug') || labels.some((label) => label.startsWith('type:bug'))) {
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

function summarizeNextSteps({ releaseOverdue, pendingReviewCount, triageIssueCount, copilotWorkReady, squadWorkReady, hasRecentActivity, hasRelease }) {
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

  if (parts.length > 0) {
    return `${parts.join(', ')}.`;
  }

  if (hasRecentActivity) {
    return 'Repository is active with recent commits or discussion.';
  }

  return 'Repository is quiet right now.';
}

async function getLatestRelease(fullName, defaultBranch) {
  const release = await fetchJson(`/repos/${fullName}/releases/latest`, {
    context: `Fetching latest release for ${fullName}`,
    allowStatuses: [404]
  });

  if (!release) {
    return {
      latest_tag: null,
      latest_published_at: null,
      commits_since_latest: 0,
      has_release: false,
      release_overdue: false
    };
  }

  let commitsSinceLatest = 0;
  try {
    const comparison = await fetchJson(
      `/repos/${fullName}/compare/${encodeURIComponent(release.tag_name)}...${encodeURIComponent(defaultBranch)}`,
      { context: `Comparing latest release to ${defaultBranch} for ${fullName}`, allowStatuses: [404] }
    );

    if (comparison?.ahead_by !== undefined) {
      commitsSinceLatest = comparison.ahead_by;
    }
  } catch (error) {
    warn(`Could not compare latest release for ${fullName}: ${error.message}`);
  }

  return {
    latest_tag: release.tag_name || null,
    latest_published_at: release.published_at || release.created_at || null,
    commits_since_latest: commitsSinceLatest,
    has_release: true,
    release_overdue: commitsSinceLatest > RELEASE_OVERDUE_THRESHOLD
  };
}

async function getLastCommitDate(fullName, defaultBranch) {
  const commit = await fetchJson(`/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`, {
    context: `Fetching default branch commit for ${fullName}`,
    allowStatuses: [404, 409]
  });

  return commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
}

async function getIssues(fullName) {
  return paginate(`/repos/${fullName}/issues?state=open&per_page=100&sort=updated&direction=desc`, {
    context: `Fetching issues for ${fullName}`,
    allowStatuses: [404, 409]
  });
}

async function getPulls(fullName) {
  return paginate(`/repos/${fullName}/pulls?state=open&per_page=100&sort=updated&direction=desc`, {
    context: `Fetching pull requests for ${fullName}`,
    allowStatuses: [404, 409]
  });
}

async function getBranches(fullName) {
  return paginate(`/repos/${fullName}/branches?per_page=100`, {
    context: `Fetching branches for ${fullName}`,
    allowStatuses: [404, 409]
  });
}

async function getReviewState(fullName, pullNumber) {
  const reviews = await paginate(`/repos/${fullName}/pulls/${pullNumber}/reviews?per_page=100`, {
    context: `Fetching reviews for ${fullName}#${pullNumber}`,
    allowStatuses: [404, 409]
  });

  const meaningfulReviews = reviews.filter((review) => review.state && review.state !== 'PENDING');
  const latestReview = meaningfulReviews.at(-1);
  return latestReview?.state || null;
}

async function getCopilotBranchActivity(fullName, branches) {
  const activity = await Promise.all(
    branches.map(async (branchName) => {
      try {
        const commit = await fetchJson(`/repos/${fullName}/commits/${encodeURIComponent(branchName)}`, {
          context: `Fetching branch commit for ${fullName}:${branchName}`,
          allowStatuses: [404, 409]
        });
        return commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
      } catch (error) {
        warn(`Could not inspect branch ${fullName}:${branchName}: ${error.message}`);
        return null;
      }
    })
  );

  return activity.filter(Boolean);
}

function buildPriorityIssues(issues) {
  return issues
    .map((issue) => {
      const priority = issuePriority(issue);
      return {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
        labels: normalizeLabels(issue.labels),
        created_at: issue.created_at,
        age_days: priority.ageDays,
        is_unassigned: priority.isUnassigned,
        is_unlabeled: priority.isUnlabeled,
        priority_reason: priority.reason,
        score: priority.score
      };
    })
    .filter((issue) => issue.priority_reason)
    .sort((left, right) => right.score - left.score || right.age_days - left.age_days)
    .slice(0, PRIORITY_ISSUE_LIMIT)
    .map(({ score, ...issue }) => issue);
}

async function getCodeScanningAlerts(fullName) {
  const alerts = await paginate(`/repos/${fullName}/code-scanning/alerts?state=open&per_page=100`, {
    context: `Fetching code scanning alerts for ${fullName}`,
    allowStatuses: [403, 404, 451, 422]
  });

  if (!alerts || alerts.length === 0) {
    return { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 };
  }

  // Code scanning uses different severity terms than Dependabot
  // severity: critical, high, medium, low, warning, note, error
  const counts = { critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 };
  for (const alert of alerts) {
    const sev = (alert.rule?.severity || alert.most_recent_instance?.message?.severity || 'warning').toLowerCase();
    if (sev in counts) counts[sev]++;
  }

  return { total: alerts.length, ...counts };
}

async function buildRepoRecord(repo) {
  const fullName = repo.full_name;
  log(`Processing ${fullName}`);

  try {
    const [issuesAndPrs, pulls, branches, lastCommitDate, releaseInfo, squadTeamFile, codeScanAlerts] = await Promise.all([
      getIssues(fullName),
      getPulls(fullName),
      getBranches(fullName),
      getLastCommitDate(fullName, repo.default_branch),
      getLatestRelease(fullName, repo.default_branch),
      fetchJson(`/repos/${fullName}/contents/.squad/team.md`, {
        context: `Checking Squad presence for ${fullName}`,
        allowStatuses: [404]
      }),
      getCodeScanningAlerts(fullName)
    ]);

    const issueRecords = issuesAndPrs.filter((item) => !item.pull_request);
    const issueLabelMap = new Map(issuesAndPrs.map((item) => [item.number, item.labels || []]));
    const openIssuesCount = issueRecords.length;
    const triageIssues = issueRecords.filter((issue) => {
      const priority = issuePriority(issue);
      return priority.isUnassigned || priority.isUnlabeled;
    });
    const priorityIssues = buildPriorityIssues(issueRecords);

    const pullSources = new Map();
    for (const pull of pulls) {
      pullSources.set(pull.number, getPullSource(pull, issueLabelMap.get(pull.number)));
    }

    const reviewStates = new Map(
      await Promise.all(
        pulls.map(async (pull) => {
          try {
            return [pull.number, await getReviewState(fullName, pull.number)];
          } catch (error) {
            warn(`Could not inspect review state for ${fullName}#${pull.number}: ${error.message}`);
            return [pull.number, null];
          }
        })
      )
    );

    const pendingReviewItems = pulls
      .filter((pull) => {
        const source = pullSources.get(pull.number);
        const hasRequestedReviewers = (pull.requested_reviewers?.length || 0) > 0 || (pull.requested_teams?.length || 0) > 0;
        const latestReviewState = reviewStates.get(pull.number);

        if (pull.draft) {
          return source === 'copilot' || hasRequestedReviewers;
        }

        if (hasRequestedReviewers) {
          return true;
        }

        if (!latestReviewState) {
          return true;
        }

        return !['APPROVED', 'CHANGES_REQUESTED'].includes(latestReviewState);
      })
      .map((pull) => ({
        number: pull.number,
        title: pull.title,
        html_url: pull.html_url,
        author: pull.user?.login || 'unknown',
        is_draft: pull.draft,
        awaiting_review: true,
        created_at: pull.created_at,
        updated_at: pull.updated_at,
        requested_reviewers: [
          ...(pull.requested_reviewers || []).map((reviewer) => reviewer.login),
          ...(pull.requested_teams || []).map((team) => team.slug)
        ],
        source: pullSources.get(pull.number)
      }));

    const copilotBranches = branches
      .map((branch) => branch.name)
      .filter((branchName) => branchName.toLowerCase().startsWith('copilot/'));
    const copilotBranchActivity = await getCopilotBranchActivity(fullName, copilotBranches);

    const squadBranches = branches
      .map((branch) => branch.name)
      .filter((branchName) => branchName.toLowerCase().startsWith('squad/'));

    const copilotPulls = pulls.filter((pull) => pullSources.get(pull.number) === 'copilot');
    const copilotIssues = issueRecords.filter((issue) =>
      normalizeLabels(issue.labels).some((label) => label.toLowerCase().includes('copilot'))
    );

    const squadPulls = pulls.filter((pull) =>
      (pull.head?.ref || '').toLowerCase().startsWith('squad/')
    );

    const squadSignals = [];
    if (squadTeamFile) squadSignals.push('squad-enabled');
    if (squadBranches.length > 0) squadSignals.push('squad-branch');
    if (squadPulls.length > 0) squadSignals.push('squad-open-pr');

    const copilotSignals = [];
    if (copilotBranches.length > 0) {
      copilotSignals.push('copilot-branch');
    }
    if (copilotPulls.length > 0) {
      copilotSignals.push('copilot-open-pr');
    }
    if (copilotPulls.some((pull) => pull.draft)) {
      copilotSignals.push('copilot-draft-pr');
    }
    if (copilotIssues.length > 0) {
      copilotSignals.push('copilot-label');
    }

    const hasRelease = releaseInfo.has_release;
    const releaseOverdue = hasRelease
      ? releaseInfo.release_overdue
      : isRecent(lastCommitDate || repo.pushed_at);
    releaseInfo.release_overdue = releaseOverdue;

    const prsNeedReview = pendingReviewItems.length > 0;
    const issuesNeedTriage = triageIssues.length > 0;
    const copilotWorkReady = copilotBranches.length > 0 || copilotPulls.some((pull) => pull.draft);

    const signals = [];
    if (releaseOverdue) {
      signals.push('release-overdue');
    }
    if (prsNeedReview) {
      signals.push('prs-need-review');
    }
    if (issuesNeedTriage) {
      signals.push('issues-need-triage');
    }
    if (copilotWorkReady) {
      signals.push('copilot-work-ready');
    }

    const squadWorkReady = squadBranches.length > 0 || squadPulls.some((pull) => pull.draft);
    if (squadWorkReady) {
      signals.push('squad-work-ready');
    }

    const hasCodeAlerts = (codeScanAlerts?.critical || 0) + (codeScanAlerts?.high || 0) + (codeScanAlerts?.error || 0) > 0;
    if (hasCodeAlerts) {
      signals.push('code-alerts');
    }

    const recentActivityAt = maxTimestamp(
      repo.pushed_at,
      lastCommitDate,
      issueRecords.map((issue) => issue.updated_at),
      pulls.map((pull) => pull.updated_at)
    );
    const hasRecentActivity = isRecent(recentActivityAt);

    const nextStepSignals = signals.length > 0 ? signals : [hasRecentActivity ? 'active' : 'quiet'];
    const nextStepStatus = signals.length > 0 ? 'needs-attention' : hasRecentActivity ? 'active' : 'quiet';

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
      is_private: repo.private === true,
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      releases: releaseInfo,
      copilot_activity: {
        copilot_branch_count: copilotBranches.length,
        copilot_branches: copilotBranches,
        copilot_open_pr_count: copilotPulls.length,
        copilot_draft_pr_count: copilotPulls.filter((pull) => pull.draft).length,
        copilot_labeled_issue_count: copilotIssues.length,
        last_activity_at: maxTimestamp(
          copilotBranchActivity,
          copilotPulls.map((pull) => pull.updated_at),
          copilotIssues.map((issue) => issue.updated_at)
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
      code_scanning: codeScanAlerts,
      priority_issues: priorityIssues,
      pending_reviews: {
        count: pendingReviewItems.length,
        items: pendingReviewItems
      },
      next_steps: {
        status: nextStepStatus,
        signals: nextStepSignals,
        summary: summarizeNextSteps({
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
  } catch (error) {
    warn(`Falling back to partial data for ${fullName}: ${error.message}`);

    const hasRecentActivity = isRecent(repo.pushed_at || repo.updated_at);
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
      is_private: repo.private === true,
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
      code_scanning: { total: 0, critical: 0, high: 0, medium: 0, low: 0, warning: 0, note: 0, error: 0 },
      priority_issues: [],
      pending_reviews: {
        count: 0,
        items: []
      },
      next_steps: {
        status: hasRecentActivity ? 'active' : 'quiet',
        signals: [hasRecentActivity ? 'active' : 'quiet'],
        summary: hasRecentActivity
          ? 'Repository is active, but some GitHub API data could not be fetched.'
          : 'Repository is quiet, and some GitHub API data could not be fetched.'
      }
    };
  }
}

async function main() {
  log(`Fetching repositories for ${owner}`);
  const repos = await paginate(`/users/${owner}/repos?sort=updated&direction=desc&per_page=100&type=owner`, {
    context: `Fetching repositories for ${owner}`
  });

  const selectedRepos = repos
    .filter((repo) => !repo.fork && !repo.archived)
    .sort((left, right) => new Date(right.pushed_at || right.updated_at).getTime() - new Date(left.pushed_at || left.updated_at).getTime())
    .slice(0, MAX_REPOS);

  if (selectedRepos.length === 0) {
    warn(`No eligible repositories found for ${owner}.`);
  }

  const records = [];
  for (const repo of selectedRepos) {
    records.push(await buildRepoRecord(repo));
  }

  const payload = {
    generated_at: generatedAt,
    owner,
    repo_count: records.length,
    repos: records
  };

  const outputPath = path.join(process.cwd(), 'data', 'dashboard.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  log(`Wrote ${records.length} repositories to ${outputPath}`);
}

main().catch((error) => {
  console.error(`[fetch-data] ${error.message}`);
  process.exit(1);
});
