// test/blocked-lane-data.test.js
// Unit tests for workflow_status + security_alerts pipeline (#47)
// Covers: correct conclusion extraction, empty-runs → not blocked,
// security alert counting, and graceful degradation on 403/404/missing scope → 0.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('GHD.GitHubClient — blocked lane data (#47)', () => {
  beforeEach(() => {
    globalThis.window = { GHD: {} };
    vi.restoreAllMocks();
    loadBrowserScript('js/github-client.js');
  });

  // ── _parseWorkflowRun ─────────────────────────────────────

  describe('_parseWorkflowRun', () => {
    test('null response → has_workflows: false, latest_run: null', () => {
      expect(window.GHD.GitHubClient._parseWorkflowRun(null)).toEqual({
        has_workflows: false,
        latest_run: null
      });
    });

    test('undefined response → has_workflows: false, latest_run: null', () => {
      expect(window.GHD.GitHubClient._parseWorkflowRun(undefined)).toEqual({
        has_workflows: false,
        latest_run: null
      });
    });

    test('empty workflow_runs array → has_workflows: false, not blocked', () => {
      expect(window.GHD.GitHubClient._parseWorkflowRun({ workflow_runs: [] })).toEqual({
        has_workflows: false,
        latest_run: null
      });
    });

    test('failure run → has_workflows: true, conclusion: "failure"', () => {
      const data = {
        workflow_runs: [{
          conclusion: 'failure', status: 'completed',
          html_url: 'https://github.com/o/r/actions/runs/1',
          name: 'CI', run_started_at: '2026-06-27T10:00:00Z'
        }]
      };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBe('failure');
    });

    test('timed_out → conclusion: "timed_out"', () => {
      const data = { workflow_runs: [{ conclusion: 'timed_out', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      expect(window.GHD.GitHubClient._parseWorkflowRun(data).latest_run.conclusion).toBe('timed_out');
    });

    test('startup_failure → conclusion: "startup_failure"', () => {
      const data = { workflow_runs: [{ conclusion: 'startup_failure', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      expect(window.GHD.GitHubClient._parseWorkflowRun(data).latest_run.conclusion).toBe('startup_failure');
    });

    test('action_required → conclusion: "action_required"', () => {
      const data = { workflow_runs: [{ conclusion: 'action_required', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      expect(window.GHD.GitHubClient._parseWorkflowRun(data).latest_run.conclusion).toBe('action_required');
    });

    test('success run → has_workflows: true, conclusion: "success" (not a blocking value)', () => {
      const data = { workflow_runs: [{ conclusion: 'success', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBe('success');
    });

    test('in-progress run (no conclusion yet) → latest_run.conclusion null', () => {
      const data = { workflow_runs: [{ conclusion: null, status: 'in_progress', html_url: null, name: null, run_started_at: null }] };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBeNull();
    });

    test('preserves html_url and name from run', () => {
      const data = {
        workflow_runs: [{
          conclusion: 'failure', status: 'completed',
          html_url: 'https://github.com/o/r/actions/runs/42',
          name: 'Build and Test', run_started_at: '2026-06-27T08:00:00Z'
        }]
      };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.latest_run.html_url).toBe('https://github.com/o/r/actions/runs/42');
      expect(result.latest_run.name).toBe('Build and Test');
      expect(result.latest_run.run_started_at).toBe('2026-06-27T08:00:00Z');
    });

    test('non-array workflow_runs field → has_workflows: false', () => {
      expect(window.GHD.GitHubClient._parseWorkflowRun({ workflow_runs: null })).toEqual({
        has_workflows: false,
        latest_run: null
      });
    });

    // Gap 3: non-blocking conclusions
    test('cancelled run → has_workflows true, conclusion "cancelled" (non-blocking)', () => {
      const data = { workflow_runs: [{ conclusion: 'cancelled', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBe('cancelled');
      const isBlocking = ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(result.latest_run.conclusion);
      expect(isBlocking).toBe(false);
    });

    test('neutral run → has_workflows true, conclusion "neutral" (non-blocking)', () => {
      const data = { workflow_runs: [{ conclusion: 'neutral', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBe('neutral');
      const isBlocking = ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(result.latest_run.conclusion);
      expect(isBlocking).toBe(false);
    });

    test('skipped run → has_workflows true, conclusion "skipped" (non-blocking)', () => {
      const data = { workflow_runs: [{ conclusion: 'skipped', status: 'completed', html_url: null, name: null, run_started_at: null }] };
      const result = window.GHD.GitHubClient._parseWorkflowRun(data);
      expect(result.has_workflows).toBe(true);
      expect(result.latest_run.conclusion).toBe('skipped');
      const isBlocking = ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(result.latest_run.conclusion);
      expect(isBlocking).toBe(false);
    });
  });

  // ── _parseSecurityAlerts ──────────────────────────────────

  describe('_parseSecurityAlerts', () => {
    test('null input → all-zero counts', () => {
      expect(window.GHD.GitHubClient._parseSecurityAlerts(null)).toEqual({
        total: 0, critical: 0, high: 0, medium: 0, low: 0
      });
    });

    test('undefined input → all-zero counts', () => {
      expect(window.GHD.GitHubClient._parseSecurityAlerts(undefined)).toEqual({
        total: 0, critical: 0, high: 0, medium: 0, low: 0
      });
    });

    test('empty array → all-zero counts', () => {
      expect(window.GHD.GitHubClient._parseSecurityAlerts([])).toEqual({
        total: 0, critical: 0, high: 0, medium: 0, low: 0
      });
    });

    test('counts by severity via security_advisory', () => {
      const alerts = [
        { security_advisory: { severity: 'critical' } },
        { security_advisory: { severity: 'high' } },
        { security_advisory: { severity: 'high' } },
        { security_advisory: { severity: 'medium' } },
        { security_advisory: { severity: 'low' } }
      ];
      expect(window.GHD.GitHubClient._parseSecurityAlerts(alerts)).toEqual({
        total: 5, critical: 1, high: 2, medium: 1, low: 1
      });
    });

    test('falls back to security_vulnerability.severity when advisory absent', () => {
      const alerts = [
        { security_vulnerability: { severity: 'high' } },
        { security_vulnerability: { severity: 'low' } }
      ];
      const result = window.GHD.GitHubClient._parseSecurityAlerts(alerts);
      expect(result.total).toBe(2);
      expect(result.high).toBe(1);
      expect(result.low).toBe(1);
    });

    test('severity matching is case-insensitive', () => {
      const alerts = [
        { security_advisory: { severity: 'CRITICAL' } },
        { security_advisory: { severity: 'High' } }
      ];
      const result = window.GHD.GitHubClient._parseSecurityAlerts(alerts);
      expect(result.critical).toBe(1);
      expect(result.high).toBe(1);
    });

    test('alert with unknown severity counted in total but not in named buckets', () => {
      const alerts = [{ security_advisory: { severity: 'unknown' } }];
      const result = window.GHD.GitHubClient._parseSecurityAlerts(alerts);
      expect(result.total).toBe(1);
      expect(result.critical + result.high + result.medium + result.low).toBe(0);
    });
  });

  // ── Integration: fetchPrivateDashboard wires new fields ───

  describe('fetchPrivateDashboard workflow_status + security_alerts', () => {
    const baseRepo = {
      name: 'my-repo',
      full_name: 'octocat/my-repo',
      html_url: 'https://github.com/octocat/my-repo',
      visibility: 'public',
      description: null,
      language: 'JavaScript',
      updated_at: '2026-06-27T00:00:00Z',
      pushed_at: '2026-06-27T00:00:00Z',
      default_branch: 'main',
      private: false,
      fork: false,
      archived: false,
      topics: [],
      has_discussions: false
    };

    function mockFetch(overrides = {}) {
      return vi.fn(async (url) => {
        const value = String(url);
        if (value.includes('/user/repos?')) return jsonResponse([baseRepo]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/main')) {
          return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        }
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        for (const [pattern, response] of Object.entries(overrides)) {
          if (value.includes(pattern)) return response;
        }
        if (value.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [] });
        if (value.includes('/dependabot/alerts?')) return jsonResponse([]);
        return jsonResponse({});
      });
    }

    test('failing CI run → workflow_status.has_workflows true, conclusion "failure"', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/actions/runs?': jsonResponse({
          workflow_runs: [{
            conclusion: 'failure', status: 'completed',
            html_url: 'https://github.com/octocat/my-repo/actions/runs/1',
            name: 'CI', run_started_at: '2026-06-27T10:00:00Z'
          }]
        })
      }));

      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.has_workflows).toBe(true);
      expect(repo.workflow_status.latest_run.conclusion).toBe('failure');
    });

    test('no workflow runs → has_workflows false, not blocked', async () => {
      vi.stubGlobal('fetch', mockFetch());
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.has_workflows).toBe(false);
      expect(repo.workflow_status.latest_run).toBeNull();
    });

    test('403 on actions/runs → degrades to has_workflows false, no thrown error', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/actions/runs?': new Response('{"message":"Resource not accessible"}', { status: 403 })
      }));
      // Must NOT reject
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.has_workflows).toBe(false);
      expect(repo.workflow_status.latest_run).toBeNull();
    });

    test('404 on actions/runs → degrades gracefully', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/actions/runs?': new Response('Not Found', { status: 404 })
      }));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.has_workflows).toBe(false);
    });

    test('open security alerts → security_alerts.total populated', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/dependabot/alerts?': jsonResponse([
          { security_advisory: { severity: 'critical' } },
          { security_advisory: { severity: 'high' } }
        ])
      }));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(2);
      expect(repo.security_alerts.critical).toBe(1);
      expect(repo.security_alerts.high).toBe(1);
    });

    test('403 on dependabot/alerts → security_alerts.total 0, no thrown error', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/dependabot/alerts?': new Response('{"message":"Must have admin rights to see alerts"}', { status: 403 })
      }));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(0);
    });

    test('404 on dependabot/alerts → security_alerts.total 0', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/dependabot/alerts?': new Response('Not Found', { status: 404 })
      }));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(0);
    });

    test('no alerts, no failing CI → repo is NOT in Blocked lane', async () => {
      vi.stubGlobal('fetch', mockFetch());
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];

      // Confirm the data satisfies deriveKanbanLane's "not blocked" preconditions
      const ciFailure =
        repo.workflow_status?.has_workflows === true &&
        ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(
          repo.workflow_status?.latest_run?.conclusion
        );
      const hasAlerts = (repo.security_alerts?.total || 0) > 0;
      expect(ciFailure).toBe(false);
      expect(hasAlerts).toBe(false);
    });

    test('failing CI + open alerts → both fields populated', async () => {
      vi.stubGlobal('fetch', mockFetch({
        '/actions/runs?': jsonResponse({
          workflow_runs: [{ conclusion: 'timed_out', status: 'completed', html_url: null, name: null, run_started_at: null }]
        }),
        '/dependabot/alerts?': jsonResponse([
          { security_advisory: { severity: 'high' } }
        ])
      }));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.latest_run.conclusion).toBe('timed_out');
      expect(repo.security_alerts.total).toBe(1);
    });
  });

  // ── Gap 1: Multi-repo isolation (_runWithConcurrency + filter(Boolean)) ──

  describe('multi-repo isolation: _runWithConcurrency + filter(Boolean)', () => {
    const makeRepo = (name) => ({
      name,
      full_name: `octocat/${name}`,
      html_url: `https://github.com/octocat/${name}`,
      visibility: 'public',
      description: null,
      language: 'JavaScript',
      updated_at: '2026-06-27T00:00:00Z',
      pushed_at: '2026-06-27T00:00:00Z',
      default_branch: 'main',
      private: false,
      fork: false,
      archived: false,
      topics: [],
      has_discussions: false
    });

    const repoA = makeRepo('repo-a');
    const repoB = makeRepo('repo-b');
    const repoC = makeRepo('repo-c');

    function makeMultiFetch(handlers = {}) {
      return vi.fn(async (url) => {
        const value = String(url);
        for (const [pattern, handler] of Object.entries(handlers)) {
          if (value.includes(pattern)) return handler;
        }
        if (value.includes('/user/repos?')) return jsonResponse([repoA, repoB, repoC]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/')) return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        if (value.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [] });
        if (value.includes('/dependabot/alerts?')) return jsonResponse([]);
        return jsonResponse({});
      });
    }

    test('one repo 403 on actions/runs → that repo workflow_status zeroed, other repos populated, all 3 present, no rejection', async () => {
      vi.stubGlobal('fetch', makeMultiFetch({
        'repo-a/actions/runs?': jsonResponse({
          workflow_runs: [{ conclusion: 'failure', status: 'completed', html_url: null, name: null, run_started_at: null }]
        }),
        'repo-b/actions/runs?': new Response('{"message":"Forbidden"}', { status: 403 })
      }));

      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      expect(payload.dashboard.repos).toHaveLength(3);

      const a = payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-a');
      const b = payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-b');
      const c = payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-c');

      // repo-a: failing CI populated correctly
      expect(a.workflow_status.has_workflows).toBe(true);
      expect(a.workflow_status.latest_run.conclusion).toBe('failure');

      // repo-b: 403 → soft degradation to zeroed fields
      expect(b.workflow_status.has_workflows).toBe(false);
      expect(b.workflow_status.latest_run).toBeNull();

      // repo-c: unaffected by repo-b's failure
      expect(c.workflow_status.has_workflows).toBe(false);
      expect(c).toBeDefined();
    });

    test('one repo network throw on hard fetch → _fetchRepoDetails fallback fires, repo present with zeroed blocked-lane fields, remaining repos intact', async () => {
      const fetchFn = vi.fn(async (url) => {
        const value = String(url);
        // Throw inside _paginate for repo-b (hard fetch, not soft)
        if (value.includes('repo-b/issues?')) throw new TypeError('Network failure');
        if (value.includes('/user/repos?')) return jsonResponse([repoA, repoB, repoC]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/')) return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        if (value.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [] });
        if (value.includes('/dependabot/alerts?')) return jsonResponse([]);
        return jsonResponse({});
      });
      vi.stubGlobal('fetch', fetchFn);

      // Must not reject — _fetchRepoDetails outer catch returns a fallback object
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');

      // All 3 repos present: fallback record is truthy, filter(Boolean) keeps it
      expect(payload.dashboard.repos).toHaveLength(3);

      const b = payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-b');
      expect(b).toBeDefined();
      // Fallback zeroes blocked-lane fields
      expect(b.workflow_status).toEqual({ has_workflows: false, latest_run: null });
      expect(b.security_alerts).toEqual({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
      expect(b.open_issues_count).toBe(0);

      // repo-a and repo-c unaffected
      expect(payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-a')).toBeDefined();
      expect(payload.dashboard.repos.find((r) => r.full_name === 'octocat/repo-c')).toBeDefined();
    });
  });

  // ── Gap 2: Network-exception branch (_fetchJsonSoft / _paginateSoft throw) ──

  describe('network-exception branch: fetch throws → catch(_) returns null / []', () => {
    const throwBaseRepo = {
      name: 'my-repo',
      full_name: 'octocat/my-repo',
      html_url: 'https://github.com/octocat/my-repo',
      visibility: 'public',
      description: null,
      language: 'JavaScript',
      updated_at: '2026-06-27T00:00:00Z',
      pushed_at: '2026-06-27T00:00:00Z',
      default_branch: 'main',
      private: false,
      fork: false,
      archived: false,
      topics: [],
      has_discussions: false
    };

    function makeThrowFetch(throwPattern) {
      return vi.fn(async (url) => {
        const value = String(url);
        if (value.includes(throwPattern)) throw new TypeError('Failed to fetch');
        if (value.includes('/user/repos?')) return jsonResponse([throwBaseRepo]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/')) return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        if (value.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [] });
        if (value.includes('/dependabot/alerts?')) return jsonResponse([]);
        return jsonResponse({});
      });
    }

    test('fetch throws (TypeError) on actions/runs → _fetchJsonSoft catch branch → workflow_status zeroed, no throw', async () => {
      vi.stubGlobal('fetch', makeThrowFetch('/actions/runs?'));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.workflow_status.has_workflows).toBe(false);
      expect(repo.workflow_status.latest_run).toBeNull();
    });

    test('fetch throws (TypeError) on dependabot/alerts first page → _paginateSoft catch branch → security_alerts all-zero, no throw', async () => {
      vi.stubGlobal('fetch', makeThrowFetch('/dependabot/alerts?'));
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts).toEqual({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
    });

    test('AbortError thrown on actions/runs → _fetchJsonSoft catch branch handles non-TypeError → workflow_status zeroed, no throw', async () => {
      const abortFetch = vi.fn(async (url) => {
        const value = String(url);
        if (value.includes('/actions/runs?')) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        if (value.includes('/user/repos?')) return jsonResponse([throwBaseRepo]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/')) return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        if (value.includes('/dependabot/alerts?')) return jsonResponse([]);
        return jsonResponse({});
      });
      vi.stubGlobal('fetch', abortFetch);
      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      expect(payload.dashboard.repos[0].workflow_status.has_workflows).toBe(false);
      expect(payload.dashboard.repos[0].workflow_status.latest_run).toBeNull();
    });
  });

  // ── Gap 4: _paginateSoft pagination ─────────────────────

  describe('_paginateSoft: multi-page accumulation and mid-pagination error', () => {
    const PAGE2_URL =
      'https://api.github.com/repos/octocat/my-repo/dependabot/alerts?state=open&per_page=100&page=2';

    const pagBaseRepo = {
      name: 'my-repo',
      full_name: 'octocat/my-repo',
      html_url: 'https://github.com/octocat/my-repo',
      visibility: 'public',
      description: null,
      language: 'JavaScript',
      updated_at: '2026-06-27T00:00:00Z',
      pushed_at: '2026-06-27T00:00:00Z',
      default_branch: 'main',
      private: false,
      fork: false,
      archived: false,
      topics: [],
      has_discussions: false
    };

    function makePagFetch(page1Handler, page2Handler) {
      return vi.fn(async (url) => {
        const value = String(url);
        if (value.includes('/user/repos?')) return jsonResponse([pagBaseRepo]);
        if (value.includes('/issues?')) return jsonResponse([]);
        if (value.includes('/pulls?')) return jsonResponse([]);
        if (value.includes('/branches?')) return jsonResponse([]);
        if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
        if (value.includes('/commits/')) return jsonResponse({ commit: { committer: { date: '2026-06-27T00:00:00Z' } } });
        if (value.includes('/releases/latest')) return jsonResponse({}, 404);
        if (value.includes('/pages')) return jsonResponse({}, 404);
        if (value.includes('/actions/runs?')) return jsonResponse({ workflow_runs: [] });
        // page=2 check must come before the generic alerts check
        if (value.includes('page=2') && value.includes('/dependabot/alerts')) return page2Handler(url);
        if (value.includes('/dependabot/alerts?')) return page1Handler(url);
        return jsonResponse({});
      });
    }

    test('two-page pagination via Link header accumulates items from both pages', async () => {
      const page1 = [{ security_advisory: { severity: 'critical' } }];
      const page2 = [
        { security_advisory: { severity: 'high' } },
        { security_advisory: { severity: 'medium' } }
      ];

      vi.stubGlobal('fetch', makePagFetch(
        () => new Response(JSON.stringify(page1), {
          status: 200,
          headers: { 'content-type': 'application/json', link: `<${PAGE2_URL}>; rel="next"` }
        }),
        () => jsonResponse(page2)
      ));

      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(3);
      expect(repo.security_alerts.critical).toBe(1);
      expect(repo.security_alerts.high).toBe(1);
      expect(repo.security_alerts.medium).toBe(1);
    });

    test('mid-pagination 403 → stops cleanly, returns items from page 1 only, no throw', async () => {
      const page1 = [{ security_advisory: { severity: 'high' } }];

      vi.stubGlobal('fetch', makePagFetch(
        () => new Response(JSON.stringify(page1), {
          status: 200,
          headers: { 'content-type': 'application/json', link: `<${PAGE2_URL}>; rel="next"` }
        }),
        () => new Response('{"message":"Forbidden"}', { status: 403 })
      ));

      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(1);
      expect(repo.security_alerts.high).toBe(1);
    });

    test('mid-pagination network throw → catch branch swallows it, returns page 1 items, no throw', async () => {
      const page1 = [{ security_advisory: { severity: 'critical' } }];

      vi.stubGlobal('fetch', makePagFetch(
        () => new Response(JSON.stringify(page1), {
          status: 200,
          headers: { 'content-type': 'application/json', link: `<${PAGE2_URL}>; rel="next"` }
        }),
        () => { throw new TypeError('Network error on page 2'); }
      ));

      const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('tok', 'octocat');
      const repo = payload.dashboard.repos[0];
      expect(repo.security_alerts.total).toBe(1);
      expect(repo.security_alerts.critical).toBe(1);
    });
  });
});
