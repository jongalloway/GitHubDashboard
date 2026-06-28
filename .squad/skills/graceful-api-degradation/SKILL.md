# Skill: Graceful API Degradation — Soft HTTP Helpers

**Category:** Data Pipeline  
**Applies to:** Client-side GitHub API calls (browser, no-server architecture)

## Pattern

When fetching auth-only or permission-gated GitHub API endpoints in a browser client, use "soft" HTTP helpers that return safe defaults (`null` / `[]`) on any non-OK response instead of throwing. This prevents 403/404/missing-scope errors from bubbling up and breaking the calling pipeline.

## Implementation

```js
// Returns null on ANY non-OK response — never throws.
async function _fetchJsonSoft(url, token) {
  try {
    const response = await fetch(url, { headers: _headers(token) });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

// Paginates gracefully — stops and returns what was collected on any error.
async function _paginateSoft(url, token) {
  const items = [];
  try {
    let nextUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: _headers(token) });
      if (!response.ok) return items;
      const page = await response.json();
      if (Array.isArray(page)) items.push(...page);
      nextUrl = _getNextLink(response.headers.get('link'));
    }
  } catch (_) { /* swallow */ }
  return items;
}
```

## Contrast with Strict Helpers

| Helper | Non-OK response | Use when |
|--------|----------------|----------|
| `_fetchJson` | throws `ApiError` | Core data — failure means incomplete dashboard |
| `_fetchJsonSoft` | returns `null` | Enrichment data — failure means degraded but safe |
| `_paginate` | throws `ApiError` | Core list data — paginated, must succeed |
| `_paginateSoft` | returns `[]` | Auth-only list data — missing = 0, not error |

## When to Use

- Endpoints that require elevated PAT scopes (e.g., `security_events`, `actions: read`)
- Endpoints that return 403 for repos where the user lacks admin access
- Endpoints that return 404 for repos with the feature disabled (e.g., no Actions, no Dependabot)
- Any field that has a safe "empty" sentinel value in the UI (counts → 0, status → absent)

## Example Callers

```js
async function _fetchWorkflowStatus(fullName, token) {
  const data = await _fetchJsonSoft(
    `${API_BASE}/repos/${fullName}/actions/runs?per_page=1`,
    token
  );
  return _parseWorkflowRun(data); // handles null safely
}

async function _fetchDependabotAlerts(fullName, token) {
  const alerts = await _paginateSoft(
    `${API_BASE}/repos/${fullName}/dependabot/alerts?state=open&per_page=100`,
    token
  );
  return _parseSecurityAlerts(alerts); // handles [] safely
}
```

## Testing the Degradation

```js
test('403 on endpoint → degrades to safe default, no thrown error', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/the-endpoint')) {
      return new Response('{"message":"Forbidden"}', { status: 403 });
    }
    return jsonResponse(defaultData);
  }));
  // Must NOT reject:
  const result = await callFunctionUnderTest();
  expect(result.theField).toBe(0); // or false / null
});
```

## Caveats

- `_paginateSoft` stops at the first failed page. If page 1 succeeds but page 2 fails, you get a partial count. Acceptable for enrichment signals; not acceptable for core data.
- These helpers silently absorb network errors (DNS, timeout). Only use for optional enrichment.
- Always pair with a pure parser function that accepts `null`/`[]` and returns the safe default shape.
