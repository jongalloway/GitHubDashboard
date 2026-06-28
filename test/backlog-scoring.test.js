import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// Fixed reference timestamp: 2026-06-28T05:03:35.578Z (matches backlog-strip.test.js)
const NOW = new Date('2026-06-28T05:03:35.578Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal backlog repo fixture. Default: 60 days old, no signals. */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    full_name: 'owner/test-repo',
    html_url: 'https://github.com/owner/test-repo',
    pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
    last_commit_date: null,
    open_issues_count: 0,
    releases: { commits_since_latest: 0 },
    copilot_activity: {
      copilot_open_pr_count: 0,
      signals: []
    },
    squad_activity: { squad_enabled: false },
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreBacklogRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogScoring.scoreBacklogRepo', () => {
  let scoreBacklogRepo;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-scoring.js');
    scoreBacklogRepo = window.GHD.BacklogScoring.scoreBacklogRepo;
  });

  // ── Graceful fallbacks ────────────────────────────────────

  it('returns 0 for null repo', () => {
    expect(scoreBacklogRepo(null, NOW)).toBe(0);
  });

  it('returns 0 for undefined repo', () => {
    expect(scoreBacklogRepo(undefined, NOW)).toBe(0);
  });

  it('returns 0 for empty object (no date fields)', () => {
    expect(scoreBacklogRepo({}, NOW)).toBe(0);
  });

  it('returns 0 for repo with unparseable pushed_at', () => {
    expect(scoreBacklogRepo(makeRepo({ pushed_at: 'not-a-date', last_commit_date: null }), NOW)).toBe(0);
  });

  // ── Zero-signal baseline ──────────────────────────────────

  it('returns > 0 for a repo with only a valid date (60 days old)', () => {
    const score = scoreBacklogRepo(makeRepo(), NOW);
    expect(score).toBeGreaterThan(0);
  });

  it('returns a pure recency score when all signals are zero (60 days old)', () => {
    const repo = makeRepo({ open_issues_count: 0, releases: { commits_since_latest: 0 } });
    const score = scoreBacklogRepo(repo, NOW);
    // 60 days old: fraction = (120-60)/(120-14) = 60/106 ≈ 0.566 → ~28.3 recency pts
    expect(score).toBeCloseTo(60 / 106 * 50, 5);
  });

  // ── Recency ordering ──────────────────────────────────────

  it('30-day repo scores higher than 100-day repo (all else equal)', () => {
    const recent = makeRepo({ pushed_at: new Date(NOW - 30 * DAY_MS).toISOString() });
    const old    = makeRepo({ pushed_at: new Date(NOW - 100 * DAY_MS).toISOString() });
    expect(scoreBacklogRepo(recent, NOW)).toBeGreaterThan(scoreBacklogRepo(old, NOW));
  });

  it('15-day repo (just past Working boundary) scores near maximum recency', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 15 * DAY_MS).toISOString() });
    const score = scoreBacklogRepo(repo, NOW);
    // fraction = (120-15)/(120-14) = 105/106 ≈ 0.991 → ~49.5 recency pts
    expect(score).toBeGreaterThan(49);
  });

  it('120-day repo (at dormant boundary) scores ~0 recency component', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 120 * DAY_MS).toISOString() });
    const score = scoreBacklogRepo(repo, NOW);
    // recency fraction = (120-120)/(120-14) = 0 → 0 recency pts
    expect(score).toBe(0); // no other signals either
  });

  // ── Issues signal ─────────────────────────────────────────

  it('adds issue score for open_issues_count', () => {
    const noIssues = makeRepo({ pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(), open_issues_count: 0 });
    const withIssues = makeRepo({ pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(), open_issues_count: 5 });
    expect(scoreBacklogRepo(withIssues, NOW)).toBe(scoreBacklogRepo(noIssues, NOW) + 5);
  });

  it('caps issue score at 20 for large open_issues_count', () => {
    const many = makeRepo({ open_issues_count: 100 });
    const capped = makeRepo({ open_issues_count: 20 });
    expect(scoreBacklogRepo(many, NOW)).toBe(scoreBacklogRepo(capped, NOW));
  });

  it('ignores negative or NaN open_issues_count gracefully', () => {
    expect(scoreBacklogRepo(makeRepo({ open_issues_count: -5 }), NOW)).toBeGreaterThanOrEqual(0);
    expect(scoreBacklogRepo(makeRepo({ open_issues_count: NaN }), NOW)).toBeGreaterThanOrEqual(0);
  });

  // ── Release pressure signal ───────────────────────────────

  it('adds release score for commits_since_latest', () => {
    const noRelease = makeRepo({ releases: { commits_since_latest: 0 } });
    const withRelease = makeRepo({ releases: { commits_since_latest: 8 } });
    expect(scoreBacklogRepo(withRelease, NOW)).toBe(scoreBacklogRepo(noRelease, NOW) + 8);
  });

  it('caps release score at 10 commits', () => {
    const ten = makeRepo({ releases: { commits_since_latest: 10 } });
    const twenty = makeRepo({ releases: { commits_since_latest: 20 } });
    expect(scoreBacklogRepo(ten, NOW)).toBe(scoreBacklogRepo(twenty, NOW));
  });

  it('handles missing releases gracefully (no release data → 0 release score)', () => {
    const noReleases = makeRepo({ releases: undefined });
    const zeroReleases = makeRepo({ releases: { commits_since_latest: 0 } });
    expect(scoreBacklogRepo(noReleases, NOW)).toBe(scoreBacklogRepo(zeroReleases, NOW));
  });

  // ── Copilot signal ────────────────────────────────────────

  it('adds copilot score for open Copilot PRs', () => {
    const noCopilot = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: [] } });
    const withCopilot = makeRepo({ copilot_activity: { copilot_open_pr_count: 2, signals: [] } });
    expect(scoreBacklogRepo(withCopilot, NOW)).toBe(scoreBacklogRepo(noCopilot, NOW) + 5);
  });

  it('adds copilot score for non-empty signals array', () => {
    const noSignals = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: [] } });
    const withSignals = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: ['copilot-branch'] } });
    expect(scoreBacklogRepo(withSignals, NOW)).toBe(scoreBacklogRepo(noSignals, NOW) + 5);
  });

  it('caps copilot score at 10 (PRs + signals both present)', () => {
    const full = makeRepo({
      copilot_activity: { copilot_open_pr_count: 1, signals: ['copilot-branch'] }
    });
    const baseline = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: [] } });
    expect(scoreBacklogRepo(full, NOW)).toBe(scoreBacklogRepo(baseline, NOW) + 10);
  });

  it('adds squad score as fallback when no copilot signals', () => {
    const noSquad = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: [] }, squad_activity: { squad_enabled: false } });
    const withSquad = makeRepo({ copilot_activity: { copilot_open_pr_count: 0, signals: [] }, squad_activity: { squad_enabled: true } });
    expect(scoreBacklogRepo(withSquad, NOW)).toBe(scoreBacklogRepo(noSquad, NOW) + 3);
  });

  it('does not add squad score when copilot score already earned', () => {
    // copilot PRs present → squad_enabled should not add more beyond the cap
    const withBoth = makeRepo({
      copilot_activity: { copilot_open_pr_count: 1, signals: ['copilot-branch'] },
      squad_activity: { squad_enabled: true }
    });
    const withCopilotOnly = makeRepo({
      copilot_activity: { copilot_open_pr_count: 1, signals: ['copilot-branch'] },
      squad_activity: { squad_enabled: false }
    });
    expect(scoreBacklogRepo(withBoth, NOW)).toBe(scoreBacklogRepo(withCopilotOnly, NOW));
  });

  // ── Boundary: 30d-with-issues beats 100d-dormant ─────────

  it('30d repo with issues scores higher than 100d dormant repo', () => {
    const recent = makeRepo({
      pushed_at: new Date(NOW - 30 * DAY_MS).toISOString(),
      open_issues_count: 3
    });
    const old = makeRepo({
      pushed_at: new Date(NOW - 100 * DAY_MS).toISOString(),
      open_issues_count: 0
    });
    expect(scoreBacklogRepo(recent, NOW)).toBeGreaterThan(scoreBacklogRepo(old, NOW));
  });

  // ── Deterministic with Date.now() default ─────────────────

  it('returns a number when now is omitted (uses Date.now())', () => {
    const score = scoreBacklogRepo(makeRepo());
    expect(typeof score).toBe('number');
    expect(Number.isFinite(score)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findTopBacklogPick
// ─────────────────────────────────────────────────────────────────────────────

describe('BacklogScoring.findTopBacklogPick', () => {
  let findTopBacklogPick;
  let scoreBacklogRepo;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/backlog-scoring.js');
    findTopBacklogPick = window.GHD.BacklogScoring.findTopBacklogPick;
    scoreBacklogRepo   = window.GHD.BacklogScoring.scoreBacklogRepo;
  });

  it('returns null for empty array', () => {
    expect(findTopBacklogPick([], NOW)).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(findTopBacklogPick(null, NOW)).toBeNull();
    expect(findTopBacklogPick(undefined, NOW)).toBeNull();
  });

  it('returns the single repo when only one provided', () => {
    const repo = makeRepo({ name: 'only-repo' });
    const result = findTopBacklogPick([repo], NOW);
    expect(result).not.toBeNull();
    expect(result.repo.name).toBe('only-repo');
  });

  it('returns the highest-scored repo', () => {
    const old     = makeRepo({ name: 'old-repo',    pushed_at: new Date(NOW - 100 * DAY_MS).toISOString(), open_issues_count: 0 });
    const recent  = makeRepo({ name: 'recent-repo', pushed_at: new Date(NOW - 20 * DAY_MS).toISOString(),  open_issues_count: 0 });
    const result  = findTopBacklogPick([old, recent], NOW);
    expect(result.repo.name).toBe('recent-repo');
  });

  it('uses alphabetical name as tiebreaker (lower name wins)', () => {
    // Both same pushed_at, no signals → same score
    const pushed = new Date(NOW - 60 * DAY_MS).toISOString();
    const alpha  = makeRepo({ name: 'aaa-repo', pushed_at: pushed });
    const beta   = makeRepo({ name: 'zzz-repo', pushed_at: pushed });
    const result = findTopBacklogPick([beta, alpha], NOW);
    expect(result.repo.name).toBe('aaa-repo');
  });

  it('returns a result with repo, score and url fields', () => {
    const repo   = makeRepo();
    const result = findTopBacklogPick([repo], NOW);
    expect(result).toHaveProperty('repo');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('url');
    expect(typeof result.score).toBe('number');
  });

  it('url is html_url when present', () => {
    const repo   = makeRepo({ html_url: 'https://github.com/owner/test-repo' });
    const result = findTopBacklogPick([repo], NOW);
    expect(result.url).toBe('https://github.com/owner/test-repo');
  });

  it('url falls back to full_name when html_url absent', () => {
    const repo   = makeRepo({ html_url: undefined, full_name: 'owner/fallback-repo' });
    const result = findTopBacklogPick([repo], NOW);
    expect(result.url).toBe('https://github.com/owner/fallback-repo');
  });

  it('url falls back to # when neither html_url nor full_name present', () => {
    const repo   = makeRepo({ html_url: undefined, full_name: undefined });
    const result = findTopBacklogPick([repo], NOW);
    expect(result.url).toBe('#');
  });

  it('url clamps non-http(s) values to #', () => {
    const repo   = makeRepo({ html_url: 'javascript:alert(1)' });
    const result = findTopBacklogPick([repo], NOW);
    expect(result.url).toBe('#');
  });

  it('score in result matches scoreBacklogRepo for the same repo', () => {
    const repo   = makeRepo({ open_issues_count: 5 });
    const result = findTopBacklogPick([repo], NOW);
    expect(result.score).toBe(scoreBacklogRepo(repo, NOW));
  });

  // ── Tie ordering is stable ────────────────────────────────

  it('ordering is deterministic when input order varies (same repos)', () => {
    const pushed = new Date(NOW - 30 * DAY_MS).toISOString();
    const repos  = ['charlie', 'alpha', 'beta'].map(n => makeRepo({ name: n, pushed_at: pushed }));
    const r1 = findTopBacklogPick(repos, NOW);
    const r2 = findTopBacklogPick([...repos].reverse(), NOW);
    expect(r1.repo.name).toBe('alpha'); // alphabetical winner
    expect(r2.repo.name).toBe('alpha');
  });
});
