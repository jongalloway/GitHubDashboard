import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// Fixed reference timestamp: 2026-06-28T05:03:35.578Z (matches kanban-strip.test.js)
const NOW = new Date('2026-06-28T05:03:35.578Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a minimal repo fixture for backlog tests. Default: 60 days old (Healthy, in backlog window). */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    full_name: 'owner/test-repo',
    html_url: 'https://github.com/owner/test-repo',
    pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(), // 60 days ago — in backlog window
    last_commit_date: null,
    workflow_status: { has_workflows: false, latest_run: null },
    security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    pending_reviews: { count: 0, items: [] },
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// isBacklogRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogStrip.isBacklogRepo', () => {
  let isBacklogRepo;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-strip.js');
    isBacklogRepo = window.GHD.BacklogStrip.isBacklogRepo;
  });

  // ── Age boundary tests ──────────────────────────────────

  it('returns false when pushed_at is exactly 14 days ago (Working boundary — excluded)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 14 * DAY_MS).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns true when pushed_at is 14 days + 1ms ago (just past Working boundary)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 14 * DAY_MS - 1).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(true);
  });

  it('returns false when pushed_at is less than 14 days ago (still Working)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 7 * DAY_MS).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns false when pushed_at is today (same day)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns true when pushed_at is exactly 120 days ago (upper boundary — included)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 120 * DAY_MS).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(true);
  });

  it('returns false when pushed_at is 120 days + 1ms ago (dormant — excluded)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 120 * DAY_MS - 1).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns false when pushed_at is 200 days ago (clearly dormant)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 200 * DAY_MS).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns true for a repo at 60 days (middle of the window)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    expect(isBacklogRepo(repo, NOW)).toBe(true);
  });

  // ── Lane exclusion tests ────────────────────────────────

  it('returns false for a Blocked repo (CI failing) even if age is in the window', () => {
    const repo = makeRepo({
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } }
    });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns false for a Blocked repo (security alerts) even if age is in the window', () => {
    const repo = makeRepo({
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      security_alerts: { total: 2, critical: 1, high: 1, medium: 0, low: 0 }
    });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns false for a Needs Attention repo (pending reviews) even if age is in the window', () => {
    const repo = makeRepo({
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      pending_reviews: { count: 1, items: [{ author: 'jongalloway' }] }
    });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('returns false for all CI failing conclusions', () => {
    const conclusions = ['failure', 'timed_out', 'startup_failure', 'action_required'];
    for (const conclusion of conclusions) {
      const repo = makeRepo({
        pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
        workflow_status: { has_workflows: true, latest_run: { conclusion } }
      });
      expect(isBacklogRepo(repo, NOW), `conclusion=${conclusion}`).toBe(false);
    }
  });

  it('does NOT exclude on has_workflows=false + failure conclusion (data gap — same as Kanban)', () => {
    // When has_workflows is false, CI data is unavailable — not treated as blocked
    const repo = makeRepo({
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      workflow_status: { has_workflows: false, latest_run: { conclusion: 'failure' } }
    });
    expect(isBacklogRepo(repo, NOW)).toBe(true);
  });

  // ── Missing date ────────────────────────────────────────

  it('returns false when both pushed_at and last_commit_date are null (cannot classify)', () => {
    const repo = makeRepo({ pushed_at: null, last_commit_date: null });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  it('falls back to last_commit_date when pushed_at is null', () => {
    const repo = makeRepo({
      pushed_at: null,
      last_commit_date: new Date(NOW - 60 * DAY_MS).toISOString()
    });
    expect(isBacklogRepo(repo, NOW)).toBe(true);
  });

  it('returns false when last_commit_date fallback is outside the window (> 120d)', () => {
    const repo = makeRepo({
      pushed_at: null,
      last_commit_date: new Date(NOW - 200 * DAY_MS).toISOString()
    });
    expect(isBacklogRepo(repo, NOW)).toBe(false);
  });

  // ── now argument determinism ────────────────────────────

  it('respects the injected now argument for deterministic time calculations', () => {
    const pushedAt = new Date(NOW - 15 * DAY_MS).toISOString(); // 15 days before NOW
    const repo = makeRepo({ pushed_at: pushedAt });

    // At NOW: 15 days → in backlog window
    expect(isBacklogRepo(repo, NOW)).toBe(true);

    // Travel back: at NOW - 2d, the same push was only 13 days ago → Working → not backlog
    expect(isBacklogRepo(repo, NOW - 2 * DAY_MS)).toBe(false);

    // Travel forward: at NOW + 110d, push is 125 days ago → dormant → not backlog
    expect(isBacklogRepo(repo, NOW + 110 * DAY_MS)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveBacklogRepos
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogStrip.deriveBacklogRepos', () => {
  let deriveBacklogRepos;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-strip.js');
    deriveBacklogRepos = window.GHD.BacklogStrip.deriveBacklogRepos;
  });

  it('returns empty array for empty input', () => {
    expect(deriveBacklogRepos([], NOW)).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(deriveBacklogRepos(null, NOW)).toEqual([]);
    expect(deriveBacklogRepos(undefined, NOW)).toEqual([]);
  });

  it('returns only repos in the backlog window — excludes Working and dormant', () => {
    const working  = makeRepo({ name: 'working',  pushed_at: new Date(NOW - 7 * DAY_MS).toISOString() });
    const backlog1 = makeRepo({ name: 'backlog1', pushed_at: new Date(NOW - 30 * DAY_MS).toISOString() });
    const backlog2 = makeRepo({ name: 'backlog2', pushed_at: new Date(NOW - 90 * DAY_MS).toISOString() });
    const dormant  = makeRepo({ name: 'dormant',  pushed_at: new Date(NOW - 150 * DAY_MS).toISOString() });

    const result = deriveBacklogRepos([working, backlog1, backlog2, dormant], NOW);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['backlog1', 'backlog2']);
  });

  it('dedup: backlog repos are NOT in the Healthy set (they are separate)', () => {
    // A repo at 60 days qualifies for backlog; it should NOT also appear in the healthy set
    const repo = makeRepo({ name: 'borderline', pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    const backlogResult = deriveBacklogRepos([repo], NOW);
    expect(backlogResult).toHaveLength(1);
    expect(backlogResult[0].name).toBe('borderline');
    // The calling code in app.js excludes backlogSet from the grid — the test confirms the
    // classifier identifies it correctly so no double-counting is possible.
  });

  it('multi-repo isolation: Blocked/Needs-Attention repos in the window are excluded individually', () => {
    const blocked = makeRepo({
      name: 'blocked-repo',
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      security_alerts: { total: 1, critical: 1, high: 0, medium: 0, low: 0 }
    });
    const needsAttn = makeRepo({
      name: 'needs-attn-repo',
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      pending_reviews: { count: 2, items: [] }
    });
    const healthy   = makeRepo({ name: 'healthy-repo',  pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    const dormant   = makeRepo({ name: 'dormant-repo',  pushed_at: new Date(NOW - 200 * DAY_MS).toISOString() });

    const result = deriveBacklogRepos([blocked, needsAttn, healthy, dormant], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('healthy-repo');
  });

  it('handles a mix of 10 repos returning only those in window with no blocking signals', () => {
    const repos = [
      makeRepo({ name: 'r1', pushed_at: new Date(NOW - 3 * DAY_MS).toISOString() }),   // working
      makeRepo({ name: 'r2', pushed_at: new Date(NOW - 15 * DAY_MS).toISOString() }),  // backlog ✓
      makeRepo({ name: 'r3', pushed_at: new Date(NOW - 45 * DAY_MS).toISOString() }),  // backlog ✓
      makeRepo({ name: 'r4', pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(), security_alerts: { total: 1 } }), // blocked
      makeRepo({ name: 'r5', pushed_at: new Date(NOW - 80 * DAY_MS).toISOString(), pending_reviews: { count: 1, items: [] } }), // needs-attn
      makeRepo({ name: 'r6', pushed_at: new Date(NOW - 120 * DAY_MS).toISOString() }), // backlog ✓ (120d exactly)
      makeRepo({ name: 'r7', pushed_at: new Date(NOW - 121 * DAY_MS).toISOString() }), // dormant
    ];
    const result = deriveBacklogRepos(repos, NOW);
    expect(result.map(r => r.name)).toEqual(['r2', 'r3', 'r6']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// app.js renderRepos integration contract
// DOM-level test deferred to Phase 2 per D027 (requires jsdom).
// This suite covers the computation path by replicating the exact Set-building
// pattern that app.js renderRepos uses (lines 794–806 and 824–825 of app.js).
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogStrip — renderRepos integration contract (app.js pattern)', () => {
  let isBacklogRepo;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-strip.js');
    isBacklogRepo = window.GHD.BacklogStrip.isBacklogRepo;
  });

  it('backlog set built by app.js isBacklogRepo loop excludes the repo from the grid set — no double-counting', () => {
    // Replicates the exact computation in app.js renderRepos:
    //   const backlogSet = new Set();
    //   for (const r of _currentRepos) {
    //     if (!closed.has(r.name) && BacklogStrip.isBacklogRepo(r, now)) backlogSet.add(r.name);
    //   }
    //   pinnedRepos = _currentRepos.filter(r => !closed.has(r.name) && !backlogSet.has(r.name));
    //   normalRepos = _currentRepos.filter(r => !closed.has(r.name) && !backlogSet.has(r.name));
    //   KanbanStrip input = _currentRepos.filter(r => !closed.has(r.name) && !backlogSet.has(r.name));
    const working  = makeRepo({ name: 'repo-working',  pushed_at: new Date(NOW - 7 * DAY_MS).toISOString() });
    const backlog  = makeRepo({ name: 'repo-backlog',  pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    const dormant  = makeRepo({ name: 'repo-dormant',  pushed_at: new Date(NOW - 200 * DAY_MS).toISOString() });
    const allRepos = [working, backlog, dormant];
    const closed   = new Set();

    // Replicate app.js renderRepos backlog-set computation
    const backlogSet = new Set();
    for (const r of allRepos) {
      if (!closed.has(r.name) && isBacklogRepo(r, NOW)) backlogSet.add(r.name);
    }
    const gridRepos    = allRepos.filter(r => !closed.has(r.name) && !backlogSet.has(r.name));
    const backlogRepos = allRepos.filter(r => backlogSet.has(r.name));

    // Backlog repo captured in backlog set
    expect(backlogSet.has('repo-backlog')).toBe(true);
    // Backlog repo absent from the grid — no double-counting
    expect(gridRepos.map(r => r.name)).not.toContain('repo-backlog');
    // Backlog repo present exclusively in the backlog strip
    expect(backlogRepos.map(r => r.name)).toContain('repo-backlog');
    // Working and dormant stay in the grid (not captured as backlog)
    expect(gridRepos.map(r => r.name)).toContain('repo-working');
    expect(gridRepos.map(r => r.name)).toContain('repo-dormant');
    // Mutual exclusion: no repo appears in both sets
    const gridNames    = new Set(gridRepos.map(r => r.name));
    const backlogNames = new Set(backlogRepos.map(r => r.name));
    for (const n of backlogNames) {
      expect(gridNames.has(n), `"${n}" must not appear in both grid and backlog`).toBe(false);
    }
  });

  it('closed repos are excluded from both the backlog set and grid (closed > backlog precedence)', () => {
    const closedBacklog = makeRepo({ name: 'closed-backlog', pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    const normalBacklog = makeRepo({ name: 'open-backlog',   pushed_at: new Date(NOW - 60 * DAY_MS).toISOString() });
    const allRepos = [closedBacklog, normalBacklog];
    const closed   = new Set(['closed-backlog']);

    const backlogSet = new Set();
    for (const r of allRepos) {
      if (!closed.has(r.name) && isBacklogRepo(r, NOW)) backlogSet.add(r.name);
    }
    const gridRepos    = allRepos.filter(r => !closed.has(r.name) && !backlogSet.has(r.name));
    const backlogRepos = allRepos.filter(r => backlogSet.has(r.name));

    // Closed repo is not in backlog set
    expect(backlogSet.has('closed-backlog')).toBe(false);
    // Closed repo is not in the grid either (closed section is separate)
    expect(gridRepos.map(r => r.name)).not.toContain('closed-backlog');
    // Open backlog repo is captured correctly
    expect(backlogRepos.map(r => r.name)).toContain('open-backlog');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _formatBacklogAge
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogStrip._formatBacklogAge', () => {
  let fmt;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-strip.js');
    fmt = window.GHD.BacklogStrip._formatBacklogAge;
  });

  it('returns "" for null', () => {
    expect(fmt(null, NOW)).toBe('');
  });

  it('returns "" for an invalid date string', () => {
    expect(fmt('not-a-date', NOW)).toBe('');
  });

  it('returns "2 weeks ago" for 15 days', () => {
    const pushed = new Date(NOW - 15 * DAY_MS).toISOString();
    expect(fmt(pushed, NOW)).toBe('2 weeks ago');
  });

  it('returns "3 weeks ago" for 21 days', () => {
    const pushed = new Date(NOW - 21 * DAY_MS).toISOString();
    expect(fmt(pushed, NOW)).toBe('3 weeks ago');
  });

  it('returns "1 month ago" for 30 days (singular)', () => {
    const pushed = new Date(NOW - 30 * DAY_MS).toISOString();
    expect(fmt(pushed, NOW)).toBe('1 month ago');
  });

  it('returns "2 months ago" for 60 days', () => {
    const pushed = new Date(NOW - 60 * DAY_MS).toISOString();
    expect(fmt(pushed, NOW)).toBe('2 months ago');
  });

  it('returns "4 months ago" for 120 days', () => {
    const pushed = new Date(NOW - 120 * DAY_MS).toISOString();
    expect(fmt(pushed, NOW)).toBe('4 months ago');
  });

  it('uses injected now — same date, different now produces different result', () => {
    const pushed = new Date(NOW - 21 * DAY_MS).toISOString();
    // At NOW:       21 days old → 3 weeks ago
    expect(fmt(pushed, NOW)).toBe('3 weeks ago');
    // 40 days later: 61 days old → 2 months ago
    expect(fmt(pushed, NOW + 40 * DAY_MS)).toBe('2 months ago');
  });
});
