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
    headers: {
      'content-type': 'application/json',
      ...headers
    }
  });
}

describe('GHD.GitHubClient', () => {
  beforeEach(() => {
    globalThis.window = { GHD: {} };
    vi.restoreAllMocks();
    loadBrowserScript('js/github-client.js');
  });

  test('fetchPrivateDashboard excludes forks/archived and keeps private repos', async () => {
    const repos = [
      {
        name: 'private-active',
        full_name: 'octocat/private-active',
        html_url: 'https://github.com/octocat/private-active',
        visibility: 'private',
        description: null,
        language: 'JavaScript',
        updated_at: '2026-05-31T00:00:00Z',
        pushed_at: '2026-05-31T00:00:00Z',
        default_branch: 'main',
        private: true,
        fork: false,
        archived: false,
        topics: []
      },
      {
        name: 'public-active',
        full_name: 'octocat/public-active',
        html_url: 'https://github.com/octocat/public-active',
        visibility: 'public',
        description: 'repo',
        language: 'TypeScript',
        updated_at: '2026-05-30T00:00:00Z',
        pushed_at: '2026-05-30T00:00:00Z',
        default_branch: 'main',
        private: false,
        fork: false,
        archived: false,
        topics: []
      },
      {
        name: 'forked',
        full_name: 'octocat/forked',
        html_url: 'https://github.com/octocat/forked',
        updated_at: '2026-05-29T00:00:00Z',
        pushed_at: '2026-05-29T00:00:00Z',
        default_branch: 'main',
        private: false,
        fork: true,
        archived: false,
        topics: []
      },
      {
        name: 'archived',
        full_name: 'octocat/archived',
        html_url: 'https://github.com/octocat/archived',
        updated_at: '2026-05-28T00:00:00Z',
        pushed_at: '2026-05-28T00:00:00Z',
        default_branch: 'main',
        private: false,
        fork: false,
        archived: true,
        topics: []
      }
    ];

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const value = String(url);

      if (value.includes('/user/repos?')) return jsonResponse(repos);
      if (value.includes('/issues?')) return jsonResponse([]);
      if (value.includes('/pulls?')) return jsonResponse([]);
      if (value.includes('/branches?')) return jsonResponse([]);
      if (value.includes('/contents/.squad/team.md')) return jsonResponse({}, 404);
      if (value.includes('/commits/')) {
        return jsonResponse({
          commit: { committer: { date: '2026-05-31T00:00:00Z' } }
        });
      }
      if (value.includes('/releases/latest')) return jsonResponse({}, 404);
      if (value.includes('/pages')) return jsonResponse({}, 404);
      if (value.includes('/deployments?environment=github-pages')) return jsonResponse([]);

      return jsonResponse({});
    }));

    const payload = await window.GHD.GitHubClient.fetchPrivateDashboard('token', 'octocat');

    const names = payload.dashboard.repos.map((repo) => repo.name);
    expect(names).toContain('private-active');
    expect(names).toContain('public-active');
    expect(names).not.toContain('forked');
    expect(names).not.toContain('archived');

    const privateRepo = payload.dashboard.repos.find((repo) => repo.name === 'private-active');
    expect(privateRepo.is_private).toBe(true);
  });

  test('fetchPublicDashboard supports empty repo lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const value = String(url);
      if (value.includes('/users/octocat/repos?')) return jsonResponse([]);
      return jsonResponse({});
    }));

    const payload = await window.GHD.GitHubClient.fetchPublicDashboard('octocat');

    expect(payload.dashboard.owner).toBe('octocat');
    expect(payload.dashboard.repo_count).toBe(0);
    expect(payload.dashboard.repos).toEqual([]);
  });

  test('fetchPublicDashboard throws on API rate-limit/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const value = String(url);
      if (value.includes('/users/octocat/repos?')) return jsonResponse({ message: 'rate limit' }, 403);
      return jsonResponse({});
    }));

    await expect(window.GHD.GitHubClient.fetchPublicDashboard('octocat')).rejects.toThrow(
      'Paginate failed (403)'
    );
  });
});