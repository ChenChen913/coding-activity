# AI Coding Activity

> Turn real Git history into a living documentary of how humans and AI write code together.
>
> **Git is the single source of truth: no fabricated data, no hidden / truncated / sampled commits — every commit is reachable.**

[![Made with](https://img.shields.io/badge/built%20by-Claude%20Code-f59e0b)](https://claude.com/claude-code) [![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%2B%20React%2019-0d9488)](https://nextjs.org)

**[简体中文](README.md) | English**

---

## Table of contents

1. [What is this](#what-is-this)
2. [Screenshots](#screenshots)
3. [Quick start](#quick-start)
4. [Demo dataset: expressjs/express (optional)](#demo-dataset-expressjsexpress-optional)
5. [Core concept: where the data comes from](#core-concept-where-the-data-comes-from)
6. [Daily AI dev workflow: monitoring yourself](#daily-ai-dev-workflow-monitoring-yourself)
7. [Integrating with local agents / IDEs](#integrating-with-local-agents--ides)
8. [GitHub integration & push monitoring](#github-integration--push-monitoring)
9. [Feature overview](#feature-overview)
10. [FAQ](#faq)

---

## What is this

A zero-database, read-only **local visualization dashboard** that works directly on Git repositories:

- **Commit Graph (spatial view)** — a custom SVG lane-layout renderer for the full commit graph, with zoom / pan / search / keyboard navigation, **horizontal / vertical toggle**, and **high-resolution PNG export** (current view at 2× / 3× / 4×, or a full-history poster).
- **Activity Timeline (temporal view)** — all commits and releases grouped by month, with honest counts and windowed rendering (bidirectionally reachable — data is never hidden).
- **Release Timeline (release view)** — one dot per real git tag, swum by major version, expandable down to patch-level detail.
- **AI detection** — identifies Claude / Cursor / Copilot / Gemini / Codex / Aider collaborators through real traces such as `Co-Authored-By` in commit messages. **Never guesses**: no trace, no badge.
- **Commit Detail** — numstat file stats, unified diff, **syntax highlighting + inline word-level change highlighting**, GitHub deep links.
- **Live Events** — GitHub public event stream (a token lifts the rate limit, see below).

## Screenshots

Main dashboard — commit graph of `expressjs/express` (6,436 commits rendered, amber dots mark AI-assisted commits):

![Dashboard overview](screenshots/01-dashboard-overview.png)

Repository insight cards — top contributors, commit rhythm by hour, commit-type conventions, monthly commit density, and the release-timeline swimmers:

![Insight cards](screenshots/02-insight-cards.png)

Activity timeline with the GitHub live event feed:

![Activity timeline and live events](screenshots/03-timeline.png)

Commit detail panel — changed-file stats plus an on-demand unified diff with syntax highlighting and word-level change marks:

![Commit detail panel](screenshots/04-commit-detail.png)

The tool watching itself — this project's own history, where 24 of 38 commits were AI-assisted (amber markers):

![Self repo, AI commits](screenshots/05-self-repo-ai-commits.png)

## Quick start

```bash
git clone https://github.com/ChenChen913/git-activity.git
cd git-activity
bun install        # or npm install
bun run dev        # or npm run dev
# open http://localhost:3000
```

No database to configure — the first version reads everything straight from Git.

**The first run is clean**: the whole `repos/` directory is gitignored, so a fresh clone contains no demo data. The page falls back to `self` (this project's own real history) and shows a guide card explaining how to register your own repositories. Want the 6,430-commit express demo dataset? See the next section.

## Demo dataset: expressjs/express (optional)

The demo data is not in the working tree, but its **full snapshot ships with the repository as a git bundle** (`assets/demo/express.bundle`, ~10 MB) — restorable offline and reproducible across restarts. This is the very demo data synced to GitHub:

```bash
bash scripts/demo.sh status    # show current status
bash scripts/demo.sh restore   # restore repos/demo from the offline bundle (works with zero network)
bash scripts/demo.sh remove    # delete the demo data, back to a clean space
```

- **Local deployments are never affected by demo data**: `restore` is an explicit opt-in; without it the space stays clean, and `remove` returns to the empty state in one step.
- After restoring, origin points back to `github.com/expressjs/express`, so Open on GitHub / Live Events / Releases all work.
- `bash scripts/demo.sh bundle` lets maintainers refresh the snapshot from the current repos/demo.

## Core concept: where the data comes from

### The repository registry (`src/lib/git/repos.ts`)

Every data source is registered here. Two are built in:

| id | name | description |
|---|---|---|
| `demo` | express | full clone of expressjs/express under `repos/demo` (6,000+ commits, real merge history) |
| `self` | git-activity | this project itself — "the tool watching itself being built by AI" |

**Adding your own repository takes 30 seconds** — edit `getRegistry()`:

```ts
{
  id: 'my-app',                    // URL ?repo=my-app
  name: 'my-app',
  path: '/absolute/path/to/my-app',// any local git repository
  description: 'My daily development repo',
},
```

Save and refresh the page — your repository appears in the switcher at the top. **No server restart needed** (APIs re-read the registry on every request).

> Tip: you can also `git clone` remote repositories you want to monitor into the `repos/` directory (`repos/` is gitignored and never committed).

### How data is fetched

- The backend shells out to `git log --format` / `git for-each-ref` / `git diff --numstat` and friends (Node.js runtime, `execFile`, no shell-injection surface).
- API routes live under `/api/git/*`, switching repositories via `?repo=<id>`.
- Every count is the real value: 6,430 commits means 6,430 rendered nodes (the graph clips rendering to the viewport, but the data is complete and every node is navigable).

## Daily AI dev workflow: monitoring yourself

This is the core scenario the project is designed for. Say you write code with Claude Code / Cursor / Copilot every day:

### Step 1: make your AI traces real and traceable

Most AI tools leave a trailer in the commit message automatically:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

- **Claude Code**: adds it automatically (every commit in this repository has one)
- **Cursor / Copilot / Aider**: by default or configurable
- **Add one manually** (works with any agent):

```bash
git commit -m "feat: add login" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Traces recognized by the tool (`src/lib/git/ai.ts`): `Generated with [Claude Code]`, `Co-Authored-By: Claude/Cursor/Copilot/Gemini/Codex/Aider`, and the vendors' noreply addresses.

### Step 2: register your development repositories

See the previous section. Monitoring several at once is recommended: your main project plus one repository you let an AI fully maintain.

### Step 3: how to "look" day to day

| Question | Where to look |
|---|---|
| How many commits involved AI? | The "N AI commits" stat in the top bar + the AI filter chip in the Timeline |
| Which commits are AI-written? | The **amber dot** at the top-right of nodes in the Graph; the amber ✦ marker in the Timeline |
| What did the AI change? | Click any node → detail panel with the diff (syntax highlighting + inline change marks) |
| When was a feature introduced? | Search box → type the message → click → the graph centers on the match |
| Is the release cadence healthy? | Lane density in the Release Timeline + expand for patch detail |
| Recent pushes / PRs / releases? | The Live Events card (lights up once a token is configured) |

### Step 4: after git push

Once you push (and configured `GITHUB_TOKEN`):

- **Live Events** shows real PushEvent / PullRequestEvent / ReleaseEvent / WatchEvent entries.
- GitHub deep links in the detail panel (commit / tree / author / tag) jump straight to the source.
- This repository (`self`) is a living example: it has a GitHub remote, and after a push its own event stream shows "itself being pushed".

## Integrating with local agents / IDEs

### Implemented

- **Any local repository, plug-and-play** — the registry points at a path; no build step, no database.
- **Zero-config hot refresh** — commit in your IDE, refresh the page, it's there (APIs read git live, no stale cache; the event stream is cached for 60 s).
- **The AI trailer protocol** — any agent honoring the `Co-Authored-By` convention (Claude Code, Cursor, Copilot, Aider…) is recognized automatically.
- **Scriptable QA** — the automated browser regressions during development were driven by the `agent-browser` CLI (full log in `worklog.md`); no one-off scripts linger in the repository.

### Recommended workflows (ideas)

1. **Keep it on a second monitor**: run `bun run dev` permanently and glance at the Graph after every commit — the ratio and distribution of AI commits (amber dots) vs. yours at a glance.
2. **Auto-refresh via post-commit hook** (one line):
   ```bash
   # .git/hooks/post-commit (install into the monitored repository)
   # curl-ping this project's API to invalidate the cache, or just refresh the browser
   ```
3. **Make agents report themselves**: write "keep the Co-Authored-By trailer when committing" into your CLAUDE.md / AGENTS.md — this repository does exactly that; the narrative closes the loop.
4. **Weekly-report material**: export the full-history poster PNG (Graph toolbar → Export PNG → Full history poster), or a 3× hi-res shot of the current view.

### Not yet implemented (PRs welcome)

- A web UI for repository registration (currently `repos.ts`)
- WebSocket live push (auto-refresh after commits)
- Multi-repo comparison view / AI-participation trend charts
- CI/CD pipeline activity types (structure ready, waiting on a data source)

## GitHub integration & push monitoring

### Remote resolution

The backend resolves owner/repo from `git remote get-url origin`. With a GitHub remote the following light up automatically:

- The "Open on GitHub" button at the top
- Deep links for every commit
- Release stats and the Release Timeline
- Live Events (token recommended)

### Configuring GITHUB_TOKEN (strongly recommended)

The anonymous GitHub API is rate-limited to 60 requests/hour (often hit when sharing an IP). A token raises this to **5,000 requests/hour**:

```bash
cp .env.example .env.local
# edit .env.local:
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

- `.env.local` is gitignored and **never committed**.
- The token is only used server-side (API routes) and never exposed to the browser.
- Next.js dev mode hot-reloads changes to `.env.local`.

### Pushing to GitHub

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Refresh after pushing — the Live Events card starts showing the real event stream.

## Feature overview

- ✅ Full commit graph (custom lane layout, zoom/pan, search, keyboard navigation, **horizontal/vertical toggle**, bottom commit-info rail in horizontal mode)
- ✅ PNG export (current view at 2×/3×/4×, **full-history poster + commit density strip**, light/dark theme aware, WYSIWYG)
- ✅ **Full-history minimap scrubber** (one dot per commit, honestly unsampled; hover shows date/message; shift+click to pin-point)
- ✅ **Search / type-filter linkage across the whole chain** (node ring/halo/desaturation ↔ minimap ticks ↔ export parity — four views, one visual language)
- ✅ **Commit Density card** (month/week granularity histogram, AI-stacked layers, per-bucket top contributors, click a bucket to jump in the graph)
- ✅ **Locate flash** (GitHub event / search / timeline click → twin radar rings + breathing glow on the node)
- ✅ Activity Timeline (month grouping, type/AI/year filters, windowed rendering, GitHub live event stream)
- ✅ Release Timeline (tag swimmers, patch-level detail, annotated/lightweight distinction)
- ✅ Commit Detail (numstat, diff with **syntax highlighting**, **word-level inline highlights**, deep links)
- ✅ AI collaboration detection (real trailers only, never guesses)
- ✅ Live Events (token lifts the rate limit)
- ✅ Light/dark themes, mobile full-screen Sheet, zero overflow at 390px

## FAQ

**Q: Does a local deployment get polluted by demo data?**
No. `repos/` is gitignored, so cloning brings no demo data; the express snapshot (`assets/demo/express.bundle`) is just a static file — it is never read by the app unless you run `bash scripts/demo.sh restore`.

**Q: Will it modify my repositories?**
No. Every git command is read-only (log / show / diff / for-each-ref) — not even `git status`-level writes.

**Q: The graph shows only some nodes — is data truncated?**
No. That's **viewport culling** (only nodes near the screen render, for smoothness); scroll/drag reaches all 6,430+ commits, and the `1–80 / 6,430` counter at the bottom-right shows the visible range. Poster exports render **everything**.

**Q: Why are some commits not marked as AI?**
Because their messages carry no real AI trace. This is the red line: **no guessing**. Automated commits (e.g. cron) without a trailer stay unmarked.

**Q: What does "showing 1–80 of 6,735" in the timeline mean?**
Render pagination (Load more expands progressively; past 640 rows it becomes a sliding window with a Load earlier control at the top). All activity stays bidirectionally reachable and counts are honest.

**Q: Does it work on Windows?**
The dev environment relies on Unix paths (`process.cwd()` joins), so WSL is recommended on Windows.

---

<div align="center">

**AI Coding Activity** — git is the single source of truth.

</div>
