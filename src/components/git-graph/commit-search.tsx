'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { GitMerge, Search, Sparkles, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { CommitTypeBadge } from '@/components/commit-type-badge'
import type { GraphCommit } from '@/lib/git/types'

export interface CommitSearchProps {
  commits: GraphCommit[]
  onSelect: (hash: string) => void
}

interface RankedResult {
  commit: GraphCommit
  score: number
}

const MAX_RESULTS = 30

/**
 * Client-side commit search across the FULL commit list:
 * message, author, and hash. Results are ranked (hash prefix > subject
 * prefix > contains). Clicking a result selects the commit and centers
 * the graph on it.
 */
export function CommitSearch({ commits, onSelect }: CommitSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo<RankedResult[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: RankedResult[] = []
    for (const c of commits) {
      let score = 0
      if (c.hash.toLowerCase().startsWith(q) || c.shortHash.toLowerCase() === q) {
        score = 100
      } else if (c.message.toLowerCase().startsWith(q)) {
        score = 80
      } else if (c.message.toLowerCase().includes(q)) {
        score = 50
      } else if (c.author.toLowerCase().includes(q)) {
        score = 30
      } else if (c.authorEmail.toLowerCase().includes(q)) {
        score = 25
      }
      if (score > 0) out.push({ commit: c, score })
    }
    out.sort(
      (a, b) =>
        b.score - a.score ||
        b.commit.committedAt.localeCompare(a.commit.committedAt),
    )
    return out
  }, [query, commits])

  const matchCount = results.length

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // global "/" focuses the search box (unless already typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (hash: string) => {
    onSelect(hash)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-[240px]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search commits…"
          aria-label="Search commits by message, author or hash"
          className="h-8 pl-8 pr-7 text-[13px]"
        />
        {/* "/" focus hint while empty (replaced by the clear button on type) */}
        {!query && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground/70 sm:block">
            /
          </kbd>
        )}
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 top-9 z-40 w-[320px] max-w-[calc(100vw-2.5rem)] rounded-xl border bg-popover shadow-lg">
          <div className="slim-scrollbar max-h-[320px] overflow-y-auto p-1.5">
            {matchCount === 0 ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                No commits match “{query.trim()}”.
              </p>
            ) : (
              results.slice(0, MAX_RESULTS).map(({ commit }) => (
                <button
                  key={commit.hash}
                  type="button"
                  onClick={() => choose(commit.hash)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      {commit.isMerge && (
                        <GitMerge className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      {commit.aiAgent && (
                        <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                      )}
                      {!commit.isMerge && (
                        <CommitTypeBadge message={commit.message} />
                      )}
                      <span className="truncate text-[13px] font-medium">
                        {commit.message}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                      <span className="font-mono">{commit.shortHash}</span>
                      <span className="truncate">{commit.author}</span>
                      <span className="shrink-0">
                        {format(new Date(commit.committedAt), 'yyyy-MM-dd')}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
            {matchCount > MAX_RESULTS && (
              <p className="px-2.5 pb-1.5 pt-2 text-center text-[10px] text-muted-foreground">
                {MAX_RESULTS} of {matchCount.toLocaleString()} matches — keep
                typing to refine
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
