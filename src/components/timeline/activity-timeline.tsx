'use client'

/**
 * AI Coding Activity — Phase 4 · Activity Timeline
 *
 * Every commit becomes an activity on a unified timeline. Activities are
 * derived client-side from the already-fetched commit list, so the timeline
 * covers 100% of the repository history — no sampling, no fabrication.
 * AI activities are marked only when a real trailer (Co-Authored-By: …,
 * Generated with …) exists on the commit.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  CalendarRange,
  GitCommitHorizontal,
  GitMerge,
  History,
  Loader2,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraphCommit, TimelineActivity } from '@/lib/git/types'

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 80

type TypeFilter = 'all' | 'commits' | 'merges' | 'ai'

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

function deriveActivities(commits: GraphCommit[]): TimelineActivity[] {
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

/* ------------------------------------------------------------------ */
/*  props                                                              */
/* ------------------------------------------------------------------ */

export interface ActivityTimelineProps {
  commits: GraphCommit[]
  loading: boolean
  selectedHash: string | null
  /** select a commit — the graph centers on it and the page scrolls up */
  onSelect: (hash: string) => void
}

/* ------------------------------------------------------------------ */
/*  component                                                          */
/* ------------------------------------------------------------------ */

export function ActivityTimeline({
  commits,
  loading,
  selectedHash,
  onSelect,
}: ActivityTimelineProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [yearFilter, setYearFilter] = useState<number | null>(null)
  const [extra, setExtra] = useState(0)

  /* ---- derive the full activity stream (memoized, all commits) ---- */
  const activities = useMemo(() => deriveActivities(commits), [commits])

  const stats = useMemo(() => {
    let ai = 0
    let merges = 0
    const years = new Map<number, YearBucket>()
    let firstTs: string | null = null
    let lastTs: string | null = null
    for (const a of activities) {
      if (a.aiAgent) ai += 1
      if (a.isMerge) merges += 1
      const y = new Date(a.timestamp).getFullYear()
      const b = years.get(y)
      if (b) {
        b.total += 1
        if (a.aiAgent) b.ai += 1
      } else {
        years.set(y, { year: y, total: 1, ai: a.aiAgent ? 1 : 0 })
      }
      if (!firstTs || a.timestamp < firstTs) firstTs = a.timestamp
      if (!lastTs || a.timestamp > lastTs) lastTs = a.timestamp
    }
    return {
      total: activities.length,
      ai,
      merges,
      commitsOnly: activities.length - merges,
      yearBuckets: [...years.values()].sort((a, b) => a.year - b.year),
      firstTs,
      lastTs,
    }
  }, [activities])

  /* ---- filter pipeline ---- */
  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (typeFilter === 'commits' && a.isMerge) return false
      if (typeFilter === 'merges' && !a.isMerge) return false
      if (typeFilter === 'ai' && !a.aiAgent) return false
      if (yearFilter !== null && new Date(a.timestamp).getFullYear() !== yearFilter)
        return false
      return true
    })
  }, [activities, typeFilter, yearFilter])

  const visibleCount = Math.min(PAGE_SIZE + extra, filtered.length)

  const groups = useMemo(() => {
    const slice = filtered.slice(0, visibleCount)
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
  }, [filtered, visibleCount])

  const now = useMemo(() => Date.now(), [activities])

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
    { key: 'ai', label: 'AI', count: stats.ai, dot: 'bg-amber-500' },
  ]

  /* ---- render ---- */

  return (
    <Card className="overflow-hidden p-0">
      {/* ---------- header ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <History className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Activity Timeline</div>
            <div className="text-[11px] text-muted-foreground">
              every commit as an activity, grouped by month
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
              const h = Math.max(3, Math.round((b.total / maxYearTotal) * 48))
              const active = yearFilter === b.year
              return (
                <button
                  key={b.year}
                  type="button"
                  title={`${b.year} · ${b.total.toLocaleString()} commits${
                    b.ai > 0 ? ` · ${b.ai} AI` : ''
                  }`}
                  aria-label={`Focus year ${b.year}: ${b.total} commits${b.ai > 0 ? `, ${b.ai} AI` : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    setYearFilter(active ? null : b.year)
                    setExtra(0)
                  }}
                  className="group relative flex min-w-[16px] flex-1 shrink-0 cursor-pointer flex-col items-center justify-end gap-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {/* AI marker rides directly above the bar in flow layout —
                      always anchored to the bar top, whatever its height */}
                  {b.ai > 0 && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-200"
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
                  setExtra(0)
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
          {filterChips.map((f) => {
            const active = typeFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setTypeFilter(f.key)
                  setExtra(0)
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
            showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}
          </span>
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
                : 'Try a different type filter.'}
            </p>
          </div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto slim-scrollbar">
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
                  {g.activities.map((a, i) => {
                    const isSelected = a.commitHash === selectedHash
                    const isAi = Boolean(a.aiAgent)
                    return (
                      <li key={a.id} className="relative flex">
                        {/* rail */}
                        <div
                          aria-hidden
                          className="absolute bottom-0 left-[11px] top-0 w-px bg-border"
                        />
                        <div className="relative z-[1] mr-3 flex h-9 items-center">
                          {isAi ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-amber-300 bg-amber-100 shadow-sm"
                            >
                              <Sparkles className="h-3 w-3 text-amber-600" />
                            </motion.span>
                          ) : a.isMerge ? (
                            <motion.span
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-teal-300 bg-teal-50 shadow-sm"
                            >
                              <GitMerge className="h-3 w-3 text-teal-600" />
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
                          title={format(new Date(a.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                          className={`group -my-0.5 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 ${
                            isSelected
                              ? 'bg-accent ring-1 ring-foreground/15'
                              : 'hover:bg-muted/60'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={`truncate text-[13px] ${
                                  isSelected ? 'font-semibold' : 'font-medium'
                                }`}
                              >
                                {a.title}
                              </span>
                              {isAi && (
                                <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                                  ✦ {a.aiAgent}
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
            {visibleCount < filtered.length && (
              <div className="flex items-center justify-center gap-2 border-t px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExtra((e) => e + PAGE_SIZE)}
                >
                  <Loader2 className="mr-1.5 h-3 w-3 rotate-180" />
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount).toLocaleString()} more
                  <span className="ml-1 text-muted-foreground">
                    ({(filtered.length - visibleCount).toLocaleString()} left)
                  </span>
                </Button>
              </div>
            )}

            {/* provenance note */}
            <div className="border-t px-4 py-3 text-[10.5px] leading-relaxed text-muted-foreground sm:px-5">
              Activities are derived from the full commit history — nothing sampled or
              fabricated. AI-assisted marks come from real commit trailers
              (Co-Authored-By / Generated with …). Push, CI and deploy events will join
              this timeline with GitHub integration.
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
