// ============================================================
// GHD Cache — localStorage private dashboard cache manager
// ============================================================

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const CACHE_KEY = 'ghd.private.cache.v1';
  const SCHEMA_VERSION = 1;
  const SOFT_STALE_MS = 15 * 60 * 1000;       // 15 minutes
  const HARD_STALE_MS = 24 * 60 * 60 * 1000;  // 24 hours

  // ── Helpers ──────────────────────────────────────────────

  function _now() {
    return Date.now();
  }

  function _isPast(isoString) {
    if (!isoString) return true;
    return _now() >= new Date(isoString).getTime();
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Read the private cache from localStorage.
   * Returns null if absent, corrupt, or schema-mismatched.
   */
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.schemaVersion !== SCHEMA_VERSION) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  /**
   * Write a private dashboard payload to the cache.
   * Adds schemaVersion, fetchedAt, softStaleAt, hardStaleAt.
   * Returns the written cache entry, or null on failure.
   */
  function writeCache(payload) {
    try {
      const now = new Date();
      const entry = {
        ...payload,
        schemaVersion: SCHEMA_VERSION,
        fetchedAt: now.toISOString(),
        softStaleAt: new Date(now.getTime() + SOFT_STALE_MS).toISOString(),
        hardStaleAt: new Date(now.getTime() + HARD_STALE_MS).toISOString()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
      return entry;
    } catch (_) {
      return null;
    }
  }

  /**
   * Return true if the cache is older than 15 minutes (soft stale).
   * A soft-stale cache is still renderable; trigger a background refresh.
   */
  function isSoftStale(cache) {
    if (!cache || !cache.softStaleAt) return true;
    return _isPast(cache.softStaleAt);
  }

  /**
   * Return true if the cache is older than 24 hours (hard stale).
   * A hard-stale cache must be discarded before rendering.
   */
  function isHardStale(cache) {
    if (!cache || !cache.hardStaleAt) return true;
    return _isPast(cache.hardStaleAt);
  }

  /**
   * Remove the private cache from localStorage.
   * Call on sign-out, owner mismatch, or schema change.
   */
  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (_) {}
  }

  /**
   * Return lightweight metadata about the current cache entry,
   * or null if no valid cache exists.
   */
  function getCacheMeta() {
    const cache = readCache();
    if (!cache) return null;
    return {
      owner: cache.owner || null,
      fetchedAt: cache.fetchedAt || null,
      softStaleAt: cache.softStaleAt || null,
      hardStaleAt: cache.hardStaleAt || null,
      schemaVersion: cache.schemaVersion,
      source: cache.source || 'private',
      repoCount: cache.dashboard ? (cache.dashboard.repo_count || 0) : 0
    };
  }

  GHD.Cache = {
    readCache,
    writeCache,
    isSoftStale,
    isHardStale,
    clearCache,
    getCacheMeta
  };
}(window.GHD));
