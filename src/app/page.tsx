'use client'

/**
 * AI Coding Activity — Phase 5 · Dashboard
 *
 * The graph is the hero: real Git history rendered as a lane-based commit
 * graph with zoom / pan / fit, branch + author filters, search-to-locate,
 * hover tooltips, keyboard navigation and a detail panel. Below it, an
 * insights row (contributors / commit rhythm / conventions) drives the same
 * filters, and every commit flows into a unified Activity Timeline. Data
 * integrity stays visible at the bottom as the proof that every commit
 * comes from the real repository.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Database,
  ExternalLink,
  GitBranch,
  GitMerge,
  Github,
  Loader2,
  RefreshCw,
  Sparkles,
  Tag,
  UserRound,
  Users,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CommitGraph } from '@/components/git-graph/commit-graph'
import { CommitSearch } from '@/components/git-graph/commit-search'
import { CommitDetailPanel } from '@/components/commit-detail/commit-detail-panel'
import { ActivityTimeline } from '@/components/timeline/activity-timeline'
import { ContributorCard } from '@/components/dashboard/contributor-card'
import { RhythmCard } from '@/components/dashboard/rhythm-card'
import {
  ConventionsCard,
  type TypeFilterSelection,
} from '@/components/dashboard/conventions-card'
import { ReleaseTimelineCard } from '@/components/dashboard/release-timeline-card'
import { IntegrityCard } from '@/components/integrity/integrity-card'
import { ThemeToggle } from '@/components/theme-toggle'
import { Reveal, staggerContainer, staggerItem } from '@/components/reveal'
import { ScrollTop } from '@/components/scroll-top'
import { useClock } from '@/hooks/use-clock'
import type {
  CommitsResponse,
  GithubEventsResult,
  GraphCommit,
  RepoOverview,
  TagsResponse,
} from '@/lib/git/types'

interface RepoListItem {
  id: string
  name: string
  fullName?: string
  currentBranch?: string
  commitCount?: number
  available: boolean
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/* ------------------------------------------------------------------ */

export default function Home() {
  const [repoId, setRepoId] = useState('demo')
  const [branchFilter, setBranchFilter] = useState('all')
  /** active author focus — key = email (git identity) so every name
   *  variant of the same person is included; name is for display */
  const [authorFilter, setAuthorFilter] = useState<{
    name: string
    key: string
  } | null>(null)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

  /** commit-type filter picked on the Conventions card — shared with the
   *  Activity Timeline ("click a row → timeline shows only that kind") */
  const [typeFilter, setTypeFilter] = useState<TypeFilterSelection | null>(
    null,
  )

  /** graph orientation — lifted here so the page layout can react to it
   *  (horizontal mode pins the detail panel below the graph, always
   *  visible); persisted to localStorage, shared with the graph */
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>(
    'vertical',
  )

  /** the graph card — timeline selections scroll it into view */
  const graphCardRef = useRef<HTMLDivElement>(null)
  /** the timeline section — type-filter picks scroll it into view so the
   *  effect of the click is immediately visible */
  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // rAF-wrapped: reading a browser-only store after mount (SSR-safe),
    // async so the lint set-state-in-effect rule stays satisfied
    const raf = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem('graph-orientation')
        if (saved === 'horizontal' || saved === 'vertical')
          setOrientation(saved)
      } catch {
        /* private mode — default vertical is fine */
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const toggleOrientation = useCallback(() => {
    setOrientation((prev) => {
      const next = prev === 'vertical' ? 'horizontal' : 'vertical'
      try {
        localStorage.setItem('graph-orientation', next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const now = useClock()

  const reposQuery = useQuery({
    queryKey: ['git', 'repos'],
    queryFn: () => fetchJson<{ repos: RepoListItem[] }>('/api/git/repos'),
  })

  const overviewQuery = useQuery({
    queryKey: ['git', 'repo', repoId],
    queryFn: () => fetchJson<RepoOverview>(`/api/git/repo?repo=${repoId}`),
    enabled: Boolean(repoId),
  })

  const commitsQuery = useQuery({
    queryKey: ['git', 'commits', repoId, branchFilter, authorFilter?.key],
    queryFn: () =>
      fetchJson<CommitsResponse<GraphCommit>>(
        `/api/git/commits?repo=${repoId}&slim=1${
          branchFilter !== 'all'
            ? `&branch=${encodeURIComponent(branchFilter)}`
            : ''
        }${
          authorFilter
            ? `&author=${encodeURIComponent(authorFilter.key)}`
            : ''
        }`,
      ),
    enabled: Boolean(repoId),
    // keep the previous graph visible while a new branch filter loads —
    // no blank window between refetches
    placeholderData: keepPreviousData,
  })

  /** real git tags — every release the repository ever cut */
  const tagsQuery = useQuery({
    queryKey: ['git', 'tags', repoId],
    queryFn: () => fetchJson<TagsResponse>(`/api/git/tags?repo=${repoId}`),
    enabled: Boolean(repoId),
  })

  /** live GitHub public events — honest degradation when unreachable;
   *  polls every 60 s so a fresh push lights up within a minute */
  const githubEventsQuery = useQuery({
    queryKey: ['git', 'github-events', repoId],
    queryFn: () =>
      fetchJson<GithubEventsResult>(`/api/git/github-events?repo=${repoId}`),
    enabled: Boolean(repoId),
    refetchInterval: 60_000,
    retry: 1,
  })

  const repos = reposQuery.data?.repos.filter((r) => r.available) ?? []
  const overview = overviewQuery.data
  const commitsData = commitsQuery.data
  const tagsData = tagsQuery.data
  const githubEventsData = githubEventsQuery.data

  /** placeholder-data guard: while switching repositories the query keeps
      serving the previous repo's commits (keepPreviousData) — only render
      commits that provably belong to the active repo. Branch switches
      within the same repo keep the old graph visible (no blank window). */
  const commitsMatchRepo = commitsData?.repoId === repoId
  const commits = commitsMatchRepo ? (commitsData?.commits ?? []) : []
  const horizGraph = orientation === 'horizontal'

  /** same cross-repo guard for tags + github events */
  const tags = tagsData?.repoId === repoId ? (tagsData?.tags ?? []) : []
  const githubEvents = githubEventsData?.repoId === repoId ? githubEventsData : null

  const branches = overview?.branches ?? []

  const switchingRepo = (id: string) => {
    setRepoId(id)
    setBranchFilter('all')
    setAuthorFilter(null)
    setSelectedHash(null)
    setTypeFilter(null)
  }

  /** toggle the timeline's commit-type filter from the Conventions card;
   *  scrolls the timeline into view so the loop closes visually */
  const toggleTypeFilter = useCallback(
    (rowKey: string, kinds: TypeFilterSelection['kinds']) => {
      setTypeFilter((prev) =>
        prev?.rowKey === rowKey ? null : { rowKey, kinds },
      )
      requestAnimationFrame(() => {
        timelineRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    },
    [],
  )

  /** select from anywhere (timeline / search) — center the graph card on screen */
  const selectAndReveal = (hash: string) => {
    setSelectedHash(hash)
    graphCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** focus the dashboard on one author (toggle off when clicked again).
   *  Filter key = git identity (email when present) so name variants of
   *  the same person stay together — the leaderboard count and the
   *  filtered view always agree. */
  const focusAuthor = (name: string, key: string) => {
    setAuthorFilter((prev) => (prev?.key === key ? null : { name, key }))
    setSelectedHash(null)
    graphCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const reloading =
    overviewQuery.isFetching ||
    commitsQuery.isFetching ||
    reposQuery.isFetching ||
    tagsQuery.isFetching
  const loadError = overviewQuery.error

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-gradient-to-br from-emerald-500/15 to-teal-500/10 dark:from-emerald-400/20 dark:to-teal-400/10">
              <ActivityIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                <span className="bg-gradient-to-r from-emerald-700 via-teal-600 to-emerald-600 bg-clip-text text-transparent dark:from-emerald-400 dark:via-teal-300 dark:to-emerald-400">
                  AI Coding Activity
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Git history, watching itself being written
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="hidden text-muted-foreground sm:inline">
              {now ? format(now, 'yyyy-MM-dd') : '····-··-··'}
            </span>
            <span className="font-medium">
              {now ? format(now, 'HH:mm:ss') : '··:··:··'}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-5 px-4 py-6 sm:px-6">
        {/* repository bar */}
        <motion.section
          aria-label="Repository"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {overview ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="truncate text-base font-semibold">
                  {overview.repo.fullName ?? overview.repo.name}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {overview.repo.currentBranch}
              </span>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <GitMerge className="h-3 w-3" />
                  {overview.repo.commitCount.toLocaleString()} commits
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {overview.repo.branchCount} branches
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitMerge className="h-3 w-3" />
                  {overview.repo.mergeCount.toLocaleString()} merges
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {overview.repo.contributorCount.toLocaleString()} contributors
                </span>
                {tags.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                    <Tag className="h-3 w-3" />
                    {tags.length.toLocaleString()} releases
                  </span>
                )}
                {overview.repo.aiCommitCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <Sparkles className="h-3 w-3" />
                    {overview.repo.aiCommitCount} AI commits
                  </span>
                )}
              </span>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="hidden h-4 w-64 sm:block" />
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {overview?.repo.remote?.githubUrl && (
              <Button variant="outline" size="sm" className="h-8" asChild>
                <a
                  href={overview.repo.remote.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={overview.repo.remote.githubUrl}
                  aria-label="Open repository on GitHub"
                >
                  <Github className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Open on GitHub</span>
                  <ExternalLink className="ml-1 hidden h-3 w-3 text-muted-foreground sm:inline" />
                </a>
              </Button>
            )}
            <Select value={repoId} onValueChange={switchingRepo}>
              <SelectTrigger className="h-8 w-[170px] text-[13px] sm:w-[210px]" aria-label="Switch repository">
                <SelectValue placeholder="Repository" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <span className="font-medium">{r.fullName ?? r.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                      {(r.commitCount ?? 0).toLocaleString()} commits
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                void overviewQuery.refetch()
                void commitsQuery.refetch()
                void reposQuery.refetch()
                void tagsQuery.refetch()
                void githubEventsQuery.refetch()
              }}
              disabled={reloading}
            >
              {reloading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Reload
            </Button>
          </div>
        </motion.section>

        {/* error */}
        {loadError && !overviewQuery.isFetching && (
          <Card className="border-red-200 dark:border-red-500/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                Unable to read Git history.
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {(loadError as Error).message}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void overviewQuery.refetch()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ---------------- COMMIT GRAPH (hero) ---------------- */}
        <div ref={graphCardRef} className="scroll-mt-20">
          <Card className="overflow-hidden p-0">
            {/* horizontal mode stacks: graph on top, commit details pinned
                below it — always visible; vertical keeps the side panel */}
            <div
              className={
                horizGraph ? 'flex flex-col' : 'flex flex-col md:flex-row'
              }
            >
              <div className="min-w-0 flex-1">
                {/* key={repoId}: fresh mount per repository so placeholder
                    data from another repo is never shown */}
                <CommitGraph
                  key={repoId}
                  orientation={orientation}
                  onOrientationChange={toggleOrientation}
                  commits={commits}
                  loading={commitsQuery.isLoading || !commitsMatchRepo}
                  fetching={commitsQuery.isFetching && commitsMatchRepo}
                  error={
                    commitsQuery.error
                      ? (commitsQuery.error as Error)
                      : null
                  }
                  onRetry={() => void commitsQuery.refetch()}
                  selectedHash={selectedHash}
                  onSelect={setSelectedHash}
                  currentBranch={overview?.repo.currentBranch ?? ''}
                  repoLabel={
                    overview?.repo.fullName ?? overview?.repo.name ?? repoId
                  }
                  branchLabel={
                    branchFilter !== 'all' ? branchFilter : null
                  }
                  extra={
                    <div className="flex min-w-0 items-center gap-2">
                      <Select
                        value={branchFilter}
                        onValueChange={(v) => {
                          setBranchFilter(v)
                          setAuthorFilter(null)
                          setSelectedHash(null)
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-[150px] shrink-0 text-[13px]"
                          aria-label="Filter by branch"
                        >
                          <GitBranch className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="slim-scrollbar max-h-[320px]">
                          <SelectItem value="all">All branches</SelectItem>
                          {branches
                            .filter((b) => !b.isRemote)
                            .map((b) => (
                              <SelectItem key={b.name} value={b.name}>
                                {b.name}
                                {b.current ? ' (HEAD)' : ''}
                              </SelectItem>
                            ))}
                          {branches.some((b) => b.isRemote) && (
                            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                              remote-tracking
                            </div>
                          )}
                          {branches
                            .filter((b) => b.isRemote)
                            .map((b) => (
                              <SelectItem key={b.name} value={b.name}>
                                {b.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {authorFilter && (
                        <span
                          role="status"
                          className="inline-flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-[12px] font-medium text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-300"
                        >
                          <UserRound className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{authorFilter.name}</span>
                          <button
                            type="button"
                            aria-label={`Clear author filter: ${authorFilter.name}`}
                            onClick={() => setAuthorFilter(null)}
                            className="ml-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-400/25"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                      <CommitSearch commits={commits} onSelect={setSelectedHash} />
                    </div>
                  }
                />
              </div>
              <CommitDetailPanel
                variant={horizGraph ? 'below' : 'sidebar'}
                repoId={repoId}
                hash={
                  horizGraph
                    ? (selectedHash ?? commits[0]?.hash ?? null)
                    : selectedHash
                }
                isDefaulted={
                  horizGraph && selectedHash === null && commits.length > 0
                }
                onSelect={setSelectedHash}
                onClose={() => setSelectedHash(null)}
                githubRemote={overview?.repo.remote ?? null}
              />
            </div>
          </Card>
        </div>

        {/* ---------------- INSIGHTS (dashboard) ---------------- */}
        <motion.section
          aria-label="Repository insights"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px 0px' }}
        >
          <motion.div
            variants={staggerItem}
            className="md:col-span-2 xl:col-span-1"
          >
            <ContributorCard
              contributors={overview?.contributors ?? []}
              loading={overviewQuery.isLoading}
              activeAuthorKey={authorFilter?.key ?? null}
              onFilterAuthor={focusAuthor}
              className="h-full"
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <RhythmCard
              commits={commits}
              loading={commitsQuery.isLoading || !commitsMatchRepo}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <ConventionsCard
              commits={commits}
              loading={commitsQuery.isLoading || !commitsMatchRepo}
              typeFilter={typeFilter}
              onToggleTypeFilter={toggleTypeFilter}
            />
          </motion.div>
        </motion.section>

        {/* ---------------- RELEASE TIMELINE (wide) ---------------- */}
        <motion.div
          variants={staggerItem}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px 0px' }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <ReleaseTimelineCard
            tags={tags}
            loading={tagsQuery.isLoading}
            selectedHash={selectedHash}
            onSelect={selectAndReveal}
          />
        </motion.div>

        {/* ---------------- ACTIVITY TIMELINE ---------------- */}
        <Reveal>
          <div ref={timelineRef} className="scroll-mt-20">
            <ActivityTimeline
              key={repoId}
              commits={commits}
              tags={tags}
              githubEvents={githubEvents}
              githubEventsUpdatedAt={githubEventsQuery.dataUpdatedAt}
              loading={commitsQuery.isLoading || !commitsMatchRepo}
              selectedHash={selectedHash}
              onSelect={selectAndReveal}
              typeFilter={typeFilter}
              onClearTypeFilter={() => setTypeFilter(null)}
            />
          </div>
        </Reveal>

        {/* ---------------- integrity ---------------- */}
        <Reveal delay={0.08}>
          <IntegrityCard
            overview={overview}
            commits={commits}
            fetchMs={commitsMatchRepo ? commitsData?.fetchMs : undefined}
            loading={commitsQuery.isLoading || !commitsMatchRepo || overviewQuery.isLoading}
            clientFiltered={branchFilter !== 'all' || authorFilter !== null}
          />
        </Reveal>
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Git is the single source of truth — no fabricated data, no hidden
            commits.
          </span>
          <span className="font-mono">
            {overview
              ? `${overview.repo.fullName ?? overview.repo.name} @ ${overview.repo.currentBranch}`
              : '—'}
          </span>
        </div>
      </footer>

      {/* floating back-to-top */}
      <ScrollTop />
    </div>
  )
}
