# Public/Private Dashboard Architecture

## 1. Recommended auth approach

**Use GitHub App Device Flow as the only authentication path.**

Why this is the best fit for this project:
- **Works with a static site** on GitHub Pages: no backend, no token-exchange proxy, no client secret in browser code.
- **Supported by GitHub for headless/public clients** and compatible with vanilla JS.
- **Safer than a PAT**: short-lived user access tokens and refresh tokens are better than asking the owner to paste a long-lived token.
- **More stable for this repo than PKCE-only browser auth**: GitHub's SPA/PKCE story is improving, but Device Flow is the most conservative static-site choice that avoids backend assumptions.
- **Better permission model than a classic OAuth app**: use a GitHub App with only read permissions needed for repo metadata, contents/releases, issues, and pull requests.

**Recommendation details**
- Register a **GitHub App** for this dashboard.
- Enable **Device Flow**.
- Install the app on the owner's account and grant access to the repositories the dashboard should read.
- At runtime, the browser starts Device Flow, shows the GitHub code + verification URL, polls until authorized, verifies the signed-in login matches the configured owner, then fetches private data.

---

## 2. Data flow diagram

```text
PUBLIC PATH
GitHub Actions
  -> scripts/fetch-data.js
  -> data/dashboard.json (public repos only)
  -> GitHub Pages
  -> Browser loads dashboard.json
  -> Render public dashboard

PRIVATE PATH
Owner opens dashboard
  -> Browser loads public dashboard.json first
  -> User clicks "Sign in with GitHub"
  -> GitHub App Device Flow starts
  -> User enters code at github.com/login/device
  -> Browser polls for user token
  -> Browser calls GET /user to verify login matches configured owner
  -> Browser fetches ALL owner repos (public + private)
  -> Browser stores lightweight repo catalog in localStorage
  -> Browser selects visible repos using same rules as public pipeline
     (exclude archived/forks, sort by pushed/updated, max 10)
  -> Browser fetches detailed signals for visible repos only
     (releases, commits, issues, PRs, branches, reviews)
  -> Shared normalization/heuristics module computes dashboard records
  -> Browser writes normalized private snapshot to localStorage
  -> App re-renders from localStorage only

REFRESH PATH
Authenticated app starts
  -> If private cache exists: render cached private snapshot immediately
  -> Else: keep public dashboard.json as placeholder
  -> Refresh GitHub data in background
  -> Replace localStorage snapshot
  -> Re-render from localStorage
```

---

## 3. localStorage schema

Use **normalized cache data**, not raw GitHub API payloads.

### sessionStorage
`ghd.auth.session.v1`

```json
{
  "provider": "github-app-device-flow",
  "owner": "your-username",
  "login": "your-username",
  "accessToken": "...",
  "accessTokenExpiresAt": "2026-05-23T18:00:00Z",
  "refreshToken": "...",
  "refreshTokenExpiresAt": "2026-11-19T18:00:00Z",
  "authenticatedAt": "2026-05-23T10:00:00Z"
}
```

### localStorage
`ghd.private.cache.v1`

```json
{
  "schemaVersion": 1,
  "owner": "your-username",
  "source": "private",
  "fetchedAt": "2026-05-23T10:05:00Z",
  "softStaleAt": "2026-05-23T10:20:00Z",
  "hardStaleAt": "2026-05-24T10:05:00Z",
  "selection": {
    "maxRepos": 10,
    "excludeForks": true,
    "excludeArchived": true,
    "sort": "pushed_or_updated_desc"
  },
  "repoCatalog": [
    {
      "full_name": "owner/repo",
      "name": "repo",
      "html_url": "https://github.com/owner/repo",
      "visibility": "private",
      "description": "...",
      "primary_language": "JavaScript",
      "updated_at": "...",
      "pushed_at": "...",
      "default_branch": "main",
      "is_fork": false,
      "is_archived": false,
      "topics": ["copilot"]
    }
  ],
  "dashboard": {
    "generated_at": "2026-05-23T10:05:00Z",
    "owner": "your-username",
    "repo_count": 10,
    "repos": []
  }
}
```

### Cache rules
- **Render contract:** `dashboard` should match the shape of `data/dashboard.json` so the renderer can stay almost unchanged.
- **Soft stale:** after ~15 minutes, show "Refresh private data" and auto-refresh if token is valid.
- **Hard stale:** after 24 hours, schema mismatch, owner mismatch, or sign-out, discard the cache.
- **Clear on sign-out:** remove both auth session and private cache.
- **Never cache raw tokens in localStorage.**

---

## 4. UI states

### Unauthenticated
- Default load path.
- Render `data/dashboard.json`.
- Header shows **Public view**.
- Primary action: **Sign in with GitHub**.

### Authenticating
- After clicking sign-in, show a compact auth panel in the header:
  - verification code
  - `github.com/login/device`
  - polling status
  - cancel button
- Keep public dashboard visible underneath.

### Authenticated
- After successful auth and owner verification:
  - replace header label with **Private view**
  - show **Refresh private data** and **Sign out** actions
  - render from `localStorage.dashboard` only
  - show last private refresh timestamp

### Refreshing
- If cached private snapshot exists, keep rendering it while refresh runs.
- If no private snapshot exists yet, keep public dashboard as placeholder.
- Show non-blocking status: **Refreshing private data…**
- On success, swap in new private snapshot.
- On failure, keep existing private snapshot if present; otherwise fall back to public view with an error banner.

---

## 5. Security considerations

- **No backend means no truly secure browser storage.** Assume any XSS can expose tokens and private cached data.
- **Store tokens in `sessionStorage`, not `localStorage`.** This limits persistence across browser restarts.
- **Store only normalized private dashboard data in `localStorage`.** Do not store raw GitHub API responses.
- **Verify the signed-in user** with `GET /user`; if the login does not match the configured owner, clear auth and deny private mode.
- **Use minimal GitHub App permissions**: metadata (read), contents (read), issues (read), pull requests (read). Add more only if a required endpoint proves it.
- **Clear private cache on sign-out** and provide an explicit **Clear private cache** control.
- **Do not log tokens** to console, DOM, query strings, or localStorage.
- **Harden the static site against XSS**: keep third-party JS out, preserve safe text rendering, and add a strict CSP where GitHub Pages allows it.
- **Rate-limit browser API calls** with a small concurrency cap (for example 3-4 parallel repo detail fetches).

---

## 6. Implementation plan for McManus

1. **Split data shaping from transport**
   - Refactor `scripts/fetch-data.js` into:
     - a pure normalization/heuristics module shared by Node and browser
     - Node-only GitHub fetch helpers
   - Goal: public pipeline and private browser refresh compute the same fields (`releases`, `copilot_activity`, `priority_issues`, `pending_reviews`, `next_steps`).

2. **Add auth/session manager**
   - Create a small browser auth module for GitHub App Device Flow.
   - Responsibilities: start flow, poll token endpoint, refresh tokens, fetch `/user`, enforce owner match, sign out.

3. **Add browser cache manager**
   - Create a cache module for `sessionStorage` and `localStorage`.
   - Responsibilities: schema versioning, stale checks, clear methods, read/write helpers.

4. **Implement private data fetch pipeline**
   - Fetch **all** owner repos client-side.
   - Persist a lightweight repo catalog in localStorage.
   - Apply the same selection rules as the public pipeline.
   - Fetch detailed repo signals only for the visible repo set.
   - Normalize into the same dashboard payload shape as `data/dashboard.json`.

5. **Update app bootstrap flow**
   - On load, always fetch and render `data/dashboard.json` first.
   - If authenticated and private cache exists, hydrate from localStorage immediately.
   - Kick off background private refresh.
   - After refresh, re-render from localStorage only.

6. **Add UI controls and states**
   - Update `index.html` and CSS for:
     - sign-in button
     - auth/device-code panel
     - private/public badge
     - refresh button
     - sign-out / clear-cache button
     - inline loading + error messaging

7. **Add failure handling**
   - Handle auth timeout/cancel, token expiry, owner mismatch, API rate limit, and partial refresh failure.
   - Rule: never leave the dashboard blank if public data or cached private data exists.

8. **Manual validation pass**
   - Test unauthenticated public load.
   - Test first-time auth with public placeholder.
   - Test cached private load + background refresh.
   - Test sign-out clears private cache.
   - Test owner mismatch blocks private mode.

---

## Bottom line

Keep the existing **public static JSON pipeline** exactly as-is. Add an **owner-only private mode** powered by **GitHub App Device Flow**, **sessionStorage tokens**, and a **normalized private cache in localStorage**. The renderer should consume the same payload shape in both modes so the UI stays simple and the site remains fully static.
