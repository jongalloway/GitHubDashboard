import { beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

describe('GHD.Cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    vi.resetModules();

    global.localStorage = createStorage();
    global.window = { GHD: {} };

    await import('../js/cache.js');
  });

  it('writes and reads valid cache entries with metadata', () => {
    const payload = { owner: 'jon', dashboard: { repo_count: 2 } };
    const entry = window.GHD.Cache.writeCache(payload);
    const loaded = window.GHD.Cache.readCache();

    expect(entry).toBeTruthy();
    expect(loaded.owner).toBe('jon');
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.fetchedAt).toBeTruthy();
    expect(loaded.softStaleAt).toBeTruthy();
    expect(loaded.hardStaleAt).toBeTruthy();
  });

  it('marks cache soft stale before hard stale', () => {
    const entry = window.GHD.Cache.writeCache({ owner: 'jon', dashboard: { repo_count: 1 } });

    expect(window.GHD.Cache.isSoftStale(entry)).toBe(false);
    expect(window.GHD.Cache.isHardStale(entry)).toBe(false);

    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(window.GHD.Cache.isSoftStale(entry)).toBe(true);
    expect(window.GHD.Cache.isHardStale(entry)).toBe(false);

    vi.advanceTimersByTime(9 * 60 * 60 * 1000);
    expect(window.GHD.Cache.isHardStale(entry)).toBe(false);

    vi.advanceTimersByTime(16 * 60 * 60 * 1000);
    expect(window.GHD.Cache.isHardStale(entry)).toBe(true);
  });

  it('returns null for schema mismatch and clears cache', () => {
    localStorage.setItem(
      'ghd.private.cache.v1',
      JSON.stringify({ schemaVersion: 999, dashboard: { repo_count: 1 } })
    );
    expect(window.GHD.Cache.readCache()).toBeNull();

    window.GHD.Cache.writeCache({ owner: 'jon', dashboard: { repo_count: 1 } });
    expect(window.GHD.Cache.readCache()).toBeTruthy();
    window.GHD.Cache.clearCache();
    expect(window.GHD.Cache.readCache()).toBeNull();
  });
});