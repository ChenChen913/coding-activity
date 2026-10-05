'use client'

/**
 * AI Coding Activity — Commit Density over time
 *
 * Every commit bucketed by calendar month (oldest → newest, left → right).
 * Amber segments stack from the baseline = the AI-assisted share (real
 * trailer evidence, never guessed); empty months stay empty — quiet
 * periods are honest periods. Hover a month for exact counts, click to
 * jump the graph to that month's latest commit.
 */

import { useMemo, useState } from 'react'
import { BarChart3, MousePointerClick, Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraphCommit } from '@/lib/git/types'

interface MonthBucket {
  year: number
  month: number // 0–11
  count: number
  aiCount: number
  /** newest commit hash in this bucket (click target) */
  lastHash: string | null
  /** committedAt of that newest commit */
  lastAt: number
}

export interface DensityCardProps {
  commits: GraphCommit[]
  loading: boolean
  /** jump the graph to a commit (click on a month bar) */
  onSelect: (hash: string) => void
  /** committedAt of the currently selected commit (marker under its month) */
  selectedAt?: string | null
}

function bucketize(commits: GraphCommit[]): MonthBucket[] {
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

  const dA = new Date(minT)
  const dB = new Date(maxT)
  const start = new Date(dA.getFullYear(), dA.getMonth(), 1).getTime()
  const end = new Date(dB.getFullYear(), dB.getMonth(), 1).getTime()
  const months: MonthBucket[] = []
  for (let t = start; t <= end; t = new Date(t).setMonth(new Date(t).getMonth() + 1)) {
    months.push({ year: new Date(t).getFullYear(), month: new Date(t).getMonth(), count: 0, aiCount: 0, lastHash: null, lastAt: 0 })
  }
  const idx = (t: number) => {
    const d = new Date(t)
    return (
      (d.getFullYear() - dA.getFullYear()) * 12 +
      (d.getMonth() - dA.getMonth())
    )
  }
  for (const c of commits) {
    const t = Date.parse(c.committedAt)
    if (!Number.isFinite(t)) continue
    const i = idx(t)
    const b = months[i]
    if (!b) continue
    b.count += 1
    if (c.aiAgent) b.aiCount += 1
    if (t >= b.lastAt) {
      b.lastAt = t
      b.lastHash = c.hash
    }
  }
  return months
}

const MONTH_LABEL = (y: number, m: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}`

export function DensityCard({
  commits,
  loading,
  onSelect,
  selectedAt,
}: DensityCardProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  const buckets = useMemo(() => bucketize(commits), [commits])
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

  /** month index of the selected commit (marker under the strip) */
  const selectedBucket = useMemo(() => {
    if (!selectedAt || B === 0) return null
    const d = new Date(selectedAt)
    if (Number.isNaN(d.getTime())) return null
    return (
      buckets.findIndex(
        (b) => b.year === d.getFullYear() && b.month === d.getMonth(),
      )
    )
  }, [selectedAt, buckets, B])

  const hoveredBucket = hovered !== null ? buckets[hovered] : null

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
              how this repository breathes over time — one bar per month
            </div>
          </div>
        </div>
        {/* legend — honest totals, same language as the poster export */}
        {!loading && commits.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] bg-amber-500" aria-hidden />
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
              click a month to jump
            </span>
          </div>
        )}
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
                  className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 font-mono text-[10px] tabular-nums text-popover-foreground shadow-md"
                  style={{
                    left: `clamp(56px, ${(((hovered ?? 0) + 0.5) / B) * 100}%, calc(100% - 56px))`,
                  }}
                >
                  {MONTH_LABEL(hoveredBucket.year, hoveredBucket.month)}
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
              )}

              <div className="flex h-[96px] items-end gap-[1px]">
                {buckets.map((b, i) => {
                  const hPct = b.count === 0 ? 0 : (b.count / max) * 100
                  const aiPct =
                    b.count === 0 ? 0 : (b.aiCount / b.count) * hPct
                  const isPeak = i === stats.peak
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!b.lastHash}
                      onClick={() => b.lastHash && onSelect(b.lastHash)}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered(null)}
                      aria-label={`${MONTH_LABEL(b.year, b.month)}: ${b.count} commits${b.aiCount > 0 ? `, ${b.aiCount} AI-assisted` : ''}${b.lastHash ? ' — jump to this month' : ''}`}
                      title={
                        b.lastHash
                          ? `${MONTH_LABEL(b.year, b.month)} — ${b.count} commits · click to jump`
                          : `${MONTH_LABEL(b.year, b.month)} — no commits`
                      }
                      className="group relative flex h-full min-w-[1px] flex-1 cursor-pointer flex-col justify-end outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {hPct > 0 && (
                        <>
                          {aiPct > 0 && (
                            <span
                              className="density-bar block w-full rounded-b-[1px] bg-amber-500"
                              style={{
                                height: `${aiPct}%`,
                                animationDelay: `${Math.min(i * 0.004, 0.4)}s`,
                              }}
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
                              animationDelay: `${Math.min(i * 0.004, 0.4)}s`,
                            }}
                          />
                        </>
                      )}
                    </button>
                  )
                })}
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

            {/* year labels — one label per January boundary, aligned to
                its bar column; odd years hide on small screens to avoid
                crowding (they reappear ≥sm) */}
            <div className="relative mt-1.5 h-3.5">
              {buckets.map((b, i) =>
                b.month === 0 ? (
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
                    {MONTH_LABEL(hoveredBucket.year, hoveredBucket.month)}
                  </span>{' '}
                  · {hoveredBucket.count.toLocaleString()} commits
                  {hoveredBucket.aiCount > 0 &&
                    ` · ${hoveredBucket.aiCount} AI-assisted`}
                </span>
              ) : stats.peak >= 0 ? (
                <span>
                  busiest month:{' '}
                  <span className="font-semibold text-foreground">
                    {MONTH_LABEL(
                      buckets[stats.peak].year,
                      buckets[stats.peak].month,
                    )}
                  </span>{' '}
                  · {buckets[stats.peak].count.toLocaleString()} commits ·{' '}
                  {B.toLocaleString()} months total, {stats.quiet} quiet
                </span>
              ) : null}
              <span className="text-muted-foreground/70">
                calendar months · browser-local time
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
