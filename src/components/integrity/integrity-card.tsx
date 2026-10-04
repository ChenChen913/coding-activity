'use client'

import { useMemo } from 'react'
import { CheckCircle2, ChevronDown, ShieldCheck, XCircle } from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type {
  GitCommit,
  GitIntegrity,
  RepoOverview,
} from '@/lib/git/types'

export interface IntegrityCardProps {
  overview: RepoOverview | undefined
  commits?: Array<GitCommit | (GitCommit & { branchCount?: number })>
  fetchMs?: number
  loading: boolean
}

interface Audit {
  label: string
  pass: boolean
  detail: string
}

function auditCommits(commits: Array<{ [k: string]: unknown }>): Audit[] {
  let missingHash = 0
  let missingAuthor = 0
  let missingMessage = 0
  let missingTime = 0
  let mergeInconsistent = 0

  for (const c of commits) {
    if (!c.hash || !c.shortHash) missingHash++
    if (!c.author || !c.authorEmail) missingAuthor++
    if (!c.message) missingMessage++
    if (!c.committedAt || Number.isNaN(Date.parse(String(c.committedAt)))) missingTime++
    const parents = c.parents as unknown[] | undefined
    const isMerge = Boolean(c.isMerge)
    if (!Array.isArray(parents) || (isMerge && parents.length < 2) || (!isMerge && parents.length > 1)) {
      mergeInconsistent++
    }
  }

  const n = commits.length
  return [
    { label: 'hash / shortHash present', pass: missingHash === 0, detail: `${n - missingHash}/${n}` },
    { label: 'author + email present', pass: missingAuthor === 0, detail: `${n - missingAuthor}/${n}` },
    { label: 'message present', pass: missingMessage === 0, detail: `${n - missingMessage}/${n}` },
    { label: 'timestamp parseable (ISO 8601)', pass: missingTime === 0, detail: `${n - missingTime}/${n}` },
    { label: 'merge flag consistent with parents', pass: mergeInconsistent === 0, detail: `${mergeInconsistent} issues` },
  ]
}

function Row({
  label,
  detail,
  pass,
}: {
  label: React.ReactNode
  detail: string
  pass: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-foreground/80">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {detail}
        </span>
        {pass ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-600" />
        )}
      </span>
    </div>
  )
}

/**
 * Data integrity report — the proof that every single commit was fetched,
 * cross-checked against git's own count. Collapsible so the graph stays
 * the hero of the page.
 */
export function IntegrityCard({
  overview,
  commits,
  fetchMs,
  loading,
}: IntegrityCardProps) {
  const audits = useMemo(
    () => (commits && commits.length > 0 ? auditCommits(commits) : []),
    [commits],
  )

  const integrity: GitIntegrity | undefined = overview?.integrity

  const allPass =
    integrity?.match === true &&
    (integrity?.orphanParents ?? 1) === 0 &&
    audits.every((a) => a.pass)

  const clientCount = commits?.length ?? 0
  const serverCount = integrity?.fetchedCommits ?? 0

  return (
    <Collapsible className="rounded-xl border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {allPass ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-amber-600" />
            )}
            Data Integrity
          </span>
          {integrity && (
            <span className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
              <span>
                {integrity.fetchedCommits.toLocaleString()} ={' '}
                {integrity.verifiedCount.toLocaleString()} commits
              </span>
              <span className="text-border">·</span>
              <span>{integrity.orphanParents} orphan parents</span>
              <span className="text-border">·</span>
              <span>{integrity.mergeCount.toLocaleString()} merges</span>
              {fetchMs !== undefined && (
                <>
                  <span className="text-border">·</span>
                  <span>server {fetchMs} ms</span>
                </>
              )}
            </span>
          )}
          {loading && (
            <span className="text-xs text-muted-foreground">checking…</span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="divide-y divide-border/70 border-t px-4 pb-3 pt-1">
          {integrity && (
            <>
              <Row
                label={
                  <>
                    Commit count matches{' '}
                    <span className="text-muted-foreground">
                      (git log --all vs git rev-list --all --count)
                    </span>
                  </>
                }
                detail={`${integrity.fetchedCommits.toLocaleString()} = ${integrity.verifiedCount.toLocaleString()}`}
                pass={integrity.match}
              />
              <Row
                label="All commits delivered to the client (no truncation)"
                detail={`${clientCount.toLocaleString()} / ${serverCount.toLocaleString()}`}
                pass={serverCount > 0 && clientCount === serverCount}
              />
              <Row
                label="Unique commit hashes"
                detail={
                  integrity.uniqueHashes.toLocaleString() ===
                  integrity.fetchedCommits.toLocaleString()
                    ? 'all unique'
                    : `${integrity.uniqueHashes.toLocaleString()} unique`
                }
                pass={
                  integrity.uniqueHashes === integrity.fetchedCommits
                }
              />
              <Row
                label="Every parent resolves to a fetched commit"
                detail={`${integrity.orphanParents} orphan parents`}
                pass={integrity.orphanParents === 0}
              />
              <Row
                label="Root commits / merge commits"
                detail={`${integrity.rootCount} roots · ${integrity.mergeCount.toLocaleString()} merges`}
                pass
              />
            </>
          )}
          {audits.map((a) => (
            <Row key={a.label} label={a.label} detail={a.detail} pass={a.pass} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
