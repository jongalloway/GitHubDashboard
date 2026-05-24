# Fenster — History

## Project Context
- **Project:** GitHubDashboard — a personal GitHub Pages dashboard for tracking status and next steps across Jon Galloway's most recent 10 GitHub repos.
- **User:** Jon Galloway
- **Stack:** GitHub Actions, GitHub REST API, GitHub Pages
- **Goal:** Automated data pipeline that fetches repo info and deploys the dashboard

## Learnings

- Built Phase 1 as a single GitHub Actions workflow that refreshes `data/dashboard.json`, commits the generated file, and deploys a Pages artifact in the same run.
- Kept the pipeline reusable by reading the monitored account from `vars.GITHUB_USERNAME` and relying on the built-in `GITHUB_TOKEN` for API access.
- Added a deployment-only placeholder `index.html` fallback in the workflow so Pages remains publishable before frontend assets land.

## Team Coordination (2026-05-23T09:22:49Z)

Scribe consolidated team deliverables:
- **Keyser (Lead):** PRD finalized and approved — Copilot focus + reusability + static architecture locked
- **McManus (Frontend):** Dashboard UI complete — static bundle, GitHub Pages-friendly, framework-free rendering
- **Hockney (Tester):** Test plan created — 148 test cases covering pipeline, UI, deployment, configuration

All decisions (D001-D005) merged into `.squad/decisions.md`. Orchestration logs created for handoff tracking.

## Learnings (2026-05-23 Squad Detection)

- Mirrored the Copilot detection pattern (branch prefix, PR head ref, Contents API file check) to add Squad detection to both `scripts/fetch-data.js` (server pipeline) and `js/github-client.js` (browser pipeline).
- Squad signals: `squad-enabled` (team.md exists), `squad-branch` (squad/ prefix branches), `squad-open-pr` (PRs from squad/ branches), `squad-work-ready` (composite signal for next_steps).
- The browser `_fetchJson` already returns null on 404, making it a drop-in for the Contents API check without extra error handling.
- Both pipelines now emit `squad_activity` in the same shape, keeping the dashboard.json contract consistent for the frontend.
