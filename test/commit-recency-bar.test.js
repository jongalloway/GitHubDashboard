import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const recencyModule = require('../js/repo-recency-bar.js');
const currentDir = path.dirname(fileURLToPath(import.meta.url));

const RECENCY_VALIDATION_CASES = [
  {
    name: 'fresh commit should be marked good',
    repo: { last_commit_date: '2026-06-07T00:00:00.000Z' },
    expectedTone: 'good',
    expectedState: 'fresh',
    expectedLabel: '1 day ago'
  },
  {
    name: 'moderately old commit should be marked warning',
    repo: { last_commit_date: '2026-05-20T00:00:00.000Z' },
    expectedTone: 'warning',
    expectedState: 'steady',
    expectedLabel: '19 days ago'
  },
  {
    name: 'stale commit should be marked critical',
    repo: { last_commit_date: '2026-03-20T00:00:00.000Z' },
    expectedTone: 'critical',
    expectedState: 'stale',
    expectedLabel: '80 days ago'
  }
];

function createBaselineRepo(overrides = {}) {
  return {
    last_commit_date: '2026-06-07T00:00:00.000Z',
    ...overrides
  };
}

function parseHex(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function blendOverBackground([r, g, b, alpha], [bgR, bgG, bgB]) {
  const blend = (channel, bgChannel) => Math.round((channel * alpha) + (bgChannel * (1 - alpha)));
  return [blend(r, bgR), blend(g, bgG), blend(b, bgB)];
}

function relativeLuminance([r, g, b]) {
  const convert = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (0.2126 * convert(r)) + (0.7152 * convert(g)) + (0.0722 * convert(b));
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('commit recency bar model', () => {
  it('defines concrete test vectors for issue #29 handoff', () => {
    expect(RECENCY_VALIDATION_CASES).toHaveLength(3);
    expect(RECENCY_VALIDATION_CASES.map((item) => item.name)).toEqual([
      'fresh commit should be marked good',
      'moderately old commit should be marked warning',
      'stale commit should be marked critical'
    ]);
  });

  for (const testCase of RECENCY_VALIDATION_CASES) {
    it(testCase.name, () => {
      const model = recencyModule.computeCommitRecencyModel(
        createBaselineRepo(testCase.repo),
        { nowMs: Date.parse('2026-06-08T00:00:00.000Z') }
      );

      expect(model.hasRecency).toBe(true);
      expect(model.tone).toBe(testCase.expectedTone);
      expect(model.stateLabel).toBe(testCase.expectedState);
      expect(model.label).toBe(testCase.expectedLabel);
      expect(model.tooltip).toContain(testCase.expectedLabel);
      expect(model.ariaLabel).toContain('Commit recency');
      expect(model.fillPercent).toBeGreaterThanOrEqual(0);
      expect(model.fillPercent).toBeLessThanOrEqual(100);
    });
  }

  it('returns a neutral fallback when last commit date is missing or invalid', () => {
    expect(recencyModule.computeCommitRecencyModel({}, { nowMs: Date.now() })).toEqual(
      expect.objectContaining({
        hasRecency: false,
        tone: 'neutral',
        score: null
      })
    );

    expect(recencyModule.computeCommitRecencyModel(
      createBaselineRepo({ last_commit_date: 'not-a-date' }),
      { nowMs: Date.now() }
    )).toEqual(expect.objectContaining({
      hasRecency: false,
      tone: 'neutral',
      score: null
    }));
  });

  it('keeps tone thresholds stable at boundary values', () => {
    expect(recencyModule.getTone(100)).toBe('good');
    expect(recencyModule.getTone(80)).toBe('good');
    expect(recencyModule.getTone(79)).toBe('warning');
    expect(recencyModule.getTone(55)).toBe('warning');
    expect(recencyModule.getTone(54)).toBe('critical');
    expect(recencyModule.getTone(0)).toBe('critical');
  });
});

describe('commit recency bar color/accessibility expectations', () => {
  it('keeps tone CSS mapping and non-text contrast at or above 3:1 against the meter track', () => {
    const cssPath = path.resolve(currentDir, '..', 'css', 'style.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('--meter-good:');
    expect(css).toContain('--meter-warning:');
    expect(css).toContain('--meter-critical:');
    expect(css).toContain('.commit-recency-fill.tone-good');
    expect(css).toContain('.commit-recency-fill.tone-warning');
    expect(css).toContain('.commit-recency-fill.tone-critical');

    const darkTrack = blendOverBackground([148, 163, 184, 0.18], parseHex('#07111f'));
    const lightTrack = blendOverBackground([96, 110, 128, 0.16], parseHex('#f8fafc'));

    const darkRatios = [
      contrastRatio(parseHex('#34d399'), darkTrack),
      contrastRatio(parseHex('#f59e0b'), darkTrack),
      contrastRatio(parseHex('#f97316'), darkTrack)
    ];

    const lightRatios = [
      contrastRatio(parseHex('#047857'), lightTrack),
      contrastRatio(parseHex('#b45309'), lightTrack),
      contrastRatio(parseHex('#c2410c'), lightTrack)
    ];

    [...darkRatios, ...lightRatios].forEach((ratio) => {
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });
});
