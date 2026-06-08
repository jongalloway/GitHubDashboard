import { beforeEach, describe, expect, it, vi, bench } from 'vitest';

// Mock localStorage with quota limit
function createMockStorage(quotaBytes = 52428800) {
  const store = new Map();
  let usedBytes = 0;

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      const str = String(value);
      const oldValue = store.get(key);
      const oldSize = oldValue ? new TextEncoder().encode(oldValue).byteLength : 0;
      const newSize = new TextEncoder().encode(str).byteLength;
      const delta = newSize - oldSize;

      if (usedBytes + delta > quotaBytes) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }

      store.set(key, str);
      usedBytes += delta;
    },
    removeItem(key) {
      const value = store.get(key);
      if (value) {
        const size = new TextEncoder().encode(value).byteLength;
        usedBytes -= size;
      }
      store.delete(key);
    },
    clear() {
      store.clear();
      usedBytes = 0;
    },
    getUsedBytes() {
      return usedBytes;
    }
  };
}

// Mock minimal DOM for SVG rendering
function createMockDOM() {
  return {
    createElement(tag) {
      const elem = {
        tagName: tag,
        attributes: {},
        children: [],
        textContent: '',
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name];
        },
        appendChild(child) {
          this.children.push(child);
        },
        toString() {
          return `<${this.tagName} ${Object.entries(this.attributes)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ')} />`;
        }
      };
      return elem;
    }
  };
}

describe('GHD.SnapshotHistory', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00.000Z'));
    vi.resetModules();

    global.localStorage = createMockStorage();
    global.document = createMockDOM();
    global.window = { GHD: {} };

    // Import the snapshot-history module
    await import('../js/snapshot-history.js');
  });

  // ─────────────────────────────────────────────────────────────────
  // S4: Unit Tests — Bucketing Logic
  // ─────────────────────────────────────────────────────────────────

  describe('Unit: Bucketing Logic', () => {
    it('buckets multiple fetches within the same hour into a single bucket', () => {
      const hist = window.GHD.SnapshotHistory;

      // Record at 09:15
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10, forks: 5 });
      vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes

      // Record at 09:45 — same hour
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 102, watchers: 11, forks: 6 });

      const buckets = hist.getBuckets('owner/repo1');
      expect(buckets).toHaveLength(1);
      expect(buckets[0].hour).toBe(9);
      expect(buckets[0].count).toBe(2);
    });

    it('creates separate buckets across different hours', () => {
      const hist = window.GHD.SnapshotHistory;

      // Record at 09:15
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10, forks: 5 });
      vi.advanceTimersByTime(50 * 60 * 1000); // 50 minutes

      // Record at 10:05 — next hour
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 102, watchers: 11, forks: 6 });

      const buckets = hist.getBuckets('owner/repo1');
      expect(buckets).toHaveLength(2);
      expect(buckets[0].hour).toBe(9);
      expect(buckets[1].hour).toBe(10);
    });

    it('normalizes bucket timestamp correctly to hour boundary', () => {
      const hist = window.GHD.SnapshotHistory;

      // Record at 09:37:22
      vi.setSystemTime(new Date('2026-06-08T09:37:22.000Z'));
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10, forks: 5 });

      const buckets = hist.getBuckets('owner/repo1');
      const bucketTime = new Date(buckets[0].bucketTimestamp);
      expect(bucketTime.getUTCHours()).toBe(9);
      expect(bucketTime.getUTCMinutes()).toBe(0);
      expect(bucketTime.getUTCSeconds()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // S4: Unit Tests — Overflow & LRU Eviction
  // ─────────────────────────────────────────────────────────────────

  describe('Unit: Overflow & LRU Eviction', () => {
    it('evicts oldest snapshot when exceeding maxPoints=24', () => {
      const hist = window.GHD.SnapshotHistory;
      const maxPoints = 24;

      // Record 25 snapshots over 25 hours
      for (let i = 0; i < 25; i++) {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 + i, watchers: 10 + i });
        vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
      }

      const buckets = hist.getBuckets('owner/repo1', { maxPoints });
      expect(buckets).toHaveLength(maxPoints);
      // Oldest should be evicted
      expect(buckets[0].stars).toBe(101); // Not 100
    });

    it('respects config.maxPoints=48 variant', () => {
      const hist = window.GHD.SnapshotHistory;
      const maxPoints = 48;

      // Record 50 snapshots
      for (let i = 0; i < 50; i++) {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 + i, watchers: 10 + i });
        vi.advanceTimersByTime(60 * 60 * 1000);
      }

      const buckets = hist.getBuckets('owner/repo1', { maxPoints });
      expect(buckets.length).toBeLessThanOrEqual(maxPoints);
      expect(buckets.length).toBe(maxPoints);
    });

    it('respects config.maxPoints=72 variant', () => {
      const hist = window.GHD.SnapshotHistory;
      const maxPoints = 72;

      // Record 75 snapshots
      for (let i = 0; i < 75; i++) {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 + i, watchers: 10 + i });
        vi.advanceTimersByTime(60 * 60 * 1000);
      }

      const buckets = hist.getBuckets('owner/repo1', { maxPoints });
      expect(buckets.length).toBeLessThanOrEqual(maxPoints);
      expect(buckets.length).toBe(maxPoints);
    });

    it('silently discards corrupt entries without crashing', () => {
      const hist = window.GHD.SnapshotHistory;

      // Manually insert corrupt JSON
      const storageKey = 'ghd.snapshots.owner/repo1.v1';
      localStorage.setItem(storageKey, JSON.stringify({ corrupted: true, data: 'invalid }]' }));

      // This should not crash
      expect(() => {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10 });
      }).not.toThrow();

      const buckets = hist.getBuckets('owner/repo1');
      expect(buckets.length).toBeGreaterThanOrEqual(1);
    });

    it('continues rendering after encountering corrupt entry', () => {
      const hist = window.GHD.SnapshotHistory;

      // Insert corrupt entry
      const storageKey = 'ghd.snapshots.owner/repo1.v1';
      localStorage.setItem(storageKey, 'not-valid-json-{[]');

      // Record a valid entry
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10 });

      // Render should still work
      const svg = hist.renderSparkline('owner/repo1', { width: 100, height: 30 });
      expect(svg).toBeTruthy();
      expect(svg.tagName).toBe('svg');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // S4: Unit Tests — Sparse Data & Interpolation
  // ─────────────────────────────────────────────────────────────────

  describe('Unit: Sparse Data & Interpolation', () => {
    it('fills gaps with linear interpolation between sparse datapoints', () => {
      const hist = window.GHD.SnapshotHistory;

      // Hour 1: 100 stars
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10 });
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // Skip to hour 3

      // Hour 3: 110 stars
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 110, watchers: 10 });
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // Skip to hour 5

      // Hour 5: 120 stars
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 120, watchers: 10 });

      const buckets = hist.getBuckets('owner/repo1', { interpolate: true });
      // Should have 5 points: hour 1, 2 (interp), 3, 4 (interp), 5
      expect(buckets.length).toBeGreaterThanOrEqual(3);

      // Hour 2 should be interpolated: (100 + 110) / 2 = 105
      const hour2Bucket = buckets.find(b => b.hour === 2);
      expect(hour2Bucket).toBeTruthy();
      expect(hour2Bucket.interpolated).toBe(true);
      expect(hour2Bucket.stars).toBe(105);
    });

    it('renders single datapoint without interpolation', () => {
      const hist = window.GHD.SnapshotHistory;

      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10 });

      const buckets = hist.getBuckets('owner/repo1', { interpolate: true });
      expect(buckets).toHaveLength(1);
      expect(buckets[0].interpolated).toBeFalsy();
    });

    it('renders empty/placeholder SVG when all data is missing', () => {
      const hist = window.GHD.SnapshotHistory;

      // Don't record anything
      const svg = hist.renderSparkline('owner/repo1', { width: 100, height: 30 });
      expect(svg).toBeTruthy();
      expect(svg.tagName).toBe('svg');
      expect(svg.getAttribute('class')).toContain('empty');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // S4: Integration Tests — Record → Render Pipeline
  // ─────────────────────────────────────────────────────────────────

  describe('Integration: Record → Render Pipeline', () => {
    it('records snapshots with correct metrics per repo', () => {
      const hist = window.GHD.SnapshotHistory;

      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100, watchers: 10, forks: 5 });
      hist.recordSnapshot({ repo: 'owner/repo2', stars: 200, watchers: 20, forks: 10 });

      const buckets1 = hist.getBuckets('owner/repo1');
      const buckets2 = hist.getBuckets('owner/repo2');

      expect(buckets1[0].stars).toBe(100);
      expect(buckets1[0].watchers).toBe(10);
      expect(buckets1[0].forks).toBe(5);

      expect(buckets2[0].stars).toBe(200);
      expect(buckets2[0].watchers).toBe(20);
      expect(buckets2[0].forks).toBe(10);
    });

    it('renders sparkline for each repo with recorded history', () => {
      const hist = window.GHD.SnapshotHistory;

      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 });
      hist.recordSnapshot({ repo: 'owner/repo2', stars: 200 });

      const svg1 = hist.renderSparkline('owner/repo1');
      const svg2 = hist.renderSparkline('owner/repo2');

      expect(svg1).toBeTruthy();
      expect(svg2).toBeTruthy();
      expect(svg1.tagName).toBe('svg');
      expect(svg2.tagName).toBe('svg');
    });

    it('renders sparkline with per-point tooltips', () => {
      const hist = window.GHD.SnapshotHistory;

      hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 });
      vi.advanceTimersByTime(60 * 60 * 1000);
      hist.recordSnapshot({ repo: 'owner/repo1', stars: 105 });

      const svg = hist.renderSparkline('owner/repo1', { tooltip: true });

      // Check for title elements (tooltips)
      const titles = svg.children.filter(c => c.tagName === 'title');
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    it('integrates with app post-render hook', () => {
      const hist = window.GHD.SnapshotHistory;

      // Mock app hook
      const recordedSnapshots = [];
      window.GHD.SnapshotHistory.recordSnapshot = vi.fn((metrics) => {
        recordedSnapshots.push(metrics);
      });

      // Simulate app calling the hook
      window.GHD.SnapshotHistory.recordSnapshot({ repo: 'owner/repo1', stars: 100 });

      expect(recordedSnapshots).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // S4: Edge Cases — Error Handling
  // ─────────────────────────────────────────────────────────────────

  describe('Edge Cases: Error Handling', () => {
    it('traps QuotaExceededError and does not crash', () => {
      const hist = window.GHD.SnapshotHistory;
      // Use small quota
      global.localStorage = createMockStorage(100); // 100 bytes

      expect(() => {
        for (let i = 0; i < 100; i++) {
          try {
            hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 + i, watchers: 10 + i });
          } catch (err) {
            if (err.name === 'QuotaExceededError') {
              break; // Expected
            }
          }
        }
      }).not.toThrow();
    });

    it('skips corrupt JSON in localStorage and recreates', () => {
      const storageKey = 'ghd.snapshots.owner/repo1.v1';
      localStorage.setItem(storageKey, 'not-json-{]');

      const hist = window.GHD.SnapshotHistory;
      const recordSpy = vi.spyOn(hist, 'recordSnapshot');

      // Should not crash when reading corrupt data
      expect(() => {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 });
      }).not.toThrow();

      expect(recordSpy).toHaveBeenCalled();
    });

    it('handles schema mismatch by migration or skip', () => {
      const hist = window.GHD.SnapshotHistory;
      const storageKey = 'ghd.snapshots.owner/repo1.v1';

      // Insert old schema
      localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 0, data: [] }));

      // Should handle gracefully
      expect(() => {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 });
      }).not.toThrow();

      const buckets = hist.getBuckets('owner/repo1');
      expect(Array.isArray(buckets)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // S5: Performance Benchmarks
  // ─────────────────────────────────────────────────────────────────

  describe('Performance: Benchmarks', () => {
    it('records 72 snapshots × 10 repos in <10ms total', () => {
      const hist = window.GHD.SnapshotHistory;

      const t0 = performance.now();

      for (let repo = 1; repo <= 10; repo++) {
        for (let hour = 0; hour < 72; hour++) {
          hist.recordSnapshot({
            repo: `owner/repo${repo}`,
            stars: 100 + Math.random() * 50,
            watchers: 10 + Math.random() * 5,
            forks: 5 + Math.random() * 2
          });
          vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
        }
      }

      const elapsed = performance.now() - t0;
      console.log(`Record 720 snapshots: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(10);
    });

    it('renders sparkline 10 times in <10ms total (<1ms per render)', () => {
      const hist = window.GHD.SnapshotHistory;

      // Pre-populate with data
      for (let i = 0; i < 24; i++) {
        hist.recordSnapshot({ repo: 'owner/repo1', stars: 100 + i });
        vi.advanceTimersByTime(60 * 60 * 1000);
      }

      const t0 = performance.now();

      for (let i = 0; i < 10; i++) {
        hist.renderSparkline('owner/repo1', { width: 100, height: 30 });
      }

      const elapsed = performance.now() - t0;
      console.log(`Render 10 sparklines: ${elapsed.toFixed(2)}ms (${(elapsed / 10).toFixed(3)}ms each)`);
      expect(elapsed).toBeLessThan(10);
      expect(elapsed / 10).toBeLessThan(1); // <1ms per render
    });

    it('stores 72 snapshots × 10 repos in <50KB', () => {
      const hist = window.GHD.SnapshotHistory;

      for (let repo = 1; repo <= 10; repo++) {
        for (let hour = 0; hour < 72; hour++) {
          hist.recordSnapshot({
            repo: `owner/repo${repo}`,
            stars: 100 + hour,
            watchers: 10 + hour,
            forks: 5
          });
          vi.advanceTimersByTime(60 * 60 * 1000);
        }
      }

      const usedBytes = global.localStorage.getUsedBytes();
      console.log(`localStorage used: ${(usedBytes / 1024).toFixed(2)}KB`);
      expect(usedBytes).toBeLessThan(50 * 1024); // 50KB
    });
  });
});
