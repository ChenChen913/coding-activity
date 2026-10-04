'use client'

/**
 * AI Coding Activity — Phase 5 · Commit rhythm insight
 *
 * When do commits actually land? Hour-of-day and weekday distributions
 * derived client-side from every commit's real timestamp (browser-local
 * time — stated honestly on the card). Peaks are highlighted; hover any
 * bar for exact counts.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraphCommit } from '@/lib/git/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** hour tick labels under the 24-bar chart */
const HOUR_TICKS = new Set([0, 6, 12, 18, 23])

type Mode = 'hour' | 'weekday'

export interface RhythmCardProps {
  commits: GraphCommit[]
  loading: boolean
}

function analyze(commits: GraphCommit[]) {
  const hours = new Array<number>(24).fill(0)
  const weekdays = new Array<number>(7).fill(0)
  for (const c of commits) {
    const d = new Date(c.committedAt)
    if (Number.isNaN(d.getTime())) continue
    hours[d.getHours()] += 1
    // getDay(): 0=Sun … 6=Sat → shift to 0=Mon
    weekdays[(d.getDay() + 6) % 7] += 1
  }
  const peakHour = hours.indexOf(Math.max(...hours))
  const peakWeekday = weekdays.indexOf(Math.max(...weekdays))
  return { hours, weekdays, peakHour, peakWeekday }
}

function Bars({
  values,
  labels,
  max,
  peakIndex,
  onHover,
}: {
  values: number[]
  labels: string[]
  max: number
  peakIndex: number
  onHover: (i: number | null) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-[64px] items-end gap-[3px]">
        {values.map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * 60))
          const isPeak = i === peakIndex && v > 0
          return (
            <div
              key={i}
              className="group relative flex min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
            >
              {/* hover count bubble */}
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                {v.toLocaleString()}
              </span>
              <motion.span
                initial={{ height: 0 }}
                animate={{ height: `${h}px` }}
                transition={{ duration: 0.45, ease: 'easeOut', delay: Math.min(i * 0.015, 0.3) }}
                className={`block w-full rounded-t-[3px] transition-colors ${
                  isPeak
                    ? 'bg-emerald-600'
                    : 'bg-foreground/[0.15] group-hover:bg-emerald-500/70'
                }`}
              />
            </div>
          )
        })}
      </div>
      {/* labels */}
      <div className="mt-1 flex gap-[3px]">
        {labels.map((l, i) => (
          <span
            key={i}
            className={`min-w-0 flex-1 text-center font-mono text-[9px] tabular-nums ${
              labels.length === 7
                ? 'text-muted-foreground'
                : HOUR_TICKS.has(i)
                  ? 'text-muted-foreground'
                  : 'text-transparent'
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

export function RhythmCard({ commits, loading }: RhythmCardProps) {
  const [mode, setMode] = useState<Mode>('hour')
  const [hovered, setHovered] = useState<number | null>(null)

  const data = useMemo(() => analyze(commits), [commits])

  const max = mode === 'hour' ? Math.max(...data.hours, 1) : Math.max(...data.weekdays, 1)
  const values = mode === 'hour' ? data.hours : data.weekdays
  const labels =
    mode === 'hour'
      ? data.hours.map((_, i) => String(i).padStart(2, '0'))
      : WEEKDAYS
  const peakIndex = mode === 'hour' ? data.peakHour : data.peakWeekday
  const peakValue = values[peakIndex]

  return (
    <Card className="flex flex-col overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Commit Rhythm</div>
            <div className="text-[11px] text-muted-foreground">
              when this repository actually moves
            </div>
          </div>
        </div>
        {/* mode switch */}
        <div className="flex items-center rounded-full border p-0.5 text-[11px] font-medium">
          {(['hour', 'weekday'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                setHovered(null)
              }}
              className={`rounded-full px-2.5 py-0.5 transition-colors ${
                mode === m
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'hour' ? 'By hour' : 'By weekday'}
            </button>
          ))}
        </div>
      </div>

      {/* chart */}
      <div className="flex flex-1 flex-col justify-center px-4 pb-2 pt-4 sm:px-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="mx-auto h-2.5 w-2/3" />
          </div>
        ) : commits.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Clock className="h-5 w-5 text-muted-foreground/50" />
            <div className="text-[12px] font-medium text-muted-foreground">
              No commits in view
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              clear the branch or author filter to see when work happens
            </div>
          </div>
        ) : (
          <>
            <Bars
              values={values}
              labels={labels}
              max={max}
              peakIndex={peakIndex}
              onHover={setHovered}
            />
            {/* summary line */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10.5px] tabular-nums text-muted-foreground">
              {hovered !== null ? (
                <span>
                  <span className="font-semibold text-foreground">
                    {values[hovered].toLocaleString()}
                  </span>{' '}
                  commits {mode === 'hour' ? `at ${String(hovered).padStart(2, '0')}:00` : `on ${WEEKDAYS[hovered]}`}
                </span>
              ) : (
                <span>
                  peak:{' '}
                  <span className="font-semibold text-foreground">
                    {mode === 'hour'
                      ? `${String(peakIndex).padStart(2, '0')}:00–${String((peakIndex + 1) % 24).padStart(2, '0')}:00`
                      : WEEKDAYS[peakIndex]}
                  </span>{' '}
                  · {peakValue.toLocaleString()} commits
                </span>
              )}
              <span className="text-muted-foreground/70">browser-local time</span>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
