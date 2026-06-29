import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// ── localStorage stub ──────────────────────────────────────────────────────────

class MockLocalStorage {
  constructor() { this._store = {}; }
  getItem(k)    { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; }
  setItem(k, v) { this._store[k] = String(v); }
  removeItem(k) { delete this._store[k]; }
  clear()       { this._store = {}; }
}

let mockLS;

beforeEach(() => {
  mockLS = new MockLocalStorage();
  globalThis.window    = { GHD: {} };
  globalThis.localStorage = mockLS;
  loadBrowserScript('js/pinned.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pinned() { return window.GHD.Pinned; }
function readRaw() {
  const raw = mockLS.getItem('ghd-pinned-v1');
  return raw ? JSON.parse(raw) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// pinRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned.pinRepo', () => {
  it('persists an entry with the correct repo name', () => {
    pinned().pinRepo('my-repo');
    const data = readRaw();
    expect(data.version).toBe(1);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].repo).toBe('my-repo');
  });

  it('is idempotent — repeated pin keeps one entry', () => {
    pinned().pinRepo('repo-a');
    pinned().pinRepo('repo-a');
    const data = readRaw();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].repo).toBe('repo-a');
  });

  it('accumulates multiple distinct repos', () => {
    pinned().pinRepo('repo-a');
    pinned().pinRepo('repo-b');
    const data = readRaw();
    expect(data.entries).toHaveLength(2);
    const names = data.entries.map(e => e.repo);
    expect(names).toContain('repo-a');
    expect(names).toContain('repo-b');
  });

  it('ignores empty or non-string input', () => {
    pinned().pinRepo('');
    pinned().pinRepo(null);
    pinned().pinRepo(undefined);
    pinned().pinRepo(42);
    expect(readRaw()).toBeNull(); // nothing written
  });

  it('stores versioned JSON blob with version=1', () => {
    pinned().pinRepo('repo-x');
    const data = readRaw();
    expect(data.version).toBe(1);
    expect(Array.isArray(data.entries)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unpinRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned.unpinRepo', () => {
  it('removes a pinned repo', () => {
    pinned().pinRepo('repo-a');
    pinned().unpinRepo('repo-a');
    const data = readRaw();
    expect(data.entries).toHaveLength(0);
  });

  it('is a no-op for a repo that is not pinned', () => {
    pinned().pinRepo('repo-b');
    pinned().unpinRepo('repo-x'); // not pinned
    expect(readRaw().entries).toHaveLength(1);
  });

  it('ignores falsy input gracefully', () => {
    pinned().pinRepo('repo-a');
    pinned().unpinRepo(null);
    pinned().unpinRepo(undefined);
    expect(readRaw().entries).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPinned
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned.isPinned', () => {
  it('returns true for a pinned repo', () => {
    pinned().pinRepo('repo-a');
    expect(pinned().isPinned('repo-a')).toBe(true);
  });

  it('returns false for an unpinned repo', () => {
    expect(pinned().isPinned('repo-x')).toBe(false);
  });

  it('returns false after unpinning', () => {
    pinned().pinRepo('repo-a');
    pinned().unpinRepo('repo-a');
    expect(pinned().isPinned('repo-a')).toBe(false);
  });

  it('returns false for falsy input', () => {
    expect(pinned().isPinned('')).toBe(false);
    expect(pinned().isPinned(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPinnedRepos
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned.getPinnedRepos', () => {
  it('returns an empty Set when nothing is pinned', () => {
    const result = pinned().getPinnedRepos();
    expect(result instanceof Set).toBe(true);
    expect(result.size).toBe(0);
  });

  it('returns a Set containing all pinned repo names', () => {
    pinned().pinRepo('repo-a');
    pinned().pinRepo('repo-b');
    const result = pinned().getPinnedRepos();
    expect(result.has('repo-a')).toBe(true);
    expect(result.has('repo-b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('does not include unpinned repos', () => {
    pinned().pinRepo('repo-a');
    pinned().unpinRepo('repo-a');
    const result = pinned().getPinnedRepos();
    expect(result.has('repo-a')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cap enforcement (MAX_ENTRIES = 10)
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned cap enforcement', () => {
  it('keeps at most MAX_ENTRIES repos, dropping oldest when exceeded', () => {
    const MAX = pinned().MAX_ENTRIES; // 10
    // Pin MAX + 2 repos
    for (let i = 0; i < MAX + 2; i++) {
      pinned().pinRepo(`repo-${i}`);
    }
    const data = readRaw();
    expect(data.entries.length).toBe(MAX);
    // Oldest two should be gone (repo-0 and repo-1)
    const names = data.entries.map(e => e.repo);
    expect(names).not.toContain('repo-0');
    expect(names).not.toContain('repo-1');
    // Most recent should be present
    expect(names).toContain(`repo-${MAX + 1}`);
  });

  it('pruneOverCap removes excess entries and returns the count removed', () => {
    // Manually write an oversized blob
    mockLS.setItem('ghd-pinned-v1', JSON.stringify({
      version: 1,
      entries: Array.from({ length: 15 }, (_, i) => ({ repo: `repo-${i}` }))
    }));
    const removed = pinned().pruneOverCap();
    expect(removed).toBe(5);
    expect(readRaw().entries.length).toBe(10);
  });

  it('pruneOverCap returns 0 when within cap', () => {
    pinned().pinRepo('repo-a');
    pinned().pinRepo('repo-b');
    expect(pinned().pruneOverCap()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorage schema robustness
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned localStorage robustness', () => {
  it('handles corrupted JSON gracefully', () => {
    mockLS.setItem('ghd-pinned-v1', 'not-json{{');
    expect(pinned().isPinned('repo-x')).toBe(false);
    expect(pinned().getPinnedRepos().size).toBe(0);
  });

  it('discards data with wrong schema version', () => {
    mockLS.setItem('ghd-pinned-v1', JSON.stringify({ version: 99, entries: [{ repo: 'repo-a' }] }));
    expect(pinned().isPinned('repo-a')).toBe(false);
  });

  it('discards data where entries is not an array', () => {
    mockLS.setItem('ghd-pinned-v1', JSON.stringify({ version: 1, entries: 'bad' }));
    expect(pinned().getPinnedRepos().size).toBe(0);
  });

  it('returns empty state when localStorage is empty', () => {
    expect(pinned().getPinnedRepos().size).toBe(0);
    expect(pinned().isPinned('any-repo')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grid / Kanban exclusion logic (pure set operations)
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned grid and lane exclusion', () => {
  it('getPinnedRepos returns a Set usable to exclude from normal grid', () => {
    pinned().pinRepo('pinned-repo');
    const repos = [
      { name: 'pinned-repo' },
      { name: 'normal-repo' },
    ];
    const pinnedSet = pinned().getPinnedRepos();
    const normalGrid = repos.filter(r => !pinnedSet.has(r.name));
    expect(normalGrid).toHaveLength(1);
    expect(normalGrid[0].name).toBe('normal-repo');
  });

  it('pinned repos excluded from Kanban filter', () => {
    pinned().pinRepo('pinned-repo');
    const repos = [
      { name: 'pinned-repo' },
      { name: 'kanban-repo' },
    ];
    const pinnedSet = pinned().getPinnedRepos();
    // Simulate kanban exclusion
    const kanbanRepos = repos.filter(r => !pinnedSet.has(r.name));
    expect(kanbanRepos).toHaveLength(1);
    expect(kanbanRepos[0].name).toBe('kanban-repo');
  });

  it('pinned section includes only pinned repos not in closed set', () => {
    pinned().pinRepo('pinned-a');
    pinned().pinRepo('pinned-b');
    const closed = new Set(['pinned-b']);
    const repos = [
      { name: 'pinned-a' },
      { name: 'pinned-b' },
      { name: 'normal' },
    ];
    const pinnedSet = pinned().getPinnedRepos();
    const pinnedSection = repos.filter(r => pinnedSet.has(r.name) && !closed.has(r.name));
    expect(pinnedSection).toHaveLength(1);
    expect(pinnedSection[0].name).toBe('pinned-a');
  });

  it('pin takes precedence over backlog — pinned repo excluded from backlogSet', () => {
    pinned().pinRepo('repo-a');
    const repos = [{ name: 'repo-a' }, { name: 'repo-b' }];
    const pinnedSet = pinned().getPinnedRepos();
    // Simulate backlogSet computation that respects pin precedence
    const backlogCandidates = ['repo-a', 'repo-b'];
    const backlogSet = new Set(
      backlogCandidates.filter(name => !pinnedSet.has(name))
    );
    expect(backlogSet.has('repo-a')).toBe(false); // pinned → not in backlog
    expect(backlogSet.has('repo-b')).toBe(true);  // not pinned → can be in backlog
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module export
// ─────────────────────────────────────────────────────────────────────────────

describe('Pinned module exports', () => {
  it('exports all public API functions', () => {
    const api = pinned();
    expect(typeof api.pinRepo).toBe('function');
    expect(typeof api.unpinRepo).toBe('function');
    expect(typeof api.isPinned).toBe('function');
    expect(typeof api.getPinnedRepos).toBe('function');
    expect(typeof api.pruneOverCap).toBe('function');
  });

  it('MAX_ENTRIES is 10', () => {
    expect(pinned().MAX_ENTRIES).toBe(10);
  });
});
