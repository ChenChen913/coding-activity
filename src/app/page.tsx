'use client'

/**
 * AI Coding Activity — Phase 2 · Commit Graph
 *
 * The graph is the hero: real Git history rendered as a lane-based commit
 * graph with zoom / pan / fit, branch filter, search-to-locate, hover
 * tooltips and a detail panel. Data integrity stays visible below as the
 * proof that every commit comes from the real repository.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Database,
  GitBranch,
  GitMerge,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
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
import { IntegrityCard } from '@/components/integrity/integrity-card'
import { useClock } from '@/hooks/use-clock'
import type {
  CommitsResponse,
  GraphCommit,
  RepoOverview,
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
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

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
    queryKey: ['git', 'commits', repoId, branchFilter],
    queryFn: () =>
      fetchJson<CommitsResponse<GraphCommit>>(
        `/api/git/commits?repo=${repoId}&slim=1${
          branchFilter !== 'all'
            ? `&branch=${encodeURIComponent(branchFilter)}`
            : ''
        }`,
      ),
    enabled: Boolean(repoId),
  })

  const repos = reposQuery.data?.repos.filter((r) => r.available) ?? []
  const overview = overviewQuery.data
  const commitsData = commitsQuery.data
  const commits = commitsData?.commits ?? []

  const branches = overview?.branches ?? []

  const aiCommits = useMemo(
    () => commits.filter((c) => c.aiAgent).slice(0, 3),
    [commits],
  )

  const switchingRepo = (id: string) => {
    setRepoId(id)
    setBranchFilter('all')
    setSelectedHash(null)
  }

  const reloading =
    overviewQuery.isFetching || commitsQuery.isFetching || reposQuery.isFetching
  const loadError = overviewQuery.error

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
              <ActivityIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                AI Coding Activity
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
          </div>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 px-4 py-6 sm:px-6">
        {/* repository bar */}
        <section aria-label="Repository" className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
                {overview.repo.aiCommitCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
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

          <div className="ml-auto flex items-center gap-2">
            <Select value={repoId} onValueChange={switchingRepo}>
              <SelectTrigger className="h-8 w-[210px] text-[13px]" aria-label="Switch repository">
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
        </section>

        {/* error */}
        {loadError && !overviewQuery.isFetching && (
          <Card className="border-red-200">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600">
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
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col md:flex-row">
            <div className="min-w-0 flex-1">
              <CommitGraph
                commits={commits}
                loading={commitsQuery.isLoading}
                fetching={commitsQuery.isFetching && !commitsQuery.isLoading}
                error={
                  commitsQuery.error
                    ? (commitsQuery.error as Error)
                    : null
                }
                onRetry={() => void commitsQuery.refetch()}
                selectedHash={selectedHash}
                onSelect={setSelectedHash}
                currentBranch={overview?.repo.currentBranch ?? ''}
                extra={
                  <div className="flex min-w-0 items-center gap-2">
                    <Select
                      value={branchFilter}
                      onValueChange={(v) => {
                        setBranchFilter(v)
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
                    <CommitSearch commits={commits} onSelect={setSelectedHash} />
                  </div>
                }
              />
            </div>
            <CommitDetailPanel
              repoId={repoId}
              hash={selectedHash}
              onSelect={setSelectedHash}
              onClose={() => setSelectedHash(null)}
            />
          </div>
        </Card>

        {/* ---------------- AI activity strip ---------------- */}
        {aiCommits.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold">AI Coding Activity</span>
                <span className="text-xs text-muted-foreground">
                  detected from real trailers
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-2">
                {aiCommits.map((c) => (
                  <button
                    key={c.hash}
                    type="button"
                    onClick={() => setSelectedHash(c.hash)}
                    className="group flex min-w-0 items-center gap-2 text-left"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {c.shortHash}
                    </span>
                    <span className="truncate text-[13px] font-medium group-hover:underline">
                      {c.message}
                    </span>
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                      ✦ {c.aiAgent}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---------------- integrity ---------------- */}
        <IntegrityCard
          overview={overview}
          commits={commits}
          fetchMs={commitsData?.fetchMs}
          loading={commitsQuery.isLoading || overviewQuery.isLoading}
        />
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <span>
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
    </div>
  )
}
