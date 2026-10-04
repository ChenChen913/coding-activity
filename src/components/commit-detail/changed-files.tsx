'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  FileDiff,
  FilePlus,
  FileX,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  CommitDetailResponse,
  GitCommitStats,
} from '@/lib/git/types'
import { DiffFileBlock } from './diff-view'
import { parseUnifiedDiff } from './diff-parser'

export interface ChangedFilesProps {
  repoId: string
  hash: string
  /** slim commit list data already loaded by the panel (stats without files) */
  stats?: GitCommitStats
}

async function fetchDetailWithDiff(
  repoId: string,
  hash: string,
): Promise<CommitDetailResponse> {
  const res = await fetch(
    `/api/git/commit/${hash}?repo=${encodeURIComponent(repoId)}&diff=1`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<CommitDetailResponse>
}

/**
 * Changed files list with on-demand diff expansion.
 *
 * The commit detail endpoint already returns per-file stats; the unified
 * diff text is fetched once (diff=1) and parsed client-side into file
 * blocks. Every file stays accessible — blocks collapse, nothing is cut.
 */
export function ChangedFiles({ repoId, hash }: ChangedFilesProps) {
  // Keyed remount strategy: <ChangedFilesInner key={hash}/> resets the
  // expansion state naturally when the inspected commit changes —
  // no setState-in-effect needed.
  return <ChangedFilesInner repoId={repoId} hash={hash} key={hash} />
}

function ChangedFilesInner({ repoId, hash }: ChangedFilesProps) {
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set())

  const diffQ = useQuery({
    queryKey: ['git', 'commit-diff', repoId, hash],
    queryFn: () => fetchDetailWithDiff(repoId, hash),
    enabled: Boolean(hash),
    staleTime: 5 * 60_000,
  })

  const diffText = diffQ.data?.diff
  const parsed = useMemo(
    () => (diffText ? parseUnifiedDiff(diffText) : null),
    [diffText],
  )

  // diff files keyed by path (stats may include rename pairs with same path)
  const files = diffQ.data?.stats.files ?? []

  const toggle = (path: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const expandAll = () => {
    if (!parsed) return
    setOpenFiles(new Set(parsed.files.map((f) => f.path)))
  }

  const collapseAll = () => setOpenFiles(new Set())

  if (diffQ.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
        <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          loading diff…
        </p>
      </div>
    )
  }

  if (diffQ.error) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        <p className="font-medium text-red-600 dark:text-red-400">Failed to load diff.</p>
        <p className="mt-1">{(diffQ.error as Error).message}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2.5"
          onClick={() => void diffQ.refetch()}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-muted-foreground">
        No file changes.
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      {/* header row */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {files.some((f) => f.status === 'added') && (
            <FilePlus className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          )}
          {files.some((f) => f.status === 'deleted') && (
            <FileX className="h-3 w-3 text-red-600 dark:text-red-400" />
          )}
          <FileDiff className="h-3 w-3" />
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </span>
        {parsed && parsed.files.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Expand all
            </button>
            <span className="text-border">·</span>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {/* blocks */}
      <div className="space-y-1.5">
        {(parsed?.files ?? []).map((f, i) => (
          <motion.div
            key={`${f.path}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(i * 0.03, 0.3) }}
          >
            <DiffFileBlock
              file={f}
              open={openFiles.has(f.path)}
              onToggle={() => toggle(f.path)}
            />
          </motion.div>
        ))}
      </div>

      {/* fallback: stats-only list (diff text missing/unparsed) */}
      {(!parsed || parsed.files.length === 0) &&
        files.map((f, i) => (
          <div
            key={`${f.path}-${i}`}
            className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              {f.previousPath && (
                <span className="text-muted-foreground">
                  {f.previousPath} →{' '}
                </span>
              )}
              {f.path}
            </span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
              {f.isBinary ? (
                <span className="text-muted-foreground">binary</span>
              ) : (
                <>
                  <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>{' '}
                  <span className="text-red-600 dark:text-red-400">−{f.deletions}</span>
                </>
              )}
            </span>
          </div>
        ))}

      {parsed?.truncated && (
        <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300">
          <ChevronDown className="h-3 w-3" />
          Diff truncated at 256 KB — showing the first files only.
        </p>
      )}
    </div>
  )
}
