'use client'

import { Fragment, memo, useMemo } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import type { DiffFile, DiffLine } from './diff-parser'
import { baseName, dirName } from './diff-parser'
import { detectLanguage, tokenizeLine, type TokenType } from './diff-highlight'

/* ------------------------------------------------------------------ */
/*  Syntax token colors (light/dark aware, warm palette)               */
/* ------------------------------------------------------------------ */

const TOKEN_STYLES: Record<TokenType, string> = {
  keyword: 'text-violet-700 dark:text-violet-300',
  tag: 'text-violet-700 dark:text-violet-300',
  prop: 'text-violet-700 dark:text-violet-300',
  string: 'text-amber-700 dark:text-amber-200',
  comment: 'italic text-neutral-500 dark:text-neutral-400',
  number: 'text-orange-700 dark:text-orange-300',
  func: 'text-teal-700 dark:text-teal-300',
  type: 'text-emerald-800 dark:text-emerald-200',
  plain: '',
}

/* ------------------------------------------------------------------ */
/*  Single diff line                                                   */
/* ------------------------------------------------------------------ */

const LINE_STYLES: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-500/[0.09] text-emerald-900 dark:bg-emerald-400/[0.13] dark:text-emerald-100',
  remove: 'bg-red-500/[0.09] text-red-900 dark:bg-red-400/[0.13] dark:text-red-100',
  context: '',
  hunk: 'bg-muted/70 text-muted-foreground',
}

const MARKER: Record<DiffLine['type'], string> = {
  add: '+',
  remove: '−',
  context: ' ',
  hunk: '@',
}

const DiffRow = memo(function DiffRow({
  line,
  language,
}: {
  line: DiffLine
  language: ReturnType<typeof detectLanguage>
}) {
  if (line.type === 'hunk') {
    // "@@ -69 +69 @@" — anything after the second @@ is the hunk's function
    // context from git; show it dimmer so the numbers stay scannable
    const second = line.text.indexOf('@@', 3)
    const head = second === -1 ? line.text : line.text.slice(0, second + 2)
    const ctx = second === -1 ? '' : line.text.slice(second + 2)
    return (
      <div className="flex items-center px-2 py-1 font-mono text-[10.5px] leading-4 tabular-nums select-none">
        <span className="mr-3 w-8 shrink-0 text-right text-muted-foreground/70">···</span>
        <span className="truncate text-muted-foreground">
          {head}
          {ctx && <span className="text-muted-foreground/45">{ctx}</span>}
        </span>
      </div>
    )
  }
  const tokens = language ? tokenizeLine(line.text, language) : null
  return (
    <div
      className={`flex px-2 font-mono text-[11.5px] leading-[17px] tabular-nums ${LINE_STYLES[line.type]}`}
    >
      <span className="w-8 shrink-0 text-right text-muted-foreground/60 select-none">
        {line.oldNo ?? ''}
      </span>
      <span className="w-8 shrink-0 border-r mr-2 text-right text-muted-foreground/60 select-none">
        {line.newNo ?? ''}
      </span>
      <span
        className={`w-3 shrink-0 text-center select-none ${
          line.type === 'add'
            ? 'text-emerald-600 dark:text-emerald-400'
            : line.type === 'remove'
              ? 'text-red-600 dark:text-red-400'
              : 'text-transparent'
        }`}
      >
        {MARKER[line.type]}
      </span>
      <span className="whitespace-pre-wrap break-all">
        {tokens
          ? tokens.map((t, i) =>
              t.type === 'plain' ? (
                <Fragment key={i}>{t.text}</Fragment>
              ) : (
                <span key={i} className={TOKEN_STYLES[t.type]}>
                  {t.text}
                </span>
              ),
            )
          : line.text}
      </span>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  One file block                                                     */
/* ------------------------------------------------------------------ */

function StatusLetter({ f }: { f: DiffFile }) {
  const letter = f.isNew ? 'A' : f.isDeleted ? 'D' : f.oldPath && f.oldPath !== f.path ? 'R' : 'M'
  const cls =
    letter === 'A'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : letter === 'D'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
        : letter === 'R'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] font-mono text-[9px] font-bold ${cls}`}
      title={
        letter === 'A'
          ? 'Added'
          : letter === 'D'
            ? 'Deleted'
            : letter === 'R'
              ? 'Renamed'
              : 'Modified'
      }
    >
      {letter}
    </span>
  )
}

/** short language badge derived from the same detector that drives highlighting */
function LanguageBadge({ path }: { path: string }) {
  const spec = detectLanguage(path)
  if (!spec) return null
  const ext = path.slice(path.lastIndexOf('.') + 1).toUpperCase()
  const label = ext.length > 4 ? spec.lang.slice(0, 3).toUpperCase() : ext
  return (
    <span
      className="ml-1.5 inline-flex h-3.5 shrink-0 items-center rounded-[3px] border bg-muted/60 px-1 font-mono text-[8.5px] font-semibold tracking-wide text-muted-foreground/80"
      title={`Syntax highlighting: ${spec.lang}`}
    >
      {label}
    </span>
  )
}

export interface DiffFileBlockProps {
  file: DiffFile
  open: boolean
  onToggle: () => void
  defaultCollapsedLines?: number
}

export function DiffFileBlock({ file, open, onToggle }: DiffFileBlockProps) {
  const language = useMemo(() => detectLanguage(file.path), [file.path])
  return (
    <div className="overflow-hidden rounded-lg border">
      {/* header */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <StatusLetter f={file} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11.5px] font-medium leading-4">
            {dirName(file.path) && (
              <span className="text-muted-foreground">{dirName(file.path)}</span>
            )}
            <span>{baseName(file.path)}</span>
            {!file.isBinary && <LanguageBadge path={file.path} />}
          </span>
          {file.oldPath && file.oldPath !== file.path && (
            <span className="block truncate font-mono text-[10px] leading-3 text-muted-foreground">
              from {file.oldPath}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
          {file.isBinary ? (
            <span className="text-muted-foreground">binary</span>
          ) : (
            <>
              {file.additions > 0 && (
                <span className="font-semibold text-emerald-600">
                  +{file.additions}
                </span>
              )}
              {file.deletions > 0 && (
                <span className="font-semibold text-red-600">
                  −{file.deletions}
                </span>
              )}
              {file.additions === 0 && file.deletions === 0 && (
                <span className="text-muted-foreground">
                  {file.lines.length > 0 ? '±0' : '—'}
                </span>
              )}
            </>
          )}
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </span>
      </button>

      {/* body */}
      {open && !file.isBinary && (
        <div className="slim-scrollbar max-h-[280px] overflow-y-auto border-t bg-card/60 py-1">
          {file.lines.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">
              Renamed with no content changes.
            </p>
          ) : (
            file.lines.map((line, i) => <DiffRow key={i} line={line} language={language} />)
          )}
        </div>
      )}
      {open && file.isBinary && (
        <div className="border-t bg-card/60 px-3 py-3 text-[11px] text-muted-foreground">
          Binary file — content not shown.
        </div>
      )}
    </div>
  )
}
