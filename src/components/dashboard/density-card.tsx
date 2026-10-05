'use client'

/**
 * AI Coding Activity — Commit Density over time
 *
 * Every commit bucketed by calendar month OR calendar week (Monday-aligned,
 * oldest → newest, left → right). Amber segments stack from the baseline =
 * the AI-assisted share (real trailer evidence, never guessed); empty
 * buckets stay empty — quiet periods are honest periods. Hover a bucket for
 * exact counts and that bucket's top contributors, click to jump the graph
 * to that bucket's latest commit.
 */

import { memo, useMemo, useState } from 'react'
import { BarChart3, MousePointerClick, Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'
import type { GraphCommit } from '@/lib/git/types'

type Granularity = 'month' | 'week'

interface Bucket {
  count: number
  aiCount: number
  /** newest commit hash in this bucket (click target) */
  lastHash: string | null
  /** committedAt of that newest commit */
  lastAt: number
  /** 2024-03 (month) or 2024-03-11 (week start) */
  label: string
  /** year of the bucket's start date — drives the year axis labels */
  year: number
  /** first bucket of a new calendar year (month mode: the January bar) */
  isFirstOfYear: boolean
  /** top contributors inside this bucket, count-desc, max 3 */
  top: { name: string; count: number }[]
}

export interface DensityCardProps {
  commits: GraphCommit[]
  loading: boolean
  /** jump the graph to a commit (click on a bucket bar) */
  onSelect: (hash: string) => void
  /** committedAt of the currently selected commit (marker under its bucket) */
  selectedAt?: string | null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** local midnight of t (DST-safe anchor) */
function midnight(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function bucketize(commits: GraphCommit[], g: Granularity): Bucket[] {
  if (commits.length === 0) return []
  let minT = Infinity
  let maxT = -Infinity
  for (const c of commits) {
    const t = Date.parse(c.committedAt)
    if (Number.isFinite(t)) {
      if (t < minT) minT = t
      if (t > maxT) maxT = t
    }
  }
  if (!Number.isFinite(minT) || maxT < minT) return []

  const buckets: Bucket[] = []
  const authors: Map<string, number>[] = []

  const push = (label: string, year: number, isFirstOfYear: boolean) => {
    buckets.push({
      count: 0,
      aiCount: 0,
      lastHash: null,
      lastAt: 0,
      label,
      year,
      isFirstOfYear,
      top: [],
    })
    authors.push(new Map())
  }

  if (g === 'week') {
    // Monday-aligned local midnights; Date(y, m, d ± n) normalizes
    // across DST (never do millisecond arithmetic on local midnights)
    const m0 = new Date(midnight(minT))
    const dow = (m0.getDay() + 6) % 7 // Mon=0 … Sun=6
    const startD = new Date(
      m0.getFullYear(),
      m0.getMonth(),
      m0.getDate() - dow,
    )
    const endMid = midnight(maxT)
    let prevYear = -1
    for (let d = startD; d.getTime() <= endMid; ) {
      const y = d.getFullYear()
      push(
        `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        y,
        y !== prevYear,
      )
      prevYear = y
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
    }
  } else {
    const dA = new Date(minT)
    const dB = new Date(maxT)
    for (
      let t = new Date(dA.getFullYear(), dA.getMonth(), 1).getTime();
      t <= new Date(dB.getFullYear(), dB.getMonth(), 1).getTime();
      t = new Date(t).setMonth(new Date(t).getMonth() + 1)
    ) {
      const d = new Date(t)
      const y = d.getFullYear()
      push(`${y}-${pad2(d.getMonth() + 1)}`, y, d.getMonth() === 0)
    }
  }

  // bucket index of t, per granularity (all date math, DST-safe)
  const m0 = new Date(midnight(minT))
  const dow0 = (m0.getDay() + 6) % 7
  const weekStart = new Date(
    m0.getFullYear(),
    m0.getMonth(),
    m0.getDate() - dow0,
  ).getTime()
  const dA = new Date(minT)
  const idx = (t: number): number => {
    if (g === 'week') {
      const days = Math.round((midnight(t) - weekStart) / 86_400_000)
      return Math.floor(days / 7)
    }
    const d = new Date(t)
    return (
      (d.getFullYear() - dA.getFullYear()) * 12 + (d.getMonth() - dA.getMonth())
    )
  }

  for (const c of commits) {
    const t = Date.parse(c.committedAt)
    if (!Number.isFinite(t)) continue
    const i = idx(t)
    const b = buckets[i]
    if (!b) continue
    b.count += 1
    if (c.aiAgent) b.aiCount += 1
    if (t >= b.lastAt) {
      b.lastAt = t
      b.lastHash = c.hash
    }
    const m = authors[i]
    m.set(c.author, (m.get(c.author) ?? 0) + 1)
  }
  for (let i = 0; i < buckets.length; i++) {
    buckets[i].top = [...authors[i].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }))
  }
  return buckets
}

export function DensityCard({
  commits,
  loading,
  onSelect,
  selectedAt,
}: DensityCardProps) {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [hovered, setHovered] = useState<number | null>(null)

  const buckets = useMemo(
    () => bucketize(commits, granularity),
    [commits, granularity],
  )
  const stats = useMemo(() => {
    let ai = 0
    let peak = -1
    let quiet = 0
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]
      ai += b.aiCount
      if (b.count === 0) quiet += 1
      if (peak < 0 || b.count > buckets[peak].count) peak = i
    }
    return { ai, peak, quiet }
  }, [buckets])

  const max = Math.max(1, ...buckets.map((b) => b.count))
  const B = buckets.length

  /** bucket index of the selected commit (marker under the strip) */
  const selectedBucket = useMemo(() => {
    if (!selectedAt || B === 0) return null
    const d = new Date(selectedAt)
    if (Number.isNaN(d.getTime())) return null
    const t = d.getTime()
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]
      // every bucket covers the month/week starting at its label date
      const start = Date.parse(
        granularity === 'week' ? b.label : `${b.label}-01`,
      )
      const next = i + 1 < buckets.length
        ? Date.parse(
            granularity === 'week'
              ? buckets[i + 1].label
              : `${buckets[i + 1].label}-01`,
          )
        : Infinity
      if (t >= start && t < next) return i
    }
    return null
  }, [selectedAt, buckets, B, granularity])

  const hoveredBucket = hovered !== null ? buckets[hovered] : null
  const unitWord = granularity === 'week' ? 'week' : 'month'

  return (
    <Card className="overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              Commit Density
            </div>
            <div className="text-[11px] text-muted-foreground">
              how this repository breathes over time — one bar per{' '}
              {unitWord}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* legend — honest totals, same language as the poster export */}
          {!loading && commits.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-[2px] bg-amber-500"
                  aria-hidden
                />
                AI-assisted ({stats.ai.toLocaleString()})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-[2px] bg-foreground/[0.15]"
                  aria-hidden
                />
                other commits
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                <MousePointerClick className="h-3 w-3" aria-hidden />
                click a {unitWord} to jump
              </span>
            </div>
          )}
          {/* granularity switch */}
          <ToggleGroup
            type="single"
            value={granularity}
            onValueChange={(v) => {
              if (v === 'month' || v === 'week') {
                setGranularity(v)
                setHovered(null)
              }
            }}
            aria-label="Density granularity"
            className="rounded-md border bg-background p-0.5"
          >
            <ToggleGroupItem
              value="month"
              className="h-5 gap-1 px-2.5 text-[10.5px] font-medium"
            >
              Month
            </ToggleGroupItem>
            <ToggleGroupItem
              value="week"
              className="h-5 gap-1 px-2.5 text-[10.5px] font-medium"
            >
              Week
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* chart */}
      <div className="px-4 pb-4 pt-4 sm:px-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[96px] w-full" />
            <Skeleton className="mx-auto h-2.5 w-1/3" />
          </div>
        ) : commits.length === 0 || B === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BarChart3 className="h-5 w-5 text-muted-foreground/50" />
            <div className="text-[12px] font-medium text-muted-foreground">
              No commits in view
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              clear the branch or author filter to see the rhythm of work
            </div>
          </div>
        ) : (
          <>
            {/* bar strip — relative so the hover tooltip and selected
                marker can position themselves over it */}
            <div className="relative">
              {/* hover tooltip */}
              {hoveredBucket && (
                <div
                  role="status"
                  className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 font-mono text-[10px] tabular-nums text-popover-foreground shadow-md"
                  style={{
                    left: `clamp(64px, ${(((hovered ?? 0) + 0.5) / B) * 100}%, calc(100% - 64px))`,
                  }}
                >
                  <div className="whitespace-nowrap">
                    {hoveredBucket.label}
                    <span className="mx-1 text-border">·</span>
                    <span className="font-semibold">
                      {hoveredBucket.count.toLocaleString()}
                    </span>{' '}
                    commit{hoveredBucket.count === 1 ? '' : 's'}
                    {hoveredBucket.aiCount > 0 && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                        <Sparkles
                          className="h-2.5 w-2.5"
                          aria-hidden
                        />
                        {hoveredBucket.aiCount} AI
                      </span>
                    )}
                  </div>
                  {hoveredBucket.top.length > 0 && (
                    <div className="mt-0.5 max-w-[300px] truncate text-muted-foreground">
                      {hoveredBucket.top
                        .map((a) => `${a.name} ×${a.count}`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex h-[96px] items-end gap-[1px]">
                {buckets.map((b, i) => (
                  <BarSlot
                    key={i}
                    b={b}
                    i={i}
                    isPeak={i === stats.peak}
                    max={max}
                    onSelect={onSelect}
                    onHover={setHovered}
                  />
                ))}
              </div>

              {/* selected-commit marker — same language as the minimap */}
              {selectedBucket !== null && selectedBucket >= 0 && (
                <div
                  className="pointer-events-none absolute -bottom-1 h-[calc(100%+6px)] w-[2px] -translate-x-1/2 rounded-full bg-foreground/60"
                  style={{
                    left: `${((selectedBucket + 0.5) / B) * 100}%`,
                  }}
                  aria-hidden
                />
              )}
            </div>

            {/* year labels — one label at each year boundary bar, aligned
                to its bar column; odd years hide on small screens to avoid
                crowding (they reappear ≥sm) */}
            <div className="relative mt-1.5 h-3.5">
              {buckets.map((b, i) =>
                b.isFirstOfYear ? (
                  <span
                    key={i}
                    className={`absolute top-0 -translate-x-1/2 font-mono text-[9px] tabular-nums text-muted-foreground/70 ${
                      b.year % 2 !== 0 ? 'hidden sm:inline' : ''
                    }`}
                    style={{ left: `${(i / B) * 100}%` }}
                  >
                    {b.year}
                  </span>
                ) : null,
              )}
            </div>

            {/* summary line */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10.5px] tabular-nums text-muted-foreground">
              {hoveredBucket ? (
                <span>
                  <span className="font-semibold text-foreground">
                    {hoveredBucket.label}
                  </span>{' '}
                  · {hoveredBucket.count.toLocaleString()} commits
                  {hoveredBucket.aiCount > 0 &&
                    ` · ${hoveredBucket.aiCount} AI-assisted`}
                  {hoveredBucket.top[0] &&
                    ` · top: ${hoveredBucket.top[0].name} ×${hoveredBucket.top[0].count}`}
                </span>
              ) : stats.peak >= 0 ? (
                <span>
                  busiest {unitWord}:{' '}
                  <span className="font-semibold text-foreground">
                    {buckets[stats.peak].label}
                  </span>{' '}
                  · {buckets[stats.peak].count.toLocaleString()} commits ·{' '}
                  {B.toLocaleString()} {unitWord}s total, {stats.quiet} quiet
                </span>
              ) : null}
              <span className="text-muted-foreground/70">
                calendar {granularity === 'week' ? 'weeks (Mon)' : 'months'}{' '}
                · browser-local time
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

/**
 * Slot wrapper — carries the stable per-bar props into the memoized
 * BucketBar. The index lives here (not inside BucketBar) so memo works:
 * hovering changes only `hovered` in the parent, BucketBar props stay
 * referentially equal and ~780 week bars skip re-render entirely.
 */
const BarSlot = memo(function BarSlot({
  b,
  i,
  isPeak,
  max,
  onSelect,
  onHover,
}: {
  b: Bucket
  i: number
  isPeak: boolean
  max: number
  onSelect: (hash: string) => void
  onHover: (i: number | null) => void
}) {
  const hPct = b.count === 0 ? 0 : (b.count / max) * 100
  const aiPct = b.count === 0 ? 0 : (b.aiCount / b.count) * hPct
  const delay = Math.min(i * 0.004, 0.4)
  return (
    <button
      type="button"
      disabled={!b.lastHash}
      onClick={() => b.lastHash && onSelect(b.lastHash)}
      onMouseEnter={() => onHover(i)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(i)}
      onBlur={() => onHover(null)}
      aria-label={`${b.label}: ${b.count} commits${b.aiCount > 0 ? `, ${b.aiCount} AI-assisted` : ''}${b.lastHash ? ' — jump to this bucket' : ''}`}
      title={
        b.lastHash
          ? `${b.label} — ${b.count} commits · click to jump`
          : `${b.label} — no commits`
      }
      className="group relative flex h-full min-w-[1px] flex-1 cursor-pointer flex-col justify-end outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
    >
      {hPct > 0 && (
        <>
          {aiPct > 0 && (
            <span
              className="density-bar block w-full rounded-b-[1px] bg-amber-500"
              style={{ height: `${aiPct}%`, animationDelay: `${delay}s` }}
            />
          )}
          <span
            className={`density-bar block w-full transition-colors ${
              isPeak
                ? 'bg-emerald-600/80'
                : 'bg-foreground/[0.16] group-hover:bg-emerald-500/70'
            } ${aiPct > 0 ? 'rounded-t-[1px]' : 'rounded-[1px]'}`}
            style={{
              height: `${Math.max(hPct - aiPct, 2)}%`,
              animationDelay: `${delay}s`,
            }}
          />
        </>
      )}
    </button>
  )
})
