// js/snooze.js — Snooze repos from Kanban lanes (issue #56)
// Phase 2 of issue #42: persist snooze state in localStorage; auto-restore on expiry.
//
// Schema (ghd-snooze-v1):
//   { version: 1, entries: [{ repo: string, until: ISO-string }] }
//
// Rules: max 50 active entries; expired entries pruned on every write.
// No DOM, no API calls. Mirrors the release-pressure-indicator.js IIFE pattern.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const STORAGE_KEY    = 'ghd-snooze-v1';
  const SCHEMA_VERSION = 1;
  const MAX_ENTRIES    = 50;
  const DAY_MS         = 24 * 60 * 60 * 1000;

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

  function _pruneAndCap(entries, ts) {
    const active = entries.filter(e => {
      const t = new Date(e.until).getTime();
      return Number.isFinite(t) && t > ts;
    });
    return active.length > MAX_ENTRIES ? active.slice(-MAX_ENTRIES) : active;
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Snooze a repo for `durationDays` days from `now`.
   * Replaces any existing snooze for the same repo.
   *
   * @param {string} repoName     - repo.name identifier
   * @param {number} durationDays - positive integer (1 / 3 / 7 etc.)
   * @param {number} [now]        - epoch ms; defaults to Date.now()
   */
  function snoozeRepo(repoName, durationDays, now) {
    if (!repoName || typeof repoName !== 'string') return;
    const days = (typeof durationDays === 'number' && durationDays > 0) ? durationDays : 1;
    const ts   = typeof now === 'number' ? now : Date.now();
    const until = new Date(ts + days * DAY_MS).toISOString();

    const data = _load();
    // Remove any existing entry for this repo, then append new one
    data.entries = data.entries.filter(e => e.repo !== repoName);
    data.entries.push({ repo: repoName, until });
    data.entries = _pruneAndCap(data.entries, ts);
    _save(data);
  }

  /**
   * Remove a snooze immediately (manual restore).
   *
   * @param {string} repoName
   */
  function unsnoozeRepo(repoName) {
    if (!repoName) return;
    const data = _load();
    data.entries = data.entries.filter(e => e.repo !== repoName);
    _save(data);
  }

  /**
   * Returns true if the repo has an active (non-expired) snooze.
   *
   * @param {string} repoName
   * @param {number} [now] - epoch ms; defaults to Date.now()
   * @returns {boolean}
   */
  function isSnoozed(repoName, now) {
    if (!repoName) return false;
    const ts   = typeof now === 'number' ? now : Date.now();
    const data = _load();
    const entry = data.entries.find(e => e.repo === repoName);
    if (!entry) return false;
    const t = new Date(entry.until).getTime();
    return Number.isFinite(t) && t > ts;
  }

  /**
   * Returns the ISO `until` timestamp for a snoozed repo, or null if not snoozed.
   * Does NOT check whether the snooze has expired — use isSnoozed() for that.
   *
   * @param {string} repoName
   * @returns {string|null}
   */
  function getSnoozedUntil(repoName) {
    if (!repoName) return null;
    const data  = _load();
    const entry = data.entries.find(e => e.repo === repoName);
    return entry ? entry.until : null;
  }

  /**
   * Returns a Set of repo names that are currently snoozed (expired entries excluded).
   * This is the primary filter used by renderRepos() to exclude repos from Kanban lanes.
   *
   * @param {number} [now] - epoch ms; defaults to Date.now()
   * @returns {Set<string>}
   */
  function getSnoozedRepos(now) {
    const ts   = typeof now === 'number' ? now : Date.now();
    const data = _load();
    const active = data.entries.filter(e => {
      const t = new Date(e.until).getTime();
      return Number.isFinite(t) && t > ts;
    });
    return new Set(active.map(e => e.repo));
  }

  /**
   * Remove expired entries and enforce the MAX_ENTRIES cap.
   * Safe to call on every page load as a housekeeping step.
   * Returns the number of entries pruned.
   *
   * @param {number} [now] - epoch ms; defaults to Date.now()
   * @returns {number}
   */
  function pruneExpired(now) {
    const ts   = typeof now === 'number' ? now : Date.now();
    const data = _load();
    const before = data.entries.length;
    data.entries = _pruneAndCap(data.entries, ts);
    _save(data);
    return before - data.entries.length;
  }

  const api = {
    snoozeRepo,
    unsnoozeRepo,
    isSnoozed,
    getSnoozedUntil,
    getSnoozedRepos,
    pruneExpired
  };

  root.GHD.Snooze = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
