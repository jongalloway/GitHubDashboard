import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeRepoActivityModel } = require('../js/repo-activity-meter.js');

describe('repo activity meter scoring', () => {
  it('returns a healthy score for a quiet healthy repo', () => {
    const model = computeRepoActivityModel({
      pending_reviews: { count: 0 },
      priority_issues: [],
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'success' } },
      security_alerts: { total: 0 },
      releases: { has_release: true, release_overdue: false, commits_since_latest: 0 },
      last_commit_date: '2026-06-06T00:00:00.000Z'
    }, { nowMs: Date.parse('2026-06-08T00:00:00.000Z') });

    expect(model.score).toBe(100);
    expect(model.tone).toBe('good');
    expect(model.topContributions).toEqual([]);
  });

  it('penalizes operational risk signals and exposes readable tooltip', () => {
    const model = computeRepoActivityModel({
      pending_reviews: { count: 2 },
      priority_issues: [{}, {}],
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } },
      security_alerts: { critical: 1, high: 1, medium: 0, low: 0 },
      releases: { has_release: true, release_overdue: true, commits_since_latest: 6 },
      last_commit_date: '2026-02-01T00:00:00.000Z'
    }, { nowMs: Date.parse('2026-06-08T00:00:00.000Z') });

    expect(model.score).toBe(0);
    expect(model.tone).toBe('critical');
    expect(model.tooltip).toContain('Repo Activity Meter: 0/100');
    expect(model.tooltip).toContain('Critical security alerts: -30');
    expect(model.tooltip).toContain('CI status: -24');
  });

  it('caps penalties for queue-heavy repos', () => {
    const model = computeRepoActivityModel({
      pending_reviews: { count: 99 },
      priority_issues: Array.from({ length: 99 }, () => ({})),
      last_commit_date: '2026-06-01T00:00:00.000Z'
    }, { nowMs: Date.parse('2026-06-08T00:00:00.000Z') });

    expect(model.contributions.find((item) => item.key === 'pending-reviews')?.penalty).toBe(24);
    expect(model.contributions.find((item) => item.key === 'priority-issues')?.penalty).toBe(20);
  });

  it('is deterministic for the same timestamp input', () => {
    const repo = {
      pending_reviews: { count: 1 },
      priority_issues: [{}],
      releases: { has_release: false, release_overdue: false, commits_since_latest: 2 },
      last_commit_date: '2026-05-01T00:00:00.000Z'
    };
    const nowMs = Date.parse('2026-06-08T12:00:00.000Z');

    const first = computeRepoActivityModel(repo, { nowMs });
    const second = computeRepoActivityModel(repo, { nowMs });

    expect(first).toEqual(second);
  });
});
