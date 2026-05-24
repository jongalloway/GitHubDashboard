# Decision: Show Discussion Activity per Repo (Issue #15)

**Author:** Keyser  
**Date:** 2026-05-24  
**Issue:** #15

## Context

Issue #15 requests surfacing whether GitHub Discussions are enabled on a repo, with a flag for unanswered discussions. GitHub Discussions have no REST API — only a GraphQL endpoint. The REST repo list payload doesn't include discussion counts; fetching unanswered discussion counts would require additional per-repo API calls.

## Decision

**Option A chosen:** Use `has_discussions` from the existing REST repo object.

The `GET /users/{owner}/repos` response already includes `has_discussions: boolean` on every repo object. This field is fetched as part of the initial repo listing in `buildRepoRecord` — no additional API call is required.

GraphQL (Option B) was considered but rejected: it would require a new POST-based fetch function with different auth/headers, adding complexity for a `value:low` feature.

## Implementation

- `scripts/fetch-data.js`: Added `discussions_enabled: repo.has_discussions === true` to both the success and fallback return objects in `buildRepoRecord`.
- `js/app.js`: Added `buildDiscussionsBadge(repo)` returning a `💬 Discussions` neutral badge when `discussions_enabled` is true. Called from `buildStatusBadges`.

## Trade-offs

- ✅ Zero additional API calls / no rate limit impact  
- ✅ No codebase refactoring  
- ❌ Cannot show unanswered discussion count (requires GraphQL)  
- Unanswered count deferred — acceptable for `value:low` feature
