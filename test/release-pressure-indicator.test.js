import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

/** Build a minimal repo fixture with release data. */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    full_name: 'owner/test-repo',
    releases: {
      commits_since_latest: 5,
      ...((overrides.releases) || {})
    },
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeReleasePressureModel
// ─────────────────────────────────────────────────────────────────────────────

describe('ReleasePressureIndicator.computeReleasePressureModel', () => {
  let computeReleasePressureModel;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/release-pressure-indicator.js');
    computeReleasePressureModel = window.GHD.ReleasePressureIndicator.computeReleasePressureModel;
  });

  // ── No release data ───────────────────────────────────────

  it('returns hasPressure=false when repo has no releases property', () => {
    const model = computeReleasePressureModel({ name: 'repo' });
    expect(model.hasPressure).toBe(false);
  });

  it('returns hasPressure=false when releases.commits_since_latest is missing', () => {
    const model = computeReleasePressureModel({ releases: {} });
    expect(model.hasPressure).toBe(false);
  });

  it('returns hasPressure=false when releases.commits_since_latest is NaN', () => {
    const model = computeReleasePressureModel({ releases: { commits_since_latest: NaN } });
    expect(model.hasPressure).toBe(false);
  });

  it('returns hasPressure=false when repo is null', () => {
    const model = computeReleasePressureModel(null);
    expect(model.hasPressure).toBe(false);
  });

  // ── Zero commits ──────────────────────────────────────────

  it('returns hasPressure=true with tone good when commits_since_latest=0', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 0 } }));
    expect(model.hasPressure).toBe(true);
    expect(model.commits).toBe(0);
    expect(model.percent).toBe(0);
    expect(model.tone).toBe('good');
  });

  // ── Tone boundaries (default threshold = 10) ──────────────

  it('tone=good when commits < 33% of threshold (e.g. 3 of 10 → 30%)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 3 } }));
    expect(model.tone).toBe('good');
    expect(model.percent).toBe(30);
  });

  it('tone=warning at 33% boundary (e.g. 4 of 10 → 40%)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 4 } }));
    expect(model.tone).toBe('warning');
    expect(model.percent).toBe(40);
  });

  it('tone=warning at mid range (e.g. 6 of 10 → 60%)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 6 } }));
    expect(model.tone).toBe('warning');
    expect(model.percent).toBe(60);
  });

  it('tone=critical at 66% boundary (e.g. 7 of 10 → 70%)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 7 } }));
    expect(model.tone).toBe('critical');
    expect(model.percent).toBe(70);
  });

  it('tone=critical at threshold (10 of 10 → 100%)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 10 } }));
    expect(model.tone).toBe('critical');
    expect(model.percent).toBe(100);
  });

  // ── Percent clamping at/above threshold ───────────────────

  it('clamps percent at 100 when commits exceed threshold (15 of 10)', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 15 } }));
    expect(model.percent).toBe(100);
    expect(model.commits).toBe(15);
    expect(model.tone).toBe('critical');
  });

  it('clamps percent at 100 for very large commit counts', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 999 } }));
    expect(model.percent).toBe(100);
  });

  // ── Threshold override ────────────────────────────────────

  it('respects custom threshold via options.threshold', () => {
    const model = computeReleasePressureModel(
      makeRepo({ releases: { commits_since_latest: 5 } }),
      { threshold: 20 }
    );
    expect(model.threshold).toBe(20);
    expect(model.percent).toBe(25); // 5/20 * 100 = 25
    expect(model.tone).toBe('good');
  });

  it('threshold override changes tone from good to critical', () => {
    // 5 commits, threshold=5 → 100% → critical
    const model = computeReleasePressureModel(
      makeRepo({ releases: { commits_since_latest: 5 } }),
      { threshold: 5 }
    );
    expect(model.percent).toBe(100);
    expect(model.tone).toBe('critical');
  });

  // ── Model shape ───────────────────────────────────────────

  it('returned model includes expected fields', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 5 } }));
    expect(model).toMatchObject({
      hasPressure: true,
      commits: 5,
      threshold: 10,
      percent: 50,
      tone: 'warning',
      stateLabel: 'moderate',
      label: '5 commits since release'
    });
    expect(typeof model.tooltip).toBe('string');
    expect(typeof model.ariaLabel).toBe('string');
    expect(model.tooltip).toContain('5 commits since release');
    expect(model.ariaLabel).toContain('50%');
  });

  it('label is singular for 1 commit', () => {
    const model = computeReleasePressureModel(makeRepo({ releases: { commits_since_latest: 1 } }));
    expect(model.label).toBe('1 commit since release');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildReleasePressureIndicator (DOM — node environment returns null)
// ─────────────────────────────────────────────────────────────────────────────

describe('ReleasePressureIndicator.buildReleasePressureIndicator (no DOM)', () => {
  let buildReleasePressureIndicator;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/release-pressure-indicator.js');
    buildReleasePressureIndicator = window.GHD.ReleasePressureIndicator.buildReleasePressureIndicator;
  });

  it('returns null when document is not available', () => {
    // In the vitest node environment document is not defined
    const result = buildReleasePressureIndicator(makeRepo());
    expect(result).toBeNull();
  });

  it('returns null when repo has no release data', () => {
    const result = buildReleasePressureIndicator({ name: 'no-releases' });
    expect(result).toBeNull();
  });
});
