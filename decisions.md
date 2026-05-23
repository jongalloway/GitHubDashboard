# Project Decisions

## Decision: keep dashboard data runtime-generated
**Date:** 2026-05-23

- Added root-level gitignore rules for `data/*` while preserving `data/.gitkeep`.
- Kept directory creation in `scripts/fetch-data.js` as the source of truth because it already calls `fs.mkdir(..., { recursive: true })` before writing `data/dashboard.json`.
- Removed the workflow step that committed generated dashboard data back into the repository so GitHub Actions only produces the file for the Pages artifact.
- Updated the frontend error state to explicitly tell users to run the workflow after setting `GITHUB_USERNAME` when `data/dashboard.json` is missing.

---

## Decision: Fenster local pipeline test
**Date:** 2026-05-23

- Decision: Use `gh auth token` to provide `GITHUB_TOKEN` for the local fetch run and treat the current pipeline as healthy without code changes.
- Why: The authenticated run completed successfully, generated `data/dashboard.json` with live repository data for `jongalloway`, and the output included the PRD data contract fields (`releases`, `copilot_activity`, `priority_issues`, `pending_reviews`, `next_steps`).

---

## Decision: static public/private dashboard split
**Date:** 2026-05-23

- Decision: Keep the existing public `data/dashboard.json` path for anonymous visitors, and add an owner-only private mode using **GitHub App Device Flow** with browser-side fetching and caching.
- Why:
  - Preserves the project's static-site constraint on GitHub Pages.
  - Avoids shipping a client secret or introducing a proxy/backend.
  - Gives better security posture than manual PAT entry while still working in vanilla JS.
  - Lets the dashboard keep rendering the same normalized payload shape in both public and private modes.
- Storage:
  - Tokens live in `sessionStorage`.
  - Normalized private dashboard data lives in `localStorage`.
- Data strategy:
  - Fetch all owner repos client-side.
  - Store a lightweight repo catalog for all repos.
  - Compute detailed dashboard signals for the visible repo set using shared heuristics extracted from `scripts/fetch-data.js`.
- UX:
  - Public `dashboard.json` remains the default and placeholder state.
  - Authenticated mode renders entirely from local cache and refreshes in the background.

---

## Decision: Private Auth System — Browser-Side Implementation Choices (D006)
**Date:** 2026-05-23  
**Author:** McManus (Frontend Dev)  
**Status:** Proposed  
**Status:** Under review (Keyser)

### Decision 1: `window.GHD` global namespace pattern

All new JS modules (`auth.js`, `cache.js`, `github-client.js`) use `window.GHD = window.GHD || {}` as a shared namespace and register themselves on it (e.g., `GHD.Auth`, `GHD.Cache`, `GHD.GitHubClient`). `app.js` consumes these via `window.GHD.Auth` etc. This maintains IIFE-only, no-ES-module compatibility required for GitHub Pages without a build step.

### Decision 2: Per-PR review state API calls skipped in browser pipeline

The server-side pipeline (`scripts/fetch-data.js`) calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` for every open PR to determine whether it has been approved or had changes requested. This is omitted from the browser pipeline in `js/github-client.js` to limit API call volume. The browser path treats all open non-draft PRs as pending review (conservative). This produces slightly higher `pending_reviews.count` values in private mode vs. public for repos with approved/changes-requested PRs, which is acceptable.

### Decision 3: Sign-out triggers page reload

On sign-out, `app.js` calls `Auth.signOut()` (clears sessionStorage + localStorage cache) and then `window.location.reload()`. This is the simplest way to restore the public-only view without partial state leaking into the rendered DOM. The alternative (in-place re-render from public data) was more complex and provided no meaningful UX benefit.

### Decision 4: `CLIENT_ID` placeholder warns in console only

When `CLIENT_ID` is still the placeholder value `'YOUR_GITHUB_APP_CLIENT_ID'` and the user enters the private auth path, `app.js` emits a `console.warn`. It does not surface an error in the DOM because the auth will fail gracefully at the `startAuth()` step with a clear error message in the device-flow status panel.

### Decision 5: Auth panel is inside `page-shell`, below the `<header>`

The device-code authorization panel is positioned between the header and `<main>` in the DOM. It is `hidden` by default and shown only during the sign-in device-flow phase. This keeps it visually adjacent to the auth controls in the header without modifying the header layout significantly.

