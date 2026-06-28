// js/backlog-scoring.js — Backlog repo scoring for Top Pick revival (issue #57)
//
// Pure scoring module: no DOM, no API calls, no side effects.
// Mirrors the release-pressure-indicator.js IIFE + module.exports pattern.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const DAY_MS = 24 * 60 * 60 * 1000;
  const BACKLOG_MIN_DAYS = 14;   // repos younger than this are "Working", not Backlog
  const BACKLOG_MAX_DAYS = 120;  // repos older than this are "Dormant", not Backlog

  // Score weight caps
  const RECENCY_MAX   = 50;  // freshness within the 14-120d window
  const ISSUES_MAX    = 20;  // open issue signal (capped at 20)
  const COPILOT_MAX   = 10;  // Copilot / Squad activity present
  const RELEASE_MAX   = 10;  // commits_since_latest release pressure

  /**
   * Return a deterministic numeric score for a backlog repo.
   * Higher = more valuable to revive. Never throws.
   *
   * Factors:
   *   - Recency      (0–50): more recent → higher; linear across the 14–120d window
   *   - Open issues  (0–20): more issues → more to pick up; capped at 20
   *   - Copilot/AI   (0–10): open Copilot PRs/branches or Squad activity present
   *   - Release      (0–10): commits_since_latest = unreleased work waiting to ship
   *
   * @param {Object} repo - normalized repo object from pipeline
   * @param {number} [now] - epoch ms, defaults to Date.now()
   * @returns {number}
   */
  function scoreBacklogRepo(repo, now) {
    if (!repo || typeof repo !== 'object') return 0;

    const ts = typeof now === 'number' ? now : Date.now();

    // ── Recency score (0–50) ────────────────────────────────
    const activityAt = repo.pushed_at || repo.last_commit_date || null;
    const activityMs = activityAt ? new Date(activityAt).getTime() : NaN;

    let recencyScore = 0;
    if (Number.isFinite(activityMs)) {
      const ageDays = (ts - activityMs) / DAY_MS;
      // Clamp to the valid backlog window [14, 120] and invert so newer = higher
      const clampedAge = Math.min(Math.max(ageDays, BACKLOG_MIN_DAYS), BACKLOG_MAX_DAYS);
      const fraction = (BACKLOG_MAX_DAYS - clampedAge) / (BACKLOG_MAX_DAYS - BACKLOG_MIN_DAYS);
      recencyScore = fraction * RECENCY_MAX;
    }

    // ── Issues score (0–20) ─────────────────────────────────
    const openIssues = (typeof repo.open_issues_count === 'number' && Number.isFinite(repo.open_issues_count))
      ? Math.max(0, repo.open_issues_count)
      : 0;
    const issueScore = Math.min(openIssues, ISSUES_MAX);

    // ── Copilot / Squad signal score (0–10) ─────────────────
    let copilotScore = 0;
    const copilot = repo.copilot_activity;
    if (copilot && typeof copilot === 'object') {
      // Existing Copilot PRs = active engagement already started
      if ((copilot.copilot_open_pr_count || 0) > 0) copilotScore += 5;
      // Any Copilot signal (branch, labeled issue, etc.)
      if (Array.isArray(copilot.signals) && copilot.signals.length > 0) copilotScore += 5;
    }
    if (copilotScore === 0) {
      // Squad activity as fallback Copilot-like signal
      const squad = repo.squad_activity;
      if (squad && squad.squad_enabled) copilotScore = 3;
    }
    copilotScore = Math.min(copilotScore, COPILOT_MAX);

    // ── Release pressure score (0–10) ───────────────────────
    const commitsSince = repo.releases?.commits_since_latest;
    const releaseScore = (typeof commitsSince === 'number' && Number.isFinite(commitsSince))
      ? Math.min(Math.max(0, commitsSince), RELEASE_MAX)
      : 0;

    return recencyScore + issueScore + copilotScore + releaseScore;
  }

  /**
   * Given an array of backlog repos, return the highest-scored one as a Top
   * Pick descriptor, or null if the array is empty.
   *
   * Sorting is deterministic: primary = score descending, secondary = name
   * ascending (alphabetical tiebreaker).
   *
   * @param {Array}  repos - already-filtered backlog repos
   * @param {number} [now] - epoch ms, defaults to Date.now()
   * @returns {{ repo: Object, score: number, url: string } | null}
   */
  function findTopBacklogPick(repos, now) {
    if (!Array.isArray(repos) || repos.length === 0) return null;

    const ts = typeof now === 'number' ? now : Date.now();

    const scored = repos.map(r => ({ repo: r, score: scoreBacklogRepo(r, ts) }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable alphabetical tiebreaker
      const nameA = String(a.repo.name || '');
      const nameB = String(b.repo.name || '');
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    const top = scored[0];
    const raw = top.repo.html_url
      || (top.repo.full_name ? `https://github.com/${top.repo.full_name}` : null)
      || '#';
    const url = /^https?:\/\//i.test(raw) ? raw : '#';

    return { repo: top.repo, score: top.score, url };
  }

  const api = { scoreBacklogRepo, findTopBacklogPick };

  root.GHD.BacklogScoring = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
