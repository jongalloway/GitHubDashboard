import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const fullPath = resolve(process.cwd(), relativePath);
  const code = readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

/** Build a minimal repo fixture with optional pending_reviews overrides. */
function makeRepo(overrides = {}) {
  return {
    name: 'test-repo',
    full_name: 'owner/test-repo',
    pending_reviews: { count: 0, items: [] },
    ...overrides
  };
}

/** Build a Dependabot PR item fixture. */
function makeBotPR(overrides = {}) {
  return {
    number: 1,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    html_url: 'https://github.com/owner/test-repo/pull/1',
    author: 'dependabot[bot]',
    ...overrides
  };
}

// ── generatePRLink ───────────────────────────────────────────────────────────

describe('DependabotLinks.generatePRLink', () => {
  let generatePRLink;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/dependabot-links.js');
    generatePRLink = window.GHD.DependabotLinks.generatePRLink;
  });

  it('generates a correct PR permalink', () => {
    expect(generatePRLink('jongalloway', 'newsletter-generator', 39))
      .toBe('https://github.com/jongalloway/newsletter-generator/pull/39');
  });

  it('accepts numeric string PR number', () => {
    expect(generatePRLink('owner', 'repo', '42'))
      .toBe('https://github.com/owner/repo/pull/42');
  });

  it('returns "#" when owner is missing', () => {
    expect(generatePRLink('', 'repo', 1)).toBe('#');
    expect(generatePRLink(null, 'repo', 1)).toBe('#');
    expect(generatePRLink(undefined, 'repo', 1)).toBe('#');
  });

  it('returns "#" when repo is missing', () => {
    expect(generatePRLink('owner', '', 1)).toBe('#');
    expect(generatePRLink('owner', null, 1)).toBe('#');
  });

  it('returns "#" when number is missing or null', () => {
    expect(generatePRLink('owner', 'repo', null)).toBe('#');
    expect(generatePRLink('owner', 'repo', undefined)).toBe('#');
  });

  it('returns "#" when number is non-numeric', () => {
    expect(generatePRLink('owner', 'repo', 'abc')).toBe('#');
    expect(generatePRLink('owner', 'repo', '1.5')).toBe('#');
    expect(generatePRLink('owner', 'repo', '')).toBe('#');
  });

  it('URL-encodes owner and repo in the link', () => {
    const url = generatePRLink('my org', 'my repo', 5);
    expect(url).toBe('https://github.com/my%20org/my%20repo/pull/5');
  });
});

// ── groupDependabotPRs ───────────────────────────────────────────────────────

describe('DependabotLinks.groupDependabotPRs', () => {
  let groupDependabotPRs;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/dependabot-links.js');
    groupDependabotPRs = window.GHD.DependabotLinks.groupDependabotPRs;
  });

  it('returns empty array for no repos', () => {
    expect(groupDependabotPRs([])).toEqual([]);
  });

  it('returns empty array when no repos have Dependabot PRs', () => {
    const repos = [
      makeRepo({ pending_reviews: { count: 1, items: [{ author: 'jongalloway', number: 1 }] } })
    ];
    expect(groupDependabotPRs(repos)).toHaveLength(0);
  });

  it('returns one group for a repo with one Dependabot PR', () => {
    const repos = [
      makeRepo({
        pending_reviews: { count: 1, items: [makeBotPR()] }
      })
    ];
    const groups = groupDependabotPRs(repos);
    expect(groups).toHaveLength(1);
    expect(groups[0].prs).toHaveLength(1);
  });

  it('uses html_url from the PR item as the prUrl when present', () => {
    const pr = makeBotPR({ html_url: 'https://github.com/owner/repo/pull/99' });
    const repos = [makeRepo({ pending_reviews: { count: 1, items: [pr] } })];
    const groups = groupDependabotPRs(repos);
    expect(groups[0].prs[0].prUrl).toBe('https://github.com/owner/repo/pull/99');
    expect(groups[0].topPRUrl).toBe('https://github.com/owner/repo/pull/99');
  });

  it('falls back to generatePRLink when html_url is absent', () => {
    const pr = makeBotPR({ html_url: undefined, number: 7 });
    const repos = [
      makeRepo({ full_name: 'jongalloway/my-repo', pending_reviews: { count: 1, items: [pr] } })
    ];
    const groups = groupDependabotPRs(repos);
    expect(groups[0].prs[0].prUrl).toBe('https://github.com/jongalloway/my-repo/pull/7');
  });

  it('falls back to "#" when html_url and full_name are both missing', () => {
    const pr = { author: 'dependabot[bot]', number: 1 };
    const repos = [{ name: 'bare-name', pending_reviews: { items: [pr] } }];
    const groups = groupDependabotPRs(repos);
    // full_name absent → falls back to name which has no "/" → '#'
    expect(groups[0].prs[0].prUrl).toBe('#');
  });

  it('sorts groups by Dependabot PR count descending', () => {
    const repoA = makeRepo({
      name: 'repo-a', full_name: 'owner/repo-a',
      pending_reviews: { count: 1, items: [makeBotPR({ number: 1 })] }
    });
    const repoB = makeRepo({
      name: 'repo-b', full_name: 'owner/repo-b',
      pending_reviews: {
        count: 3,
        items: [
          makeBotPR({ number: 10 }),
          makeBotPR({ number: 11 }),
          makeBotPR({ number: 12 })
        ]
      }
    });
    const groups = groupDependabotPRs([repoA, repoB]);
    expect(groups[0].repo.name).toBe('repo-b');
    expect(groups[0].prs).toHaveLength(3);
    expect(groups[1].repo.name).toBe('repo-a');
    expect(groups[1].prs).toHaveLength(1);
  });

  it('excludes repos with no Dependabot PRs', () => {
    const repos = [
      makeRepo({ name: 'bot-repo', pending_reviews: { count: 1, items: [makeBotPR()] } }),
      makeRepo({ name: 'human-repo', pending_reviews: { count: 1, items: [{ author: 'jongalloway', number: 2 }] } })
    ];
    const groups = groupDependabotPRs(repos);
    expect(groups).toHaveLength(1);
    expect(groups[0].repo.name).toBe('bot-repo');
  });

  it('counts only Dependabot PRs in mixed PR lists', () => {
    const repos = [makeRepo({
      pending_reviews: {
        count: 3,
        items: [
          makeBotPR({ number: 1 }),
          { author: 'jongalloway', number: 2 },
          makeBotPR({ number: 3 })
        ]
      }
    })];
    const groups = groupDependabotPRs(repos);
    expect(groups[0].prs).toHaveLength(2);
  });

  it('accepts a custom isDependabotPR predicate', () => {
    const customPR = { author: 'renovate[bot]', number: 5, html_url: 'https://github.com/o/r/pull/5' };
    const repos = [makeRepo({ pending_reviews: { count: 1, items: [customPR] } })];
    const isRenovate = (pr) => String(pr?.author || '').includes('renovate');
    const groups = groupDependabotPRs(repos, isRenovate);
    expect(groups).toHaveLength(1);
    expect(groups[0].prs[0].prUrl).toBe('https://github.com/o/r/pull/5');
  });

  it('handles null/undefined repos argument gracefully', () => {
    expect(groupDependabotPRs(null)).toEqual([]);
    expect(groupDependabotPRs(undefined)).toEqual([]);
  });

  it('handles repos with missing pending_reviews gracefully', () => {
    const repos = [{ name: 'no-reviews', full_name: 'o/no-reviews' }];
    expect(groupDependabotPRs(repos)).toEqual([]);
  });
});

// ── findTopPickPR ────────────────────────────────────────────────────────────

describe('DependabotLinks.findTopPickPR', () => {
  let findTopPickPR;

  beforeEach(() => {
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/dependabot-links.js');
    findTopPickPR = window.GHD.DependabotLinks.findTopPickPR;
  });

  it('returns null when no repos have Dependabot PRs', () => {
    expect(findTopPickPR([])).toBeNull();
    expect(findTopPickPR([makeRepo()])).toBeNull();
  });

  it('returns an object with groups, topRepo, topPR, topPRUrl, totalCount', () => {
    const repos = [makeRepo({ pending_reviews: { count: 1, items: [makeBotPR()] } })];
    const result = findTopPickPR(repos);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('groups');
    expect(result).toHaveProperty('topRepo');
    expect(result).toHaveProperty('topPR');
    expect(result).toHaveProperty('topPRUrl');
    expect(result).toHaveProperty('totalCount');
  });

  it('topPRUrl points to the highest-priority (most PRs) repo top PR', () => {
    const lowRepo = makeRepo({
      name: 'low', full_name: 'owner/low',
      pending_reviews: { count: 1, items: [makeBotPR({ number: 1, html_url: 'https://github.com/owner/low/pull/1' })] }
    });
    const highRepo = makeRepo({
      name: 'high', full_name: 'owner/high',
      pending_reviews: {
        count: 2,
        items: [
          makeBotPR({ number: 10, html_url: 'https://github.com/owner/high/pull/10' }),
          makeBotPR({ number: 11, html_url: 'https://github.com/owner/high/pull/11' })
        ]
      }
    });
    const result = findTopPickPR([lowRepo, highRepo]);
    expect(result.topPRUrl).toBe('https://github.com/owner/high/pull/10');
    expect(result.topRepo.name).toBe('high');
  });

  it('totalCount is the sum of all Dependabot PRs across all repos', () => {
    const repos = [
      makeRepo({
        name: 'a',
        pending_reviews: { count: 2, items: [makeBotPR({ number: 1 }), makeBotPR({ number: 2 })] }
      }),
      makeRepo({
        name: 'b',
        pending_reviews: { count: 1, items: [makeBotPR({ number: 3 })] }
      })
    ];
    const result = findTopPickPR(repos);
    expect(result.totalCount).toBe(3);
  });

  it('groups array is sorted descending by PR count', () => {
    const repos = [
      makeRepo({ name: 'a', pending_reviews: { count: 1, items: [makeBotPR({ number: 1 })] } }),
      makeRepo({ name: 'b', pending_reviews: { count: 3, items: [
        makeBotPR({ number: 2 }), makeBotPR({ number: 3 }), makeBotPR({ number: 4 })
      ] } })
    ];
    const result = findTopPickPR(repos);
    expect(result.groups[0].repo.name).toBe('b');
    expect(result.groups[1].repo.name).toBe('a');
  });

  it('works correctly with a single PR across a single repo', () => {
    const pr = makeBotPR({ number: 39, html_url: 'https://github.com/jongalloway/newsletter-generator/pull/39' });
    const repos = [makeRepo({ full_name: 'jongalloway/newsletter-generator', pending_reviews: { count: 1, items: [pr] } })];
    const result = findTopPickPR(repos);
    expect(result.totalCount).toBe(1);
    expect(result.topPRUrl).toBe('https://github.com/jongalloway/newsletter-generator/pull/39');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].prs).toHaveLength(1);
  });
});

// ── module.exports (Vitest / CommonJS compatibility) ─────────────────────────

describe('DependabotLinks module.exports', () => {
  it('exports generatePRLink, groupDependabotPRs, findTopPickPR', async () => {
    const mod = await import('../js/dependabot-links.js');
    // In ESM/Vitest context the IIFE sets module.exports via the CommonJS shim path.
    // Verify via window.GHD as primary export surface.
    globalThis.window = { GHD: {} };
    loadBrowserScript('js/dependabot-links.js');
    const api = window.GHD.DependabotLinks;
    expect(typeof api.generatePRLink).toBe('function');
    expect(typeof api.groupDependabotPRs).toBe('function');
    expect(typeof api.findTopPickPR).toBe('function');
  });
});
