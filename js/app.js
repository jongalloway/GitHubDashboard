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

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    renderSummarySkeleton();

    // ── Always load public dashboard.json first ──────────
    let publicLoadOk = false;
    try {
      const response = await fetch('data/dashboard.json', { cache: 'no-store' });
      if (!response.ok) {
        const error = new Error(
          response.status === 404
            ? 'Run the workflow to populate dashboard data after setting GITHUB_USERNAME.'
            : `Dashboard data request failed with ${response.status}.`
        );
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      configuredOwner = data.owner || null;
      const repos = Array.isArray(data.repos) ? data.repos.slice() : [];

      updateHeader(data);
      renderSummary(computeSummary(repos));

      if (!repos.length) {
        renderEmptyState();
      } else {
        renderRepos(sortRepos(repos));
      }
      publicLoadOk = true;
    } catch (error) {
      renderErrorState(error);
    }

    // ── Auth path — runs after public render ─────────────
    _initAuthControls();

    const Auth = window.GHD && window.GHD.Auth;
    const Cache = window.GHD && window.GHD.Cache;

    if (!Auth || !Cache || !publicLoadOk) return;

    if (Auth.ready) await Auth.ready;
    if (Auth.isAuthenticated()) {
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
      _setAuthUI('public');
    }
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
    if (root.refreshBtn) root.refreshBtn.hidden = (state !== 'private');

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
      root.refreshBtn.textContent = 'Refreshing…';
    } else if (root.refreshBtn && state === 'private') {
      root.refreshBtn.disabled = false;
      root.refreshBtn.textContent = 'Refresh private data';
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
    if (!Auth || !Auth.isAuthenticated()) return;
    _setAuthUI('refreshing');
    await _backgroundRefresh();
    _setAuthUI('private');
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
      const leftPriority = STATUS_PRIORITY[getStatus(left)] ?? 99;
      const rightPriority = STATUS_PRIORITY[getStatus(right)] ?? 99;

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
    root.stateRegion.innerHTML = '';
    root.repoGrid.hidden = false;
    root.repoGrid.innerHTML = '';

    repos.forEach((repo) => {
      root.repoGrid.appendChild(buildRepoCard(repo));
    });
  }

  function buildRepoCard(repo) {
    const card = document.createElement('article');
    const status = getStatus(repo);
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

    card.className = `repo-card status-${status}`;

    const header = document.createElement('div');
    header.className = 'repo-header';
    header.appendChild(buildRepoHeaderCopy(repo, language, description, lastCommit, lastCommitAbsolute, topics));
    header.appendChild(buildNextStepPanel(repo, status));

    const badges = document.createElement('div');
    badges.className = 'badge-row';
    buildStatusBadges(repo).forEach((badge) => badges.appendChild(badge));

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    grid.appendChild(buildInfoTile('Priority issues', `${priorityIssues.length} highlighted`, renderIssueList(priorityIssues, 'No priority issues surfaced.')));
    grid.appendChild(buildInfoTile('Pending review PRs', `${getPendingReviewCount(repo)} awaiting review`, renderReviewList(reviewItems, 'No PRs waiting for review.')));

    card.append(header, badges, grid);
    return card;
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

  function buildStatusBadges(repo) {
    const release = repo.releases || {};
    const copilot = repo.copilot_activity || {};
    const badges = [];

    badges.push(buildBadge('🚀', getReleaseLabel(release), needsRelease(repo) ? 'warning' : 'success'));
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

    if (repo.is_archived) {
      badges.push(buildBadge('🗃️', 'Archived', 'neutral'));
    }

    if (repo.is_fork) {
      badges.push(buildBadge('🍴', 'Fork', 'neutral'));
    }

    return badges;
  }

  function buildBadge(icon, text, tone) {
    const badge = document.createElement('span');
    badge.className = `badge ${tone}`;
    badge.textContent = `${icon} ${text}`;
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
    const release = repo.releases || {};
    return Boolean(release.release_overdue || (!release.has_release && Number(release.commits_since_latest || 0) > 0));
  }

  function hasCopilotActivity(repo) {
    const activity = repo.copilot_activity || {};
    const signalCount = Array.isArray(activity.signals) ? activity.signals.length : 0;
    return (
      Number(activity.copilot_branch_count || 0) > 0 ||
      Number(activity.copilot_open_pr_count || 0) > 0 ||
      Number(activity.copilot_draft_pr_count || 0) > 0 ||
      Number(activity.copilot_labeled_issue_count || 0) > 0 ||
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
    return `${tag} · ${ahead} commits ahead`;
  }

  function getCopilotLabel(activity) {
    const branches = Number(activity.copilot_branch_count || 0);
    const prs = Number(activity.copilot_open_pr_count || 0) + Number(activity.copilot_draft_pr_count || 0);
    const issues = Number(activity.copilot_labeled_issue_count || 0);
    const total = branches + prs + issues;

    if (!total) {
      return 'No Copilot signals';
    }

    return `${branches} branches · ${prs} PRs · ${issues} linked issues`;
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
