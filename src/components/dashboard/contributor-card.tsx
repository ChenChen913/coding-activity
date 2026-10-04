'use client'

/**
 * AI Coding Activity — Phase 5 · Contributors insight
 *
 * Real contributor leaderboard from the repository overview (git shortlog
 * semantics — name+email pairs). Clicking a contributor filters the whole
 * dashboard (graph + timeline) to their commits via the existing author
 * filter. No data is estimated; counts come from git itself.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  ChevronDown,
  Clock,
  Github,
  Mail,
  Sparkles,
  Users,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { GitContributor } from '@/lib/git/types'
import { githubProfileFromEmail } from '@/lib/github'

const TOP_N = 8

/** warm/green palette — no blues/indigos */
const AVATAR_COLORS = [
  '#059669',
  '#0d9488',
  '#ca8a04',
  '#be123c',
  '#7c2d12',
  '#a21caf',
  '#4d7c0f',
  '#b45309',
]

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** "Douglas Christopher Wilson" → "DW", "wesleytodd" → "WE" */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** "Jun 2009 → Nov 2015 · 6.4y active" — from real git commit dates */
function activityRange(c: GitContributor): string | null {
  if (!c.firstCommitAt || !c.lastCommitAt) return null
  const first = new Date(c.firstCommitAt)
  const last = new Date(c.lastCommitAt)
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null
  const months =
    (last.getFullYear() - first.getFullYear()) * 12 +
    (last.getMonth() - first.getMonth())
  const span =
    months < 1
      ? 'same month'
      : months < 18
        ? `${months} mo`
        : `${(months / 12).toFixed(1)}y`
  return `${format(first, 'MMM yyyy')} → ${format(last, 'MMM yyyy')} · ${span}`
}

export interface ContributorCardProps {
  contributors: GitContributor[]
  loading: boolean
  /** git identity key (email) of the active author filter, null when off */
  activeAuthorKey: string | null
  /** filter the dashboard to one author — key = email (git identity) */
  onFilterAuthor: (name: string, key: string) => void
  /** layout classes from the parent grid */
  className?: string
}

export function ContributorCard({
  contributors,
  loading,
  activeAuthorKey,
  onFilterAuthor,
  className,
}: ContributorCardProps) {
  const [showAll, setShowAll] = useState(false)

  const sorted = useMemo(
    () => [...contributors].sort((a, b) => b.commitCount - a.commitCount),
    [contributors],
  )

  const maxCount = sorted[0]?.commitCount ?? 1
  const visible = showAll ? sorted : sorted.slice(0, TOP_N)
  const totalCommits = useMemo(
    () => contributors.reduce((s, c) => s + c.commitCount, 0),
    [contributors],
  )

  return (
    <Card className={`flex flex-col overflow-hidden p-0 transition-[border-color,box-shadow] duration-200 hover:border-foreground/25 hover:shadow-sm ${className ?? ''}`}>
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Contributors</div>
            <div className="text-[11px] text-muted-foreground">
              click to focus the dashboard on one author
            </div>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-24" />
        ) : (
          <div className="text-right text-[11px] tabular-nums leading-tight text-muted-foreground">
            <div className="font-semibold text-foreground">
              {contributors.length.toLocaleString()}
            </div>
            <div>{totalCommits.toLocaleString()} commits</div>
          </div>
        )}
      </div>

      {/* list */}
      <div className="mt-3 border-t">
        {loading ? (
          <div className="space-y-2.5 p-4 sm:p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3" style={{ width: `${[62, 45, 78, 55, 70][i]}%` }} />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        ) : contributors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Users className="h-5 w-5 text-muted-foreground/50" />
            <div className="text-[12px] font-medium text-muted-foreground">
              No contributors match the current filters
            </div>
            <div className="text-[11px] text-muted-foreground/70">
              clear the branch or author filter to see everyone
            </div>
          </div>
        ) : (
          <>
            <ul
              className={
                showAll
                  ? 'max-h-[300px] overflow-y-auto slim-scrollbar p-2 sm:p-2.5'
                  : 'p-2 sm:p-2.5'
              }
            >
              {visible.map((c, i) => {
                const key = c.email || c.name
                const active = activeAuthorKey === key
                const pct = Math.max(2, Math.round((c.commitCount / maxCount) * 100))
                const range = activityRange(c)
                const profile = githubProfileFromEmail(c.email)
                return (
                  <li key={key} className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => onFilterAuthor(c.name, key)}
                          className={`group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 ${
                            active
                              ? 'bg-accent ring-1 ring-foreground/15'
                              : 'hover:bg-muted/60'
                          } ${profile ? 'pr-8' : ''}`}
                        >
                      <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/70">
                        {i + 1}
                      </span>
                      <motion.span
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold tracking-tight text-white shadow-sm"
                        style={{ backgroundColor: avatarColor(c.name) }}
                      >
                        {initialsOf(c.name)}
                      </motion.span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`truncate text-[13px] ${
                              active ? 'font-semibold' : 'font-medium'
                            }`}
                          >
                            {c.name}
                          </span>
                          {c.aiAgent && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300"
                              title={`AI-assisted commits detected (${c.aiAgent})`}
                            >
                              <Sparkles className="mr-0.5 h-2.5 w-2.5" />
                              AI
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                          <motion.span
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
                            className={`block h-full rounded-full ${
                              active
                                ? 'bg-emerald-600'
                                : 'bg-foreground/[0.28] group-hover:bg-emerald-500/70'
                            }`}
                          />
                        </span>
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {c.commitCount.toLocaleString()}
                      </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        align="center"
                        sideOffset={8}
                        className="max-w-[260px] rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground shadow-md"
                      >
                        <div className="text-[12px] font-semibold leading-tight">
                          {c.name}
                        </div>
                        {c.email && (
                          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.email}</span>
                          </div>
                        )}
                        {profile && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Github className="h-3 w-3 shrink-0" />
                            <span className="truncate">GitHub · {profile.username}</span>
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-3 text-[10px] tabular-nums text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {c.commitCount.toLocaleString()} commits
                          </span>
                          {range && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 shrink-0" />
                              {range}
                            </span>
                          )}
                        </div>
                        {c.aiAgent && (
                          <div className="mt-1.5 flex items-center gap-1 border-t pt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                            <Sparkles className="h-3 w-3 shrink-0" />
                            AI-assisted commits detected ({c.aiAgent})
                          </div>
                        )}
                        <div className="mt-1.5 text-[9px] text-muted-foreground/70">
                          click to focus graph + timeline on this author
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    {/* GitHub profile — derived from the real noreply email,
                        absolutely positioned so it never nests interactive
                        elements inside the row button */}
                    {profile && (
                      <a
                        href={profile.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`GitHub profile of ${profile.username}`}
                        title={`GitHub · ${profile.username}`}
                        className="absolute right-1.5 top-1/2 z-[1] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                      >
                        <Github className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* expand / collapse */}
            {sorted.length > TOP_N && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                aria-expanded={showAll}
                className="flex w-full items-center justify-center gap-1.5 border-t px-4 py-2.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    showAll ? 'rotate-180' : ''
                  }`}
                />
                {showAll
                  ? 'Show top contributors only'
                  : `Show all ${sorted.length.toLocaleString()} contributors`}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
