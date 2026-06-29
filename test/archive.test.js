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
  loadBrowserScript('js/archive.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function archive() { return window.GHD.Archive; }
function readRaw() {
  const raw = mockLS.getItem('ghd-archived-v1');
  return raw ? JSON.parse(raw) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// archiveRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.archiveRepo', () => {
  it('persists an entry with the correct repo name and archivedAt', () => {
    const before = Date.now();
    archive().archiveRepo('my-repo');
    const after = Date.now();
    const data = readRaw();
    expect(data.version).toBe(1);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].repo).toBe('my-repo');
    expect(data.entries[0].archivedAt).toBeGreaterThanOrEqual(before);
    expect(data.entries[0].archivedAt).toBeLessThanOrEqual(after);
  });

  it('is idempotent — re-archiving updates timestamp, keeps one entry', () => {
    archive().archiveRepo('repo-a');
    const first = readRaw().entries[0].archivedAt;
    archive().archiveRepo('repo-a');
    const data = readRaw();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].repo).toBe('repo-a');
    // archivedAt should be >= first (re-archive refreshes timestamp)
    expect(data.entries[0].archivedAt).toBeGreaterThanOrEqual(first);
  });

  it('accumulates multiple distinct repos', () => {
    archive().archiveRepo('repo-a');
    archive().archiveRepo('repo-b');
    const data = readRaw();
    expect(data.entries).toHaveLength(2);
    const names = data.entries.map(e => e.repo);
    expect(names).toContain('repo-a');
    expect(names).toContain('repo-b');
  });

  it('ignores empty or non-string input', () => {
    archive().archiveRepo('');
    archive().archiveRepo(null);
    archive().archiveRepo(undefined);
    archive().archiveRepo(42);
    expect(readRaw()).toBeNull(); // nothing written
  });

  it('stores versioned JSON blob with version=1', () => {
    archive().archiveRepo('repo-x');
    const data = readRaw();
    expect(data.version).toBe(1);
    expect(Array.isArray(data.entries)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unarchiveRepo
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.unarchiveRepo', () => {
  it('removes an archived repo', () => {
    archive().archiveRepo('repo-a');
    archive().unarchiveRepo('repo-a');
    const data = readRaw();
    expect(data.entries).toHaveLength(0);
  });

  it('is a no-op for a repo that is not archived', () => {
    archive().archiveRepo('repo-b');
    archive().unarchiveRepo('repo-x'); // not archived
    expect(readRaw().entries).toHaveLength(1);
  });

  it('ignores falsy input gracefully', () => {
    archive().archiveRepo('repo-a');
    archive().unarchiveRepo(null);
    archive().unarchiveRepo(undefined);
    expect(readRaw().entries).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.toggle', () => {
  it('archives a non-archived repo', () => {
    archive().toggle('repo-a');
    expect(archive().isArchived('repo-a')).toBe(true);
  });

  it('unarchives an archived repo', () => {
    archive().archiveRepo('repo-a');
    archive().toggle('repo-a');
    expect(archive().isArchived('repo-a')).toBe(false);
  });

  it('double-toggle returns to original state', () => {
    archive().toggle('repo-a');
    archive().toggle('repo-a');
    expect(archive().isArchived('repo-a')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isArchived
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.isArchived', () => {
  it('returns true for an archived repo', () => {
    archive().archiveRepo('repo-a');
    expect(archive().isArchived('repo-a')).toBe(true);
  });

  it('returns false for a non-archived repo', () => {
    expect(archive().isArchived('repo-x')).toBe(false);
  });

  it('returns false after unarchiving', () => {
    archive().archiveRepo('repo-a');
    archive().unarchiveRepo('repo-a');
    expect(archive().isArchived('repo-a')).toBe(false);
  });

  it('returns false for falsy input', () => {
    expect(archive().isArchived('')).toBe(false);
    expect(archive().isArchived(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getArchivedRepos
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.getArchivedRepos', () => {
  it('returns an empty Set when nothing is archived', () => {
    const result = archive().getArchivedRepos();
    expect(result instanceof Set).toBe(true);
    expect(result.size).toBe(0);
  });

  it('returns a Set containing all archived repo names', () => {
    archive().archiveRepo('repo-a');
    archive().archiveRepo('repo-b');
    const result = archive().getArchivedRepos();
    expect(result.has('repo-a')).toBe(true);
    expect(result.has('repo-b')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('does not include unarchived repos', () => {
    archive().archiveRepo('repo-a');
    archive().unarchiveRepo('repo-a');
    const result = archive().getArchivedRepos();
    expect(result.has('repo-a')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive.list', () => {
  it('returns an empty array when nothing is archived', () => {
    expect(archive().list()).toEqual([]);
  });

  it('returns entries with repo and archivedAt fields', () => {
    archive().archiveRepo('repo-a');
    const entries = archive().list();
    expect(entries).toHaveLength(1);
    expect(entries[0].repo).toBe('repo-a');
    expect(typeof entries[0].archivedAt).toBe('number');
  });

  it('reflects the current archive state after unarchive', () => {
    archive().archiveRepo('repo-a');
    archive().archiveRepo('repo-b');
    archive().unarchiveRepo('repo-a');
    const entries = archive().list();
    expect(entries).toHaveLength(1);
    expect(entries[0].repo).toBe('repo-b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorage schema robustness
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive localStorage robustness', () => {
  it('handles corrupted JSON gracefully', () => {
    mockLS.setItem('ghd-archived-v1', 'not-json{{');
    expect(archive().isArchived('repo-x')).toBe(false);
    expect(archive().getArchivedRepos().size).toBe(0);
  });

  it('discards data with wrong schema version', () => {
    mockLS.setItem('ghd-archived-v1', JSON.stringify({ version: 99, entries: [{ repo: 'repo-a', archivedAt: 0 }] }));
    expect(archive().isArchived('repo-a')).toBe(false);
  });

  it('discards data where entries is not an array', () => {
    mockLS.setItem('ghd-archived-v1', JSON.stringify({ version: 1, entries: 'bad' }));
    expect(archive().getArchivedRepos().size).toBe(0);
  });

  it('returns empty state when localStorage is empty', () => {
    expect(archive().getArchivedRepos().size).toBe(0);
    expect(archive().isArchived('any-repo')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grid / Kanban exclusion logic (pure set operations, mirroring app.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive grid and lane exclusion', () => {
  it('getArchivedRepos returns a Set usable to exclude from normal grid', () => {
    archive().archiveRepo('archived-repo');
    const repos = [
      { name: 'archived-repo' },
      { name: 'normal-repo' },
    ];
    const archivedSet = archive().getArchivedRepos();
    const normalGrid = repos.filter(r => !archivedSet.has(r.name));
    expect(normalGrid).toHaveLength(1);
    expect(normalGrid[0].name).toBe('normal-repo');
  });

  it('archived repos excluded from Kanban filter', () => {
    archive().archiveRepo('archived-repo');
    const repos = [
      { name: 'archived-repo' },
      { name: 'kanban-repo' },
    ];
    const archivedSet = archive().getArchivedRepos();
    const kanbanRepos = repos.filter(r => !archivedSet.has(r.name));
    expect(kanbanRepos).toHaveLength(1);
    expect(kanbanRepos[0].name).toBe('kanban-repo');
  });

  it('archive takes precedence over pinned — archived pinned repo excluded from pinned section', () => {
    archive().archiveRepo('pinned-and-archived');
    const archivedSet = archive().getArchivedRepos();
    const pinnedSet = new Set(['pinned-and-archived', 'only-pinned']);
    const repos = [
      { name: 'pinned-and-archived' },
      { name: 'only-pinned' },
      { name: 'normal' },
    ];
    // Pinned section: pinned AND not archived
    const pinnedSection = repos.filter(r => pinnedSet.has(r.name) && !archivedSet.has(r.name));
    expect(pinnedSection).toHaveLength(1);
    expect(pinnedSection[0].name).toBe('only-pinned');
  });

  it('archived repos excluded from backlog set computation', () => {
    archive().archiveRepo('archived-repo');
    const archivedSet = archive().getArchivedRepos();
    const candidates = ['archived-repo', 'backlog-repo'];
    // Backlog excludes archived
    const backlogSet = new Set(candidates.filter(name => !archivedSet.has(name)));
    expect(backlogSet.has('archived-repo')).toBe(false);
    expect(backlogSet.has('backlog-repo')).toBe(true);
  });

  it('archived repos appear in archived section filter', () => {
    archive().archiveRepo('archived-repo');
    const archivedSet = archive().getArchivedRepos();
    const repos = [
      { name: 'archived-repo' },
      { name: 'normal-repo' },
    ];
    const archivedSection = repos.filter(r => archivedSet.has(r.name));
    expect(archivedSection).toHaveLength(1);
    expect(archivedSection[0].name).toBe('archived-repo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module export
// ─────────────────────────────────────────────────────────────────────────────

describe('Archive module exports', () => {
  it('exports all public API functions', () => {
    const api = archive();
    expect(typeof api.archiveRepo).toBe('function');
    expect(typeof api.unarchiveRepo).toBe('function');
    expect(typeof api.toggle).toBe('function');
    expect(typeof api.isArchived).toBe('function');
    expect(typeof api.getArchivedRepos).toBe('function');
    expect(typeof api.list).toBe('function');
  });

  it('is registered on window.GHD.Archive', () => {
    expect(window.GHD.Archive).toBeDefined();
  });
});
