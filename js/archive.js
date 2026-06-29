// js/archive.js — Archive (hide) repos from dashboard (issue #63)
// Part of #42 Phase 3.
//
// Schema (ghd-archived-v1):
//   { version: 1, entries: [{ repo: string, archivedAt: number }] }
//
// Rules: no cap on entries; archive persists until explicitly unarchived.
// No DOM, no API calls. Mirrors pinned.js IIFE + module.exports pattern.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const STORAGE_KEY    = 'ghd-archived-v1';
  const SCHEMA_VERSION = 1;

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

  // ── Public API ────────────────────────────────────────────

  /**
   * Archive a repo. Idempotent — re-archiving a repo updates its archivedAt timestamp.
   *
   * @param {string} repoName
   */
  function archiveRepo(repoName) {
    if (!repoName || typeof repoName !== 'string') return;
    const data = _load();
    data.entries = data.entries.filter(e => e.repo !== repoName);
    data.entries.push({ repo: repoName, archivedAt: Date.now() });
    _save(data);
  }

  /**
   * Unarchive a repo, restoring it to all views.
   *
   * @param {string} repoName
   */
  function unarchiveRepo(repoName) {
    if (!repoName) return;
    const data = _load();
    data.entries = data.entries.filter(e => e.repo !== repoName);
    _save(data);
  }

  /**
   * Toggle archive state for a repo.
   *
   * @param {string} repoName
   */
  function toggle(repoName) {
    if (isArchived(repoName)) {
      unarchiveRepo(repoName);
    } else {
      archiveRepo(repoName);
    }
  }

  /**
   * Returns true if the repo is currently archived.
   *
   * @param {string} repoName
   * @returns {boolean}
   */
  function isArchived(repoName) {
    if (!repoName) return false;
    const data = _load();
    return data.entries.some(e => e.repo === repoName);
  }

  /**
   * Returns a Set of all currently archived repo names.
   * Used by renderRepos() to exclude archived repos from all views.
   *
   * @returns {Set<string>}
   */
  function getArchivedRepos() {
    const data = _load();
    return new Set(data.entries.map(e => e.repo));
  }

  /**
   * Returns the full entry list: [{ repo, archivedAt }].
   * Used to render the archived section with timestamps.
   *
   * @returns {Array<{repo: string, archivedAt: number}>}
   */
  function list() {
    return _load().entries;
  }

  const api = {
    archiveRepo,
    unarchiveRepo,
    toggle,
    isArchived,
    getArchivedRepos,
    list
  };

  root.GHD.Archive = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
