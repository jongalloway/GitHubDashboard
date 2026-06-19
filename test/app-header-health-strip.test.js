import { beforeEach, describe, expect, it, vi } from 'vitest';

function createDocumentStub() {
  return {
    querySelector: () => null,
    addEventListener: vi.fn()
  };
}

describe('header health strip model', () => {
  beforeEach(async () => {
    vi.resetModules();
    global.__GHD_TESTING__ = true;
    global.window = { GHD: {} };
    global.document = createDocumentStub();
    await import('../js/app.js');
  });

  it('normalizes summary metrics into non-negative rounded values', () => {
    const { _normalizeSummaryMetric } = window.GHD.__appTest;

    expect(_normalizeSummaryMetric(undefined)).toBe(0);
    expect(_normalizeSummaryMetric(-3)).toBe(0);
    expect(_normalizeSummaryMetric('2.6')).toBe(3);
    expect(_normalizeSummaryMetric(4.2)).toBe(4);
  });

  it('builds an all-clear strip when summary has no pressure signals', () => {
    const { _buildHeaderHealthModel } = window.GHD.__appTest;
    const model = _buildHeaderHealthModel();

    expect(model.total).toBe(0);
    expect(model.srSummary).toBe('All health-strip signals are clear.');
    expect(model.segments).toHaveLength(4);
    expect(model.segments.every((segment) => segment.tone === 'good')).toBe(true);
    expect(model.segments.reduce((total, segment) => total + segment.width, 0)).toBeCloseTo(100, 6);
    expect(model.segments[0].x).toBeCloseTo(0, 6);
    expect(model.segments[1].x).toBeCloseTo(25, 6);
  });

  it('applies warning and critical tones using configured thresholds', () => {
    const { _buildHeaderHealthModel, _getHealthTone } = window.GHD.__appTest;
    const model = _buildHeaderHealthModel({
      ciFailures: 2,
      securityAlerts: 1,
      pendingReviews: 6.6,
      releaseReady: 4
    });

    expect(model.total).toBe(14);
    expect(model.srSummary).toBe('14 total health pressure points.');
    expect(model.segments.map((segment) => segment.tone)).toEqual([
      'critical',
      'warning',
      'critical',
      'critical'
    ]);
    expect(model.segments[2].width).toBeGreaterThan(model.segments[0].width);
    expect(model.segments[0].x).toBeLessThan(model.segments[1].x);

    expect(_getHealthTone({ warningAt: 2, criticalAt: 4 }, 1)).toBe('good');
    expect(_getHealthTone({ warningAt: 2, criticalAt: 4 }, 2)).toBe('warning');
    expect(_getHealthTone({ warningAt: 2, criticalAt: 4 }, 4)).toBe('critical');
  });
});
