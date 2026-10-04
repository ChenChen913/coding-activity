'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  Check,
  Copy,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitMerge,
  GitCommitHorizontal,
  Github,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { CommitDetailResponse, GitRemoteInfo } from '@/lib/git/types'
import {
  githubCommitUrl,
  githubProfileFromEmail,
  githubTreeUrl,
} from '@/lib/github'
import { ChangedFiles } from './changed-files'
import { Drawer } from 'vaul'

export interface CommitDetailPanelProps {
  repoId: string
  hash: string | null
  onSelect: (hash: string) => void
  onClose: () => void
  /** origin remote — GitHub deep links are derived from it (hidden when absent) */
  githubRemote?: GitRemoteInfo | null
}

async function fetchDetail(
  repoId: string,
  hash: string,
): Promise<CommitDetailResponse> {
  const res = await fetch(
    `/api/git/commit/${hash}?repo=${encodeURIComponent(repoId)}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<CommitDetailResponse>
}

function MetaRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-16 shrink-0 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  )
}

export function CommitDetailPanel({
  repoId,
  hash,
  onSelect,
  onClose,
  githubRemote,
}: CommitDetailPanelProps) {
  const [copied, setCopied] = useState(false)

  const detailQ = useQuery({
    queryKey: ['git', 'commit', repoId, hash],
    queryFn: () => fetchDetail(repoId, hash as string),
    enabled: Boolean(hash),
  })

  const d = detailQ.data
  const c = d?.commit

  const copyHash = async () => {
    if (!c) return
    try {
      await navigator.clipboard.writeText(c.hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  /* shared panel content — rendered once, mounted in two shells */
  const panelContent = (
    <>
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {c?.isMerge ? (
            <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <GitCommitHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {c?.isMerge ? 'Merge Commit' : 'Commit'}
          </span>
          {c?.aiAgent && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300">
              <Sparkles className="h-2.5 w-2.5" />
              {c.aiAgent}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {c && githubCommitUrl(githubRemote, c.hash) && (
            <a
              href={githubCommitUrl(githubRemote, c.hash) as string}
              target="_blank"
              rel="noopener noreferrer"
              title="View this commit on GitHub"
              aria-label="View this commit on GitHub"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="Close details"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="slim-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {detailQ.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {detailQ.error && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <p className="font-medium text-red-600 dark:text-red-400">Failed to load commit.</p>
            <p className="mt-1">{(detailQ.error as Error).message}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void detailQ.refetch()}
            >
              Retry
            </Button>
          </div>
        )}

        {d && c && (
          <div className="space-y-4">
            {/* message */}
            <div>
              <h3 className="text-[15px] font-semibold leading-snug">
                {c.message}
              </h3>
              {c.fullMessage !== c.message && (
                <pre className="slim-scrollbar mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {c.fullMessage.slice(c.message.length).trim()}
                </pre>
              )}
            </div>

            {/* diff summary */}
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs tabular-nums">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <FileDiff className="h-3.5 w-3.5" />
                {d.stats.filesChanged} files
              </span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                +{d.stats.additions.toLocaleString()}
              </span>
              <span className="font-medium text-red-600 dark:text-red-400">
                −{d.stats.deletions.toLocaleString()}
              </span>
            </div>

            {/* metadata */}
            <div className="divide-y divide-border/60">
              <MetaRow label="Hash">
                <div className="flex items-center gap-1.5">
                  <code className="font-mono text-xs">{c.shortHash}</code>
                  {/* full tail only where there is room (mobile keeps the
                      short hash + copy button — full hash via title/copy) */}
                  <span
                    className="hidden font-mono text-[10px] text-muted-foreground md:inline"
                    title={c.hash}
                  >
                    {c.hash.slice(7)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    aria-label="Copy full hash"
                    onClick={copyHash}
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                  {githubCommitUrl(githubRemote, c.hash) && (
                    <a
                      href={githubCommitUrl(githubRemote, c.hash) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View this commit on GitHub"
                      aria-label="View this commit on GitHub"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </MetaRow>

              <MetaRow label="Author">
                <div className="leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{c.author}</span>
                    {(() => {
                      const profile = githubProfileFromEmail(c.authorEmail)
                      return profile ? (
                        <a
                          href={profile.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`GitHub · ${profile.username}`}
                          aria-label={`GitHub profile of ${profile.username}`}
                          className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                        >
                          <Github className="h-3 w-3" />
                        </a>
                      ) : null
                    })()}
                  </div>
                  <div className="break-all text-xs text-muted-foreground">
                    {c.authorEmail}
                  </div>
                </div>
              </MetaRow>

              <MetaRow label="Authored">
                <div className="tabular-nums">
                  <div>{format(new Date(c.authoredAt), 'yyyy-MM-dd HH:mm:ss')}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(c.authoredAt), {
                      addSuffix: true,
                    })}
                  </div>
                </div>
              </MetaRow>

              {c.committedAt !== c.authoredAt && (
                <MetaRow label="Committed">
                  <div className="tabular-nums">
                    <div>{format(new Date(c.committedAt), 'yyyy-MM-dd HH:mm:ss')}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(c.committedAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </MetaRow>
              )}

              <MetaRow label="Parents">
                <div className="flex flex-wrap gap-1.5">
                  {c.parents.length === 0 ? (
                    <span className="text-xs text-muted-foreground">root</span>
                  ) : (
                    c.parents.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onSelect(p)}
                        className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted"
                        title="Jump to parent commit"
                      >
                        {p.slice(0, 7)}
                      </button>
                    ))
                  )}
                </div>
              </MetaRow>

              <MetaRow label="Branches">
                <div className="flex flex-wrap items-center gap-1.5">
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {c.branches.length === 0 ? (
                    <span className="text-xs text-muted-foreground">none</span>
                  ) : (
                    c.branches.slice(0, 8).map((b) => {
                      const treeUrl = githubTreeUrl(githubRemote, b)
                      const chipBase = `inline-flex max-w-full items-center rounded-full border px-1.5 py-px text-[10px] transition-colors ${
                        b.includes('/')
                          ? 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                          : 'border-teal-600/30 bg-teal-600/10 font-medium text-teal-700 hover:border-teal-600/60 dark:border-teal-400/40 dark:bg-teal-400/15 dark:text-teal-300 dark:hover:border-teal-400/70'
                      }`
                      return treeUrl ? (
                        <a
                          key={b}
                          href={treeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`View ${b} on GitHub`}
                          className={chipBase}
                        >
                          <span className="max-w-[220px] truncate">{b}</span>
                          <ExternalLink className="ml-0.5 h-2.5 w-2.5 shrink-0 opacity-60" />
                        </a>
                      ) : (
                        <span key={b} className={chipBase}>
                          <span className="max-w-[220px] truncate">{b}</span>
                        </span>
                      )
                    })
                  )}
                  {c.branches.length > 8 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{c.branches.length - 8} more
                    </span>
                  )}
                </div>
              </MetaRow>

              {c.aiAgent && (
                <MetaRow label="AI Trace">
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400/90">
                    Detected from real commit trailers (Co-Authored-By /
                    Generated-with). {c.aiAgent} participated in this change.
                  </p>
                </MetaRow>
              )}
            </div>

            {/* changed files + on-demand diff */}
            <div className="border-t pt-3">
              <ChangedFiles repoId={repoId} hash={c.hash} />
            </div>
          </div>
        )}
      </div>
    </>
  )

  return (
    <>
      {/* ---- desktop sidebar (md+) ---- */}
      {hash && (
        <motion.aside
          role="complementary"
          aria-label="Commit details"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="hidden w-[340px] shrink-0 flex-col border-l md:flex xl:w-[380px]"
        >
          {panelContent}
        </motion.aside>
      )}

      {/* ---- mobile: full-height sheet (drag to dismiss) ---- */}
      <Drawer.Root
        open={Boolean(hash)}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] max-h-[92dvh] flex-col rounded-t-2xl border-t-2 border-border bg-background pb-[env(safe-area-inset-bottom)] outline-none"
            aria-describedby={undefined}
          >
            {/* drag handle */}
            <div className="flex shrink-0 justify-center pt-2.5 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
            </div>
            <Drawer.Title className="sr-only">Commit details</Drawer.Title>
            <div
              role="complementary"
              aria-label="Commit details"
              className="flex min-h-0 flex-1 flex-col"
            >
              {panelContent}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
