// js/backlog-strip.js — Phase 1.5 Backlog "Pick Back Up" strip (issue #44)
//
// Renders a collapsible strip BELOW the 4-lane Kanban board answering
// "what could I revive?" — repos with pushed_at > 14 days AND ≤ 120 days
// ago that are NOT already in the Blocked or Needs Attention lanes.
// Repos with pushed_at > 120 days are dormant and stay quietly in Healthy.

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const WORKING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days (>this = not Working)
  const BACKLOG_MAX_MS    = 120 * 24 * 60 * 60 * 1000; // 120 days (>this = dormant)
  const CI_FAILING        = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

  /**
   * Returns true if this repo belongs in the Backlog strip.
   *
   * Inclusion rule:
   *   - pushed_at > 14 days AND ≤ 120 days ago
   *   - NOT Blocked (CI failing or security alerts)
   *   - NOT Needs Attention (pending reviews)
   *
   * @param {Object} repo - normalized repo data object
   * @param {number} [now] - epoch ms for "now" (defaults to Date.now())
   * @returns {boolean}
   */
  function isBacklogRepo(repo, now) {
    const ts = typeof now === 'number' ? now : Date.now();

    // Exclude Blocked — CI failing
    const ciFailure =
      repo.workflow_status?.has_workflows === true &&
      CI_FAILING.has(repo.workflow_status?.latest_run?.conclusion);
    if (ciFailure) return false;

    // Exclude Blocked — security alerts
    if ((repo.security_alerts?.total || 0) > 0) return false;

    // Exclude Needs Attention — pending reviews
    if ((repo.pending_reviews?.count || 0) > 0) return false;

    // Must have a parseable date
    const activityAt = repo.pushed_at || repo.last_commit_date || null;
    const activityMs = activityAt ? new Date(activityAt).getTime() : NaN;
    if (!Number.isFinite(activityMs)) return false;

    const ageMs = ts - activityMs;
    return ageMs > WORKING_WINDOW_MS && ageMs <= BACKLOG_MAX_MS;
  }

  /**
   * Filter an array of repos down to those that qualify for the Backlog strip.
   *
   * @param {Array} repos
   * @param {number} [now] - epoch ms (defaults to Date.now())
   * @returns {Array}
   */
  function deriveBacklogRepos(repos, now) {
    if (!Array.isArray(repos)) return [];
    const ts = typeof now === 'number' ? now : Date.now();
    return repos.filter(r => isBacklogRepo(r, ts));
  }

  /**
   * Format a pushed_at timestamp as a human-readable relative age.
   * Designed for the 14–120 day range; falls back gracefully outside it.
   *
   * @param {string|null} pushedAt - ISO date string
   * @param {number} now - epoch ms
   * @returns {string}  e.g. "3 weeks ago" or "2 months ago"
   */
  function _formatBacklogAge(pushedAt, now) {
    if (!pushedAt) return '';
    const ms = new Date(pushedAt).getTime();
    if (!Number.isFinite(ms)) return '';

    const ageMs  = now - ms;
    const days   = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (days < 28) {
      const w = Math.max(Math.round(ageMs / (7 * 24 * 60 * 60 * 1000)), 1);
      return `${w} week${w === 1 ? '' : 's'} ago`;
    }

    const m = Math.max(Math.round(ageMs / (30 * 24 * 60 * 60 * 1000)), 1);
    return `${m} month${m === 1 ? '' : 's'} ago`;
  }

  function _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Expand/collapse state — reset on each renderBacklogStrip call
  let _isExpanded = false;

  function _setExpanded(bodyEl, toggleEl, expanded) {
    _isExpanded = expanded;
    bodyEl.hidden = !expanded;
    toggleEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const chevron = toggleEl.querySelector('.backlog-strip-chevron');
    if (chevron) chevron.textContent = expanded ? '▾' : '▸';
  }

  /**
   * Render the Backlog strip into #backlog-strip-region.
   * Starts collapsed. Must be called after cards are in the DOM.
   *
   * @param {Array}  backlogRepos - repos already filtered to the backlog set
   * @param {number} [now]        - epoch ms (defaults to Date.now())
   */
  function renderBacklogStrip(backlogRepos, now) {
    const region = document.getElementById('backlog-strip-region');
    if (!region) return;

    region.innerHTML = '';

    if (!Array.isArray(backlogRepos) || backlogRepos.length === 0) {
      region.hidden = true;
      return;
    }

    const ts    = typeof now === 'number' ? now : Date.now();
    const count = backlogRepos.length;

    // ── Toggle header ──────────────────────────────────────
    const toggle = document.createElement('button');
    toggle.type      = 'button';
    toggle.className = 'backlog-strip-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'backlog-strip-body');
    toggle.setAttribute(
      'aria-label',
      `Backlog: ${count} repo${count === 1 ? '' : 's'} to pick back up. Click to expand.`
    );
    toggle.innerHTML = `
      <span class="backlog-strip-icon" aria-hidden="true">📋</span>
      <span class="backlog-strip-title">Backlog</span>
      <span class="backlog-strip-count">${count}</span>
      <span class="backlog-strip-chevron" aria-hidden="true">▸</span>
    `;

    // ── Expandable body (chip row) ─────────────────────────
    const body       = document.createElement('div');
    body.className   = 'backlog-strip-body';
    body.id          = 'backlog-strip-body';
    body.hidden      = true; // collapsed by default

    const chipRow       = document.createElement('div');
    chipRow.className   = 'backlog-chip-row';
    chipRow.setAttribute('role', 'list');

    for (const repo of backlogRepos) {
      const pushedAt = repo.pushed_at || repo.last_commit_date || null;
      const age      = _formatBacklogAge(pushedAt, ts);
      const url      = repo.html_url
        || repo.url
        || `https://github.com/${_escapeHtml(repo.full_name || repo.name)}`;
      const label    = repo.full_name || repo.name;

      const chip     = document.createElement('a');
      chip.className = 'backlog-chip';
      chip.href      = url;
      chip.target    = '_blank';
      chip.rel       = 'noopener noreferrer';
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('aria-label', `${label} — last pushed ${age}`);
      chip.innerHTML = `
        <span class="backlog-chip-name">${_escapeHtml(label)}</span>
        <span class="backlog-chip-age">${_escapeHtml(age)}</span>
      `;
      chipRow.appendChild(chip);
    }

    body.appendChild(chipRow);

    toggle.addEventListener('click', () => _setExpanded(body, toggle, !_isExpanded));

    region.appendChild(toggle);
    region.appendChild(body);
    region.hidden = false;

    // Always start collapsed on re-render
    _isExpanded = false;
  }

  GHD.BacklogStrip = {
    isBacklogRepo,
    deriveBacklogRepos,
    renderBacklogStrip,
    _formatBacklogAge
  };

})(window.GHD);
