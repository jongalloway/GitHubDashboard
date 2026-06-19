(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const MIN_TONE_SCORE = 55;
  const GOOD_TONE_SCORE = 80;
  const DAYS_PER_SCORE_POINT = 1.5;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function daysBetween(dateString, nowMs = Date.now()) {
    if (!dateString) return null;

    const value = new Date(dateString).getTime();
    if (!Number.isFinite(value)) return null;

    return Math.floor(Math.max(nowMs - value, 0) / 86400000);
  }

  function formatRecencyLabel(daysAgo) {
    if (daysAgo === 0) return 'today';
    if (daysAgo === 1) return '1 day ago';
    return `${daysAgo} days ago`;
  }

  function getTone(score) {
    if (score >= GOOD_TONE_SCORE) return 'good';
    if (score >= MIN_TONE_SCORE) return 'warning';
    return 'critical';
  }

  function getStateLabel(score) {
    if (score >= GOOD_TONE_SCORE) return 'fresh';
    if (score >= MIN_TONE_SCORE) return 'steady';
    return 'stale';
  }

  function computeCommitRecencyModel(repo, options = {}) {
    const dateValue = repo?.last_commit_date || null;
    const daysAgo = daysBetween(dateValue, options.nowMs);

    if (daysAgo === null) {
      return {
        hasRecency: false,
        daysAgo: null,
        score: null,
        tone: 'neutral',
        stateLabel: 'unavailable',
        label: 'Commit recency unavailable',
        tooltip: 'Commit recency unavailable',
        ariaLabel: 'Commit recency unavailable',
        fillPercent: 0
      };
    }

    const score = clamp(Math.round(100 - (daysAgo * DAYS_PER_SCORE_POINT)), 0, 100);
    const tone = getTone(score);
    const stateLabel = getStateLabel(score);
    const label = formatRecencyLabel(daysAgo);
    const tooltip = `Commit recency: ${label} · ${stateLabel}`;

    return {
      hasRecency: true,
      daysAgo,
      score,
      tone,
      stateLabel,
      label,
      tooltip,
      ariaLabel: `${tooltip} (${score}/100)`,
      fillPercent: score
    };
  }

  function createSvgElement(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function buildCommitRecencyBar(repo, options = {}) {
    if (typeof document === 'undefined') return null;

    const model = computeCommitRecencyModel(repo, options);
    if (!model.hasRecency) return null;

    const wrapper = document.createElement('span');
    wrapper.className = `commit-recency tone-${model.tone}`;
    wrapper.setAttribute('data-tooltip', model.tooltip);

    const svg = createSvgElement('svg');
    svg.classList.add('commit-recency-svg', `tone-${model.tone}`);
    svg.setAttribute('viewBox', '0 0 100 10');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', model.ariaLabel);
    svg.setAttribute('focusable', 'false');

    const title = createSvgElement('title');
    title.textContent = model.tooltip;

    const track = createSvgElement('rect');
    track.classList.add('commit-recency-track');
    track.setAttribute('x', '0');
    track.setAttribute('y', '1.5');
    track.setAttribute('width', '100');
    track.setAttribute('height', '7');
    track.setAttribute('rx', '3.5');
    track.setAttribute('ry', '3.5');

    const fill = createSvgElement('rect');
    fill.classList.add('commit-recency-fill', `tone-${model.tone}`);
    fill.setAttribute('x', '0');
    fill.setAttribute('y', '1.5');
    fill.setAttribute('width', String(model.fillPercent));
    fill.setAttribute('height', '7');
    fill.setAttribute('rx', '3.5');
    fill.setAttribute('ry', '3.5');

    svg.append(title, track, fill);
    wrapper.appendChild(svg);
    return wrapper;
  }

  const api = {
    computeCommitRecencyModel,
    buildCommitRecencyBar,
    getTone
  };

  root.GHD.RepoRecencyBar = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
