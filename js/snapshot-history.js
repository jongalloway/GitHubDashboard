(() => {
  const STORAGE_KEY_PREFIX = 'ghd.snapshots.';
  const STORAGE_VERSION_SUFFIX = '.v1';
  const DEFAULT_MAX_POINTS = 24;
  const STORAGE_MAX_POINTS = 72;
  const HOUR_MS = 60 * 60 * 1000;

  function getStorageKey(repoName) {
    return `${STORAGE_KEY_PREFIX}${repoName}${STORAGE_VERSION_SUFFIX}`;
  }

  function clampMaxPoints(value) {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_POINTS;
    return Math.min(Math.floor(value), STORAGE_MAX_POINTS);
  }

  function toHourBucket(timestamp) {
    return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
  }

  function getCurrentHourBucket() {
    return toHourBucket(Date.now());
  }

  function parseStorageData(jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch (_) {
      return null;
    }
  }

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function normalizeSnapshot(entry) {
    if (Array.isArray(entry)) {
      const timestamp = toHourBucket(toNumber(entry[0], NaN));
      if (!Number.isFinite(timestamp)) return null;
      return {
        timestamp,
        stars: toNumber(entry[1], 0),
        watchers: toNumber(entry[2], 0),
        forks: toNumber(entry[3], 0),
        count: Math.max(1, Math.floor(toNumber(entry[4], 1)))
      };
    }

    if (!entry || typeof entry !== 'object') return null;

    const rawTimestamp = toNumber(entry.timestamp ?? entry.bucketTimestamp, NaN);
    const timestamp = toHourBucket(rawTimestamp);
    if (!Number.isFinite(timestamp)) return null;

    return {
      timestamp,
      stars: toNumber(entry.stars, 0),
      watchers: toNumber(entry.watchers, 0),
      forks: toNumber(entry.forks, 0),
      count: Math.max(1, Math.floor(toNumber(entry.count, 1)))
    };
  }

  function loadSnapshots(repoName) {
    if (typeof localStorage === 'undefined') return [];
    const stored = localStorage.getItem(getStorageKey(repoName));
    if (!stored) return [];

    const parsed = parseStorageData(stored);
    if (!parsed) return [];

    const rawSnapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots
      : Array.isArray(parsed.s) ? parsed.s
        : [];

    if (rawSnapshots.length === 0) return [];

    const snapshots = rawSnapshots
      .map(normalizeSnapshot)
      .filter(Boolean)
      .sort((left, right) => left.timestamp - right.timestamp);

    if (snapshots.length < 2) return snapshots;

    const deduped = [];
    snapshots.forEach((snapshot) => {
      const last = deduped[deduped.length - 1];
      if (last && last.timestamp === snapshot.timestamp) {
        deduped[deduped.length - 1] = snapshot;
      } else {
        deduped.push(snapshot);
      }
    });

    return deduped;
  }

  function saveSnapshots(repoName, snapshots) {
    if (typeof localStorage === 'undefined') return;
    const compact = snapshots.map((snapshot) => [
      snapshot.timestamp,
      Math.round(snapshot.stars),
      Math.round(snapshot.watchers),
      Math.round(snapshot.forks),
      Math.max(1, Math.floor(snapshot.count))
    ]);

    localStorage.setItem(getStorageKey(repoName), JSON.stringify({ v: 1, s: compact }));
  }

  function toPublicBucket(snapshot) {
    const date = new Date(snapshot.timestamp);
    return {
      timestamp: snapshot.timestamp,
      bucketTimestamp: snapshot.timestamp,
      hour: date.getUTCHours(),
      stars: snapshot.stars,
      watchers: snapshot.watchers,
      forks: snapshot.forks,
      count: snapshot.count,
      interpolated: false
    };
  }

  function interpolateBuckets(buckets) {
    if (buckets.length <= 1) return buckets;

    const result = [];

    for (let i = 0; i < buckets.length - 1; i += 1) {
      const current = buckets[i];
      const next = buckets[i + 1];
      result.push(current);

      const gapHours = Math.floor((next.bucketTimestamp - current.bucketTimestamp) / HOUR_MS);
      if (gapHours <= 1) continue;

      for (let step = 1; step < gapHours; step += 1) {
        const ratio = step / gapHours;
        const bucketTimestamp = current.bucketTimestamp + step * HOUR_MS;
        result.push({
          timestamp: bucketTimestamp,
          bucketTimestamp,
          hour: new Date(bucketTimestamp).getUTCHours(),
          stars: Math.round(current.stars + (next.stars - current.stars) * ratio),
          watchers: Math.round(current.watchers + (next.watchers - current.watchers) * ratio),
          forks: Math.round(current.forks + (next.forks - current.forks) * ratio),
          count: 1,
          interpolated: true
        });
      }
    }

    result.push(buckets[buckets.length - 1]);
    return result;
  }

  function getBuckets(repoName, options = {}) {
    const { maxPoints = DEFAULT_MAX_POINTS, interpolate = false } = options;
    const max = clampMaxPoints(maxPoints);

    try {
      const snapshots = loadSnapshots(repoName);
      if (snapshots.length === 0) return [];

      let buckets = snapshots.map(toPublicBucket);
      if (buckets.length > max) {
        buckets = buckets.slice(buckets.length - max);
      }

      if (!interpolate) return buckets;

      const interpolated = interpolateBuckets(buckets);
      return interpolated.length > max ? interpolated.slice(interpolated.length - max) : interpolated;
    } catch (_) {
      return [];
    }
  }

  function recordSnapshot(metrics) {
    try {
      if (!metrics || typeof metrics !== 'object' || !metrics.repo) return;

      const repoName = metrics.repo;
      const hourBucket = getCurrentHourBucket();
      const snapshots = loadSnapshots(repoName);
      const existingIdx = snapshots.findIndex((snapshot) => snapshot.timestamp === hourBucket);
      const snapshot = {
        timestamp: hourBucket,
        stars: toNumber(metrics.stars, 0),
        watchers: toNumber(metrics.watchers, 0),
        forks: toNumber(metrics.forks, 0),
        count: existingIdx >= 0 ? Math.max(1, snapshots[existingIdx].count) + 1 : 1
      };

      if (existingIdx >= 0) {
        snapshots[existingIdx] = snapshot;
      } else {
        snapshots.push(snapshot);
        snapshots.sort((left, right) => left.timestamp - right.timestamp);
      }

      const trimmed = snapshots.length > STORAGE_MAX_POINTS
        ? snapshots.slice(snapshots.length - STORAGE_MAX_POINTS)
        : snapshots;

      saveSnapshots(repoName, trimmed);
    } catch (_) {}
  }

  function renderSparkline(repoName, options = {}) {
    const {
      width = 100,
      height = 30,
      tooltip = true,
      maxPoints = DEFAULT_MAX_POINTS,
      interpolate = false
    } = options;
    const buckets = getBuckets(repoName, { maxPoints, interpolate });

    const svg = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Sparkline for ${repoName}`);

    if (buckets.length === 0) {
      svg.setAttribute('class', 'sparkline empty');
      const text = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'text') : document.createElement('text');
      text.setAttribute('x', width / 2);
      text.setAttribute('y', height / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', 'var(--text-secondary, #666)');
      text.textContent = 'No data';
      svg.appendChild(text);
      return svg;
    }

    svg.setAttribute('class', 'sparkline');

    const padding = 2;
    const innerWidth = width - 2 * padding;
    const innerHeight = height - 2 * padding;

    // Calculate min/max for scaling
    const values = buckets.map(b => b.stars || 0);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const range = Math.max(maxValue - minValue, 1);

    // Generate points for polyline
    const points = buckets.map((bucket, idx) => {
      const x = padding + (idx / Math.max(buckets.length - 1, 1)) * innerWidth;
      const y = padding + innerHeight - ((bucket.stars - minValue) / range) * innerHeight;
      return { x, y, bucket };
    });

    const polyline = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'polyline') : document.createElement('polyline');
    polyline.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('stroke', 'var(--accent-color, #0969da)');
    polyline.setAttribute('stroke-width', '1.5');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);

    if (tooltip) {
      points.forEach(({ bucket }) => {
        const title = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'title') : document.createElement('title');
        const date = new Date(bucket.bucketTimestamp);
        const timeStr = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        }).format(date);
        title.textContent = `${timeStr}: ${bucket.stars} stars`;
        svg.appendChild(title);
      });
    }

    points.forEach(({ x, y }) => {
      const circle = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'circle') : document.createElement('circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', '2');
      circle.setAttribute('fill', 'var(--accent-color, #0969da)');
      circle.setAttribute('class', 'sparkline-point');
      svg.appendChild(circle);
    });

    return svg;
  }

  // Expose public API on window
  if (!window.GHD) window.GHD = {};
  window.GHD.SnapshotHistory = {
    recordSnapshot,
    getBuckets,
    renderSparkline
  };
})();
