import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// Fixed reference timestamp: 2026-06-28T15:42:19-07:00
const NOW = new Date('2026-06-28T22:42:19.000Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

// ── localStorage stub ──────────────────────────────────────────────────────────

class MockLocalStorage {
  constructor() { this._store = {}; }
  getItem(k)       { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; }
  setItem(k, v)    { this._store[k] = String(v); }
  removeItem(k)    { delete this._store[k]; }
  clear()          { this._store = {}; }
}

let mockLS;

beforeEach(() => {
  mockLS = new MockLocalStorage();
  globalThis.window    = { GHD: {} };
  globalThis.localStorage = mockLS;
  loadBrowserScript('js/snooze.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function snooze()   { return window.GHD.Snooze; }
function readRaw()  {
  const raw = mockLS.getItem('ghd-snooze-v1');
  return raw ? JSON.parse(raw) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// snoozeRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.snoozeRepo', () => {
  it('persists a snooze entry with correct until timestamp', () => {
    snooze().snoozeRepo('my-repo', 3, NOW);
    const data = readRaw();
    expect(data.version).toBe(1);
    expect(data.entries).toHaveLength(1);
    const entry = data.entries[0];
    expect(entry.repo).toBe('my-repo');
    const expectedUntil = NOW + 3 * DAY_MS;
    expect(new Date(entry.until).getTime()).toBe(expectedUntil);
  });

  it('uses durationDays=1 when duration is omitted or invalid', () => {
    snooze().snoozeRepo('repo-a', undefined, NOW);
    const data = readRaw();
    const expectedUntil = NOW + 1 * DAY_MS;
    expect(new Date(data.entries[0].until).getTime()).toBe(expectedUntil);
  });

  it('uses durationDays=1 for zero or negative duration', () => {
    snooze().snoozeRepo('repo-a', 0, NOW);
    const data = readRaw();
    expect(new Date(data.entries[0].until).getTime()).toBe(NOW + 1 * DAY_MS);
  });

  it('replaces an existing entry for the same repo', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    snooze().snoozeRepo('repo-a', 7, NOW);
    const data = readRaw();
    expect(data.entries).toHaveLength(1);
    expect(new Date(data.entries[0].until).getTime()).toBe(NOW + 7 * DAY_MS);
  });

  it('stores multiple different repos', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    snooze().snoozeRepo('repo-b', 3, NOW);
    const data = readRaw();
    expect(data.entries).toHaveLength(2);
    expect(data.entries.map(e => e.repo).sort()).toEqual(['repo-a', 'repo-b']);
  });

  it('does nothing for null / empty repo name', () => {
    snooze().snoozeRepo(null, 3, NOW);
    snooze().snoozeRepo('', 3, NOW);
    expect(readRaw()).toBeNull();
  });

  it('does nothing for non-string repo name', () => {
    snooze().snoozeRepo(42, 3, NOW);
    expect(readRaw()).toBeNull();
  });

  it('prunes expired entries on write', () => {
    // Pre-load an expired entry via direct storage write
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({
      version: 1,
      entries: [{ repo: 'old-repo', until: new Date(NOW - DAY_MS).toISOString() }]
    }));
    snooze().snoozeRepo('new-repo', 1, NOW);
    const data = readRaw();
    expect(data.entries.map(e => e.repo)).not.toContain('old-repo');
    expect(data.entries.map(e => e.repo)).toContain('new-repo');
  });

  it('enforces MAX_ENTRIES=50 cap, keeping most-recent', () => {
    // Add 51 active entries manually
    const entries = Array.from({ length: 51 }, (_, i) => ({
      repo: `repo-${i}`,
      until: new Date(NOW + 10 * DAY_MS).toISOString()
    }));
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({ version: 1, entries }));

    snooze().snoozeRepo('repo-NEW', 1, NOW);
    const data = readRaw();
    expect(data.entries.length).toBeLessThanOrEqual(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSnoozed
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.isSnoozed', () => {
  it('returns true for an active snooze', () => {
    snooze().snoozeRepo('repo-a', 3, NOW);
    expect(snooze().isSnoozed('repo-a', NOW)).toBe(true);
  });

  it('returns false for a non-snoozed repo', () => {
    expect(snooze().isSnoozed('repo-z', NOW)).toBe(false);
  });

  it('returns false after the snooze has expired', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    const future = NOW + 2 * DAY_MS; // 2 days later → 1d snooze expired
    expect(snooze().isSnoozed('repo-a', future)).toBe(false);
  });

  it('returns true exactly 1ms before expiry', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    const justBefore = NOW + DAY_MS - 1;
    expect(snooze().isSnoozed('repo-a', justBefore)).toBe(true);
  });

  it('returns false exactly at expiry timestamp', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    const atExpiry = NOW + DAY_MS;
    expect(snooze().isSnoozed('repo-a', atExpiry)).toBe(false);
  });

  it('returns false for null repo name', () => {
    expect(snooze().isSnoozed(null, NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSnoozedUntil
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.getSnoozedUntil', () => {
  it('returns the ISO until string for a snoozed repo', () => {
    snooze().snoozeRepo('repo-a', 7, NOW);
    const until = snooze().getSnoozedUntil('repo-a');
    expect(until).toBe(new Date(NOW + 7 * DAY_MS).toISOString());
  });

  it('returns null for an un-snoozed repo', () => {
    expect(snooze().getSnoozedUntil('no-such-repo')).toBeNull();
  });

  it('returns null for null repo name', () => {
    expect(snooze().getSnoozedUntil(null)).toBeNull();
  });

  it('returns until string even if the snooze has expired (raw storage read)', () => {
    const pastUntil = new Date(NOW - DAY_MS).toISOString();
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({
      version: 1,
      entries: [{ repo: 'repo-a', until: pastUntil }]
    }));
    expect(snooze().getSnoozedUntil('repo-a')).toBe(pastUntil);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unsnoozeRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.unsnoozeRepo', () => {
  it('removes the snooze entry', () => {
    snooze().snoozeRepo('repo-a', 3, NOW);
    snooze().unsnoozeRepo('repo-a');
    expect(snooze().isSnoozed('repo-a', NOW)).toBe(false);
    expect(readRaw().entries).toHaveLength(0);
  });

  it('does not affect other snoozed repos', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    snooze().snoozeRepo('repo-b', 1, NOW);
    snooze().unsnoozeRepo('repo-a');
    expect(snooze().isSnoozed('repo-b', NOW)).toBe(true);
    expect(readRaw().entries).toHaveLength(1);
  });

  it('is safe to call when repo is not snoozed', () => {
    expect(() => snooze().unsnoozeRepo('no-such-repo')).not.toThrow();
  });

  it('is safe to call with null', () => {
    expect(() => snooze().unsnoozeRepo(null)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSnoozedRepos
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.getSnoozedRepos', () => {
  it('returns a Set containing all active snooze names', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    snooze().snoozeRepo('repo-b', 3, NOW);
    const set = snooze().getSnoozedRepos(NOW);
    expect(set instanceof Set).toBe(true);
    expect(set.has('repo-a')).toBe(true);
    expect(set.has('repo-b')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('excludes expired entries', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    const future = NOW + 2 * DAY_MS;
    const set = snooze().getSnoozedRepos(future);
    expect(set.has('repo-a')).toBe(false);
    expect(set.size).toBe(0);
  });

  it('returns empty Set when nothing is snoozed', () => {
    const set = snooze().getSnoozedRepos(NOW);
    expect(set.size).toBe(0);
  });

  it('does not modify storage (read-only)', () => {
    snooze().snoozeRepo('repo-a', 1, NOW);
    const before = mockLS.getItem('ghd-snooze-v1');
    snooze().getSnoozedRepos(NOW);
    expect(mockLS.getItem('ghd-snooze-v1')).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pruneExpired
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze.pruneExpired', () => {
  it('removes expired entries and returns count pruned', () => {
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({
      version: 1,
      entries: [
        { repo: 'expired-1', until: new Date(NOW - DAY_MS).toISOString() },
        { repo: 'expired-2', until: new Date(NOW - 2 * DAY_MS).toISOString() },
        { repo: 'active',    until: new Date(NOW + DAY_MS).toISOString() }
      ]
    }));
    const pruned = snooze().pruneExpired(NOW);
    expect(pruned).toBe(2);
    const data = readRaw();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].repo).toBe('active');
  });

  it('returns 0 when nothing expired', () => {
    snooze().snoozeRepo('repo-a', 7, NOW);
    const pruned = snooze().pruneExpired(NOW);
    expect(pruned).toBe(0);
  });

  it('returns 0 on empty storage', () => {
    expect(snooze().pruneExpired(NOW)).toBe(0);
  });

  it('enforces MAX_ENTRIES cap and counts capped entries as pruned', () => {
    const entries = Array.from({ length: 52 }, (_, i) => ({
      repo: `repo-${i}`,
      until: new Date(NOW + 10 * DAY_MS).toISOString()
    }));
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({ version: 1, entries }));
    const pruned = snooze().pruneExpired(NOW);
    expect(pruned).toBe(2);
    expect(readRaw().entries.length).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema robustness
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze schema robustness', () => {
  it('returns empty state when storage is corrupt JSON', () => {
    mockLS.setItem('ghd-snooze-v1', 'NOT_JSON{{{');
    expect(snooze().getSnoozedRepos(NOW).size).toBe(0);
    expect(snooze().isSnoozed('repo-a', NOW)).toBe(false);
  });

  it('returns empty state when schema version mismatches', () => {
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({
      version: 99,
      entries: [{ repo: 'repo-a', until: new Date(NOW + DAY_MS).toISOString() }]
    }));
    expect(snooze().isSnoozed('repo-a', NOW)).toBe(false);
  });

  it('returns empty state when entries is not an array', () => {
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({ version: 1, entries: null }));
    expect(snooze().getSnoozedRepos(NOW).size).toBe(0);
  });

  it('tolerates entries with invalid until timestamps', () => {
    mockLS.setItem('ghd-snooze-v1', JSON.stringify({
      version: 1,
      entries: [
        { repo: 'bad-date', until: 'not-a-date' },
        { repo: 'good',     until: new Date(NOW + DAY_MS).toISOString() }
      ]
    }));
    const set = snooze().getSnoozedRepos(NOW);
    expect(set.has('bad-date')).toBe(false);
    expect(set.has('good')).toBe(true);
  });

  it('snoozeRepo gracefully handles missing localStorage', () => {
    globalThis.localStorage = undefined;
    // Reload the module without localStorage
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/snooze.js');
    expect(() => window.GHD.Snooze.snoozeRepo('repo-a', 1, NOW)).not.toThrow();
    expect(() => window.GHD.Snooze.isSnoozed('repo-a', NOW)).not.toThrow();
    expect(window.GHD.Snooze.isSnoozed('repo-a', NOW)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scoring integration — snoozed repos excluded before findTopBacklogPick
// ─────────────────────────────────────────────────────────────────────────────

describe('Snooze + BacklogScoring integration', () => {
  let findTopBacklogPick;

  function loadScoring() {
    const fullPath = resolve(process.cwd(), 'js/backlog-scoring.js');
    const code = readFileSync(fullPath, 'utf8');
    vm.runInThisContext(code, { filename: fullPath });
    findTopBacklogPick = window.GHD.BacklogScoring.findTopBacklogPick;
  }

  beforeEach(() => {
    globalThis.localStorage = mockLS;
    loadScoring();
  });

  function makeBacklogRepo(name, overrides = {}) {
    return {
      name,
      full_name: `owner/${name}`,
      html_url: `https://github.com/owner/${name}`,
      pushed_at: new Date(NOW - 60 * DAY_MS).toISOString(),
      open_issues_count: 5,
      releases: { commits_since_latest: 3 },
      copilot_activity: { copilot_open_pr_count: 0, signals: [] },
      squad_activity: { squad_enabled: false },
      ...overrides
    };
  }

  it('snoozed repo excluded from findTopBacklogPick when filtered out beforehand', () => {
    const repoA = makeBacklogRepo('repo-a', { open_issues_count: 20 }); // high score
    const repoB = makeBacklogRepo('repo-b', { open_issues_count: 1  }); // low score

    snooze().snoozeRepo('repo-a', 3, NOW);
    const snoozed = snooze().getSnoozedRepos(NOW);

    // Caller's responsibility: filter before scoring (mirroring the app.js pattern)
    const candidates = [repoA, repoB].filter(r => !snoozed.has(r.name));
    const pick = findTopBacklogPick(candidates, NOW);

    expect(pick).not.toBeNull();
    expect(pick.repo.name).toBe('repo-b');
  });

  it('snoozed repo IS top pick when snooze has expired', () => {
    const repoA = makeBacklogRepo('repo-a', { open_issues_count: 20 });
    const repoB = makeBacklogRepo('repo-b', { open_issues_count: 1  });

    snooze().snoozeRepo('repo-a', 1, NOW);
    const future = NOW + 2 * DAY_MS; // past expiry
    const snoozed = snooze().getSnoozedRepos(future);

    const candidates = [repoA, repoB].filter(r => !snoozed.has(r.name));
    const pick = findTopBacklogPick(candidates, future);

    expect(pick.repo.name).toBe('repo-a'); // back in the running
  });

  it('returns null when all repos are snoozed', () => {
    const repoA = makeBacklogRepo('repo-a');
    snooze().snoozeRepo('repo-a', 7, NOW);
    const snoozed  = snooze().getSnoozedRepos(NOW);
    const candidates = [repoA].filter(r => !snoozed.has(r.name));
    const pick = findTopBacklogPick(candidates, NOW);
    expect(pick).toBeNull();
  });
});
