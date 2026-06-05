import { beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
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

describe('GHD.Auth', () => {
  beforeEach(() => {
    vi.resetModules();
    global.document = { getElementById: () => null };
  });

  it('reports unauthenticated when no token exists', async () => {
    global.localStorage = createStorage();
    global.fetch = vi.fn();
    global.window = { GHD: {} };

    await import('../js/auth.js');

    expect(window.GHD.Auth.isAuthenticated()).toBe(false);
    expect(window.GHD.Auth.getSession()).toBeNull();
    await expect(window.GHD.Auth.getValidToken()).rejects.toThrow('Not authenticated.');
  });

  it('restores valid session from storage and exposes token', async () => {
    global.localStorage = createStorage({
      ghd_token: 'test-token',
      ghd_login: 'jon-g'
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ login: 'jon-g' }),
      headers: { get: () => null }
    }));
    global.window = { GHD: {} };

    await import('../js/auth.js');
    await window.GHD.Auth.ready;

    expect(window.GHD.Auth.isAuthenticated()).toBe(true);
    expect(window.GHD.Auth.getToken()).toBe('test-token');
    expect(window.GHD.Auth.getSession()).toEqual({ login: 'jon-g', owner: 'jon-g' });
    expect(window.GHD.Auth.hasIssueWriteAccess()).toBe(true);
  });

  it('clears auth and private cache on sign-out', async () => {
    global.localStorage = createStorage({
      ghd_token: 'test-token',
      ghd_login: 'jon-g',
      ghd_write: '1'
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ login: 'jon-g' }),
      headers: { get: () => null }
    }));

    const clearCache = vi.fn();
    global.window = { GHD: { Cache: { clearCache } } };

    await import('../js/auth.js');
    await window.GHD.Auth.ready;

    window.GHD.Auth.signOut();

    expect(window.GHD.Auth.isAuthenticated()).toBe(false);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ghd_token')).toBeNull();
    expect(localStorage.getItem('ghd_login')).toBeNull();
    expect(localStorage.getItem('ghd_write')).toBeNull();
  });

  it('clears expired token during startup validation', async () => {
    global.localStorage = createStorage({
      ghd_token: 'expired-token',
      ghd_login: 'jon-g',
      ghd_write: '1'
    });
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null }
    }));
    const clearCache = vi.fn();
    global.window = { GHD: { Cache: { clearCache } } };

    await import('../js/auth.js');
    await window.GHD.Auth.ready;

    expect(window.GHD.Auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('ghd_token')).toBeNull();
    expect(localStorage.getItem('ghd_login')).toBeNull();
    expect(localStorage.getItem('ghd_write')).toBeNull();
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('clears token and rejects when PAT expires during refresh validation', async () => {
    global.localStorage = createStorage({
      ghd_token: 'test-token',
      ghd_login: 'jon-g'
    });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ login: 'jon-g' }),
        headers: { get: () => null }
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null }
      });
    const clearCache = vi.fn();
    global.window = { GHD: { Cache: { clearCache } } };

    await import('../js/auth.js');
    await window.GHD.Auth.ready;

    await expect(window.GHD.Auth.getValidToken()).rejects.toThrow('PAT expired or revoked. Sign in again.');
    expect(window.GHD.Auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('ghd_token')).toBeNull();
    expect(clearCache).toHaveBeenCalledTimes(1);
  });
});