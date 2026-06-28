// js/kanban-lane-chips.js — Kanban lane repo chips + drill-down panel (issue #55)
// Phase 2 of issue #42: inline repo chips per lane with lane-placement reasons.
//
// Adds repo chips to the .kanban-strip grid; clicking a chip opens an inline
// detail panel listing the signals that placed the repo in that lane.
// All data derived from existing deriveKanbanLane() signals — no new API calls.

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const CI_FAILING = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Lane IDs in display order — must match LANE_CONFIG in kanban-strip.js
  const LANE_ORDER = ['blocked', 'needs-attention', 'working', 'healthy'];

  /**
   * Derive human-readable reasons explaining why a repo was placed in a lane.
   * Pure function — no DOM, injectable `now` for determinism in tests.
   *
   * @param {Object} repo  - normalized repo data object
   * @param {string} lane  - 'blocked' | 'needs-attention' | 'working' | 'healthy'
   * @param {number} [now] - epoch ms (defaults to Date.now())
   * @returns {string[]}
   */
  function deriveLanePlacementReasons(repo, lane, now) {
    const ts = typeof now === 'number' ? now : Date.now();
    const reasons = [];

    if (lane === 'blocked') {
      if (
        repo.workflow_status?.has_workflows === true &&
        CI_FAILING.has(repo.workflow_status?.latest_run?.conclusion)
      ) {
        reasons.push('CI failing on main');
      }
      const alerts = repo.security_alerts?.total || 0;
      if (alerts > 0) {
        const severe =
          (repo.security_alerts?.critical || 0) + (repo.security_alerts?.high || 0);
        reasons.push(
          `${alerts} security alert${alerts !== 1 ? 's' : ''}` +
            (severe > 0 ? ` (${severe} critical/high)` : '')
        );
      }
    } else if (lane === 'needs-attention') {
      const items = Array.isArray(repo.pending_reviews?.items)
        ? repo.pending_reviews.items
        : [];
      const total = repo.pending_reviews?.count || items.length;
      const botCount = items.filter((pr) =>
        String(pr?.author || '').toLowerCase().includes('dependabot')
      ).length;
      const humanCount = total - botCount;

      if (botCount > 0) {
        reasons.push(
          `${botCount} open Dependabot PR${botCount !== 1 ? 's' : ''} awaiting review`
        );
      }
      if (humanCount > 0) {
        reasons.push(`${humanCount} PR${humanCount !== 1 ? 's' : ''} awaiting review`);
      }
      // Fallback: count present but items array unpopulated
      if (total > 0 && botCount === 0 && humanCount <= 0) {
        reasons.push(`${total} PR${total !== 1 ? 's' : ''} awaiting review`);
      }
    } else if (lane === 'working' || lane === 'healthy') {
      const activityAt = repo.pushed_at || repo.last_commit_date || null;
      if (activityAt) {
        const ageMs = ts - new Date(activityAt).getTime();
        if (Number.isFinite(ageMs) && ageMs >= 0) {
          const days = Math.floor(ageMs / DAY_MS);
          reasons.push(`Pushed ${days}d ago`);
        }
      }
    }

    return reasons;
  }

  function _escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _safeUrl(repo) {
    const raw =
      repo.html_url ||
      (repo.full_name ? `https://github.com/${repo.full_name}` : null) ||
      '#';
    return /^https?:\/\//i.test(raw) ? raw : '#';
  }

  // ── Panel state ───────────────────────────────────────────────────────────
  // One panel open at a time; reset on every renderLaneChips call.
  let _openChip = null; // { repoName, laneId, chipEl, panelEl }
  let _escapeListenerAdded = false;

  function _closePanel() {
    if (!_openChip) return;
    const { panelEl, chipEl } = _openChip;
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    if (chipEl) chipEl.setAttribute('aria-expanded', 'false');
    _openChip = null;
  }

  /**
   * Build the detail panel DOM element.
   * Exported for unit-testability without requiring full strip rendering.
   *
   * @param {Object}   repo
   * @param {string}   lane
   * @param {string[]} reasons
   * @returns {HTMLElement}
   */
  function _buildDetailPanel(repo, lane, reasons) {
    const panel = document.createElement('div');
    panel.className = `kanban-detail-panel kanban-detail-panel--${lane}`;
    panel.setAttribute('role', 'region');
    panel.setAttribute(
      'aria-label',
      `${_escapeHtml(repo.full_name || repo.name)} — ${lane} lane details`
    );

    const safeUrl = _safeUrl(repo);
    const repoLabel = _escapeHtml(repo.full_name || repo.name);

    const header = document.createElement('div');
    header.className = 'kanban-detail-header';
    header.innerHTML = `
      <a class="kanban-detail-repo-link"
         href="${_escapeHtml(safeUrl)}"
         target="_blank"
         rel="noopener noreferrer"
         aria-label="${repoLabel} on GitHub (opens in new tab)">${repoLabel}</a>
      <button class="kanban-detail-close" type="button" aria-label="Close details panel">×</button>
    `;

    const list = document.createElement('ul');
    list.className = 'kanban-detail-reasons';

    const displayReasons = reasons.length > 0 ? reasons : ['No signals recorded.'];
    for (const r of displayReasons) {
      const li = document.createElement('li');
      li.textContent = r;
      list.appendChild(li);
    }

    panel.appendChild(header);
    panel.appendChild(list);

    return panel;
  }

  /**
   * Build the snooze action section for the detail panel.
   * Shows duration picker when the repo is not snoozed; un-snooze button when it is.
   *
   * @param {Object}   repo
   * @param {Function} onSnooze  - (repoName: string, days: number) => void
   *                               days=0 means un-snooze
   * @param {number}   [now]     - epoch ms (defaults to Date.now())
   * @returns {HTMLElement}
   */
  function _buildSnoozeSection(repo, onSnooze, now) {
    const ts = typeof now === 'number' ? now : Date.now();
    const section = document.createElement('div');
    section.className = 'kanban-detail-snooze';

    const Snooze = (typeof window !== 'undefined' ? window : globalThis).GHD &&
                   (typeof window !== 'undefined' ? window : globalThis).GHD.Snooze;
    const snoozed = Snooze && Snooze.isSnoozed(repo.name, ts);

    if (snoozed) {
      const until = Snooze.getSnoozedUntil(repo.name);
      const label = document.createElement('span');
      label.className = 'snooze-indicator';
      label.textContent = `💤 Snoozed until ${until ? new Date(until).toLocaleDateString() : '?'}`;
      section.appendChild(label);

      const unsnoozeBtn = document.createElement('button');
      unsnoozeBtn.type = 'button';
      unsnoozeBtn.className = 'kanban-detail-snooze-btn kanban-detail-unsnooze-btn';
      unsnoozeBtn.textContent = 'Un-snooze';
      unsnoozeBtn.setAttribute('aria-label',
        `Un-snooze ${_escapeHtml(repo.full_name || repo.name)}`);
      unsnoozeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onSnooze(repo.name, 0);
        _closePanel();
      });
      section.appendChild(unsnoozeBtn);
    } else {
      const label = document.createElement('span');
      label.className = 'snooze-label';
      label.textContent = 'Snooze:';
      section.appendChild(label);

      for (const days of [1, 3, 7]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kanban-detail-snooze-btn';
        btn.textContent = `${days}d`;
        btn.setAttribute('aria-label',
          `Snooze ${_escapeHtml(repo.full_name || repo.name)} for ${days} day${days !== 1 ? 's' : ''}`);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onSnooze(repo.name, days);
          _closePanel();
        });
        section.appendChild(btn);
      }
    }

    return section;
  }

  function _openPanel(container, repo, laneId, reasons, chipEl, onSnooze) {
    _closePanel();

    const panel = _buildDetailPanel(repo, laneId, reasons);

    // Append snooze section when a callback is provided
    if (typeof onSnooze === 'function') {
      panel.appendChild(_buildSnoozeSection(repo, onSnooze));
    }

    // Insert panel after .kanban-strip, before the top-pick-bar (or end of container)
    const strip = container.querySelector('.kanban-strip');
    if (strip && strip.nextSibling) {
      container.insertBefore(panel, strip.nextSibling);
    } else {
      container.appendChild(panel);
    }

    const closeBtn = panel.querySelector('.kanban-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', _closePanel);

    chipEl.setAttribute('aria-expanded', 'true');
    _openChip = { repoName: repo.name, laneId, chipEl, panelEl: panel };

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Add repo chips to each lane in an already-rendered kanban strip.
   * Must be called after renderKanbanStrip has built the .kanban-strip element.
   *
   * Chip rows are appended as direct children of .kanban-strip so they sit in
   * row 2 of the 4-column CSS grid, one column per lane.
   *
   * @param {HTMLElement} container  - the #kanban-strip-region element
   * @param {Object}      laneMap    - { 'blocked': [...], 'needs-attention': [...], ... }
   * @param {number}      [now]      - epoch ms (defaults to Date.now())
   * @param {Function}    [onSnooze] - (repoName: string, days: number) => void; days=0 = un-snooze
   */
  function renderLaneChips(container, laneMap, now, onSnooze) {
    if (!container || !laneMap) return;

    // Reset any panel/state leftover from a previous render
    _closePanel();
    _openChip = null;

    const strip = container.querySelector('.kanban-strip');
    if (!strip) return;

    const ts = typeof now === 'number' ? now : Date.now();

    for (const laneId of LANE_ORDER) {
      const repos = Array.isArray(laneMap[laneId]) ? laneMap[laneId] : [];

      const chipRow = document.createElement('div');
      chipRow.className = 'kanban-chip-row';
      chipRow.dataset.lane = laneId;

      if (repos.length === 0) {
        // Keep in DOM for explicit grid placement; hide so it collapses
        chipRow.hidden = true;
        chipRow.setAttribute('aria-hidden', 'true');
        chipRow.setAttribute('role', 'presentation');
      } else {
        chipRow.setAttribute('role', 'list');
        chipRow.setAttribute('aria-label', `${laneId} lane repos`);

        for (const repo of repos) {
          const reasons = deriveLanePlacementReasons(repo, laneId, ts);
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'kanban-repo-chip';
          chip.setAttribute('role', 'listitem');
          chip.setAttribute('aria-expanded', 'false');
          chip.setAttribute(
            'aria-label',
            `${_escapeHtml(repo.full_name || repo.name)}: click for lane details`
          );
          chip.dataset.repo = repo.name;
          chip.innerHTML = `<span class="kanban-repo-chip-name">${_escapeHtml(repo.full_name || repo.name)}</span>`;

          chip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_openChip && _openChip.repoName === repo.name && _openChip.laneId === laneId) {
              _closePanel();
            } else {
              _openPanel(container, repo, laneId, reasons, chip, onSnooze);
            }
          });

          chipRow.appendChild(chip);
        }
      }

      strip.appendChild(chipRow);
    }

    // Register Escape key listener once per page lifetime
    if (!_escapeListenerAdded) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') _closePanel();
      });
      _escapeListenerAdded = true;
    }
  }

  GHD.KanbanLaneChips = {
    deriveLanePlacementReasons,
    renderLaneChips,
    _buildDetailPanel,
    _buildSnoozeSection,
    _closePanel
  };
})(window.GHD);
