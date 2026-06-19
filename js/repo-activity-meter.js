(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.GHD = root.GHD || {};
  root.GHD.RepoActivityMeter = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Repo activity score starts at 100 and subtracts weighted "pressure" signals.
  // Weights favor urgent operational risk (CI + security) over normal queue pressure.
  const WEIGHTS = {
    ciFailing: 24,
    releaseOverdue: 12,
    pendingReviewPerItem: 6,
    pendingReviewCap: 24,
    priorityIssuePerItem: 5,
    priorityIssueCap: 20,
    securityCriticalPerAlert: 30,
    securityCriticalCap: 45,
    securityHighPerAlert: 18,
    securityHighCap: 36,
    securityMediumPerAlert: 8,
    securityMediumCap: 16,
    securityLowPerAlert: 3,
    securityLowCap: 9
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.round(numeric);
  }

  function toDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function staleCommitPenalty(lastCommitDate, nowMs) {
    const date = toDate(lastCommitDate);
    if (!date) {
      return { penalty: 20, detail: 'No commit activity date found' };
    }

    const days = Math.floor((nowMs - date.getTime()) / 86400000);
    if (days <= 7) return { penalty: 0, detail: 'Recent commits within 7 days' };
    if (days <= 21) return { penalty: 4, detail: `Last commit ${days} days ago` };
    if (days <= 45) return { penalty: 10, detail: `Last commit ${days} days ago` };
    if (days <= 90) return { penalty: 18, detail: `Last commit ${days} days ago` };
    if (days <= 180) return { penalty: 28, detail: `Last commit ${days} days ago` };
    return { penalty: 38, detail: `Last commit ${days} days ago` };
  }

  function getTone(score) {
    if (score >= 80) return 'good';
    if (score >= 55) return 'warning';
    return 'critical';
  }

  function getToneLabel(tone) {
    return tone === 'good' ? 'Healthy' : tone === 'warning' ? 'Watch' : 'Needs attention';
  }

  function computeRepoActivityModel(repo, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

    const pendingReviews = normalizeCount(repo?.pending_reviews?.count);
    const priorityIssues = Array.isArray(repo?.priority_issues) ? repo.priority_issues.length : 0;
    const releaseOverdue = Boolean(
      repo?.releases?.release_overdue
      || (!repo?.releases?.has_release && normalizeCount(repo?.releases?.commits_since_latest) > 0)
    );
    const ciConclusion = String(repo?.workflow_status?.latest_run?.conclusion || '').toLowerCase();
    const ciFailing = Boolean(repo?.workflow_status?.has_workflows && [
      'failure',
      'timed_out',
      'startup_failure',
      'action_required'
    ].includes(ciConclusion));

    const security = repo?.security_alerts || {};
    const criticalAlerts = normalizeCount(security.critical);
    const highAlerts = normalizeCount(security.high);
    const mediumAlerts = normalizeCount(security.medium);
    const lowAlerts = normalizeCount(security.low);

    const staleCommit = staleCommitPenalty(repo?.last_commit_date, nowMs);

    const contributions = [
      {
        key: 'ci-failing',
        label: 'CI status',
        penalty: ciFailing ? WEIGHTS.ciFailing : 0,
        detail: ciFailing ? 'Latest workflow run is failing' : 'Latest workflow run is healthy or unavailable'
      },
      {
        key: 'security-critical',
        label: 'Critical security alerts',
        penalty: clamp(criticalAlerts * WEIGHTS.securityCriticalPerAlert, 0, WEIGHTS.securityCriticalCap),
        detail: `${criticalAlerts} critical alert${criticalAlerts === 1 ? '' : 's'}`
      },
      {
        key: 'security-high',
        label: 'High security alerts',
        penalty: clamp(highAlerts * WEIGHTS.securityHighPerAlert, 0, WEIGHTS.securityHighCap),
        detail: `${highAlerts} high alert${highAlerts === 1 ? '' : 's'}`
      },
      {
        key: 'security-medium',
        label: 'Medium security alerts',
        penalty: clamp(mediumAlerts * WEIGHTS.securityMediumPerAlert, 0, WEIGHTS.securityMediumCap),
        detail: `${mediumAlerts} medium alert${mediumAlerts === 1 ? '' : 's'}`
      },
      {
        key: 'security-low',
        label: 'Low security alerts',
        penalty: clamp(lowAlerts * WEIGHTS.securityLowPerAlert, 0, WEIGHTS.securityLowCap),
        detail: `${lowAlerts} low alert${lowAlerts === 1 ? '' : 's'}`
      },
      {
        key: 'pending-reviews',
        label: 'Pending reviews',
        penalty: clamp(pendingReviews * WEIGHTS.pendingReviewPerItem, 0, WEIGHTS.pendingReviewCap),
        detail: `${pendingReviews} PR${pendingReviews === 1 ? '' : 's'} waiting for review`
      },
      {
        key: 'priority-issues',
        label: 'Priority issues',
        penalty: clamp(priorityIssues * WEIGHTS.priorityIssuePerItem, 0, WEIGHTS.priorityIssueCap),
        detail: `${priorityIssues} highlighted issue${priorityIssues === 1 ? '' : 's'}`
      },
      {
        key: 'release-pressure',
        label: 'Release pressure',
        penalty: releaseOverdue ? WEIGHTS.releaseOverdue : 0,
        detail: releaseOverdue ? 'Release is overdue or commits are waiting to ship' : 'Release posture is healthy'
      },
      {
        key: 'commit-recency',
        label: 'Commit recency',
        penalty: staleCommit.penalty,
        detail: staleCommit.detail
      }
    ];

    const totalPenalty = contributions.reduce((sum, item) => sum + item.penalty, 0);
    const score = clamp(100 - totalPenalty, 0, 100);
    const tone = getTone(score);
    const topContributions = contributions
      .filter((item) => item.penalty > 0)
      .sort((left, right) => right.penalty - left.penalty || left.label.localeCompare(right.label, 'en'));

    const tooltipLines = [
      `Repo Activity Meter: ${score}/100 (${getToneLabel(tone)})`,
      ...(topContributions.length
        ? topContributions.map((item) => `${item.label}: -${item.penalty} (${item.detail})`)
        : ['No major pressure signals detected'])
    ];

    const ariaLabel = topContributions.length
      ? `Repo activity score ${score} out of 100. ${topContributions
        .slice(0, 3)
        .map((item) => `${item.label.toLowerCase()} penalty ${item.penalty}`)
        .join(', ')}.`
      : `Repo activity score ${score} out of 100. No major pressure signals.`;

    return {
      score,
      tone,
      totalPenalty,
      contributions,
      topContributions,
      tooltip: tooltipLines.join('\n'),
      ariaLabel
    };
  }

  return {
    WEIGHTS,
    getTone,
    computeRepoActivityModel
  };
});
