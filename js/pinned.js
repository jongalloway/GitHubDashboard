// js/pinned.js — Pin repos to top of dashboard (issue #62)
// Part of #42 Phase 3.
//
// Schema (ghd-pinned-v1):
//   { version: 1, entries: [{ repo: string }] }
//
// Rules: max 10 entries (soft cap — oldest pinned removed on overflow); no expiry.
// No DOM, no API calls. Mirrors snooze.js IIFE + module.exports pattern.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const STORAGE_KEY    = 'ghd-pinned-v1';
  const SCHEMA_VERSION = 1;
  const MAX_ENTRIES    = 10;

  // ── Internal storage helpers ──────────────────────────────

  function _load() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: SCHEMA_VERSION, entries: [] };
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.version !== SCHEMA_VERSION ||
        !Array.isArray(parsed.entries)
      ) {
        return { version: SCHEMA_VERSION, entries: [] };
      }
      return parsed;
    } catch (_) {
      return { version: SCHEMA_VERSION, entries: [] };
    }
  }

  function _save(data) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch (_) {}
  }

  // Enforce MAX_ENTRIES by dropping the oldest (head) entries.
  function _cap(entries) {
    return entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Pin a repo. Replaces any existing entry for the same repo (idempotent).
   * If the cap is exceeded the oldest entry is dropped.
   *
   * @param {string} repoName
   */
  function pinRepo(repoName) {
    if (!repoName || typeof repoName !== 'string') return;
    const data = _load();
    // Remove existing entry for this repo, then append (most-recently-pinned at end)
    data.entries = data.entries.filter(e => e.repo !== repoName);
    data.entries.push({ repo: repoName });
    data.entries = _cap(data.entries);
    _save(data);
  }

  /**
   * Unpin a repo immediately.
   *
   * @param {string} repoName
   */
  function unpinRepo(repoName) {
    if (!repoName) return;
    const data = _load();
    data.entries = data.entries.filter(e => e.repo !== repoName);
    _save(data);
  }

  /**
   * Returns true if the repo is currently pinned.
   *
   * @param {string} repoName
   * @returns {boolean}
   */
  function isPinned(repoName) {
    if (!repoName) return false;
    const data = _load();
    return data.entries.some(e => e.repo === repoName);
  }

  /**
   * Returns a Set of all currently pinned repo names.
   * This is the primary filter used by renderRepos() to build the pinned section.
   *
   * @returns {Set<string>}
   */
  function getPinnedRepos() {
    const data = _load();
    return new Set(data.entries.map(e => e.repo));
  }

  /**
   * Enforce the MAX_ENTRIES cap, dropping oldest entries.
   * Safe to call on every render cycle as housekeeping.
   * Returns the number of entries removed.
   *
   * @returns {number}
   */
  function pruneOverCap() {
    const data = _load();
    const before = data.entries.length;
    data.entries = _cap(data.entries);
    _save(data);
    return before - data.entries.length;
  }

  const api = {
    pinRepo,
    unpinRepo,
    isPinned,
    getPinnedRepos,
    pruneOverCap,
    MAX_ENTRIES
  };

  root.GHD.Pinned = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
