import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

// Fixed reference timestamp: 2026-06-28T05:03:35.578Z (matches kanban-strip.test.js)
const NOW = new Date('2026-06-28T05:03:35.578Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a minimal repo fixture. Default: 5 days ago (Working lane). */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    full_name: 'owner/test-repo',
    html_url: 'https://github.com/owner/test-repo',
    pushed_at: new Date(NOW - 5 * DAY_MS).toISOString(),
    last_commit_date: null,
    workflow_status: { has_workflows: false, latest_run: null },
    security_alerts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
    pending_reviews: { count: 0, items: [] },
    ...overrides
  };
}

// ── Minimal DOM stub for _buildDetailPanel + renderLaneChips tests ──────────

function setupMockDOM() {
  class MockEl {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.type = '';
      this.innerHTML = '';
      this.textContent = '';
      this.children = [];
      this._attrs = {};
      this._events = {};
      this.dataset = {};
      this.hidden = false;
      this.parentNode = null;
    }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return this._attrs[k] ?? null; }
    addEventListener(type, fn) {
      if (!this._events[type]) this._events[type] = [];
      this._events[type].push(fn);
    }
    appendChild(child) {
      if (child) {
        child.parentNode = this;
        this.children.push(child);
      }
      return child;
    }
    querySelector(sel) {
      // Supports '.class-name' selector only — sufficient for our tests
      const m = sel.match(/^\.([\w-]+)$/);
      if (!m) return null;
      return this._findByClass(m[1]);
    }
    _findByClass(cls) {
      for (const c of this.children) {
        if (typeof c.className === 'string' && c.className.split(' ').includes(cls)) return c;
        const found = c._findByClass && c._findByClass(cls);
        if (found) return found;
      }
      return null;
    }
    insertBefore(newNode, refNode) {
      if (newNode) {
        newNode.parentNode = this;
        const idx = this.children.indexOf(refNode);
        if (idx >= 0) this.children.splice(idx, 0, newNode);
        else this.children.push(newNode);
      }
      return newNode;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    scrollIntoView() {}
  }

  const mockDoc = {
    createElement: (tag) => new MockEl(tag),
    addEventListener: () => {},
    querySelectorAll: () => []
  };

  globalThis.document = mockDoc;
  return MockEl;
}

// ────────────────────────────────────────────────────────────────────────────
// deriveLanePlacementReasons
// ────────────────────────────────────────────────────────────────────────────

describe('KanbanLaneChips.deriveLanePlacementReasons — blocked lane', () => {
  let deriveLanePlacementReasons;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    setupMockDOM();
    loadBrowserScript('js/kanban-lane-chips.js');
    deriveLanePlacementReasons = window.GHD.KanbanLaneChips.deriveLanePlacementReasons;
  });

  it('returns "CI failing on main" when CI has failure conclusion', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } }
    });
    const reasons = deriveLanePlacementReasons(repo, 'blocked', NOW);
    expect(reasons).toContain('CI failing on main');
  });

  it('returns CI reason for timed_out conclusion', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'timed_out' } }
    });
    expect(deriveLanePlacementReasons(repo, 'blocked', NOW)).toContain('CI failing on main');
  });

  it('returns CI reason for startup_failure conclusion', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'startup_failure' } }
    });
    expect(deriveLanePlacementReasons(repo, 'blocked', NOW)).toContain('CI failing on main');
  });

  it('returns CI reason for action_required conclusion', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'action_required' } }
    });
    expect(deriveLanePlacementReasons(repo, 'blocked', NOW)).toContain('CI failing on main');
  });

  it('does NOT return CI reason when has_workflows is false', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: false, latest_run: { conclusion: 'failure' } }
    });
    expect(deriveLanePlacementReasons(repo, 'blocked', NOW)).not.toContain('CI failing on main');
  });

  it('returns security alert reason with count', () => {
    const repo = makeRepo({
      security_alerts: { total: 3, critical: 0, high: 0, medium: 2, low: 1 }
    });
    const reasons = deriveLanePlacementReasons(repo, 'blocked', NOW);
    expect(reasons.some(r => r.includes('3 security alerts'))).toBe(true);
  });

  it('appends (N critical/high) when severe alerts present', () => {
    const repo = makeRepo({
      security_alerts: { total: 5, critical: 2, high: 1, medium: 1, low: 1 }
    });
    const reasons = deriveLanePlacementReasons(repo, 'blocked', NOW);
    expect(reasons.some(r => r.includes('5 security alerts') && r.includes('3 critical/high'))).toBe(true);
  });

  it('singular "alert" when total is 1', () => {
    const repo = makeRepo({
      security_alerts: { total: 1, critical: 0, high: 1, medium: 0, low: 0 }
    });
    const reasons = deriveLanePlacementReasons(repo, 'blocked', NOW);
    expect(reasons.some(r => r.includes('1 security alert') && !r.includes('alerts'))).toBe(true);
  });

  it('returns both CI and security reasons when both present', () => {
    const repo = makeRepo({
      workflow_status: { has_workflows: true, latest_run: { conclusion: 'failure' } },
      security_alerts: { total: 2, critical: 1, high: 0, medium: 1, low: 0 }
    });
    const reasons = deriveLanePlacementReasons(repo, 'blocked', NOW);
    expect(reasons).toContain('CI failing on main');
    expect(reasons.some(r => r.includes('security'))).toBe(true);
    expect(reasons.length).toBe(2);
  });

  it('returns empty array when no CI failure or security alerts', () => {
    const repo = makeRepo();
    expect(deriveLanePlacementReasons(repo, 'blocked', NOW)).toEqual([]);
  });
});

describe('KanbanLaneChips.deriveLanePlacementReasons — needs-attention lane', () => {
  let deriveLanePlacementReasons;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    setupMockDOM();
    loadBrowserScript('js/kanban-lane-chips.js');
    deriveLanePlacementReasons = window.GHD.KanbanLaneChips.deriveLanePlacementReasons;
  });

  it('returns Dependabot PR count for bot PRs', () => {
    const repo = makeRepo({
      pending_reviews: {
        count: 2,
        items: [{ author: 'dependabot[bot]' }, { author: 'dependabot[bot]' }]
      }
    });
    const reasons = deriveLanePlacementReasons(repo, 'needs-attention', NOW);
    expect(reasons.some(r => r.includes('2') && r.includes('Dependabot'))).toBe(true);
  });

  it('singular form for 1 Dependabot PR', () => {
    const repo = makeRepo({
      pending_reviews: { count: 1, items: [{ author: 'dependabot[bot]' }] }
    });
    const reasons = deriveLanePlacementReasons(repo, 'needs-attention', NOW);
    expect(reasons.some(r => r.includes('1 open Dependabot PR awaiting'))).toBe(true);
  });

  it('returns human PR reason for non-bot PRs', () => {
    const repo = makeRepo({
      pending_reviews: {
        count: 2,
        items: [{ author: 'jongalloway' }, { author: 'teammate' }]
      }
    });
    const reasons = deriveLanePlacementReasons(repo, 'needs-attention', NOW);
    expect(reasons.some(r => r.includes('2') && r.includes('PR') && !r.includes('Dependabot'))).toBe(true);
  });

  it('returns both Dependabot and human PR reasons for mixed PRs', () => {
    const repo = makeRepo({
      pending_reviews: {
        count: 3,
        items: [{ author: 'dependabot[bot]' }, { author: 'alice' }, { author: 'bob' }]
      }
    });
    const reasons = deriveLanePlacementReasons(repo, 'needs-attention', NOW);
    expect(reasons.some(r => r.includes('Dependabot'))).toBe(true);
    expect(reasons.some(r => r.includes('2') && !r.includes('Dependabot'))).toBe(true);
  });

  it('falls back to total count when items array is empty', () => {
    const repo = makeRepo({
      pending_reviews: { count: 4, items: [] }
    });
    const reasons = deriveLanePlacementReasons(repo, 'needs-attention', NOW);
    expect(reasons.some(r => r.includes('4') && r.includes('PR'))).toBe(true);
  });

  it('returns empty array when no pending reviews', () => {
    const repo = makeRepo({ pending_reviews: { count: 0, items: [] } });
    expect(deriveLanePlacementReasons(repo, 'needs-attention', NOW)).toEqual([]);
  });
});

describe('KanbanLaneChips.deriveLanePlacementReasons — working/healthy lanes', () => {
  let deriveLanePlacementReasons;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    setupMockDOM();
    loadBrowserScript('js/kanban-lane-chips.js');
    deriveLanePlacementReasons = window.GHD.KanbanLaneChips.deriveLanePlacementReasons;
  });

  it('returns "Pushed Nd ago" for working lane (5-day-old repo)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 5 * DAY_MS).toISOString() });
    const reasons = deriveLanePlacementReasons(repo, 'working', NOW);
    expect(reasons).toEqual(['Pushed 5d ago']);
  });

  it('returns "Pushed 0d ago" for repo pushed today', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW).toISOString() });
    expect(deriveLanePlacementReasons(repo, 'working', NOW)).toEqual(['Pushed 0d ago']);
  });

  it('returns "Pushed Nd ago" for healthy lane (30-day-old repo)', () => {
    const repo = makeRepo({ pushed_at: new Date(NOW - 30 * DAY_MS).toISOString() });
    const reasons = deriveLanePlacementReasons(repo, 'healthy', NOW);
    expect(reasons).toEqual(['Pushed 30d ago']);
  });

  it('falls back to last_commit_date when pushed_at is absent', () => {
    const repo = makeRepo({
      pushed_at: null,
      last_commit_date: new Date(NOW - 7 * DAY_MS).toISOString()
    });
    expect(deriveLanePlacementReasons(repo, 'working', NOW)).toEqual(['Pushed 7d ago']);
  });

  it('returns empty array when no date available', () => {
    const repo = makeRepo({ pushed_at: null, last_commit_date: null });
    expect(deriveLanePlacementReasons(repo, 'working', NOW)).toEqual([]);
  });

  it('uses injected now parameter for determinism', () => {
    const fixedNow = new Date('2026-01-01T00:00:00Z').getTime();
    const pushedAt = new Date(fixedNow - 10 * DAY_MS).toISOString();
    const repo = makeRepo({ pushed_at: pushedAt });
    expect(deriveLanePlacementReasons(repo, 'working', fixedNow)).toEqual(['Pushed 10d ago']);
  });

  it('returns empty array for an unknown lane', () => {
    const repo = makeRepo();
    expect(deriveLanePlacementReasons(repo, 'unknown-lane', NOW)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// _buildDetailPanel
// ────────────────────────────────────────────────────────────────────────────

describe('KanbanLaneChips._buildDetailPanel', () => {
  let buildDetailPanel;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    setupMockDOM();
    loadBrowserScript('js/kanban-lane-chips.js');
    buildDetailPanel = window.GHD.KanbanLaneChips._buildDetailPanel;
  });

  it('sets correct CSS classes on the panel', () => {
    const repo = makeRepo();
    const panel = buildDetailPanel(repo, 'working', ['Pushed 5d ago']);
    expect(panel.className).toContain('kanban-detail-panel');
    expect(panel.className).toContain('kanban-detail-panel--working');
  });

  it('sets role="region" on the panel', () => {
    const repo = makeRepo();
    const panel = buildDetailPanel(repo, 'healthy', []);
    expect(panel.getAttribute('role')).toBe('region');
  });

  it('includes repo full_name in aria-label', () => {
    const repo = makeRepo({ full_name: 'owner/my-repo' });
    const panel = buildDetailPanel(repo, 'healthy', []);
    expect(panel.getAttribute('aria-label')).toContain('owner/my-repo');
  });

  it('includes repo name in header innerHTML', () => {
    const repo = makeRepo({ full_name: 'owner/my-repo' });
    const panel = buildDetailPanel(repo, 'blocked', ['CI failing on main']);
    const header = panel.children.find(c => c.className === 'kanban-detail-header');
    expect(header).toBeTruthy();
    expect(header.innerHTML).toContain('owner/my-repo');
  });

  it('includes a close button in the header', () => {
    const repo = makeRepo();
    const panel = buildDetailPanel(repo, 'blocked', []);
    const header = panel.children.find(c => c.className === 'kanban-detail-header');
    expect(header.innerHTML).toContain('kanban-detail-close');
  });

  it('renders each reason as a list item', () => {
    const repo = makeRepo();
    const reasons = ['CI failing on main', '2 security alerts'];
    const panel = buildDetailPanel(repo, 'blocked', reasons);
    const list = panel.children.find(c => c.className === 'kanban-detail-reasons');
    expect(list).toBeTruthy();
    const texts = list.children.map(li => li.textContent);
    expect(texts).toContain('CI failing on main');
    expect(texts).toContain('2 security alerts');
    expect(texts.length).toBe(2);
  });

  it('renders "No signals recorded." when reasons array is empty', () => {
    const repo = makeRepo();
    const panel = buildDetailPanel(repo, 'healthy', []);
    const list = panel.children.find(c => c.className === 'kanban-detail-reasons');
    expect(list.children[0].textContent).toBe('No signals recorded.');
  });

  it('uses html_url as the href in the repo link', () => {
    const repo = makeRepo({ html_url: 'https://github.com/owner/test-repo' });
    const panel = buildDetailPanel(repo, 'working', []);
    const header = panel.children.find(c => c.className === 'kanban-detail-header');
    expect(header.innerHTML).toContain('https://github.com/owner/test-repo');
  });

  it('falls back to full_name URL when html_url absent', () => {
    const repo = makeRepo({ html_url: null, full_name: 'owner/fallback-repo' });
    const panel = buildDetailPanel(repo, 'working', []);
    const header = panel.children.find(c => c.className === 'kanban-detail-header');
    expect(header.innerHTML).toContain('https://github.com/owner/fallback-repo');
  });

  it('clamps javascript: URI to "#" (XSS guard)', () => {
    const repo = makeRepo({ html_url: 'javascript:alert(1)', full_name: null });
    const panel = buildDetailPanel(repo, 'working', []);
    const header = panel.children.find(c => c.className === 'kanban-detail-header');
    expect(header.innerHTML).not.toContain('javascript:');
    expect(header.innerHTML).toContain('"#"');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// renderLaneChips — chip generation
// ────────────────────────────────────────────────────────────────────────────

describe('KanbanLaneChips.renderLaneChips — chip generation', () => {
  let renderLaneChips;
  let MockEl;

  function buildMockStrip() {
    const strip = new MockEl('div');
    strip.className = 'kanban-strip';
    return strip;
  }

  function buildMockContainer(strip) {
    const container = new MockEl('div');
    container.querySelector = (sel) => {
      if (sel === '.kanban-strip') return strip;
      return null;
    };
    container.insertBefore = (node, ref) => {
      node.parentNode = container;
      const idx = container.children.indexOf(ref);
      if (idx >= 0) container.children.splice(idx, 0, node);
      else container.children.push(node);
      return node;
    };
    container.appendChild = (child) => {
      child.parentNode = container;
      container.children.push(child);
      return child;
    };
    container.children = [strip];
    return container;
  }

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    MockEl = setupMockDOM();
    loadBrowserScript('js/kanban-lane-chips.js');
    renderLaneChips = window.GHD.KanbanLaneChips.renderLaneChips;
  });

  it('does nothing when container is null', () => {
    expect(() => renderLaneChips(null, {}, NOW)).not.toThrow();
  });

  it('does nothing when laneMap is null', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    expect(() => renderLaneChips(container, null, NOW)).not.toThrow();
  });

  it('does nothing when .kanban-strip element is absent', () => {
    const MockElLocal = MockEl;
    const container = new MockElLocal('div');
    container.querySelector = () => null;
    expect(() => renderLaneChips(container, {}, NOW)).not.toThrow();
  });

  it('appends one chip row per lane to the strip', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [],
      'needs-attention': [],
      'working': [makeRepo()],
      'healthy': []
    };
    renderLaneChips(container, laneMap, NOW);
    const chipRows = strip.children.filter(c => c.className === 'kanban-chip-row');
    expect(chipRows.length).toBe(4);
  });

  it('sets data-lane attribute on each chip row', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = { 'blocked': [], 'needs-attention': [], 'working': [], 'healthy': [] };
    renderLaneChips(container, laneMap, NOW);
    const lanes = strip.children.filter(c => c.className === 'kanban-chip-row').map(r => r.dataset.lane);
    expect(lanes).toEqual(['blocked', 'needs-attention', 'working', 'healthy']);
  });

  it('hides chip row when lane has no repos', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = { 'blocked': [], 'needs-attention': [], 'working': [], 'healthy': [] };
    renderLaneChips(container, laneMap, NOW);
    const rows = strip.children.filter(c => c.className === 'kanban-chip-row');
    rows.forEach(r => expect(r.hidden).toBe(true));
  });

  it('does NOT hide chip row when lane has repos', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [makeRepo({ name: 'repo-a' })],
      'needs-attention': [],
      'working': [],
      'healthy': []
    };
    renderLaneChips(container, laneMap, NOW);
    const blockedRow = strip.children.find(r => r.dataset && r.dataset.lane === 'blocked');
    expect(blockedRow.hidden).toBe(false);
  });

  it('renders one chip button per repo in a lane', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [],
      'needs-attention': [],
      'working': [makeRepo({ name: 'a' }), makeRepo({ name: 'b' })],
      'healthy': []
    };
    renderLaneChips(container, laneMap, NOW);
    const workingRow = strip.children.find(r => r.dataset && r.dataset.lane === 'working');
    const chips = workingRow.children.filter(c => c.className === 'kanban-repo-chip');
    expect(chips.length).toBe(2);
  });

  it('sets data-repo on each chip matching the repo name', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [],
      'needs-attention': [],
      'working': [],
      'healthy': [makeRepo({ name: 'my-special-repo', full_name: 'owner/my-special-repo' })]
    };
    renderLaneChips(container, laneMap, NOW);
    const healthyRow = strip.children.find(r => r.dataset && r.dataset.lane === 'healthy');
    const chip = healthyRow.children.find(c => c.className === 'kanban-repo-chip');
    expect(chip.dataset.repo).toBe('my-special-repo');
  });

  it('sets aria-expanded="false" on chips initially', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [],
      'needs-attention': [makeRepo({ name: 'r' })],
      'working': [],
      'healthy': []
    };
    renderLaneChips(container, laneMap, NOW);
    const row = strip.children.find(r => r.dataset && r.dataset.lane === 'needs-attention');
    const chip = row.children.find(c => c.className === 'kanban-repo-chip');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('chip innerHTML contains the repo full_name', () => {
    const strip = buildMockStrip();
    const container = buildMockContainer(strip);
    const laneMap = {
      'blocked': [],
      'needs-attention': [],
      'working': [makeRepo({ name: 'r', full_name: 'owner/display-name' })],
      'healthy': []
    };
    renderLaneChips(container, laneMap, NOW);
    const workingRow = strip.children.find(r => r.dataset && r.dataset.lane === 'working');
    const chip = workingRow.children.find(c => c.className === 'kanban-repo-chip');
    expect(chip.innerHTML).toContain('owner/display-name');
  });
});
