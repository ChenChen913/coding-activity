#!/usr/bin/env bash
#
# AI Coding Activity — demo dataset manager
#
# The app reads REAL git history only; repos/ is gitignored so a fresh
# clone of this project starts CLEAN (no virtual data). This script makes
# the expressjs/express demo dataset fully opt-in and reproducible:
#
#   bash scripts/demo.sh status    # is the demo restored? is the bundle there?
#   bash scripts/demo.sh restore   # restore repos/demo — offline from the
#                                   # committed bundle (assets/demo/express.bundle),
#                                   # falling back to a GitHub clone when online
#   bash scripts/demo.sh remove    # delete repos/demo — back to a clean space
#   bash scripts/demo.sh bundle    # maintainer: refresh the committed bundle
#                                   # from the current repos/demo
#
# Why a git bundle? It is the demo data itself, committed to this repo and
# pushed to GitHub: it survives sandbox/dev resets, works with zero network,
# and restores the exact same 6,400+ commit history the screenshots show.
# expressjs/express is MIT-licensed — see the LICENSE file inside its history.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT/repos/demo"
BUNDLE="$ROOT/assets/demo/express.bundle"
UPSTREAM="https://github.com/expressjs/express.git"

status() {
  echo "demo repo   : $DEMO_DIR"
  if [ -d "$DEMO_DIR/.git" ]; then
    echo "  restored  : yes ($(git -C "$DEMO_DIR" rev-list --count --all 2>/dev/null || echo '?') commits, HEAD $(git -C "$DEMO_DIR" rev-parse --short HEAD 2>/dev/null || echo '?'))"
  else
    echo "  restored  : no (clean — the app falls back to other registered repos)"
  fi
  echo "bundle      : $BUNDLE"
  if [ -f "$BUNDLE" ]; then
    echo "  present   : yes ($(du -h "$BUNDLE" | cut -f1))"
    echo "  heads in bundle:"
    # (captured first — piping git straight into head raises SIGPIPE)
    local heads
    heads="$(git bundle list-heads "$BUNDLE" || true)"
    echo "$heads" | head -5
  else
    echo "  present   : no (restore will clone from GitHub: $UPSTREAM)"
  fi
}

restore() {
  if [ -d "$DEMO_DIR/.git" ]; then
    echo "demo already restored at $DEMO_DIR — nothing to do."
    echo "run 'bash scripts/demo.sh remove' first for a fresh restore."
    exit 0
  fi
  mkdir -p "$ROOT/repos"
  if [ -f "$BUNDLE" ]; then
    echo "restoring from offline bundle ($BUNDLE)…"
    git clone --quiet "$BUNDLE" "$DEMO_DIR"
    # a plain clone only takes refs/heads/* — the demo dataset's remote
    # branches (refs/remotes/origin/*) live in the bundle too; fetch them
    # explicitly so the graph sees the exact same 6,430 commits
    git -C "$DEMO_DIR" fetch --quiet "$BUNDLE" \
      '+refs/remotes/origin/*:refs/remotes/origin/*'
    # a bundle clone points origin at the bundle file — restore the real
    # upstream so remote parsing / Open-on-GitHub / live events work
    git -C "$DEMO_DIR" remote set-url origin "$UPSTREAM"
    git -C "$DEMO_DIR" fetch --quiet --prune origin || true
  else
    echo "bundle missing — cloning from GitHub ($UPSTREAM)…"
    git clone --quiet "$UPSTREAM" "$DEMO_DIR"
  fi
  echo "restored: $(git -C "$DEMO_DIR" rev-list --count --all) commits @ HEAD $(git -C "$DEMO_DIR" rev-parse --short HEAD)"
  echo "reload the page — the 'demo' repository appears in the switcher."
}

remove() {
  if [ -d "$DEMO_DIR" ]; then
    rm -rf "$DEMO_DIR"
    echo "removed $DEMO_DIR — the workspace is clean again."
  else
    echo "nothing to remove — demo is not restored."
  fi
}

bundle() {
  if [ ! -d "$DEMO_DIR/.git" ]; then
    echo "no repos/demo to bundle from — run 'restore' first." >&2
    exit 1
  fi
  mkdir -p "$ROOT/assets/demo"
  git -C "$DEMO_DIR" bundle create "$BUNDLE" --all
  echo "bundle refreshed: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
}

case "${1:-status}" in
  status)  status ;;
  restore) restore ;;
  remove)  remove ;;
  bundle)  bundle ;;
  *)
    echo "usage: bash scripts/demo.sh {status|restore|remove|bundle}" >&2
    exit 1
    ;;
esac
