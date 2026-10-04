'use client'

/**
 * AI Coding Activity — Phase 1 · Git Data Layer Validation Panel
 *
 * This page is deliberately functional, not decorative: it proves that the
 * data layer fetches EVERY commit from a real git repository, with an
 * independent count cross-check performed by git itself.
 * The real visualization (Graph / Timeline / Dashboard) lands in Phase 2+.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Loader2,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useClock } from '@/hooks/use-clock'
import type {
  CommitsResponse,
  GitCommit,
  RepoOverview,
} from '@/lib/git/types'

interface RepoListItem {
  id: string
  name: string
  fullName?: string
  description?: string
  currentBranch?: string
  commitCount?: number
  branchCount?: number
  contributorCount?: number
  mergeCount?: number
  verifiedCount?: number
  integrityMatch?: boolean
  available: boolean
  error?: string
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
/*  Field-level completeness audit over EVERY fetched commit           */
/* ------------------------------------------------------------------ */

interface FieldAudit {
  label: string
  pass: boolean
  detail: string
}

function auditCommits(commits: GitCommit[]): FieldAudit[] {
  let missingHash = 0
  let missingAuthor = 0
  let missingMessage = 0
  let missingTime = 0
  let badParentShape = 0
  let mergeWithoutTwoParents = 0
  let nonMergeWithTwoParents = 0

  for (const c of commits) {
    if (!c.hash || !c.shortHash) missingHash++
    if (!c.author || !c.authorEmail) missingAuthor++
    if (!c.message) missingMessage++
    if (!c.committedAt || Number.isNaN(Date.parse(c.committedAt))) missingTime++
    if (!Array.isArray(c.parents)) badParentShape++
    if (c.isMerge && c.parents.length < 2) mergeWithoutTwoParents++
    if (!c.isMerge && c.parents.length > 1) nonMergeWithTwoParents++
  }

  const n = commits.length
  return [
    {
      label: 'hash / shortHash present',
      pass: missingHash === 0,
      detail: `${n - missingHash}/${n} commits`,
    },
    {
      label: 'author + email present',
      pass: missingAuthor === 0,
      detail: `${n - missingAuthor}/${n} commits`,
    },
    {
      label: 'message present',
      pass: missingMessage === 0,
      detail: `${n - missingMessage}/${n} commits`,
    },
    {
      label: 'timestamp parseable (ISO 8601)',
      pass: missingTime === 0,
      detail: `${n - missingTime}/${n} commits`,
    },
    {
      label: 'parents array well-formed',
      pass: badParentShape === 0,
      detail: `${n - badParentShape}/${n} commits`,
    },
    {
      label: 'merge flag consistent with parent count',
      pass: mergeWithoutTwoParents === 0 && nonMergeWithTwoParents === 0,
      detail: `${mergeWithoutTwoParents + nonMergeWithTwoParents} inconsistencies`,
    },
  ]
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

function PassBadge({ pass }: { pass: boolean }) {
  return pass ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">
      <CheckCircle2 className="h-3 w-3" />
      PASS
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 tabular-nums">
      <XCircle className="h-3 w-3" />
      FAIL
    </span>
  )
}

function CheckRow({ audit }: { audit: FieldAudit }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-foreground/80">{audit.label}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {audit.detail}
        </span>
        <PassBadge pass={audit.pass} />
      </span>
    </div>
  )
}

function CommitRow({ commit, label }: { commit: GitCommit; label: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-card">
        {commit.isMerge ? (
          <GitMerge className="h-3.5 w-3.5 text-foreground/70" />
        ) : (
          <GitCommitHorizontal className="h-3.5 w-3.5 text-foreground/70" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-xs text-muted-foreground">
            {commit.shortHash}
          </span>
          <span className="truncate text-sm font-medium">
            {commit.message}
          </span>
          {commit.aiAgent && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
              ✦ {commit.aiAgent}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>{commit.author}</span>
          <span>
            {format(new Date(commit.committedAt), 'yyyy-MM-dd HH:mm:ss')}
          </span>
          {commit.branches.length > 0 && (
            <span className="truncate">
              {commit.branches.slice(0, 3).join(', ')}
              {commit.branches.length > 3
                ? ` +${commit.branches.length - 3}`
                : ''}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function StatCell({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight tabular-nums">
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [repoId, setRepoId] = useState<string>('demo')

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
    queryKey: ['git', 'commits', repoId],
    queryFn: () =>
      fetchJson<CommitsResponse>(`/api/git/commits?repo=${repoId}`),
    enabled: Boolean(repoId),
  })

  const repos = reposQuery.data?.repos ?? []
  const availableRepos = repos.filter((r) => r.available)

  const overview = overviewQuery.data
  const commitsData = commitsQuery.data

  /* Client-side verification across the FULL payload */
  const clientAudit = useMemo(() => {
    if (!commitsData) return null
    const commits = commitsData.commits
    const hashSet = new Set(commits.map((c) => c.hash))
    const parentHashes = new Set<string>()
    for (const c of commits) for (const p of c.parents) parentHashes.add(p)
    const orphanParents = [...parentHashes].filter((h) => !hashSet.has(h)).length

    return {
      count: commits.length,
      uniqueHashes: hashSet.size,
      orphanParents,
      fieldAudit: auditCommits(commits),
    }
  }, [commitsData])

  const aiCommits = useMemo(
    () =>
      (commitsData?.commits ?? []).filter((c) => c.aiAgent).slice(0, 5),
    [commitsData],
  )

  const firstCommit = commitsData?.commits[commitsData.commits.length - 1]
  const lastCommit = commitsData?.commits[0]
  const sampleMerge = useMemo(
    () => (commitsData?.commits ?? []).find((c) => c.isMerge),
    [commitsData],
  )

  const reloading = overviewQuery.isFetching || commitsQuery.isFetching
  const loadError = overviewQuery.error ?? commitsQuery.error

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card">
              <ActivityIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                AI Coding Activity
              </div>
              <div className="text-[11px] text-muted-foreground">
                Phase 1 · Git Data Layer
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {/* repo selector */}
        <section aria-label="Repository" className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                Repository
              </span>
              <Select
                value={repoId}
                onValueChange={setRepoId}
                disabled={availableRepos.length === 0}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select repository" />
                </SelectTrigger>
                <SelectContent>
                  {availableRepos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="font-medium">{r.fullName ?? r.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {r.commitCount != null
                          ? `${r.commitCount.toLocaleString()} commits`
                          : ''}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
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

        {/* loading */}
        {(overviewQuery.isLoading || commitsQuery.isLoading) && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[62px] rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}

        {/* error */}
        {loadError && !reloading && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Unable to read Git history
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {(loadError as Error).message}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void overviewQuery.refetch()
                  void commitsQuery.refetch()
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {overview && commitsData && !loadError && (
          <div className="space-y-6">
            {/* stats */}
            <section
              aria-label="Repository statistics"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              <StatCell
                icon={GitCommitHorizontal}
                value={overview.repo.commitCount.toLocaleString()}
                label="commits (all branches)"
              />
              <StatCell
                icon={GitBranch}
                value={overview.repo.branchCount.toLocaleString()}
                label={`branches (${overview.repo.localBranchCount} local)`}
              />
              <StatCell
                icon={GitMerge}
                value={overview.repo.mergeCount.toLocaleString()}
                label="merge commits"
              />
              <StatCell
                icon={Users}
                value={overview.repo.contributorCount.toLocaleString()}
                label="contributors"
              />
            </section>

            {/* integrity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data Integrity</CardTitle>
                <CardDescription>
                  Parser output cross-checked against git itself — every commit
                  must be present, unique and topologically complete.
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y divide-border/70">
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-foreground/80">
                    Commit count matches{' '}
                    <span className="text-muted-foreground">
                      (git log --all vs git rev-list --all --count)
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {overview.integrity.fetchedCommits.toLocaleString()} ={' '}
                      {overview.integrity.verifiedCount.toLocaleString()}
                    </span>
                    <PassBadge pass={overview.integrity.match} />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-foreground/80">
                    All commits returned to client (no truncation)
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {clientAudit?.count.toLocaleString()} /{' '}
                      {commitsData.total.toLocaleString()}
                    </span>
                    <PassBadge
                      pass={
                        clientAudit !== null &&
                        clientAudit.count === commitsData.total &&
                        clientAudit.count > 0
                      }
                    />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-foreground/80">
                    Unique commit hashes
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {clientAudit?.uniqueHashes.toLocaleString()}
                    </span>
                    <PassBadge
                      pass={
                        clientAudit !== null &&
                        clientAudit.uniqueHashes === clientAudit.count
                      }
                    />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-foreground/80">
                    Every parent resolves to a fetched commit
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {clientAudit?.orphanParents ?? '·'} orphan parents
                    </span>
                    <PassBadge pass={(clientAudit?.orphanParents ?? 1) === 0} />
                  </span>
                </div>
                {clientAudit?.fieldAudit.map((audit) => (
                  <CheckRow key={audit.label} audit={audit} />
                ))}
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-foreground/80">
                    Data pipeline
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    server {commitsData.fetchMs} ms · payload{' '}
                    {(JSON.stringify(commitsData).length / 1024 / 1024).toFixed(
                      2,
                    )}{' '}
                    MB · {overview.repo.currentBranch}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* AI commits — real evidence only */}
            {aiCommits.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    AI Coding Activity detected{' '}
                    <span className="text-muted-foreground">
                      ({overview.repo.aiCommitCount} commits)
                    </span>
                  </CardTitle>
                  <CardDescription>
                    Detected from real commit trailers (Co-Authored-By /
                    Generated-with). Never fabricated.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {aiCommits.map((c) => (
                    <CommitRow key={c.hash} commit={c} label="✦ ai" />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* samples */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">History Samples</CardTitle>
                <CardDescription>
                  Oldest, newest and one merge commit straight from the real
                  history — the same data the graph will render in Phase 2.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {firstCommit && (
                  <CommitRow commit={firstCommit} label="first" />
                )}
                {lastCommit && <CommitRow commit={lastCommit} label="latest" />}
                {sampleMerge && (
                  <CommitRow commit={sampleMerge} label="merge" />
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
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
