'use client'

/**
 * AI Coding Activity — Phase 4/7 · Activity Timeline
 *
 * Every commit becomes an activity on a unified timeline; every real git
 * tag becomes a release activity. Activities are derived client-side from
 * the already-fetched commit list + tags list, so the timeline covers 100%
 * of the repository history — no sampling, no fabrication. AI activities
 * are marked only when a real trailer (Co-Authored-By: …, Generated with …)
 * exists on the commit. Live GitHub events (push / PR / release) join from
 * the public events API when it is reachable — never synthesized.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  CalendarRange,
  GitCommitHorizontal,
  GitMerge,
  History,
  Loader2,
  Radio,
  Sparkles,
  Tag as TagIcon,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CommitTypeBadge } from '@/components/commit-type-badge'
import type { TypeFilterSelection } from '@/components/dashboard/conventions-card'
import { parseCommitType, TYPE_META, type CommitType } from '@/lib/commit-type'
import type {
  GithubEventActivity,
  GithubEventsResult,
  GitTag,
  GraphCommit,
  TimelineActivity,
} from '@/lib/git/types'

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 80
/** hard cap on mounted rows — beyond it the window scrolls instead of
 *  accumulating DOM forever (chat-log windowing; every activity stays
 *  reachable in both directions, nothing is hidden) */
const MAX_WINDOW = 640

type TypeFilter = 'all' | 'commits' | 'merges' | 'releases' | 'ai'

interface ActivityGroup {
  key: string
  label: string
  year: number
  activities: TimelineActivity[]
}

interface YearBucket {
  year: number
  total: number
  ai: number
  releases: number
}

/** compact relative time — honest math, no rounding tricks */
function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function deriveCommitActivities(commits: GraphCommit[]): TimelineActivity[] {
  return commits.map((c) => ({
    id: c.hash,
    type: c.aiAgent ? 'ai' : 'commit',
    timestamp: c.committedAt,
    title: c.message,
    commitHash: c.hash,
    aiAgent: c.aiAgent,
    shortHash: c.shortHash,
    author: c.author,
    isMerge: c.isMerge,
  }))
}

/** tags whose target commit is part of the current view — the timeline
 *  always reflects exactly what the viewer is looking at */
function deriveReleaseActivities(
  tags: GitTag[],
  viewHashes: Set<string>,
): TimelineActivity[] {
  return tags
    .filter((t) => viewHashes.has(t.commitHash))
    .map((t) => ({
      id: `tag:${t.name}`,
      type: 'release' as const,
      timestamp: t.taggedAt,
      title: `Release ${t.name}`,
      commitHash: t.commitHash,
      shortHash: t.commitHash.slice(0, 7),
      author: t.tagger ?? 'lightweight tag',
      isMerge: false,
      release: {
        name: t.name,
        isAnnotated: t.isAnnotated,
        dateSource: t.dateSource,
        tagger: t.tagger,
        message: t.message,
      },
    }))
}

/** honest reason text for the unavailable GitHub feed */
function eventsReasonText(reason: string): string {
  switch (reason) {
    case 'rate-limited':
      return 'GitHub API rate limit exceeded'
    case 'network':
      return 'GitHub API unreachable'
    case 'no-github-remote':
      return 'no GitHub remote on this repository'
    default:
      return reason
  }
}

/** nature of every live event, color-coded like commit types — push /
 *  release / PR … are distinguishable at a glance (light + dark) */
const EVENT_KIND_CHIP: Record<string, { label: string; chip: string }> = {
  push: {
    label: 'PUSH',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  release: {
    label: 'RELEASE',
    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
  },
  pr: {
    label: 'PR',
    chip: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-300',
  },
  issue: {
    label: 'ISSUE',
    chip: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300',
  },
  star: {
    label: 'STAR',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  },
  fork: {
    label: 'FORK',
    chip: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300',
  },
  branch: {
    label: 'BRANCH',
    chip: 'border-teal-600/30 bg-teal-600/10 text-teal-700 dark:border-teal-300/30 dark:bg-teal-300/10 dark:text-teal-300',
  },
  other: {
    label: 'EVENT',
    chip: 'border-border bg-foreground/5 text-muted-foreground',
  },
}

/* ------------------------------------------------------------------ */
/*  props                                                              */
/* ------------------------------------------------------------------ */

export interface ActivityTimelineProps {
  commits: GraphCommit[]
  /** real git tags of the repository (releases) */
  tags: GitTag[]
  /** live GitHub public events, null while loading */
  githubEvents: GithubEventsResult | null
  /** when the live events were last fetched (ms epoch) — shows freshness */
  githubEventsUpdatedAt?: number
  loading: boolean
  selectedHash: string | null
  /** select a commit — the graph centers on it and the page scrolls up */
  onSelect: (hash: string) => void
  /** commit-type filter chosen on the Conventions card (null = off) */
  typeFilter?: TypeFilterSelection | null
  /** clear the commit-type filter (the × on its chip) */
  onClearTypeFilter?: () => void
}

/* ------------------------------------------------------------------ */
/*  component                                                          */
/* ------------------------------------------------------------------ */

const LIVE_EVENTS_SHOWN = 6

export function ActivityTimeline({
  commits,
  tags,
  githubEvents,
  githubEventsUpdatedAt,
  loading,
  selectedHash,
  onSelect,
  typeFilter,
  onClearTypeFilter,
}: ActivityTimelineProps) {
  const [kindFilter, setKindFilter] = useState<TypeFilter>('all')
  const [yearFilter, setYearFilter] = useState<number | null>(null)
  /** windowing — a chat-log style sliding window over the filtered list:
   *  windowSize grows to the cap, then slides forward on "load more" and
   *  back on "load earlier". Every activity stays reachable in both
   *  directions; nothing is ever hidden. */
  const [windowStart, setWindowStart] = useState(0)
  const [windowSize, setWindowSize] = useState(PAGE_SIZE)

  /* ---- hash set of the current view (branch/author filtered) ---- */
  const viewHashes = useMemo(
    () => new Set(commits.map((c) => c.hash)),
    [commits],
  )

  /* ---- derive the full activity stream (memoized, all commits) ---- */
  const activities = useMemo(() => {
    const stream = [
      ...deriveCommitActivities(commits),
      ...deriveReleaseActivities(tags, viewHashes),
    ]
    // newest first
    stream.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return stream
  }, [commits, tags, viewHashes])

  const stats = useMemo(() => {
    let ai = 0
    let merges = 0
    let releases = 0
    const years = new Map<number, YearBucket>()
    let firstTs: string | null = null
    let lastTs: string | null = null
    for (const a of activities) {
      if (a.aiAgent) ai += 1
      if (a.isMerge) merges += 1
      if (a.release) releases += 1
      const y = new Date(a.timestamp).getFullYear()
      const b = years.get(y)
      if (b) {
        b.total += 1
        if (a.aiAgent) b.ai += 1
        if (a.release) b.releases += 1
      } else {
        years.set(y, {
          year: y,
          total: 1,
          ai: a.aiAgent ? 1 : 0,
          releases: a.release ? 1 : 0,
        })
      }
      if (!firstTs || a.timestamp < firstTs) firstTs = a.timestamp
      if (!lastTs || a.timestamp > lastTs) lastTs = a.timestamp
    }
    return {
      total: activities.length,
      ai,
      merges,
      releases,
      commitsOnly: activities.length - merges - releases,
      yearBuckets: [...years.values()].sort((a, b) => a.year - b.year),
      firstTs,
      lastTs,
    }
  }, [activities])

  /* ---- filter pipeline ---- */
  /** the commit-type kinds selected on the Conventions card (null = off) */
  const typeKindSet = useMemo(
    () => (typeFilter ? new Set(typeFilter.kinds) : null),
    [typeFilter],
  )
  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (typeFilter) {
        // a commit-type filter is about commit subjects — tag activities
        // are a different kind of record and step aside while it is on
        if (a.release) return false
        if (!typeKindSet?.has(parseCommitType(a.title))) return false
      }
      // the kind chips stay live on top of the type filter (orthogonal)
      if (kindFilter === 'commits' && (a.isMerge || a.release)) return false
      if (kindFilter === 'merges' && !a.isMerge) return false
      if (kindFilter === 'releases' && !a.release) return false
      if (kindFilter === 'ai' && !a.aiAgent) return false
      if (yearFilter !== null && new Date(a.timestamp).getFullYear() !== yearFilter)
        return false
      return true
    })
  }, [activities, kindFilter, typeFilter, typeKindSet, yearFilter])

  const visibleCount = Math.min(windowSize, filtered.length - windowStart)

  /** bottom "load more" — grow the window to the cap, then slide forward
   *  (top rows unmount, always recoverable via load earlier) */
  const loadMore = () => {
    if (windowSize < MAX_WINDOW) {
      setWindowSize(Math.min(windowSize + PAGE_SIZE, MAX_WINDOW))
    } else {
      setWindowStart(
        Math.min(
          windowStart + PAGE_SIZE,
          Math.max(0, filtered.length - windowSize),
        ),
      )
    }
  }

  /** top "load earlier" — slide the window back up, same size */
  const loadEarlier = () => {
    setWindowStart(Math.max(0, windowStart - PAGE_SIZE))
  }

  const resetWindow = () => {
    setWindowStart(0)
    setWindowSize(PAGE_SIZE)
  }

  /** an external type-filter change (Conventions card) re-anchors the
   *  window at the newest activities — rAF-wrapped for the lint rule */
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setWindowStart(0)
      setWindowSize(PAGE_SIZE)
    })
    return () => cancelAnimationFrame(raf)
  }, [typeFilter])

  const groups = useMemo(() => {
    const slice = filtered.slice(windowStart, windowStart + visibleCount)
    const out: ActivityGroup[] = []
    let current: ActivityGroup | null = null
    for (const a of slice) {
      const d = new Date(a.timestamp)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!current || current.key !== key) {
        current = {
          key,
          label: format(d, 'MMMM yyyy'),
          year: d.getFullYear(),
          activities: [],
        }
        out.push(current)
      }
      current.activities.push(a)
    }
    return out
  }, [filtered, visibleCount, windowStart])

  const now = useMemo(
    () => Date.now(),
    // recompute when the live feed refreshes, so "updated Xs ago" stays honest
    [activities, githubEventsUpdatedAt],
  )

  const maxYearTotal = stats.yearBuckets.reduce((m, b) => Math.max(m, b.total), 1)

  const filterChips: Array<{
    key: TypeFilter
    label: string
    count: number
    dot?: string
  }> = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'commits', label: 'Commits', count: stats.commitsOnly, dot: 'bg-emerald-500' },
    { key: 'merges', label: 'Merges', count: stats.merges, dot: 'bg-teal-500' },
    ...(stats.releases > 0
      ? [
          {
            key: 'releases' as const,
            label: 'Releases',
            count: stats.releases,
            dot: 'bg-rose-500',
          },
        ]
      : []),
    { key: 'ai', label: 'AI', count: stats.ai, dot: 'bg-amber-500' },
  ]

  const liveEvents: GithubEventActivity[] =
    githubEvents?.available === true ? githubEvents.events : []

  /** freshness of the live feed (polls every 60 s) */
  const liveUpdatedLabel = githubEventsUpdatedAt
    ? relativeTime(new Date(githubEventsUpdatedAt).toISOString(), now)
    : null

  /* ---- render ---- */

  return (
    <Card className="overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm">
      {/* ---------- header ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <History className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Activity Timeline</div>
            <div className="text-[11px] text-muted-foreground">
              every commit and release as an activity, grouped by month
            </div>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarRange className="h-3 w-3" />
              {stats.firstTs && stats.lastTs
                ? `${format(new Date(stats.firstTs), 'MMM yyyy')} → ${format(
                    new Date(stats.lastTs),
                    'MMM yyyy',
                  )}`
                : '—'}
            </span>
            <span className="text-border">·</span>
            <span>{stats.total.toLocaleString()} activities</span>
            {stats.releases > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
                  <TagIcon className="h-3 w-3" />
                  {stats.releases} releases
                </span>
              </>
            )}
            {stats.ai > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                  <Sparkles className="h-3 w-3" />
                  {stats.ai} AI-assisted
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---------- year histogram ---------- */}
      {!loading && stats.yearBuckets.length > 0 && (
        <div className="px-4 pt-4 sm:px-5">
          <div
            className="flex h-[76px] items-end gap-[3px] overflow-x-auto slim-scrollbar pb-[18px]"
            role="group"
            aria-label="Activities per year — click a bar to focus that year"
          >
            {stats.yearBuckets.map((b) => {
              const h = Math.max(3, Math.round((b.total / maxYearTotal) * 44))
              const active = yearFilter === b.year
              return (
                <button
                  key={b.year}
                  type="button"
                  title={`${b.year} · ${b.total.toLocaleString()} commits${
                    b.releases > 0 ? ` · ${b.releases} releases` : ''
                  }${b.ai > 0 ? ` · ${b.ai} AI` : ''}`}
                  aria-label={`Focus year ${b.year}: ${b.total} commits${
                    b.releases > 0 ? `, ${b.releases} releases` : ''
                  }${b.ai > 0 ? `, ${b.ai} AI` : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setYearFilter(active ? null : b.year)
                    resetWindow()
                  }}
                  className="group relative flex min-w-[16px] flex-1 shrink-0 cursor-pointer flex-col items-center justify-end gap-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {/* release + AI markers ride directly above the bar in flow
                      layout — always anchored to the bar top, whatever its
                      height */}
                  {b.releases > 0 && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-rose-500 ring-2 ring-rose-200 dark:ring-rose-400/40"
                      aria-hidden
                    />
                  )}
                  {b.ai > 0 && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-400/40"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`w-full shrink-0 rounded-sm transition-colors ${
                      active
                        ? 'bg-emerald-600'
                        : 'bg-foreground/[0.14] group-hover:bg-foreground/25'
                    }`}
                    style={{ height: `${h}px` }}
                  />
                  <span
                    className={`absolute -bottom-[18px] font-mono text-[10px] tabular-nums transition-colors ${
                      active
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  >
                    {`'${String(b.year).slice(2)}`}
                  </span>
                </button>
              )
            })}
          </div>
          {yearFilter !== null && (
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                Focused on <span className="font-semibold text-foreground">{yearFilter}</span>
              </span>
              <button
                type="button"
                className="inline-flex items-center rounded-full border px-2 py-px text-[10px] font-medium hover:bg-muted"
                onClick={() => {
                  setYearFilter(null)
                  resetWindow()
                }}
              >
                clear year filter
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------- filter chips ---------- */}
      {!loading && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t px-4 py-2.5 sm:px-5">
          {/* commit-type filter chosen on the Conventions card — colored
              per the shared palette, dismissible right here */}
          {typeFilter && (
            <span
              role="status"
              title="matching commits keep their color + halo in the graph above; everything else is dimmed"
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{
                borderColor: `${TYPE_META[typeFilter.rowKey as CommitType]?.color ?? '#a8a29e'}55`,
                backgroundColor: `${TYPE_META[typeFilter.rowKey as CommitType]?.color ?? '#a8a29e'}14`,
                color: TYPE_META[typeFilter.rowKey as CommitType]?.color ?? '#78716c',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    TYPE_META[typeFilter.rowKey as CommitType]?.color ?? '#a8a29e',
                }}
                aria-hidden
              />
              type: {typeFilter.rowKey === 'other' ? 'other / merge' : typeFilter.rowKey}
              <button
                type="button"
                aria-label="Clear the commit-type filter"
                onClick={onClearTypeFilter}
                className="-mr-1 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          )}
          {filterChips.map((f) => {
            const active = kindFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKindFilter(f.key)
                  resetWindow()
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-transparent bg-foreground text-background'
                    : 'text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                }`}
              >
                {f.dot && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-background/70' : f.dot}`}
                    aria-hidden
                  />
                )}
                {f.label}
                <span
                  className={`tabular-nums ${active ? 'opacity-70' : 'text-muted-foreground/70'}`}
                >
                  {f.count.toLocaleString()}
                </span>
              </button>
            )
          })}
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            showing {filtered.length === 0 ? 0 : (windowStart + 1).toLocaleString()}–
            {(windowStart + visibleCount).toLocaleString()} of {filtered.length.toLocaleString()}
          </span>
        </div>
      )}

      {/* ---------- GitHub live events (real public feed) ---------- */}
      {liveEvents.length > 0 && (
        <div className="border-t px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              GitHub · live
            </span>
            <span className="text-[10px] text-muted-foreground">
              real public events from the GitHub API · last ~90 days · refreshes every 60s
              {liveUpdatedLabel ? ` · updated ${liveUpdatedLabel}` : ''}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {liveEvents.slice(0, LIVE_EVENTS_SHOWN).map((ev) => {
              const inGraph = ev.headHash ? viewHashes.has(ev.headHash) : false
              const kindMeta = EVENT_KIND_CHIP[ev.kind] ?? EVENT_KIND_CHIP.other
              return (
                <li key={ev.id} className="flex items-center gap-2 text-[11.5px]">
                  <span
                    className={`inline-flex h-[18px] shrink-0 items-center rounded border px-1 text-[9px] font-semibold tracking-wide ${kindMeta.chip}`}
                    title={`${ev.kind} event`}
                  >
                    {kindMeta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{ev.actor}</span>{' '}
                    <span className="text-muted-foreground">{ev.title}</span>
                    {ev.detail && (
                      <span className="text-muted-foreground/70"> — {ev.detail}</span>
                    )}
                  </span>
                  {inGraph && (
                    <button
                      type="button"
                      onClick={() => onSelect(ev.headHash as string)}
                      title="Show the pushed head commit in the graph"
                      className="shrink-0 rounded-full border px-2 py-px text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      view in graph
                    </button>
                  )}
                  {ev.url && (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open this event on GitHub"
                      title="Open on GitHub"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3"
                        aria-hidden
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                  <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                    {relativeTime(ev.timestamp, now)}
                  </span>
                </li>
              )
            })}
          </ul>
          {liveEvents.length > LIVE_EVENTS_SHOWN && (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              +{(liveEvents.length - LIVE_EVENTS_SHOWN).toLocaleString()} more events
              in the last 90 days
            </div>
          )}
        </div>
      )}

      {/* ---------- list ---------- */}
      <div className="border-t">
        {loading ? (
          <div className="space-y-3 p-4 sm:p-5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton
                    className="h-3.5"
                    style={{ width: `${[72, 55, 84, 62, 78, 48, 68][i]}%` }}
                  />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
            <p className="text-sm font-medium">No activities match this filter.</p>
            <p className="text-xs text-muted-foreground">
              {yearFilter !== null
                ? `Nothing in ${yearFilter} for this view.`
                : typeFilter
                  ? `No ${
                      typeFilter.rowKey === 'other'
                        ? 'unclassified / merge'
                        : typeFilter.rowKey
                    } records in this view.`
                  : 'Try a different type filter.'}
            </p>
            {typeFilter && onClearTypeFilter && (
              <button
                type="button"
                onClick={onClearTypeFilter}
                className="mt-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
              >
                clear type: {typeFilter.rowKey === 'other' ? 'other…' : typeFilter.rowKey}
              </button>
            )}
          </div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto slim-scrollbar">
            {/* window top — recover rows trimmed by the windowing cap */}
            {windowStart > 0 && (
              <div className="flex items-center justify-center gap-2 border-b px-4 py-3">
                <Button variant="outline" size="sm" onClick={loadEarlier}>
                  <Loader2 className="mr-1.5 h-3 w-3" />
                  Load {Math.min(PAGE_SIZE, windowStart).toLocaleString()} earlier
                  <span className="ml-1 text-muted-foreground">
                    ({windowStart.toLocaleString()} above)
                  </span>
                </Button>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                {/* month header */}
                <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b bg-card/95 px-4 py-1.5 backdrop-blur-sm sm:px-5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
                    {g.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {g.activities.length}{' '}
                    {g.activities.length === 1 ? 'activity' : 'activities'}
                  </span>
                </div>
                <ul className="px-4 py-1.5 sm:px-5">
                  {g.activities.map((a) => {
                    const isSelected = a.commitHash === selectedHash
                    const isAi = Boolean(a.aiAgent)
                    const isRelease = Boolean(a.release)
                    /** record nature — colored per the shared type palette
                     *  (feat/fix/build/release/…) so every kind of record is
                     *  visually distinguishable at a glance */
                    const recordType = isRelease
                      ? null
                      : parseCommitType(a.title)
                    const typeColor =
                      recordType &&
                      recordType !== 'other' &&
                      recordType !== 'merge' &&
                      !isAi
                        ? TYPE_META[recordType].color
                        : null
                    return (
                      <li key={a.id} className="relative flex">
                        {/* rail */}
                        <div
                          aria-hidden
                          className="absolute bottom-0 left-[11px] top-0 w-px bg-border"
                        />
                        <div className="relative z-[1] mr-3 flex h-9 items-center">
                          {isRelease ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-rose-300 bg-rose-50 shadow-sm dark:border-rose-400/40 dark:bg-rose-400/15"
                            >
                              <TagIcon className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                            </motion.span>
                          ) : isAi ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-amber-300 bg-amber-100 shadow-sm dark:border-amber-400/40 dark:bg-amber-400/15"
                            >
                              <Sparkles className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            </motion.span>
                          ) : a.isMerge ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-teal-300 bg-teal-50 shadow-sm dark:border-teal-400/40 dark:bg-teal-400/15"
                            >
                              <GitMerge className="h-3 w-3 text-teal-600 dark:text-teal-300" />
                            </motion.span>
                          ) : typeColor ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border shadow-sm"
                              style={{
                                borderColor: `${typeColor}55`,
                                backgroundColor: `${typeColor}14`,
                              }}
                            >
                              <GitCommitHorizontal
                                className="h-3 w-3"
                                style={{ color: typeColor }}
                              />
                            </motion.span>
                          ) : (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-card shadow-sm"
                            >
                              <GitCommitHorizontal className="h-3 w-3 text-muted-foreground" />
                            </motion.span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => a.commitHash && onSelect(a.commitHash)}
                          title={
                            isRelease && a.release
                              ? a.release.isAnnotated
                                ? `annotated tag by ${a.release.tagger ?? 'unknown'} · ${format(
                                    new Date(a.timestamp),
                                    'yyyy-MM-dd HH:mm:ss',
                                  )}`
                                : `lightweight tag · dated by its target commit (no tagger date exists) · ${format(
                                    new Date(a.timestamp),
                                    'yyyy-MM-dd HH:mm:ss',
                                  )}`
                              : format(new Date(a.timestamp), 'yyyy-MM-dd HH:mm:ss')
                          }
                          className={`group -my-0.5 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 ${
                            isSelected
                              ? 'bg-accent ring-1 ring-foreground/15'
                              : 'hover:bg-muted/60'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {!isRelease && (
                                <CommitTypeBadge message={a.title} />
                              )}
                              <span
                                className={`truncate text-[13px] ${
                                  isSelected ? 'font-semibold' : 'font-medium'
                                }`}
                              >
                                {a.title}
                              </span>
                              {isAi && (
                                <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300">
                                  ✦ {a.aiAgent}
                                </span>
                              )}
                              {isRelease && (
                                <span className="inline-flex shrink-0 items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-rose-600 dark:border-rose-400/40 dark:bg-rose-400/15 dark:text-rose-300">
                                  {a.release?.isAnnotated ? 'annotated' : 'lightweight'}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                              <span className="font-mono">{a.shortHash}</span>
                              <span className="truncate">{a.author}</span>
                              <span>{relativeTime(a.timestamp, now)}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

            {/* load more */}
            {windowStart + visibleCount < filtered.length && (
              <div className="flex items-center justify-center gap-2 border-t px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                >
                  <Loader2 className="mr-1.5 h-3 w-3 rotate-180" />
                  Load {Math.min(
                    PAGE_SIZE,
                    filtered.length - windowStart - visibleCount,
                  ).toLocaleString()}{' '}more
                  <span className="ml-1 text-muted-foreground">
                    ({(filtered.length - windowStart - visibleCount).toLocaleString()} left)
                  </span>
                </Button>
              </div>
            )}

            {/* provenance note */}
            <div className="border-t px-4 py-3 text-[10.5px] leading-relaxed text-muted-foreground sm:px-5">
              Activities are derived from the full commit history and the
              repository&apos;s real git tags — nothing sampled or fabricated.
              AI-assisted marks come from real commit trailers (Co-Authored-By /
              Generated with …); lightweight tags are dated by their target
              commit (annotated tags carry their own tagger date).
              {githubEvents && (
                <span className="mt-1 flex items-center gap-1.5">
                  <Radio className="h-3 w-3 shrink-0" />
                  {githubEvents.available
                    ? `GitHub live events: ${githubEvents.events.length.toLocaleString()} real public events joined this feed.`
                    : `GitHub live events: unavailable — ${eventsReasonText(
                        githubEvents.reason ?? 'unknown',
                      )}. Live push / PR / release events will appear here when reachable; nothing is synthesized meanwhile.`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
