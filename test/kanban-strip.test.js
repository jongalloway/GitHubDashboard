import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// Fixed reference timestamp: 2026-06-27T22:03:35.578-07:00 = 2026-06-28T05:03:35.578Z
const NOW = new Date('2026-06-28T05:03:35.578Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a minimal repo fixture. Override any field as needed. */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    pushed_at: new Date(NOW - 30 * DAY_MS).toISOString(), // 30 days ago → Healthy by default
    last_commit_date: null,
    workflow_status: { has_workflows: false, latest_run: null },
    security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    pending_reviews: { count: 0, items: [] },
    ...overrides
  };
}

describe('KanbanStrip._isDependabotPR', () => {
  let isDependabotPR;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/kanban-strip.js');
    isDependabotPR = window.GHD.KanbanStrip._isDependabotPR;
  });

  it('returns true for author "dependabot[bot]"', () => {
    expect(isDependabotPR({ author: 'dependabot[bot]' })).toBe(true);
  });

  it('returns true for author "app/dependabot"', () => {
    expect(isDependabotPR({ author: 'app/dependabot' })).toBe(true);
  });

  it('returns true for author containing "dependabot" in any case', () => {
    expect(isDependabotPR({ author: 'Dependabot[bot]' })).toBe(true);
    expect(isDependabotPR({ author: 'DEPENDABOT' })).toBe(true);
  });

  it('returns false for a human PR author', () => {
    expect(isDependabotPR({ author: 'jongalloway' })).toBe(false);
  });

  it('returns false for a Copilot PR author', () => {
    expect(isDependabotPR({ author: 'copilot[bot]' })).toBe(false);
  });

  it('returns false for null/undefined pull', () => {
    expect(isDependabotPR(null)).toBe(false);
    expect(isDependabotPR(undefined)).toBe(false);
  });

  it('returns false for a pull with no author field', () => {
    expect(isDependabotPR({})).toBe(false);
  });
});

describe('KanbanStrip._findTopPick', () => {
  let findTopPick;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/kanban-strip.js');
    findTopPick = window.GHD.KanbanStrip._findTopPick;
  });

  it('returns null for an empty repos array', () => {
    expect(findTopPick([])).toBeNull();
  });

  it('returns null when no repos have Dependabot PRs', () => {
    const repos = [
      makeRepo({ pending_reviews: { count: 1, items: [{ author: 'jongalloway' }] } }),
      makeRepo({ name: 'other-repo', pending_reviews: { count: 0, items: [] } })
    ];
    expect(findTopPick(repos)).toBeNull();
  });

  it('returns a topPick object when a Dependabot PR exists', () => {
    const repos = [
      makeRepo({ pending_reviews: { count: 1, items: [{ author: 'dependabot[bot]' }] } })
    ];
    const result = findTopPick(repos);
    expect(result).not.toBeNull();
    expect(result.type).toBe('dependabot');
  });

  it('returned url is the Dependabot cross-repo deep-link (single source of truth)', () => {
    const repos = [
      makeRepo({ pending_reviews: { count: 1, items: [{ author: 'dependabot[bot]' }] } })
    ];
    const result = findTopPick(repos);
    expect(result.url).toBe(
      'https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot'
    );
  });

  it('sorts repos by Dependabot PR count descending (most PRs first)', () => {
    const repoA = makeRepo({
      name: 'repo-a',
      pending_reviews: {
        count: 1,
        items: [{ author: 'dependabot[bot]' }]
      }
    });
    const repoB = makeRepo({
      name: 'repo-b',
      pending_reviews: {
        count: 3,
        items: [
          { author: 'dependabot[bot]' },
          { author: 'dependabot[bot]' },
          { author: 'dependabot[bot]' }
        ]
      }
    });
    const result = findTopPick([repoA, repoB]);
    expect(result.repos[0].repo.name).toBe('repo-b');
    expect(result.repos[0].count).toBe(3);
    expect(result.repos[1].repo.name).toBe('repo-a');
    expect(result.repos[1].count).toBe(1);
  });

  it('includes all repos with Dependabot PRs, excludes repos without', () => {
    const repos = [
      makeRepo({
        name: 'bot-repo',
        pending_reviews: { count: 2, items: [{ author: 'dependabot[bot]' }, { author: 'dependabot[bot]' }] }
      }),
      makeRepo({
        name: 'human-repo',
        pending_reviews: { count: 1, items: [{ author: 'jongalloway' }] }
      })
    ];
    const result = findTopPick(repos);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].repo.name).toBe('bot-repo');
  });

  it('handles repos with mixed Dependabot and human PRs (counts only bot PRs)', () => {
    const repo = makeRepo({
      pending_reviews: {
        count: 3,
        items: [
          { author: 'dependabot[bot]' },
          { author: 'jongalloway' },
          { author: 'app/dependabot' }
        ]
      }
    });
    const result = findTopPick([repo]);
    expect(result).not.toBeNull();
    expect(result.repos[0].count).toBe(2); // only 2 Dependabot PRs
  });
});

describe('KanbanStrip.deriveKanbanLane', () => {
  let derive;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/kanban-strip.js');
    derive = window.GHD.KanbanStrip.deriveKanbanLane;
  });

  // ── Blocked lane ─────────────────────────────────────────

  it('returns "blocked" when CI is failing', () => {
    const repo = makeRepo({
      workflow_status: {
        has_workflows: true,
        latest_run: { conclusion: 'failure' }
      }
    });
    expect(derive(repo, NOW)).toBe('blocked');
  });

  it('returns "blocked" for all CI failure conclusions', () => {
    const conclusions = ['failure', 'timed_out', 'startup_failure', 'action_required'];
    for (const conclusion of conclusions) {
      const repo = makeRepo({
        workflow_status: { has_workflows: true, latest_run: { conclusion } }
      });
      expect(derive(repo, NOW), `conclusion=${conclusion}`).toBe('blocked');
    }
  });

  it('does NOT block when has_workflows is false (public/unauthenticated mode gap)', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: false, latest_run: { conclusion: 'failure' } }
    });
    // has_workflows: false means CI data is unavailable — should not trigger blocked
    expect(derive(repo, NOW)).not.toBe('blocked');
  });

  it('returns "blocked" when security alerts are present', () => {
    const repo = makeRepo({ security_alerts: { total: 3, critical: 1, high: 2, medium: 0, low: 0 } });
    expect(derive(repo, NOW)).toBe('blocked');
  });

  it('returns "blocked" for any non-zero security alert count', () => {
    expect(derive(makeRepo({ security_alerts: { total: 1 } }), NOW)).toBe('blocked');
  });

  // ── Blocked takes precedence ─────────────────────────────

  it('blocked beats needs-attention (CI failure + pending reviews)', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } },
      pending_reviews: { count: 2, items: [] }
    });
    expect(derive(repo, NOW)).toBe('blocked');
  });

  it('blocked beats working (security alerts + recently pushed)', () => {
    const repo = makeRepo({
      security_alerts: { total: 1 },
      pushed_at: new Date(NOW - 3 * DAY_MS).toISOString() // 3 days ago
    });
    expect(derive(repo, NOW)).toBe('blocked');
  });

  // ── Needs Attention lane ─────────────────────────────────

  it('returns "needs-attention" when pending reviews > 0', () => {
    const repo = makeRepo({ pending_reviews: { count: 1, items: [] } });
    expect(derive(repo, NOW)).toBe('needs-attention');
  });

  it('needs-attention beats working (pending reviews + recently pushed)', () => {
    const repo = makeRepo({
      pending_reviews: { count: 1, items: [] },
      pushed_at: new Date(NOW - 2 * DAY_MS).toISOString() // 2 days ago — would be Working
    });
    expect(derive(repo, NOW)).toBe('needs-attention');
  });

  // ── Working lane ─────────────────────────────────────────

  it('returns "working" when pushed_at is within 14 days', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 7 * DAY_MS).toISOString() });
    expect(derive(repo, NOW)).toBe('working');
  });

  it('returns "working" when pushed_at is exactly 14 days ago', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 14 * DAY_MS).toISOString() });
    expect(derive(repo, NOW)).toBe('working');
  });

  it('returns "healthy" when pushed_at is 14 days + 1ms ago (boundary)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 14 * DAY_MS - 1).toISOString() });
    expect(derive(repo, NOW)).toBe('healthy');
  });

  it('falls back to last_commit_date when pushed_at is absent', () => {
    const repo = makeRepo({
      pushed_at: null,
      last_commit_date: new Date(NOW - 5 * DAY_MS).toISOString()
    });
    expect(derive(repo, NOW)).toBe('working');
  });

  it('returns "healthy" when both pushed_at and last_commit_date are null', () => {
    const repo = makeRepo({ pushed_at: null, last_commit_date: null });
    expect(derive(repo, NOW)).toBe('healthy');
  });

  // ── Healthy lane ─────────────────────────────────────────

  it('returns "healthy" when no signals match (old push, no issues)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    expect(derive(repo, NOW)).toBe('healthy');
  });

  it('returns "healthy" for a completely empty/minimal repo object', () => {
    expect(derive({}, NOW)).toBe('healthy');
  });

  // ── Precedence across all four lanes ─────────────────────

  it('top-down precedence: blocked > needs-attention > working > healthy', () => {
    // Verify the chain: blocked wins over all
    const allSignals = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } },
      security_alerts: { total: 1 },
      pending_reviews: { count: 3, items: [] },
      pushed_at: new Date(NOW - 1 * DAY_MS).toISOString()
    });
    expect(derive(allSignals, NOW)).toBe('blocked');

    // No CI/security — needs-attention wins over working
    const noBlock = makeRepo({
      pending_reviews: { count: 2, items: [] },
      pushed_at: new Date(NOW - 1 * DAY_MS).toISOString()
    });
    expect(derive(noBlock, NOW)).toBe('needs-attention');

    // No CI/security/reviews — working wins over healthy
    const working = makeRepo({
      pushed_at: new Date(NOW - 1 * DAY_MS).toISOString()
    });
    expect(derive(working, NOW)).toBe('working');
  });

  // ── Uses provided `now` argument, not Date.now() ─────────

  it('respects the now argument for deterministic time calculations', () => {
    const pushedAt = new Date(NOW - 10 * DAY_MS).toISOString(); // 10 days before NOW
    const repo = makeRepo({ pushed_at: pushedAt });

    // At NOW: 10 days ago → within 14 days → working
    expect(derive(repo, NOW)).toBe('working');

    // 5 days later: 15 days old → beyond 14-day window → healthy
    expect(derive(repo, NOW + 5 * DAY_MS)).toBe('healthy');
  });
});
