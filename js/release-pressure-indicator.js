(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GHD = root.GHD || {};

  const DEFAULT_THRESHOLD = 10;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getPressureTone(percent) {
    if (percent < 33) return 'good';
    if (percent < 66) return 'warning';
    return 'critical';
  }

  function getPressureStateLabel(percent) {
    if (percent < 33) return 'low';
    if (percent < 66) return 'moderate';
    return 'high';
  }

  function computeReleasePressureModel(repo, options = {}) {
    const threshold = options.threshold != null ? options.threshold : DEFAULT_THRESHOLD;
    const releases = repo?.releases;

    if (
      !releases ||
      typeof releases.commits_since_latest !== 'number' ||
      !Number.isFinite(releases.commits_since_latest)
    ) {
      return {
        hasPressure: false,
        commits: null,
        threshold,
        percent: 0,
        tone: 'neutral',
        stateLabel: 'unavailable',
        label: 'Release pressure unavailable',
        tooltip: 'Release pressure unavailable',
        ariaLabel: 'Release pressure unavailable'
      };
    }

    const commits = releases.commits_since_latest;
    const rawPercent = threshold > 0 ? (commits / threshold) * 100 : 100;
    const percent = clamp(Math.round(rawPercent), 0, 100);
    const tone = getPressureTone(percent);
    const stateLabel = getPressureStateLabel(percent);
    const label = commits === 1 ? '1 commit since release' : `${commits} commits since release`;
    const tooltip = `Release pressure: ${label} · ${stateLabel} (threshold: ${threshold})`;

    return {
      hasPressure: true,
      commits,
      threshold,
      percent,
      tone,
      stateLabel,
      label,
      tooltip,
      ariaLabel: `${tooltip} (${percent}%)`
    };
  }

  function createSvgElement(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function buildReleasePressureIndicator(repo, options = {}) {
    if (typeof document === 'undefined') return null;

    const model = computeReleasePressureModel(repo, options);
    if (!model.hasPressure) return null;

    const wrapper = document.createElement('span');
    wrapper.className = `release-pressure tone-${model.tone}`;
    wrapper.setAttribute('data-tooltip', model.tooltip);

    const svg = createSvgElement('svg');
    svg.classList.add('release-pressure-svg', `tone-${model.tone}`);
    svg.setAttribute('viewBox', '0 0 100 10');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', model.ariaLabel);
    svg.setAttribute('focusable', 'false');

    const title = createSvgElement('title');
    title.textContent = model.tooltip;

    const track = createSvgElement('rect');
    track.classList.add('release-pressure-track');
    track.setAttribute('x', '0');
    track.setAttribute('y', '1.5');
    track.setAttribute('width', '100');
    track.setAttribute('height', '7');
    track.setAttribute('rx', '3.5');
    track.setAttribute('ry', '3.5');

    const fill = createSvgElement('rect');
    fill.classList.add('release-pressure-fill', `tone-${model.tone}`);
    fill.setAttribute('x', '0');
    fill.setAttribute('y', '1.5');
    fill.setAttribute('width', String(model.percent));
    fill.setAttribute('height', '7');
    fill.setAttribute('rx', '3.5');
    fill.setAttribute('ry', '3.5');

    svg.append(title, track, fill);
    wrapper.appendChild(svg);
    return wrapper;
  }

  const api = {
    computeReleasePressureModel,
    buildReleasePressureIndicator,
    getPressureTone
  };

  root.GHD.ReleasePressureIndicator = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
