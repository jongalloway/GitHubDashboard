// js/kanban-strip.js — Phase 1 Kanban Strip + Top Pick bar (issue #43)
//
// DATA GAPS for Keyser review:
//   - workflow_status (CI status) is absent in public/unauthenticated mode:
//     has_workflows defaults to false → CI-failure signal unavailable for public view.
//   - security_alerts.total is always 0 in public mode (requires auth + security_events scope).
//     Both 'blocked' sub-signals are zero for unauthenticated users; the Blocked lane will be
//     empty until the user signs in with a PAT that has the security_events scope.

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const CI_FAILING = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
  const WORKING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  /**
   * Derive the kanban lane for a single repo.
   * Evaluated top-down — first match wins.
   *
   * @param {Object} repo - normalized repo data object
   * @param {number} [now] - epoch ms for "now" (defaults to Date.now() in shipped code)
   * @returns {'blocked'|'needs-attention'|'working'|'healthy'}
   */
  function deriveKanbanLane(repo, now) {
    const ts = typeof now === 'number' ? now : Date.now();

    // ── Lane 1: Blocked ──────────────────────────────────────
    // CI failing OR security alerts present.
    // DATA GAP: Both signals are 0/false in public mode — blocked lane empty without auth.
    const ciFailure =
      repo.workflow_status?.has_workflows === true &&
      CI_FAILING.has(repo.workflow_status?.latest_run?.conclusion);
    const hasSecurityAlerts = (repo.security_alerts?.total || 0) > 0;
    if (ciFailure || hasSecurityAlerts) return 'blocked';

    // ── Lane 2: Needs Attention ──────────────────────────────
    // Has open PR(s) awaiting review (Dependabot / Copilot / human).
    if ((repo.pending_reviews?.count || 0) > 0) return 'needs-attention';

    // ── Lane 3: Working ──────────────────────────────────────
    // pushed_at within 14 days. Falls back to last_commit_date if pushed_at absent.
    const activityAt = repo.pushed_at || repo.last_commit_date || null;
    const activityMs = activityAt ? new Date(activityAt).getTime() : NaN;
    if (Number.isFinite(activityMs) && ts - activityMs <= WORKING_WINDOW_MS) {
      return 'working';
    }

    // ── Lane 4: Healthy ──────────────────────────────────────
    return 'healthy';
  }

  const LANE_CONFIG = [
    { id: 'blocked',         emoji: '🔴', label: 'Blocked' },
    { id: 'needs-attention', emoji: '🟡', label: 'Needs Attention' },
    { id: 'working',         emoji: '🔵', label: 'Working' },
    { id: 'healthy',         emoji: '🟢', label: 'Healthy' }
  ];

  // Detect Dependabot PR by author login
  function _isDependabotPR(pull) {
    return String(pull?.author || '').toLowerCase().includes('dependabot');
  }

  // Find the best Top Pick action across all repos.
  // Phase 1: read-only Dependabot deep-link.
  // Phase 3 (issue #64): uses GHD.DependabotLinks for per-PR specific links + grouping.
  function _findTopPick(repos) {
    const reposWithDepBot = [];
    for (const repo of repos) {
      const items = Array.isArray(repo.pending_reviews?.items) ? repo.pending_reviews.items : [];
      const botPRs = items.filter(_isDependabotPR);
      if (botPRs.length > 0) reposWithDepBot.push({ repo, count: botPRs.length });
    }
    if (reposWithDepBot.length === 0) return null;
    reposWithDepBot.sort((a, b) => b.count - a.count);

    // Enrich with per-PR links when DependabotLinks module is available (issue #64).
    // Falls back to generic search URL for backward compat when module is absent.
    const DependabotLinks =
      (typeof window !== 'undefined' ? window : globalThis).GHD?.DependabotLinks;
    if (DependabotLinks) {
      const pick = DependabotLinks.findTopPickPR(repos, _isDependabotPR);
      if (pick) {
        return {
          type: 'dependabot',
          repos: reposWithDepBot,
          url: pick.topPRUrl,
          groups: pick.groups,
          totalCount: pick.totalCount
        };
      }
    }

    return {
      type: 'dependabot',
      repos: reposWithDepBot,
      // Cross-repo filtered view — safe read-only deep-link (fallback)
      url: 'https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot'
    };
  }

  // Active lane filter state — reset on each renderKanbanStrip call
  let _activeLane = null;

  function _onLaneClick(laneId) {
    _activeLane = _activeLane === laneId ? null : laneId;

    document.querySelectorAll('.kanban-lane').forEach((btn) => {
      const active = btn.dataset.lane === _activeLane;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('is-active', active);
    });

    _applyLaneFilter(_activeLane);
  }

  function _applyLaneFilter(laneId) {
    const grid = document.getElementById('repo-grid');
    if (!grid) return;

    grid.querySelectorAll('.repo-card').forEach((card) => {
      if (!laneId) {
        card.classList.remove('kanban-dimmed');
      } else {
        card.classList.toggle('kanban-dimmed', card.dataset.kanbanLane !== laneId);
      }
    });

    if (laneId) {
      const first = grid.querySelector(`.repo-card[data-kanban-lane="${CSS.escape(laneId)}"]`);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _renderTopPickBar(topPick) {
    if (!topPick) return null;

    const bar = document.createElement('div');
    bar.className = 'top-pick-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Top Pick — suggested next action');

    if (topPick.type === 'dependabot') {
      const total     = topPick.totalCount != null
        ? topPick.totalCount
        : topPick.repos.reduce((sum, r) => sum + r.count, 0);
      const repoCount = topPick.repos.length;
      const topUrl    = _escapeHtml(topPick.url);

      // Build per-repo expandable group list when DependabotLinks data is present.
      let groupsHtml = '';
      if (Array.isArray(topPick.groups) && topPick.groups.length > 0) {
        const items = topPick.groups.map((g) => {
          const repoLabel = _escapeHtml(g.repo.full_name || g.repo.name || 'repo');
          if (g.prs.length === 1) {
            const pr      = g.prs[0];
            const prTitle = _escapeHtml(pr.title || `PR #${pr.number}`);
            return `<li class="depbot-repo-group">
              <a class="depbot-pr-link"
                 href="${_escapeHtml(pr.prUrl)}"
                 target="_blank" rel="noopener noreferrer"
                 aria-label="Open ${prTitle} in GitHub (opens in new tab)">
                <span class="depbot-repo-name">${repoLabel}</span> — ${prTitle} →
              </a>
            </li>`;
          }
          const prLinks = g.prs.map((pr) => {
            const t = _escapeHtml(pr.title || `PR #${pr.number}`);
            return `<li><a class="depbot-pr-link"
                           href="${_escapeHtml(pr.prUrl)}"
                           target="_blank" rel="noopener noreferrer">${t} →</a></li>`;
          }).join('');
          return `<li class="depbot-repo-group">
            <details class="depbot-group-details">
              <summary>${repoLabel} — ${g.prs.length} Dependabot PRs — merge on GitHub</summary>
              <ul class="depbot-pr-list">${prLinks}</ul>
            </details>
          </li>`;
        }).join('');
        groupsHtml = `<ul class="depbot-groups-list">${items}</ul>`;
      }

      bar.innerHTML = `
        <span class="top-pick-label" aria-hidden="true">⚡ Top Pick</span>
        <span class="top-pick-action">
          Review <strong>${total}</strong> Dependabot PR${total === 1 ? '' : 's'}
          across ${repoCount} repo${repoCount === 1 ? '' : 's'} — quick security wins
        </span>
        <a class="top-pick-link"
           href="${topUrl}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="Open highest-priority Dependabot PR in GitHub (opens in new tab)">
          Open in GitHub →
        </a>
        ${groupsHtml}
      `;
    }

    if (topPick.type === 'backlog') {
      const pick = topPick.pick;
      const label = _escapeHtml(pick.repo.full_name || pick.repo.name || 'this repo');
      bar.innerHTML = `
        <span class="top-pick-label" aria-hidden="true">⚡ Top Pick</span>
        <span class="top-pick-action">
          Pick this back up: <strong>${label}</strong> — all clear on reviews &amp; CI
        </span>
        <a class="top-pick-link top-pick-link--backlog"
           href="${_escapeHtml(pick.url)}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="Open ${label} in GitHub to pick it back up (opens in new tab)">
          Open repo →
        </a>
      `;
    }

    return bar;
  }

  /**
   * Render the Kanban strip and Top Pick bar into #kanban-strip-region.
   * Must be called after repo cards are already in the DOM (renderRepos first).
   *
   * @param {Array}  repos          - all visible repo data objects (excludes backlog)
   * @param {Array}  [backlogRepos] - repos in the Backlog strip (for revival Top Pick)
   * @param {Object} [opts]         - optional hooks
   * @param {Function} [opts.onSnooze] - (repoName: string, days: number) => void
   */
  function renderKanbanStrip(repos, backlogRepos, opts) {
    const container = document.getElementById('kanban-strip-region');
    if (!container) return;

    _activeLane = null;

    if (!Array.isArray(repos) || repos.length === 0) {
      container.hidden = true;
      return;
    }

    const now = Date.now();

    // Compute lane for every repo
    const laneMap = Object.fromEntries(LANE_CONFIG.map((l) => [l.id, []]));
    const repoLaneMap = {};
    for (const repo of repos) {
      const lane = deriveKanbanLane(repo, now);
      laneMap[lane].push(repo);
      repoLaneMap[repo.name] = lane;
    }

    // Annotate rendered cards with their lane so the filter can work
    const grid = document.getElementById('repo-grid');
    if (grid) {
      grid.querySelectorAll('.repo-card').forEach((card) => {
        const name = card.dataset.repo;
        if (name && repoLaneMap[name]) {
          card.dataset.kanbanLane = repoLaneMap[name];
        }
      });
    }

    // Build strip
    container.innerHTML = '';
    container.hidden = false;

    const strip = document.createElement('div');
    strip.className = 'kanban-strip';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Kanban lane overview — click a lane to filter repos');

    for (const lane of LANE_CONFIG) {
      const count = laneMap[lane.id].length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `kanban-lane kanban-lane--${lane.id}`;
      btn.setAttribute('aria-pressed', 'false');
      btn.dataset.lane = lane.id;
      btn.setAttribute(
        'aria-label',
        `${lane.label}: ${count} repo${count === 1 ? '' : 's'}. Click to filter.`
      );
      btn.innerHTML = `
        <span class="kanban-lane-emoji" aria-hidden="true">${lane.emoji}</span>
        <span class="kanban-lane-label">${lane.label}</span>
        <span class="kanban-lane-count" aria-hidden="true">${count}</span>
      `;
      btn.addEventListener('click', () => _onLaneClick(lane.id));
      strip.appendChild(btn);
    }

    container.appendChild(strip);

    // Add repo chips to each lane (issue #55 — kanban-lane-chips.js)
    const KanbanLaneChips = window.GHD && window.GHD.KanbanLaneChips;
    if (KanbanLaneChips && KanbanLaneChips.renderLaneChips) {
      KanbanLaneChips.renderLaneChips(container, laneMap, now, opts && opts.onSnooze);
    }

    // ── Top Pick bar ────────────────────────────────────────
    // Phase 1: Dependabot PRs win unconditionally when present.
    // Phase 2 (issue #57): when Blocked + Needs-Attention are both empty,
    //   fall through to backlog revival via GHD.BacklogScoring.
    let topPick = _findTopPick(repos);
    if (!topPick) {
      const noBlockers =
        laneMap['blocked'].length === 0 && laneMap['needs-attention'].length === 0;
      if (noBlockers) {
        const BacklogScoring = (typeof window !== 'undefined' ? window : globalThis)
          .GHD && (typeof window !== 'undefined' ? window : globalThis).GHD.BacklogScoring;
        if (BacklogScoring) {
          const bl = Array.isArray(backlogRepos) ? backlogRepos : [];
          const pick = BacklogScoring.findTopBacklogPick(bl, now);
          if (pick) {
            topPick = { type: 'backlog', pick };
          }
        }
      }
    }
    const topPickBar = _renderTopPickBar(topPick);
    if (topPickBar) container.appendChild(topPickBar);
  }

  GHD.KanbanStrip = {
    deriveKanbanLane,
    renderKanbanStrip,
    _isDependabotPR,
    _findTopPick
  };

})(window.GHD);
