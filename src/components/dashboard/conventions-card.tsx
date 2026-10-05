'use client'

/**
 * AI Coding Activity — Phase 5 · Message conventions insight
 *
 * Conventional-commit type distribution, parsed from the real subject
 * lines (feat: / fix(scope): / revert: …). Non-conforming subjects land
 * in "other" — visible, never hidden. Every row is a live filter: click
 * one and the Activity Timeline below narrows to exactly that kind of
 * record. The bottom strip shows the real AI-assisted share of the
 * currently visible history.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Check, Sparkles, Tag } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { parseCommitType, TYPE_META, type CommitType } from '@/lib/commit-type'
import type { GraphCommit } from '@/lib/git/types'

const MAX_ROWS = 8

/** a timeline type filter chosen on this card — the row key plus the
 *  exact set of canonical commit types it stands for (the "other…" row
 *  aggregates unclassified subjects, structural merges and any named
 *  types beyond MAX_ROWS, so the filter is honest about what it holds) */
export interface TypeFilterSelection {
  rowKey: string
  kinds: CommitType[]
}

export interface ConventionsCardProps {
  commits: GraphCommit[]
  loading: boolean
  /** active type filter (shared with the timeline), null = off */
  typeFilter?: TypeFilterSelection | null
  /** toggle a row's filter; parent owns the state */
  onToggleTypeFilter?: (rowKey: string, kinds: CommitType[]) => void
}

export function ConventionsCard({
  commits,
  loading,
  typeFilter,
  onToggleTypeFilter,
}: ConventionsCardProps) {
  const analysis = useMemo(() => {
    const counts = new Map<string, number>()
    let conventional = 0
    let ai = 0
    for (const c of commits) {
      const t = parseCommitType(c.message)
      counts.set(t, (counts.get(t) ?? 0) + 1)
      // merges are structural (git-generated), not convention-typed
      if (t !== 'other' && t !== 'merge') conventional += 1
      if (c.aiAgent) ai += 1
    }
    const total = commits.length || 1
    // named types sorted by frequency; "other" always sinks to the last
    // row (merged with any tail types beyond MAX_ROWS + structural merges)
    // — the catch-all should never visually dominate the real conventions.
    const otherCount =
      (counts.get('other') ?? 0) + (counts.get('merge') ?? 0)
    const named = [...counts.entries()]
      .filter(([t]) => t !== 'other' && t !== 'merge')
      .sort((a, b) => b[1] - a[1])
    const head = named.slice(0, MAX_ROWS - 1)
    const tailRows = named.slice(MAX_ROWS - 1)
    const tail = tailRows.reduce((s, [, n]) => s + n, 0)
    const rows: Array<[string, number]> = [
      ...head,
      ['other', otherCount + tail],
    ]
    const max = rows[0]?.[1] ?? 1
    return {
      rows,
      max,
      total,
      conventional,
      ai,
      /** named types folded into the "other…" row — kept so the row's
       *  timeline filter covers exactly what the row displays */
      otherKinds: [
        'other',
        'merge',
        ...tailRows.map(([t]) => t as CommitType),
      ] as CommitType[],
    }
  }, [commits])

  return (
    <Card className="flex flex-col overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <Tag className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Conventions</div>
            <div className="text-[11px] text-muted-foreground">
              real commit types · click a row to filter the timeline{' '}
              <span className="text-muted-foreground/70">&amp; highlight the graph</span>
            </div>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-20" />
        ) : commits.length === 0 ? (
          <div className="text-right text-[11px] tabular-nums leading-tight text-muted-foreground">
            <div className="font-semibold text-foreground">—</div>
            <div>no data</div>
          </div>
        ) : (
          <div className="text-right text-[11px] tabular-nums leading-tight text-muted-foreground">
            <div className="font-semibold text-foreground">
              {Math.round((analysis.conventional / analysis.total) * 100)}%
            </div>
            <div>conventional</div>
          </div>
        )}
      </div>

      {/* bars */}
      <div className="flex flex-1 flex-col justify-center px-4 pb-1 pt-4 sm:px-5">
        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-14 shrink-0" />
                <Skeleton
                  className="h-2.5 flex-1 rounded-full"
                  style={{ width: `${[88, 62, 74, 45, 56, 36][i]}%` }}
                />
                <Skeleton className="h-3 w-9 shrink-0" />
              </div>
            ))}
          </div>
        ) : commits.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Tag className="h-5 w-5 text-muted-foreground/50" />
            <div className="text-[12px] font-medium text-muted-foreground">
              No commit subjects in view
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              clear the branch or author filter to parse conventions again
            </div>
          </div>
        ) : (
          <ul className="space-y-[5px]">
            {analysis.rows.map(([type, count], i) => {
              const isOther = type === 'other'
              const pct = (count / analysis.total) * 100
              const color = TYPE_META[type as CommitType]?.color ?? '#a8a29e'
              const active = typeFilter?.rowKey === type
              const kinds = isOther
                ? analysis.otherKinds
                : [type as CommitType]
              return (
                <li key={type}>
                  <button
                    type="button"
                    aria-pressed={active}
                    disabled={count === 0}
                    onClick={() => onToggleTypeFilter?.(type, kinds)}
                    title={
                      count === 0
                        ? 'no commits of this type in view'
                        : active
                          ? `${count.toLocaleString()} commits (${pct.toFixed(1)}%) — click to clear the filter, un-dim the graph and show every record again`
                          : `${count.toLocaleString()} commits (${pct.toFixed(1)}%) — click to show only ${
                              isOther ? 'unclassified / merge' : type
                            } records in the timeline, with a colored halo on matching graph nodes (the rest dim)`
                    }
                    className={`group -mx-1.5 flex w-[calc(100%+3px)] items-center gap-2.5 rounded-md px-1.5 py-[3px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 ${
                      count === 0
                        ? 'cursor-default opacity-45'
                        : active
                          ? 'cursor-pointer bg-foreground/[0.05]'
                          : 'cursor-pointer hover:bg-foreground/[0.045]'
                    }`}
                  >
                    <span
                      className={`flex w-[52px] shrink-0 items-center gap-1 truncate font-mono text-[10.5px] font-medium ${
                        active
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground group-hover:text-foreground'
                      }`}
                    >
                      {active ? (
                        <Check
                          className="h-3 w-3 shrink-0"
                          style={{ color }}
                          aria-hidden
                        />
                      ) : (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden
                        />
                      )}
                      <span className="truncate">
                        {isOther ? 'other…' : type}
                      </span>
                    </span>
                    <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                      <motion.span
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(1.5, pct)}%` }}
                        transition={{
                          duration: 0.5,
                          ease: 'easeOut',
                          delay: Math.min(i * 0.04, 0.3),
                        }}
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          backgroundColor: color,
                          boxShadow: active ? `0 0 0 2px ${color}40` : undefined,
                        }}
                      />
                    </span>
                    <span
                      className={`w-[52px] shrink-0 text-right font-mono text-[10px] tabular-nums ${
                        active ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {count.toLocaleString()}
                      <span className="ml-1 text-muted-foreground/60">
                        {pct < 10 ? pct.toFixed(1) : Math.round(pct)}%
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* AI share strip */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t px-4 py-2.5 text-[10.5px] text-muted-foreground sm:px-5">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-amber-500" />
          AI-assisted
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {analysis.ai.toLocaleString()}
          </span>
          {commits.length > 0 && (
            <span className="tabular-nums">
              ({((analysis.ai / analysis.total) * 100).toFixed(1)}%)
            </span>
          )}
        </span>
        {typeFilter ? (
          <button
            type="button"
            onClick={() => onToggleTypeFilter?.(typeFilter.rowKey, [])}
            title="Clear the timeline type filter and restore every graph node to full opacity"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/20 px-2 py-px font-medium text-foreground transition-colors hover:bg-muted"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor:
                  TYPE_META[typeFilter.rowKey as CommitType]?.color ?? '#a8a29e',
              }}
              aria-hidden
            />
            filtering: {typeFilter.rowKey === 'other' ? 'other…' : typeFilter.rowKey}
            <span className="hidden text-muted-foreground sm:inline">· graph dimmed</span>
            <span aria-hidden>×</span>
          </button>
        ) : (
          <span className="text-muted-foreground/70">
            detected from real trailers
          </span>
        )}
      </div>
    </Card>
  )
}
