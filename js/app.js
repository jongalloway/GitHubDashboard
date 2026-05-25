(() => {
  const STATUS_PRIORITY = {
    'needs-attention': 0,
    active: 1,
    quiet: 2
  };

  const STATUS_LABELS = {
    'needs-attention': 'Needs attention',
    active: 'Active',
    quiet: 'Quiet'
  };

  const SUMMARY_CONFIG = [
    {
      key: 'releaseReady',
      label: 'Repos needing a release',
      detail: 'Release overdue or no release despite active work.'
    },
    {
      key: 'pendingReviews',
      label: 'PRs awaiting review',
      detail: 'Human review queue across the visible repositories.'
    },
    {
      key: 'priorityIssues',
      label: 'Priority issues',
      detail: 'Top highlighted issues surfaced by the pipeline.'
    },
    {
      key: 'copilotRepos',
      label: 'Repos with Copilot activity',
      detail: 'Open Copilot branches, PRs, or recent AI signals.'
    },
    {
      key: 'squadRepos',
      label: 'Repos with Squad',
      detail: 'Repositories with active Squad AI team configuration.'
    }
  ];

  const root = {
    headerNote: document.querySelector('#header-note'),
    refreshMeta: document.querySelector('#refresh-meta'),
    summaryGrid: document.querySelector('#summary-grid'),
    stateRegion: document.querySelector('#state-region'),
    repoGrid: document.querySelector('#repo-grid'),
    // Auth UI
    viewBadge: document.querySelector('#view-badge'),
    signInBtn: document.querySelector('#sign-in-btn'),
    signOutBtn: document.querySelector('#sign-out-btn'),
    refreshBtn: document.querySelector('#refresh-btn')
  };

  // Module-level auth state
  let configuredOwner = null;
  let _resolvedOwner; // undefined = not yet resolved, null = resolved but not found

  // ── Pin / Close / Notes / Release-NA state ────────────────
  const PINNED_KEY = 'ghd-pinned';
  const CLOSED_KEY = 'ghd-closed';
  const NOTES_KEY = 'ghd-notes';
  const NOTES_OPEN_KEY = 'ghd-notes-open';
  const RELEASE_NA_KEY = 'ghd-release-na';
  let _currentRepos = null;

  function getPinnedRepos() {
    try { return new Set(JSON.parse(localStorage.getItem(PINNED_KEY)) || []); }
    catch (_) { return new Set(); }
  }
  function getClosedRepos() {
    try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY)) || []); }
    catch (_) { return new Set(); }
  }
  function getReleaseNARepos() {
    try { return new Set(JSON.parse(localStorage.getItem(RELEASE_NA_KEY)) || []); }
    catch (_) { return new Set(); }
  }
  function _savePinned(s) { localStorage.setItem(PINNED_KEY, JSON.stringify([...s])); }
  function _saveClosed(s) { localStorage.setItem(CLOSED_KEY, JSON.stringify([...s])); }
  function _saveReleaseNA(s) { localStorage.setItem(RELEASE_NA_KEY, JSON.stringify([...s])); }
  function isReleaseNA(repo) { return getReleaseNARepos().has(repo.name); }
  function toggleReleaseNA(repo) {
    const set = getReleaseNARepos();
    if (set.has(repo.name)) { set.delete(repo.name); } else { set.add(repo.name); }
    _saveReleaseNA(set);
  }

  // ── Notes helpers ─────────────────────────────────────────
  function getNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
    catch (_) { return {}; }
  }
  function getNote(repoName) { return getNotes()[repoName] || ''; }
  function saveNote(repoName, text) {
    const notes = getNotes();
    if (text.trim() === '') { delete notes[repoName]; } else { notes[repoName] = text; }
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }
  function getNotesOpen() {
    try { return new Set(JSON.parse(localStorage.getItem(NOTES_OPEN_KEY)) || []); }
    catch (_) { return new Set(); }
  }
  function _setNoteOpen(repoName, open) {
    const s = getNotesOpen();
    open ? s.add(repoName) : s.delete(repoName);
    localStorage.setItem(NOTES_OPEN_KEY, JSON.stringify([...s]));
  }

  function _togglePin(repoName) {
    const pinned = getPinnedRepos();
    if (pinned.has(repoName)) { pinned.delete(repoName); } else { pinned.add(repoName); }
    _savePinned(pinned);
    renderRepos();
  }
  function _closeRepo(repoName) {
    const closed = getClosedRepos();
    closed.add(repoName);
    _saveClosed(closed);
    const pinned = getPinnedRepos();
    if (pinned.has(repoName)) { pinned.delete(repoName); _savePinned(pinned); }
    renderRepos();
  }
  function _restoreRepo(repoName) {
    const closed = getClosedRepos();
    closed.delete(repoName);
    _saveClosed(closed);
    renderRepos();
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    renderSummarySkeleton();
    _initAuthControls();

    const Auth = window.GHD && window.GHD.Auth;
    const Cache = window.GHD && window.GHD.Cache;

    // Resolve owner from config.json or hostname — needed for both public and private flow
    const owner = await resolveOwner();

    if (!Auth || !Cache) {
      if (owner) {
        await _loadPublicDashboard(owner);
      } else {
        renderConnectState();
        _setAuthUI('public');
      }
      return;
    }

    if (Auth.ready) await Auth.ready;

    if (Auth.isAuthenticated()) {
      configuredOwner = owner; // config/hostname owner takes precedence in background refresh
      const cache = Cache.readCache();
      if (cache && !Cache.isHardStale(cache)) {
        _renderFromCache(cache);
        _setAuthUI('private');
        if (Cache.isSoftStale(cache)) {
          _backgroundRefresh();
        }
      } else {
        Cache.clearCache();
        _setAuthUI('private');
        _backgroundRefresh();
      }
    } else {
      if (owner) {
        await _loadPublicDashboard(owner);
      } else {
        renderConnectState();
        _setAuthUI('public');
      }
    }
  }

  // ── Owner resolution ──────────────────────────────────────

  /**
   * Determine the repo owner from (in priority order):
   * 1. config.json "owner" field (explicit override)
   * 2. GitHub Pages hostname pattern: {username}.github.io
   * 3. null — caller must prompt sign-in
   *
   * Result is cached so subsequent calls are synchronous.
   */
  async function resolveOwner() {
    if (_resolvedOwner !== undefined) return _resolvedOwner;

    // 1. Try config.json override
    try {
      const resp = await fetch('config.json');
      if (resp.ok) {
        const cfg = await resp.json();
        if (cfg && typeof cfg.owner === 'string' && cfg.owner.trim()) {
          _resolvedOwner = cfg.owner.trim();
          return _resolvedOwner;
        }
      }
    } catch (_) {}

    // 2. Parse GitHub Pages hostname: {username}.github.io
    const match = window.location.hostname.match(/^([^.]+)\.github\.io$/);
    if (match) {
      _resolvedOwner = match[1];
      return _resolvedOwner;
    }

    // 3. No owner found (localhost or custom domain without config override)
    _resolvedOwner = null;
    return null;
  }

  // ── Public data loader ────────────────────────────────────

  async function _loadPublicDashboard(owner) {
    const Client = window.GHD && window.GHD.GitHubClient;
    if (!Client || !Client.fetchPublicDashboard) {
      renderConnectState();
      _setAuthUI('public');
      return;
    }

    configuredOwner = owner;
    if (root.headerNote) root.headerNote.textContent = `Loading public repos for @${owner}\u2026`;

    try {
      const payload = await Client.fetchPublicDashboard(owner);
      const repos = payload.dashboard.repos;

      renderSummary(computeSummary(repos));

      if (!repos.length) {
        renderEmptyState();
      } else {
        renderRepos(sortRepos(repos));
      }

      if (root.headerNote) root.headerNote.textContent = `@${owner} \u00b7 Public repos`;
      if (root.refreshMeta) {
        root.refreshMeta.innerHTML = `
          <span class="refresh-inline">
            Showing public repos
            \u00b7 <button type="button" class="public-sign-in-link">Sign in</button>
            to include private repos
          </span>
        `;
        root.refreshMeta.querySelector('.public-sign-in-link')
          ?.addEventListener('click', _handleSignIn);
      }
    } catch (_) {
      renderConnectState();
    }

    _setAuthUI('public');
  }

  // ── Auth UI setup ─────────────────────────────────────────

  function _initAuthControls() {
    if (root.signInBtn) {
      root.signInBtn.addEventListener('click', _handleSignIn);
    }
    if (root.signOutBtn) {
      root.signOutBtn.addEventListener('click', _handleSignOut);
    }
    if (root.refreshBtn) {
      root.refreshBtn.addEventListener('click', _handleRefresh);
    }
  }

  function _setAuthUI(state) {
    if (root.signInBtn) root.signInBtn.hidden = (state !== 'public');
    if (root.signOutBtn) root.signOutBtn.hidden = (state !== 'private');
    if (root.refreshBtn) root.refreshBtn.hidden = false;

    if (root.viewBadge) {
      const labels = {
        'public': 'Public view',
        'private': 'Private view',
        'refreshing': 'Refreshing…'
      };
      root.viewBadge.textContent = labels[state] || 'Public view';
      root.viewBadge.className = `view-badge view-badge--${state === 'private' ? 'private' : 'public'}`;
    }

    if (root.refreshBtn && state === 'refreshing') {
      root.refreshBtn.disabled = true;
      root.refreshBtn.classList.add('spinning');
    } else if (root.refreshBtn) {
      root.refreshBtn.disabled = false;
      root.refreshBtn.classList.remove('spinning');
    }
  }

  // ── Auth event handlers ────────────────────────────────────

  async function _handleSignIn() {
    const Auth = window.GHD && window.GHD.Auth;
    if (!Auth) return;
    const result = await Auth.signIn();
    if (!result) return;
    _setAuthUI('private');
    _updatePrivateHeader(result.login, null);
    await _backgroundRefresh();
  }

  function _handleSignOut() {
    const Auth = window.GHD && window.GHD.Auth;
    if (Auth) Auth.signOut();
    _setAuthUI('public');
    // Re-render public data by reloading
    window.location.reload();
  }

  async function _handleRefresh() {
    const Auth = window.GHD && window.GHD.Auth;
    _setAuthUI('refreshing');
    if (Auth && Auth.isAuthenticated()) {
      await _backgroundRefresh();
      _setAuthUI('private');
    } else {
      window.location.reload();
    }
  }

  // ── Private data rendering ────────────────────────────────

  function _renderFromCache(cache) {
    const data = cache.dashboard;
    if (!data) return;
    const repos = Array.isArray(data.repos) ? data.repos.slice() : [];

    _updatePrivateHeader(cache.owner, data.generated_at);
    renderSummary(computeSummary(repos));

    if (!repos.length) {
      renderEmptyState();
    } else {
      renderRepos(sortRepos(repos));
    }
  }

  function _updatePrivateHeader(owner, generatedAt) {
    if (root.headerNote) {
      root.headerNote.textContent = `Configured account: @${owner || configuredOwner || '—'} · Private data`;
    }
    if (root.refreshMeta && generatedAt) {
      const label = formatAbsoluteDate(generatedAt);
      const relative = formatRelativeDate(generatedAt);
      root.refreshMeta.innerHTML = `
        <strong>Last private refresh</strong><br />
        <span class="refresh-inline">${label}${relative ? ` · ${relative}` : ''}</span>
      `;
    }
  }

  async function _backgroundRefresh() {
    const Auth = window.GHD && window.GHD.Auth;
    const Cache = window.GHD && window.GHD.Cache;
    const Client = window.GHD && window.GHD.GitHubClient;
    if (!Auth || !Cache || !Client) return;

    let token;
    try {
      token = await Auth.getValidToken();
    } catch (_) {
      _setAuthUI('public');
      return;
    }

    const owner = configuredOwner || Auth.getSession()?.owner;
    if (!owner) return;

    try {
      const payload = await Client.fetchPrivateDashboard(token, owner);
      Cache.writeCache({
        source: 'private',
        owner,
        selection: {
          maxRepos: 10,
          excludeForks: true,
          excludeArchived: true,
          sort: 'pushed_or_updated_desc'
        },
        repoCatalog: payload.repoCatalog,
        dashboard: payload.dashboard
      });
      _renderFromCache(Cache.readCache());
      _setAuthUI('private');
    } catch (_) {
      // Keep existing render if refresh fails; stay in private mode if cache valid
      const existing = Cache.readCache();
      if (!existing) {
        renderConnectState();
        _setAuthUI('public');
      } else {
        _setAuthUI('private');
      }
    }
  }

  function updateHeader(data) {
    const owner = data.owner ? `@${data.owner}` : 'configured GitHub user';
    root.headerNote.textContent = `Configured account: ${owner}`;

    const generatedLabel = formatAbsoluteDate(data.generated_at);
    const relativeRefresh = formatRelativeDate(data.generated_at);
    root.refreshMeta.innerHTML = `
      <strong>Last refresh</strong><br />
      <span class="refresh-inline">${generatedLabel}${relativeRefresh ? ` · ${relativeRefresh}` : ''}</span>
    `;
  }

  function renderSummarySkeleton() {
    root.summaryGrid.innerHTML = '';
    SUMMARY_CONFIG.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'summary-card';
      card.innerHTML = `
        <strong>—</strong>
        <span class="stat-label">${item.label}</span>
        <span class="detail-copy">${item.detail}</span>
      `;
      root.summaryGrid.appendChild(card);
    });
  }

  function renderSummary(summary) {
    root.summaryGrid.innerHTML = '';

    SUMMARY_CONFIG.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'summary-card';
      card.innerHTML = `
        <strong>${summary[item.key]}</strong>
        <span class="stat-label">${item.label}</span>
        <span class="detail-copy">${item.detail}</span>
      `;
      root.summaryGrid.appendChild(card);
    });
  }

  function computeSummary(repos) {
    return repos.reduce(
      (accumulator, repo) => {
        if (needsRelease(repo)) {
          accumulator.releaseReady += 1;
        }

        accumulator.pendingReviews += getPendingReviewCount(repo);
        accumulator.priorityIssues += getPriorityIssues(repo).length;

        if (hasCopilotActivity(repo)) {
          accumulator.copilotRepos += 1;
        }

        if (repo.squad_activity?.squad_enabled) {
          accumulator.squadRepos += 1;
        }

        return accumulator;
      },
      {
        releaseReady: 0,
        pendingReviews: 0,
        priorityIssues: 0,
        copilotRepos: 0,
        squadRepos: 0
      }
    );
  }

  function sortRepos(repos) {
    return repos.sort((left, right) => {
      const leftPriority = STATUS_PRIORITY[getEffectiveStatus(left)] ?? 99;
      const rightPriority = STATUS_PRIORITY[getEffectiveStatus(right)] ?? 99;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftReviews = getPendingReviewCount(left);
      const rightReviews = getPendingReviewCount(right);
      if (leftReviews !== rightReviews) {
        return rightReviews - leftReviews;
      }

      return (getPriorityIssues(right).length || 0) - (getPriorityIssues(left).length || 0);
    });
  }

  function renderRepos(repos) {
    if (repos != null) _currentRepos = repos;
    if (!_currentRepos) return;

    root.stateRegion.innerHTML = '';
    root.repoGrid.hidden = false;
    root.repoGrid.innerHTML = '';

    // Remove any existing closed section
    const existing = document.getElementById('closed-repos-section');
    if (existing) existing.remove();

    const pinned = getPinnedRepos();
    const closed = getClosedRepos();

    const pinnedRepos = _currentRepos.filter(r => pinned.has(r.name) && !closed.has(r.name));
    const normalRepos = _currentRepos.filter(r => !pinned.has(r.name) && !closed.has(r.name));
    const closedRepos = _currentRepos.filter(r => closed.has(r.name));

    [...pinnedRepos, ...normalRepos].forEach(repo => {
      root.repoGrid.appendChild(buildRepoCard(repo, pinned.has(repo.name)));
    });

    if (closedRepos.length) {
      root.repoGrid.insertAdjacentElement('afterend', buildClosedSection(closedRepos));
    }
  }

  function buildRepoCard(repo, isPinned = false) {
    const card = document.createElement('article');
    const status = getEffectiveStatus(repo);
    const language = repo.primary_language || 'Unknown';
    const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [];
    const description = repo.description || 'No description provided.';
    const lastCommit = formatRelativeDate(repo.last_commit_date);
    const lastCommitAbsolute = formatAbsoluteDate(repo.last_commit_date);
    const release = repo.releases || {};
    const copilot = repo.copilot_activity || {};
    const pendingReviews = repo.pending_reviews || {};
    const priorityIssues = getPriorityIssues(repo).slice(0, 3);
    const reviewItems = Array.isArray(pendingReviews.items) ? pendingReviews.items.slice(0, 3) : [];

    card.className = `repo-card status-${status}${isPinned ? ' is-pinned' : ''}`;

    const headerRight = document.createElement('div');
    headerRight.className = 'repo-header-right';
    headerRight.appendChild(buildCardActions(repo, isPinned));

    const header = document.createElement('div');
    header.className = 'repo-header';
    header.appendChild(buildRepoHeaderCopy(repo, language, description, lastCommit, lastCommitAbsolute, topics));
    header.appendChild(headerRight);

    const badges = document.createElement('div');
    badges.className = 'badge-row';
    buildStatusBadges(repo).forEach((badge) => badges.appendChild(badge));

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    grid.appendChild(buildInfoTile('Priority issues', `${priorityIssues.length} highlighted`, renderIssueList(priorityIssues, 'No priority issues surfaced.')));
    grid.appendChild(buildInfoTile('Pending review PRs', `${getPendingReviewCount(repo)} awaiting review`, renderReviewList(reviewItems, 'No PRs waiting for review.')));

    card.append(header, buildNextStepPanel(repo, status), badges, grid, buildNotesPanel(repo));
    return card;
  }

  function buildCardActions(repo, isPinned) {
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const pinBtn = document.createElement('button');
    pinBtn.className = `card-btn pin-btn${isPinned ? ' active' : ''}`;
    pinBtn.type = 'button';
    pinBtn.title = isPinned ? 'Unpin' : 'Pin to top';
    pinBtn.setAttribute('aria-label', isPinned ? 'Unpin repository' : 'Pin repository to top');
    pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/></svg>';
    pinBtn.addEventListener('click', (e) => { e.preventDefault(); _togglePin(repo.name); });

    const noteBtn = document.createElement('button');
    noteBtn.className = `card-btn note-btn${getNote(repo.name).trim() !== '' ? ' active' : ''}`;
    noteBtn.type = 'button';
    noteBtn.title = 'Toggle notes';
    noteBtn.setAttribute('aria-label', 'Toggle notes panel');
    noteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm-.5 2.5A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zM5 8a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1H5z"/><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm10-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z"/></svg>';
    noteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = noteBtn.closest('.repo-card');
      const panel = card?.querySelector('.notes-panel');
      if (!panel) return;
      const isHidden = panel.classList.contains('notes-panel--hidden');
      panel.classList.toggle('notes-panel--hidden', !isHidden);
      _setNoteOpen(repo.name, isHidden);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'card-btn close-btn';
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close repository card');
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';
    closeBtn.addEventListener('click', (e) => { e.preventDefault(); _closeRepo(repo.name); });

    const buttons = [pinBtn, noteBtn];

    if (GHD.Auth.hasIssueWriteAccess()) {
      const issueBtn = document.createElement('button');
      issueBtn.className = 'card-btn issue-btn';
      issueBtn.type = 'button';
      issueBtn.title = 'Quick issue';
      issueBtn.setAttribute('aria-label', 'Create quick issue');
      issueBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z"/></svg>';
      issueBtn.addEventListener('click', (e) => { e.preventDefault(); _showQuickIssueModal(repo); });
      buttons.push(issueBtn);
    }

    buttons.push(closeBtn);
    actions.append(...buttons);
    return actions;
  }

  function buildNotesPanel(repo) {
    const isOpen = getNotesOpen().has(repo.name);
    const currentNote = getNote(repo.name);
    const hasNote = currentNote.trim() !== '';

    const panel = document.createElement('div');
    panel.className = `notes-panel${isOpen ? '' : ' notes-panel--hidden'}`;
    panel.dataset.repo = repo.name;

    const header = document.createElement('div');
    header.className = 'notes-panel-header';

    const label = document.createElement('span');
    label.className = 'notes-panel-label';
    label.textContent = 'Notes';

    const hideBtn = document.createElement('button');
    hideBtn.className = 'notes-hide-btn';
    hideBtn.type = 'button';
    hideBtn.title = 'Hide notes';
    hideBtn.setAttribute('aria-label', 'Hide notes panel');
    hideBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>';
    hideBtn.addEventListener('click', () => {
      panel.classList.add('notes-panel--hidden');
      _setNoteOpen(repo.name, false);
      // update note button state
      const card = panel.closest('.repo-card');
      if (card) card.querySelector('.note-btn')?.classList.toggle('active', getNote(repo.name).trim() !== '');
    });

    header.append(label, hideBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'notes-textarea';
    textarea.placeholder = 'Add notes, todos, next steps…';
    textarea.value = currentNote;
    textarea.rows = 3;
    textarea.addEventListener('input', () => {
      saveNote(repo.name, textarea.value);
      // keep note button lit if there's content
      const card = panel.closest('.repo-card');
      if (card) card.querySelector('.note-btn')?.classList.toggle('active', textarea.value.trim() !== '');
    });

    panel.append(header, textarea);
    return panel;
  }

  function _showQuickIssueModal(repo) {
    const existing = document.getElementById('quick-issue-overlay');
    if (existing) existing.remove();

    const owner = repo.full_name ? repo.full_name.split('/')[0] : configuredOwner;
    const fullName = repo.full_name || `${owner}/${repo.name}`;

    const overlay = document.createElement('div');
    overlay.id = 'quick-issue-overlay';
    overlay.className = 'pat-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'qi-modal-title');
    overlay.innerHTML = `
      <div class="pat-modal quick-issue-modal">
        <h2 class="pat-modal-title" id="qi-modal-title">Quick Issue — ${escapeHtml(repo.name)}</h2>
        <div class="pat-modal-field">
          <label for="qi-title" class="pat-modal-label">Title</label>
          <input id="qi-title" class="pat-modal-input" type="text" placeholder="Issue title…" autocomplete="off" />
        </div>
        <div class="pat-modal-field">
          <label for="qi-body" class="pat-modal-label">Description <span style="font-weight:400;opacity:0.6">(optional)</span></label>
          <textarea id="qi-body" class="pat-modal-input qi-body" rows="4" placeholder="Describe the issue…"></textarea>
        </div>
        <p class="pat-modal-error" id="qi-error" hidden></p>
        <div class="pat-modal-actions">
          <button class="auth-btn" id="qi-submit" type="button">Create Issue</button>
          <button class="auth-btn auth-btn--secondary" id="qi-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const titleInput = overlay.querySelector('#qi-title');
    const bodyInput = overlay.querySelector('#qi-body');
    const submitBtn = overlay.querySelector('#qi-submit');
    const cancelBtn = overlay.querySelector('#qi-cancel');
    const errorEl = overlay.querySelector('#qi-error');
    const modalEl = overlay.querySelector('.quick-issue-modal');

    titleInput.focus();

    function _showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    function _close() { overlay.remove(); }

    async function _onSubmit() {
      const title = titleInput.value.trim();
      if (!title) { _showError('A title is required.'); return; }

      const token = GHD.Auth.getToken();
      if (!token) { _showError('Not signed in.'); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      errorEl.hidden = true;

      try {
        const issue = await _createIssue(fullName, title, bodyInput.value.trim(), token);
        modalEl.innerHTML = `
          <h2 class="pat-modal-title" style="color:var(--success)">Issue Created ✓</h2>
          <p class="pat-modal-copy">
            <a href="${escapeHtml(issue.html_url)}" target="_blank" rel="noreferrer" class="pat-modal-link">
              #${issue.number}: ${escapeHtml(issue.title)} →
            </a>
          </p>
          <div class="pat-modal-actions">
            <button class="auth-btn auth-btn--secondary" id="qi-done" type="button">Close</button>
          </div>
        `;
        overlay.querySelector('#qi-done')?.addEventListener('click', _close);
        setTimeout(_close, 4000);
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Issue';
        _showError(err.message || 'Failed to create issue. Check token permissions.');
      }
    }

    submitBtn.addEventListener('click', _onSubmit);
    cancelBtn.addEventListener('click', _close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _close();
      if (e.key === 'Enter' && e.target === titleInput) _onSubmit();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _close(); });
  }

  async function _createIssue(fullName, title, body, token) {
    const response = await fetch(`https://api.github.com/repos/${fullName}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body: body || '' })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error: HTTP ${response.status}`);
    }

    return response.json();
  }

  function buildClosedSection(closedRepos) {
    const section = document.createElement('section');
    section.id = 'closed-repos-section';
    section.className = 'closed-repos-section';

    const heading = document.createElement('h3');
    heading.className = 'closed-repos-heading';
    heading.textContent = `Closed (${closedRepos.length})`;

    const list = document.createElement('div');
    list.className = 'closed-repos-list';

    closedRepos.forEach(repo => {
      const item = document.createElement('div');
      item.className = 'closed-repo-item';

      const nameLink = document.createElement('a');
      nameLink.className = 'closed-repo-name';
      nameLink.href = repo.html_url || '#';
      nameLink.target = '_blank';
      nameLink.rel = 'noreferrer';
      nameLink.textContent = repo.name;

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'restore-btn';
      restoreBtn.type = 'button';
      restoreBtn.title = 'Restore repository card';
      restoreBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="margin-right:0.3em"><path d="M1.5 1.5A.5.5 0 0 1 2 2v2.207l.646-.646a.5.5 0 0 1 .708.708l-1.5 1.5a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L1 4.207V2a.5.5 0 0 1 .5-.5zm10 3a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5zM4.5 2a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V2.5a.5.5 0 0 1 .5-.5zm4 1a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-1 0V3.5a.5.5 0 0 1 .5-.5z"/></svg>Restore';
      restoreBtn.addEventListener('click', () => _restoreRepo(repo.name));

      item.append(nameLink, restoreBtn);
      list.appendChild(item);
    });

    section.append(heading, list);
    return section;
  }

  function buildRepoHeaderCopy(repo, language, description, lastCommit, lastCommitAbsolute, topics) {
    const wrapper = document.createElement('div');
    wrapper.className = 'repo-title-group';

    const title = document.createElement('a');
    title.className = 'repo-title-link';
    title.href = repo.html_url || '#';
    title.target = '_blank';
    title.rel = 'noreferrer';
    title.textContent = repo.name || repo.full_name || 'Unknown repo';

    const languageBadge = document.createElement('span');
    languageBadge.className = 'badge neutral';
    languageBadge.textContent = language;

    const titleRow = document.createElement('div');
    titleRow.className = 'badge-row';
    titleRow.append(title, languageBadge);
    if (repo.is_private) {
      const privateBadge = document.createElement('span');
      privateBadge.className = 'badge badge--private';
      privateBadge.title = 'Private repository';
      privateBadge.textContent = '🔒 Private';
      titleRow.append(privateBadge);
    }

    const descriptionNode = document.createElement('p');
    descriptionNode.className = 'repo-description';
    descriptionNode.textContent = description;

    const meta = document.createElement('p');
    meta.className = 'meta-inline';
    meta.textContent = lastCommit ? `Last commit ${lastCommit}${lastCommitAbsolute ? ` · ${lastCommitAbsolute}` : ''}` : 'Last commit unavailable';

    wrapper.append(titleRow, descriptionNode, meta);

    if (topics.length) {
      const topicsRow = document.createElement('div');
      topicsRow.className = 'repo-topics';
      topics.forEach((topic) => {
        const pill = document.createElement('span');
        pill.className = 'topic-pill';
        pill.textContent = topic;
        topicsRow.appendChild(pill);
      });
      wrapper.appendChild(topicsRow);
    }

    return wrapper;
  }

  function buildNextStepPanel(repo, status) {
    const nextSteps = repo.next_steps || {};
    const panel = document.createElement('section');
    panel.className = `next-step-panel status-${status}`;

    const pill = document.createElement('span');
    pill.className = `status-pill status-${status}`;
    pill.textContent = STATUS_LABELS[status] || 'Status';

    const title = document.createElement('strong');
    title.textContent = 'Next steps';

    const summary = document.createElement('p');
    summary.className = 'next-step-summary';
    summary.textContent = nextSteps.summary || 'No next-step summary available.';

    panel.append(pill, title, summary);

    if (Array.isArray(nextSteps.signals) && nextSteps.signals.length) {
      const row = document.createElement('div');
      row.className = 'status-row';
      nextSteps.signals.forEach((signal) => {
        const badge = document.createElement('span');
        badge.className = 'badge neutral';
        badge.textContent = signal.replaceAll('-', ' ');
        row.appendChild(badge);
      });
      panel.appendChild(row);
    }

    return panel;
  }

  function buildTrafficBadge(repo) {
    if (!repo.traffic) return null;
    const views = repo.traffic.views || {};
    const clones = repo.traffic.clones || {};
    const uniques = views.uniques || 0;
    const viewCount = views.count || 0;
    const cloneCount = clones.count || 0;
    const cloneUniques = clones.uniques || 0;
    const badge = buildBadge('👁️', `${uniques} unique visitors`, 'neutral');
    badge.title = `${viewCount} views, ${uniques} unique visitors, ${cloneCount} clones (${cloneUniques} unique) — last 14 days`;
    return badge;
  }

  function buildStatusBadges(repo) {
    const release = repo.releases || {};
    const copilot = repo.copilot_activity || {};
    const badges = [];

    badges.push(buildReleaseBadge(repo));
    badges.push(buildBadge('🤖', getCopilotLabel(copilot), hasCopilotActivity(repo) ? 'copilot' : 'neutral'));

    const squad = repo.squad_activity || {};
    if (squad.squad_enabled) {
      const label = squad.squad_branch_count > 0
        ? `Squad · ${squad.squad_branch_count} branch${squad.squad_branch_count === 1 ? '' : 'es'}`
        : 'Squad enabled';
      badges.push(buildBadge('🎯', label, 'squad'));
    }

    badges.push(buildBadge('📋', getIssueLabel(repo), getPriorityIssues(repo).length ? 'warning' : 'neutral'));
    badges.push(buildBadge('👀', getReviewLabel(repo), getPendingReviewCount(repo) ? 'warning' : 'neutral'));

    const licenseBadge = buildLicenseBadge(repo);
    if (licenseBadge) badges.push(licenseBadge);

    const discussionsBadge = buildDiscussionsBadge(repo);
    if (discussionsBadge) badges.push(discussionsBadge);

    const trafficBadge = buildTrafficBadge(repo);
    if (trafficBadge) badges.push(trafficBadge);

    const branchBadge = buildBranchBadge(repo);
    if (branchBadge) badges.push(branchBadge);

    const activityBadge = buildActivityBadge(repo);
    if (activityBadge) {
      badges.push(activityBadge);
    }

    const securityBadge = buildSecurityBadge(repo);
    if (securityBadge) {
      badges.push(securityBadge);
    }

    const codeScanBadge = buildCodeScanBadge(repo);
    if (codeScanBadge) {
      badges.push(codeScanBadge);
    }

    const workflowBadge = buildWorkflowBadge(repo);
    if (workflowBadge) {
      badges.push(workflowBadge);
    }

    if (repo.is_archived) {
      badges.push(buildBadge('🗃️', 'Archived', 'neutral'));
    }

    if (repo.is_fork) {
      badges.push(buildBadge('🍴', 'Fork', 'neutral'));
    }

    return badges;
  }

  function buildReleaseBadge(repo) {
    const release = repo.releases || {};
    const na = isReleaseNA(repo);

    if (na) {
      const badge = document.createElement('span');
      badge.className = 'badge neutral release-na-badge';
      badge.title = 'Click to restore release tracking';
      badge.textContent = '🚀 Release N/A';
      badge.addEventListener('click', () => { toggleReleaseNA(repo); renderRepos(_currentRepos); });
      return badge;
    }

    if (!release.has_release) {
      const wrapper = document.createElement('span');
      wrapper.className = `badge ${needsRelease(repo) ? 'warning' : 'success'} badge-dismissible`;
      const text = document.createElement('span');
      text.textContent = `🚀 ${getReleaseLabel(release)}`;
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'badge-dismiss';
      dismissBtn.type = 'button';
      dismissBtn.title = 'Mark as Release N/A (not applicable for this repo)';
      dismissBtn.setAttribute('aria-label', 'Mark release as not applicable');
      dismissBtn.textContent = '×';
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReleaseNA(repo);
        renderRepos(_currentRepos);
      });
      wrapper.append(text, dismissBtn);
      return wrapper;
    }

    return buildBadge('🚀', getReleaseLabel(release), needsRelease(repo) ? 'warning' : 'success');
  }

  function buildDiscussionsBadge(repo) {
    if (!repo.discussions_enabled) return null;
    return buildBadge('💬', 'Discussions', 'neutral');
  }

  function buildBranchBadge(repo) {
    const count = repo.non_default_branch_count;
    if (!count || count <= 1) return null;
    const tone = count > 10 ? 'warning' : 'neutral';
    return buildBadge('🌿', `${count} branch${count === 1 ? '' : 'es'}`, tone);
  }

  function buildCodeScanBadge(repo) {
    const cs = repo.code_scanning;
    if (!cs || cs.total === 0) return null;

    const critical = cs.critical || 0;
    const high = cs.high || 0;
    const error = cs.error || 0;
    const total = cs.total || 0;

    let text;
    let tone;
    if (critical > 0) {
      text = `${critical} critical`;
      tone = 'danger';
    } else if (error > 0) {
      text = `${error} error`;
      tone = 'danger';
    } else if (high > 0) {
      text = `${high} high`;
      tone = 'warning';
    } else {
      text = `${total} alerts`;
      tone = 'neutral';
    }

    return buildBadge('🔍', text, tone);
  }

  function buildBadge(icon, text, tone) {
    const badge = document.createElement('span');
    badge.className = `badge ${tone}`;
    badge.textContent = `${icon} ${text}`;
    return badge;
  }

  function buildLicenseBadge(repo) {
    if (repo.license === undefined) return null;

    const isActive = !repo.is_archived && !repo.is_fork;
    const licenseLabel = repo.license || 'No license';
    const readmeMissing = repo.has_readme === false;

    const label = readmeMissing ? `${licenseLabel} · No README` : licenseLabel;
    const isWarning = isActive && (!repo.license || readmeMissing);

    return buildBadge('📄', label, isWarning ? 'warning' : 'neutral');
  }

  function buildActivityBadge(repo) {
    if (!repo.last_commit_date) return null;

    const date = new Date(repo.last_commit_date);
    if (Number.isNaN(date.getTime())) return null;

    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    const text = formatRelativeDate(repo.last_commit_date) || 'today';

    let tone;
    if (days <= 30) {
      tone = 'success';
    } else if (days <= 90) {
      tone = 'neutral';
    } else if (days <= 365) {
      tone = 'warning';
    } else {
      tone = 'danger';
    }

    const badge = buildBadge('🕐', text, tone);
    badge.title = formatAbsoluteDate(repo.last_commit_date);
    return badge;
  }

  function buildSecurityBadge(repo) {
    const alerts = repo.security_alerts;
    if (!alerts || alerts.total === 0) return null;

    const critical = alerts.critical || 0;
    const high = alerts.high || 0;

    let label, tone;
    if (critical > 0) {
      label = `${critical} critical`;
      tone = 'danger';
    } else if (high > 0) {
      label = `${high} high`;
      tone = 'warning';
    } else {
      label = `${alerts.total} alert${alerts.total === 1 ? '' : 's'}`;
      tone = 'neutral';
    }

    return buildBadge('🔒', label, tone);
  }

  function buildWorkflowBadge(repo) {
    if (!repo.workflow_status?.has_workflows) return null;

    const run = repo.workflow_status.latest_run;
    const status = run?.status || null;
    const conclusion = run?.conclusion || null;

    let icon, text, tone;
    if (conclusion === 'success') {
      icon = '✅'; text = 'CI passing'; tone = 'success';
    } else if (['failure', 'timed_out', 'startup_failure', 'action_required'].includes(conclusion)) {
      icon = '❌'; text = 'CI failing'; tone = 'danger';
    } else if (conclusion === 'cancelled') {
      icon = '⚫'; text = 'CI cancelled'; tone = 'neutral';
    } else if (status === 'in_progress' || status === 'queued' || conclusion === 'in_progress') {
      icon = '⏳'; text = 'CI running'; tone = 'neutral';
    } else {
      icon = '⚪'; text = 'CI unknown'; tone = 'neutral';
    }

    const badge = buildBadge(icon, text, tone);

    if (run?.html_url) {
      const link = document.createElement('a');
      link.href = run.html_url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.className = 'badge-link';
      link.appendChild(badge);
      return link;
    }

    return badge;
  }

  function buildInfoTile(title, subtitle, contentNode) {
    const tile = document.createElement('section');
    tile.className = 'info-tile';

    const heading = document.createElement('strong');
    heading.textContent = title;

    const subtitleNode = document.createElement('p');
    subtitleNode.className = 'detail-copy';
    subtitleNode.textContent = subtitle;

    tile.append(heading, subtitleNode, contentNode);
    return tile;
  }

  function renderIssueList(items, emptyMessage) {
    if (!items.length) {
      return buildEmptyCopy(emptyMessage);
    }

    const list = document.createElement('ol');
    list.className = 'repo-list';

    items.forEach((issue) => {
      const item = document.createElement('li');
      item.className = 'repo-list-item';

      const link = document.createElement('a');
      link.className = 'repo-list-link';
      link.href = issue.html_url || '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `#${issue.number ?? '—'} ${issue.title || 'Untitled issue'}`;

      const meta = document.createElement('p');
      meta.className = 'issue-labels';
      const labels = Array.isArray(issue.labels) ? issue.labels.join(', ') : 'No labels';
      meta.textContent = `${labels} · ${issue.priority_reason || 'priority signal'}${issue.is_unassigned ? ' · Unassigned' : ''}${issue.is_unlabeled ? ' · Unlabeled' : ''}`;

      item.append(link, meta);
      list.appendChild(item);
    });

    return list;
  }

  function renderReviewList(items, emptyMessage) {
    if (!items.length) {
      return buildEmptyCopy(emptyMessage);
    }

    const list = document.createElement('ol');
    list.className = 'repo-list';

    items.forEach((pull) => {
      const item = document.createElement('li');
      item.className = `repo-list-item ${isCopilotPull(pull) ? 'copilot-highlight' : ''}`.trim();

      const link = document.createElement('a');
      link.className = 'repo-list-link';
      link.href = pull.html_url || '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      const prefix = pull.is_draft ? 'Draft PR' : 'PR';
      link.textContent = `${prefix} #${pull.number ?? '—'} ${pull.title || 'Untitled pull request'}`;

      const meta = document.createElement('p');
      meta.className = 'pr-meta';
      const author = pull.author || 'unknown author';
      const reviewState = pull.awaiting_review ? 'Awaiting review' : 'Open';
      meta.textContent = `${author} · ${reviewState}${isCopilotPull(pull) ? ' · Copilot-linked' : ''}`;

      item.append(link, meta);
      list.appendChild(item);
    });

    return list;
  }

  function buildEmptyCopy(message) {
    const empty = document.createElement('p');
    empty.className = 'item-empty';
    empty.textContent = message;
    return empty;
  }

  function renderEmptyState() {
    root.repoGrid.hidden = true;
    root.repoGrid.innerHTML = '';
    root.stateRegion.innerHTML = `
      <article class="state-card empty">
        <h3>No repositories to show</h3>
        <p class="empty-copy">The dashboard data loaded successfully, but there are no repository records yet.</p>
      </article>
    `;
  }

  function renderConnectState() {
    root.repoGrid.hidden = true;
    root.repoGrid.innerHTML = '';
    if (root.headerNote) root.headerNote.textContent = 'No account connected';
    if (root.refreshMeta) root.refreshMeta.textContent = '';
    root.stateRegion.innerHTML = `
      <article class="state-card connect">
        <h3>Connect your GitHub account</h3>
        <p class="connect-copy">Track release readiness, Copilot activity, priority issues, and PR review queues across your most recent repositories.</p>
        <p class="connect-copy">Sign in with a Personal Access Token using the button above.&nbsp;<a class="connect-link" href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">Generate a fine-grained PAT on GitHub →</a></p>
        <p class="connect-copy">To show public repos without signing in, set <code>"owner": "yourusername"</code> in <code>config.json</code> — or deploy to GitHub Pages where the owner is auto-detected from the URL.</p>
      </article>
    `;
  }

  function renderErrorState(error) {
    root.repoGrid.hidden = true;
    root.repoGrid.innerHTML = '';

    const isMissingData = error?.status === 404;
    const message = isMissingData
      ? 'Run the workflow to populate dashboard data after setting the repository variable <code>GITHUB_USERNAME</code>.'
      : `Check that <code>data/dashboard.json</code> exists and is published with the site. ${escapeHtml(error?.message || 'Unknown error.')}`;

    root.stateRegion.innerHTML = `
      <article class="state-card error">
        <h3>${isMissingData ? 'Dashboard data has not been generated yet' : 'Dashboard data could not be loaded'}</h3>
        <p class="error-copy">${message}</p>
      </article>
    `;

    root.headerNote.textContent = 'Configured account unavailable';
    root.refreshMeta.textContent = 'Last refresh unavailable';
  }

  function getStatus(repo) {
    return repo?.next_steps?.status || 'quiet';
  }

  function getPendingReviewCount(repo) {
    return Number(repo?.pending_reviews?.count || 0);
  }

  function getPriorityIssues(repo) {
    return Array.isArray(repo.priority_issues) ? repo.priority_issues : [];
  }

  function needsRelease(repo) {
    if (isReleaseNA(repo)) return false;
    const release = repo.releases || {};
    return Boolean(release.release_overdue || (!release.has_release && Number(release.commits_since_latest || 0) > 0));
  }

  function getEffectiveStatus(repo) {
    const baseStatus = getStatus(repo);
    if (!isReleaseNA(repo) || baseStatus !== 'needs-attention') return baseStatus;
    const signals = Array.isArray(repo.next_steps?.signals) ? repo.next_steps.signals : [];
    const nonReleaseSignals = signals.filter((s) => s !== 'release-overdue');
    return nonReleaseSignals.length > 0 ? 'needs-attention' : 'active';
  }

  function hasCopilotActivity(repo) {
    const activity = repo.copilot_activity || {};
    const signalCount = Array.isArray(activity.signals) ? activity.signals.length : 0;
    return (
      Number(activity.copilot_branch_count || 0) > 0 ||
      Number(activity.copilot_open_pr_count || 0) > 0 ||
      Number(activity.copilot_draft_pr_count || 0) > 0 ||
      Number(activity.copilot_labeled_issue_count || 0) > 0 ||
      Number(activity.bot_pr_count || 0) > 0 ||
      signalCount > 0
    );
  }

  function getReleaseLabel(release) {
    if (!release.has_release) {
      const commits = Number(release.commits_since_latest || 0);
      return commits > 0 ? `No releases · ${commits} commits on deck` : 'No releases';
    }

    const tag = release.latest_tag || 'Latest release';
    const ahead = Number(release.commits_since_latest || 0);
    const age = release.latest_published_at ? formatRelativeDate(release.latest_published_at) : null;
    return age ? `${tag} · ${ahead} commits ahead · ${age}` : `${tag} · ${ahead} commits ahead`;
  }

  function getCopilotLabel(activity) {
    const branches = Number(activity.copilot_branch_count || 0);
    const copilotPrs = Number(activity.copilot_open_pr_count || 0);
    const botPrs = Number(activity.bot_pr_count || 0);
    const issues = Number(activity.copilot_labeled_issue_count || 0);
    const totalPrs = copilotPrs + botPrs;
    const total = branches + totalPrs + issues;

    if (!total) {
      return 'No activity';
    }

    const parts = [];
    if (totalPrs > 0) parts.push(`${totalPrs} PR${totalPrs === 1 ? '' : 's'}`);
    if (branches > 0) parts.push(`${branches} branch${branches === 1 ? '' : 'es'}`);
    if (issues > 0 && parts.length === 0) parts.push(`${issues} issue${issues === 1 ? '' : 's'}`);
    return `Active (${parts.join(', ')})`;
  }

  function getIssueLabel(repo) {
    const total = Number(repo.open_issues_count || 0);
    const highlighted = getPriorityIssues(repo).length;
    return `${total} open · ${highlighted} priority`;
  }

  function getReviewLabel(repo) {
    const total = Number(repo.open_pull_requests_count || 0);
    const pending = getPendingReviewCount(repo);
    return `${total} open · ${pending} pending review`;
  }

  function isCopilotPull(pull) {
    const author = String(pull?.author || '').toLowerCase();
    const source = String(pull?.source || '').toLowerCase();
    return author.includes('copilot') || source.includes('copilot');
  }

  function formatRelativeDate(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const diffMs = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;

    if (Math.abs(diffMs) < minute) {
      return 'just now';
    }

    if (Math.abs(diffMs) < hour) {
      const minutes = Math.round(diffMs / minute);
      return formatRelativeUnit(minutes, 'minute');
    }

    if (Math.abs(diffMs) < day) {
      const hours = Math.round(diffMs / hour);
      return formatRelativeUnit(hours, 'hour');
    }

    if (Math.abs(diffMs) < week) {
      const days = Math.round(diffMs / day);
      return formatRelativeUnit(days, 'day');
    }

    const weeks = Math.round(diffMs / week);
    return formatRelativeUnit(weeks, 'week');
  }

  function formatRelativeUnit(amount, unit) {
    const absolute = Math.abs(amount);
    if (absolute === 0) {
      return 'just now';
    }

    const suffix = absolute === 1 ? unit : `${unit}s`;
    return amount >= 0 ? `${absolute} ${suffix} ago` : `in ${absolute} ${suffix}`;
  }

  function formatAbsoluteDate(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
