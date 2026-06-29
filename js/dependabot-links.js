// js/dependabot-links.js — Dependabot PR deep-link generation + grouping (issue #64)
// Part of #42 Phase 3.
//
// Pure module — no DOM, no API calls. Works in authenticated + public mode.
// Exported on window.GHD.DependabotLinks + module.exports for Vitest.
//
// NOTE: Write-scope merge (one-click "Merge all Dependabot PRs") is intentionally
// NOT implemented. This dashboard is a static GitHub Pages app — it stores no
// server-side secrets and the PAT lives in localStorage only. Shipping a merge
// button would require pull_requests:write scope (not guaranteed present) plus a
// confirmation flow. Per D025 / P003, Phase 1-3 ships read-only deep-links; write
// actions are deferred until the user opts into an explicit write-scope PAT upgrade.

(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  /**
   * Build a direct GitHub PR permalink.
   * Returns '#' for any invalid / missing argument.
   *
   * @param {string} owner  - repo owner login (e.g. "jongalloway")
   * @param {string} repo   - repo name (e.g. "newsletter-generator")
   * @param {number|string} number - PR number
   * @returns {string}
   */
  function generatePRLink(owner, repo, number) {
    if (!owner || !repo || number == null) return '#';
    const o = String(owner).trim();
    const r = String(repo).trim();
    const n = String(number).trim();
    if (!o || !r || !n || !/^\d+$/.test(n)) return '#';
    return `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/pull/${n}`;
  }

  /**
   * Resolve the best URL for a single PR item.
   * Prefers html_url already set by the API pipeline; falls back to generatePRLink.
   *
   * @param {Object} prItem      - item from pending_reviews.items
   * @param {string} fullName    - repo full_name e.g. "owner/repo"
   * @returns {string}
   */
  function _prUrl(prItem, fullName) {
    if (prItem.html_url && /^https?:\/\//i.test(prItem.html_url)) {
      return prItem.html_url;
    }
    const parts = String(fullName || '').split('/');
    if (parts.length === 2) {
      return generatePRLink(parts[0], parts[1], prItem.number);
    }
    return '#';
  }

  /**
   * Default Dependabot author predicate (mirrors _isDependabotPR in kanban-strip.js).
   * @param {Object} pull
   * @returns {boolean}
   */
  function _isBot(pull) {
    return String(pull?.author || '').toLowerCase().includes('dependabot');
  }

  /**
   * Group Dependabot PRs by repo, sorted by PR count descending (most PRs first).
   *
   * Each group: { repo, prs: [{...prItem, prUrl}], topPRUrl }
   *
   * @param {Array}    repos            - normalized repo data objects
   * @param {Function} [isDependabotPR] - optional predicate override; defaults to _isBot
   * @returns {Array}
   */
  function groupDependabotPRs(repos, isDependabotPR) {
    const isBot = typeof isDependabotPR === 'function' ? isDependabotPR : _isBot;
    const groups = [];

    for (const repo of (Array.isArray(repos) ? repos : [])) {
      const items = Array.isArray(repo.pending_reviews?.items) ? repo.pending_reviews.items : [];
      const botPRs = items
        .filter(isBot)
        .map((pr) => ({ ...pr, prUrl: _prUrl(pr, repo.full_name || repo.name) }));

      if (botPRs.length > 0) {
        groups.push({ repo, prs: botPRs, topPRUrl: botPRs[0].prUrl });
      }
    }

    groups.sort((a, b) => b.prs.length - a.prs.length);
    return groups;
  }

  /**
   * Find the highest-priority Dependabot PR for the Top Pick bar.
   * Returns null if no Dependabot PRs are found across all repos.
   *
   * @param {Array}    repos
   * @param {Function} [isDependabotPR]
   * @returns {{ groups, topRepo, topPR, topPRUrl, totalCount }|null}
   */
  function findTopPickPR(repos, isDependabotPR) {
    const groups = groupDependabotPRs(repos, isDependabotPR);
    if (groups.length === 0) return null;

    const topGroup = groups[0];
    const topPR    = topGroup.prs[0];
    const totalCount = groups.reduce((sum, g) => sum + g.prs.length, 0);

    return { groups, topRepo: topGroup.repo, topPR, topPRUrl: topGroup.topPRUrl, totalCount };
  }

  const api = { generatePRLink, groupDependabotPRs, findTopPickPR };
  root.GHD.DependabotLinks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
