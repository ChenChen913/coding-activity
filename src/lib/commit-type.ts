/**
 * AI Coding Activity — commit type system (single source of truth)
 *
 * Classifies real commit subjects by the vocabulary projects actually use
 * (conventional commits `type(scope)!: …`, git's own `Merge …` / `Revert …`
 * messages, `Release 5.0.0` / `bump version` bumps). Nothing is guessed
 * beyond these well-known patterns — unrecognized subjects stay `other`
 * and remain fully visible everywhere.
 *
 * Every surface (graph list, tooltip, search, activity timeline, detail
 * panel, conventions card) derives its colors from TYPE_META so a `fix`
 * is the same color everywhere.
 */

export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'deps'
  | 'ci'
  | 'chore'
  | 'revert'
  | 'release'
  | 'merge'
  | 'other'

/** conventional type word → canonical type (aliases folded in) */
const KNOWN: Record<string, CommitType> = {
  feat: 'feat',
  feature: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  hotfix: 'fix',
  docs: 'docs',
  doc: 'docs',
  documentation: 'docs',
  style: 'style',
  refactor: 'refactor',
  refactoring: 'refactor',
  perf: 'perf',
  performance: 'perf',
  test: 'test',
  tests: 'test',
  build: 'build',
  deps: 'deps',
  dependencies: 'deps',
  dependency: 'deps',
  ci: 'ci',
  chore: 'chore',
  revert: 'revert',
  release: 'release',
}

/**
 * Parse a commit subject into a canonical type.
 *
 * Recognized, in order:
 *  1. git's own merge messages (`Merge branch …`, `Merge pull request #…`)
 *  2. git's own revert messages (`Revert "…"`, `revert: …`)
 *  3. conventional commits `type(scope)!: subject` — `chore(release)` /
 *     `build(release)` and version-scoped chores fold into `release`
 *  4. release-style subjects (`Release 5.0.0`, `v5.0.0`, `bump version`)
 *  5. anything else → `other` (never hidden, just untyped)
 */
export function parseCommitType(message: string): CommitType {
  const msg = message.trim()
  if (!msg) return 'other'

  // 1. git's own merge commits
  if (
    /^merge\s+(branch|pull\s+request|tag|remote-tracking|remote)/i.test(msg) ||
    /^merge\s+.+\s+into\s+/i.test(msg)
  ) {
    return 'merge'
  }

  // 2. reverts — git's quoted form or the conventional `revert: …`
  if (/^revert(\s|:|")/i.test(msg)) return 'revert'

  // 3. conventional commits: type(scope)!: subject
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s/i.exec(msg)
  if (m) {
    const word = m[1].toLowerCase()
    const scope = (m[2] ?? '').toLowerCase()
    const t = KNOWN[word]
    if (!t) return 'other'
    // `chore(release)`, `build(release)`, `chore(version)` → release
    if ((t === 'chore' || t === 'build') && /release|version/.test(scope)) {
      return 'release'
    }
    return t
  }

  // 4. plain release-style subjects
  if (
    /^(release|released|publish|bump)\b/i.test(msg) ||
    /^v?\d+\.\d+\.\d+(\S*)\s/.test(msg) ||
    /^v?\d+\.\d+\.\d+\S*$/.test(msg)
  ) {
    return 'release'
  }

  return 'other'
}

export interface CommitTypeMeta {
  /** canonical hex — used for SVG/inline tints (icons, rails, dots) */
  color: string
  /** Tailwind classes for a small bordered chip (light + dark) */
  chip: string
  /** true when the type is structural (merge) or unclassified — chips are
   *  hidden for these; the row icon / styling already carries the meaning */
  hidden?: boolean
}

/** warm/green/purple palette — no blues, aligned with the dashboard */
export const TYPE_META: Record<CommitType, CommitTypeMeta> = {
  feat: {
    color: '#059669',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  fix: {
    color: '#dc2626',
    chip: 'border-red-500/30 bg-red-500/10 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300',
  },
  docs: {
    color: '#ca8a04',
    chip: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:border-yellow-400/30 dark:bg-yellow-400/10 dark:text-yellow-300',
  },
  style: {
    color: '#ea580c',
    chip: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300',
  },
  refactor: {
    color: '#0d9488',
    chip: 'border-teal-500/35 bg-teal-500/10 text-teal-700 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-300',
  },
  perf: {
    color: '#b45309',
    chip: 'border-amber-600/35 bg-amber-600/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  },
  test: {
    color: '#4d7c0f',
    chip: 'border-lime-600/35 bg-lime-600/10 text-lime-700 dark:border-lime-400/30 dark:bg-lime-400/10 dark:text-lime-300',
  },
  build: {
    color: '#7c2d12',
    chip: 'border-orange-800/35 bg-orange-800/10 text-orange-800 dark:border-orange-300/30 dark:bg-orange-300/10 dark:text-orange-200',
  },
  deps: {
    color: '#9a3412',
    chip: 'border-orange-700/35 bg-orange-700/10 text-orange-700 dark:border-orange-300/30 dark:bg-orange-300/10 dark:text-orange-200',
  },
  ci: {
    color: '#a21caf',
    chip: 'border-fuchsia-600/30 bg-fuchsia-600/10 text-fuchsia-700 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-300',
  },
  chore: {
    color: '#78716c',
    chip: 'border-stone-500/30 bg-stone-500/10 text-stone-600 dark:border-stone-400/30 dark:bg-stone-400/10 dark:text-stone-300',
  },
  revert: {
    color: '#57534e',
    chip: 'border-stone-600/35 bg-stone-600/10 text-stone-700 dark:border-stone-400/30 dark:bg-stone-400/10 dark:text-stone-300',
  },
  release: {
    color: '#e11d48',
    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
  },
  merge: {
    color: '#0f766e',
    hidden: true,
    chip: 'border-teal-700/35 bg-teal-700/10 text-teal-700 dark:border-teal-300/30 dark:bg-teal-300/10 dark:text-teal-200',
  },
  other: {
    color: '#a8a29e',
    hidden: true,
    chip: '',
  },
}

/** display label for a type (uppercase word — chips render it) */
export function typeLabel(t: CommitType): string {
  return t
}
