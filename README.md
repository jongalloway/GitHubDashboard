# GitHub Dashboard

A personal project dashboard that tracks status and next steps for your most recent GitHub repositories. Surfaces release readiness, Copilot activity, priority issues, and PR review queues.

**[Live Demo →](https://jongalloway.github.io/GitHubDashboard/)** *(original author's demo — fork and configure your own!)*

![Dashboard Preview](docs/preview.png)

## Use It Yourself

This project is designed to be forked. The committed `data/dashboard.json` shows the original author's repos as an example — once you configure your own username, the workflow overwrites it with your data.

### Quick Setup

1. **Fork** this repository
2. Go to **Settings → Variables → Actions** and add a repository variable:
   - Name: `GITHUB_USERNAME`
   - Value: *your GitHub username*
3. Go to **Settings → Pages** and set Source to **GitHub Actions**
4. Go to **Actions → Update Dashboard** and click **Run workflow**
5. Your dashboard will be live at `https://{your-username}.github.io/GitHubDashboard/`

The workflow runs daily at 6:00 AM UTC and can be triggered manually anytime.

### Local Development

```bash
# Install dependencies
npm install

# Set your username and run the data fetch
export GITHUB_USERNAME=your-username
npm run fetch-data

# Serve locally (any static server works)
npx serve .
```

The fetch script uses the `gh` CLI for authentication. Make sure you're logged in with `gh auth login`.

## How It Works

- **GitHub Actions** runs `scripts/fetch-data.js` on a schedule
- The script fetches your 10 most recently pushed public repos (excluding forks and archived repos)
- It computes next-step heuristics: release overdue, PRs needing review, issues to triage, Copilot activity
- The static frontend (`index.html`) reads `data/dashboard.json` and renders the dashboard
- GitHub Pages serves the result

## Features

- 🚀 **Release readiness** — flags repos with 10+ commits since last release
- 🤖 **Copilot activity** — surfaces `copilot/*` branches and Copilot-authored PRs
- 📋 **Priority issues** — highlights unassigned/unlabeled issues needing triage
- 👀 **PR review queue** — shows PRs awaiting human review
- 🎯 **Next-step signals** — each repo card shows what needs attention and why

## Stack

- Vanilla HTML/CSS/JS (no build tools)
- Node.js for the data pipeline
- GitHub Actions for scheduling
- GitHub Pages for hosting
