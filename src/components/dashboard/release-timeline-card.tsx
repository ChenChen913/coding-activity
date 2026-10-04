'use client'

/**
 * AI Coding Activity — Release Timeline
 *
 * Every real git tag plotted on a horizontal time axis, one lane per major
 * generation (v5 / v4 / v3 …). The full release history of the repository
 * at a glance — 305 points, every single one clickable back into the graph.
 * Data is 100% real (git for-each-ref), dates carry the same honest
 * dateSource semantics as the timeline (tagger vs target commit).
 *
 * Interactions:
 *  - click a dot → open its commit in the graph
 *  - click a lane label → expand that generation's tags as chips,
 *    grouped by minor version (patch-level detail, all of them)
 *  - on mobile the lanes scroll horizontally (with a swipe hint)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { ChevronDown, History, MoveHorizontal, Tag as TagIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GitTag } from '@/lib/git/types'

/* ------------------------------------------------------------------ */
/*  derivation                                                         */
/* ------------------------------------------------------------------ */

/** "v5.2.1" → 5, "4.22.0" → 4, "0.0.1" → 0, "weird-tag" → null */
function majorOf(name: string): number | null {
  const m = name.replace(/^[vV]/, '').match(/^(\d+)/)
  return m ? Number(m[1]) : null
}

/** "v5.2.1" → "5.2", "4.22.0" → "4.22", non-semver → null */
function minorOf(name: string): string | null {
  const m = name.replace(/^[vV]/, '').match(/^(\d+\.\d+)/)
  return m ? m[1] : null
}

interface Generation {
  key: string
  label: string
  tags: GitTag[]
}

interface Props {
  tags: GitTag[]
  loading: boolean
  selectedHash: string | null
  /** open the commit behind a release in the graph */
  onSelect: (hash: string) => void
  className?: string
}

export function ReleaseTimelineCard({
  tags,
  loading,
  selectedHash,
  onSelect,
  className,
}: Props) {
  const [expandedLane, setExpandedLane] = useState<string | null>(null)
  const [hinted, setHinted] = useState(false) // swipe hint dismissed after first scroll
  const [scrollable, setScrollable] = useState(false) // lanes actually overflow?
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /* horizontal overflow can appear when tags load or the viewport resizes */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => setScrollable(el.scrollWidth - el.clientWidth > 8)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tags, loading])

  /* ---- group tags into major generations ---- */
  const { generations, first, last, latest } = useMemo(() => {
    const map = new Map<number, GitTag[]>()
    const others: GitTag[] = []
    let firstTs: string | null = null
    let lastTs: string | null = null

    for (const t of tags) {
      const major = majorOf(t.name)
      if (major === null) others.push(t)
      else {
        const arr = map.get(major)
        if (arr) arr.push(t)
        else map.set(major, [t])
      }
      if (!firstTs || t.taggedAt < firstTs) firstTs = t.taggedAt
      if (!lastTs || t.taggedAt > lastTs) lastTs = t.taggedAt
    }

    const gens: Generation[] = [...map.entries()]
      .map(([major, list]) => ({
        key: `v${major}`,
        label: `v${major}`,
        tags: [...list].sort((a, b) => a.taggedAt.localeCompare(b.taggedAt)),
      }))
      .sort((a, b) => Number(b.key.slice(1)) - Number(a.key.slice(1)))

    if (others.length > 0) {
      gens.push({
        key: 'other',
        label: 'other',
        tags: others.sort((a, b) => a.taggedAt.localeCompare(b.taggedAt)),
      })
    }

    const latestTag = [...tags].sort((a, b) =>
      b.taggedAt.localeCompare(a.taggedAt),
    )[0]

    return {
      generations: gens,
      first: firstTs,
      last: lastTs,
      latest: latestTag,
    }
  }, [tags])

  /* ---- patch-level detail: group a generation by minor version ---- */
  const minorGroups = useMemo(() => {
    const groups = new Map<string, GitTag[]>()
    for (const gen of generations) {
      if (gen.key !== expandedLane) continue
      const plain: GitTag[] = []
      for (const t of gen.tags) {
        const minor = minorOf(t.name)
        if (minor === null) plain.push(t)
        else {
          const arr = groups.get(minor)
          if (arr) arr.push(t)
          else groups.set(minor, [t])
        }
      }
      if (plain.length > 0) groups.set('other', plain)
    }
    // newest minor first
    return [...groups.entries()].sort((a, b) => {
      const na = Number(a[0].split('.')[1])
      const nb = Number(b[0].split('.')[1])
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na
      return a[0] === 'other' ? 1 : b[0] === 'other' ? -1 : 0
    })
  }, [generations, expandedLane])

  /* ---- time axis → percent ---- */
  const expandedGen = useMemo(
    () => generations.find((g) => g.key === expandedLane) ?? null,
    [generations, expandedLane],
  )

  const span =
    first && last ? Math.max(1, new Date(last).getTime() - new Date(first).getTime()) : 1
  const xOf = (iso: string) => {
    const p = ((new Date(iso).getTime() - new Date(first as string).getTime()) / span) * 100
    return Math.min(99.2, Math.max(0.4, p))
  }

  /* ---- year ticks: every other year when the span is long ---- */
  const yearTicks = useMemo(() => {
    if (!first || !last) return [] as number[]
    const y0 = new Date(first).getFullYear()
    const y1 = new Date(last).getFullYear()
    const step = y1 - y0 > 12 ? 2 : 1
    const out: Array<{ year: number; pct: number }> = []
    for (let y = y0 + step; y < y1; y += step) {
      const pct =
        ((new Date(`${y}-01-01T00:00:00Z`).getTime() - new Date(first).getTime()) / span) * 100
      if (pct > 2 && pct < 98) out.push({ year: y, pct })
    }
    return out
  }, [first, last, span])

  const spanYears =
    first && last
      ? ((new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 864e5)).toFixed(1)
      : null

  /* ---- render ---- */

  return (
    <Card
      className={`overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm ${className ?? ''}`}
    >
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <TagIcon className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Release Timeline</div>
            <div className="text-[11px] text-muted-foreground">
              every git tag on a time axis, one lane per major version
            </div>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <History className="h-3 w-3" />
              {first && last
                ? `${format(new Date(first), 'MMM yyyy')} → ${format(new Date(last), 'MMM yyyy')}`
                : '—'}
            </span>
            <span className="text-border">·</span>
            <span>{tags.length.toLocaleString()} releases</span>
            <span className="text-border">·</span>
            <span>
              {generations.length} generations
              {spanYears ? ` · ${spanYears}y` : ''}
            </span>
            {latest && (
              <>
                <span className="text-border">·</span>
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  latest {latest.name}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* lanes — horizontally scrollable on narrow screens so the time axis
          keeps usable resolution instead of being crushed into 6 lanes × 300px */}
      <div className="mt-3 border-t px-2 pb-2 pt-4 sm:px-5">
        {loading ? (
          <div className="space-y-3 py-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-8 shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <TagIcon className="h-5 w-5 text-muted-foreground/50" />
            <div className="text-[12px] font-medium text-muted-foreground">
              No tags in this repository
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              releases appear here when the repository cuts its first tag
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* swipe hint (mobile only, until first scroll) */}
            <div
              className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center bg-gradient-to-l from-card via-card/80 to-transparent pl-8 pr-1.5 transition-opacity duration-500 sm:hidden ${
                hinted || !scrollable ? 'opacity-0' : 'opacity-100'
              }`}
              aria-hidden
            >
              <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                <MoveHorizontal className="h-3.5 w-3.5 animate-pulse" />
                swipe
              </span>
            </div>

            <div
              ref={scrollRef}
              role="group"
              aria-label="Release timeline — each dot is a real git tag, click to open its commit"
              className="slim-scrollbar -mx-1 overflow-x-auto px-1 pb-1"
              onScroll={() => setHinted(true)}
            >
              <div className="min-w-[480px] sm:min-w-0">
                {generations.map((gen, gi) => {
                  const expanded = expandedLane === gen.key
                  return (
                    <motion.div
                      key={gen.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(gi * 0.05, 0.3), ease: 'easeOut' }}
                      className="flex items-center gap-3"
                    >
                        {/* lane label — click to expand patch-level detail */}
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedLane(expanded ? null : gen.key)
                            // bring lane labels back into view when opening detail
                            if (!expanded) scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
                          }}
                          aria-expanded={expanded}
                          title={`${gen.label} — ${gen.tags.length} tags, click for patch-level detail`}
                          className={`flex w-9 shrink-0 items-center justify-end gap-0.5 rounded font-mono text-[10px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                            expanded
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {gen.label}
                          <ChevronDown
                            className={`h-2.5 w-2.5 transition-transform duration-200 ${
                              expanded ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {/* lane body */}
                        <div className="relative h-6 min-w-0 flex-1">
                          {/* baseline */}
                          <div
                            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border"
                            aria-hidden
                          />
                          {/* active span (first → last tag of the generation) */}
                          {gen.tags.length > 1 && (
                            <div
                              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-rose-500/20"
                              style={{
                                left: `${xOf(gen.tags[0].taggedAt)}%`,
                                width: `${Math.max(
                                  0.6,
                                  xOf(gen.tags[gen.tags.length - 1].taggedAt) -
                                    xOf(gen.tags[0].taggedAt),
                                )}%`,
                              }}
                              aria-hidden
                            />
                          )}
                          {/* every tag = one dot (all of them, no sampling) */}
                          {gen.tags.map((t) => {
                            const isLatest = latest?.name === t.name
                            const isSelected = t.commitHash === selectedHash
                            return (
                              <button
                                key={t.name}
                                type="button"
                                onClick={() => onSelect(t.commitHash)}
                                title={`${t.name} · ${format(new Date(t.taggedAt), 'yyyy-MM-dd')}${
                                  t.tagger ? ` · ${t.tagger}` : ''
                                } · ${t.isAnnotated ? 'annotated' : 'lightweight'} tag`}
                                aria-label={`Release ${t.name}, ${format(new Date(t.taggedAt), 'yyyy-MM-dd')}. Show its commit in the graph.`}
                                className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                style={{ left: `${xOf(t.taggedAt)}%` }}
                              >
                                <span
                                  className={`block rounded-full transition-all group-hover:scale-[1.7] ${
                                    isSelected
                                      ? 'h-2.5 w-2.5 bg-rose-600 ring-2 ring-rose-300 dark:ring-rose-400/50'
                                      : isLatest
                                        ? 'h-2 w-2 bg-rose-500 ring-2 ring-rose-200 dark:ring-rose-400/40'
                                        : 'h-[7px] w-[7px] bg-rose-400/80 group-hover:bg-rose-500 dark:bg-rose-500/70'
                                  }`}
                                />
                              </button>
                            )
                          })}
                        </div>
                        {/* generation count — flex sibling of the lane body, never
                            clipped by dots at the right edge */}
                        <span className="w-8 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground/60">
                          {gen.tags.length}
                        </span>
                      </motion.div>
                  )
                })}

                {/* year axis */}
                <div className="mt-1 flex items-center gap-3">
                  <span className="w-9 shrink-0" />
                  <span className="w-8 shrink-0" aria-hidden />
                  <div className="relative h-4 min-w-0 flex-1">
                    {first && (
                      <span className="absolute left-0 top-0 font-mono text-[9px] tabular-nums text-muted-foreground/70">
                        {format(new Date(first), 'yyyy')}
                      </span>
                    )}
                    {yearTicks.map((t) => (
                      <span
                        key={t.year}
                        className="absolute top-0 font-mono text-[9px] tabular-nums text-muted-foreground/50"
                        style={{ left: `${t.pct}%`, transform: 'translateX(-50%)' }}
                      >
                        {t.year}
                      </span>
                    ))}
                    {last && (
                      <span className="absolute right-6 top-0 font-mono text-[9px] tabular-nums text-muted-foreground/70">
                        {format(new Date(last), 'yyyy')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* patch-level detail strip — OUTSIDE the horizontal scroller so
                chips always span the full visible card width and never get
                clipped mid-chip while the lanes are scrolled */}
            <AnimatePresence initial={false}>
              {expandedLane && (
                <motion.div
                  key={`detail-${expandedLane}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 max-h-44 overflow-y-auto rounded-md border bg-muted/30 px-2.5 py-2 slim-scrollbar">
                    {minorGroups.map(([minor, list]) => (
                      <div
                        key={minor}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-0.5"
                      >
                        <span className="w-10 shrink-0 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
                          {minor}
                        </span>
                        {list
                          .slice()
                          .sort((a, b) => b.taggedAt.localeCompare(a.taggedAt))
                          .map((t) => {
                            const isSelected = t.commitHash === selectedHash
                            const isLatest = latest?.name === t.name
                            return (
                              <button
                                key={t.name}
                                type="button"
                                onClick={() => onSelect(t.commitHash)}
                                title={`${t.name} · ${format(new Date(t.taggedAt), 'yyyy-MM-dd')}${
                                  t.tagger ? ` · ${t.tagger}` : ''
                                } · ${t.isAnnotated ? 'annotated' : 'lightweight'} tag`}
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                                  isSelected
                                    ? 'border-rose-400 bg-rose-500/15 text-rose-700 dark:border-rose-500/60 dark:text-rose-300'
                                    : isLatest
                                      ? 'border-rose-300/70 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300'
                                      : 'border-border/70 bg-card text-muted-foreground hover:border-rose-300/70 hover:text-foreground'
                                }`}
                              >
                                {/* annotated vs lightweight marker */}
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    t.isAnnotated
                                      ? 'bg-rose-500/70'
                                      : 'border border-rose-500/50'
                                  }`}
                                  aria-hidden
                                />
                                {t.name.replace(/^[vV]/, '')}
                                <span className="text-muted-foreground/60">
                                  {format(new Date(t.taggedAt), 'yy-MM-dd')}
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    ))}
                    {expandedGen && (
                      <p className="mt-1 border-t pt-1.5 text-[9.5px] leading-relaxed text-muted-foreground/70">
                        {expandedGen.tags.length} tags in {expandedGen.label} · filled dot =
                        annotated tag, hollow = lightweight · click a chip to open its commit
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* provenance */}
      {!loading && tags.length > 0 && (
        <div className="border-t px-4 py-2.5 text-[10.5px] text-muted-foreground sm:px-5">
          {tags.length.toLocaleString()} real git tags — annotated tags dated by their
          tagger, lightweight tags by the tagged commit. Click any dot to open it in the
          graph, or a lane label for patch-level detail.
        </div>
      )}
    </Card>
  )
}
