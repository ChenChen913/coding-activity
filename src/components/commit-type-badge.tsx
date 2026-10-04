'use client'

/**
 * AI Coding Activity — commit type badge
 *
 * Small colored chip (`fix` / `feat` / `build` / …) rendered next to
 * commit subjects. Structural types (merge) and unclassified subjects
 * (other) render nothing — the surrounding UI already carries those.
 * Colors come from the shared TYPE_META palette so a type is the same
 * color in the graph list, tooltip, search, timeline and detail panel.
 */

import { parseCommitType, TYPE_META } from '@/lib/commit-type'

export interface CommitTypeBadgeProps {
  /** raw commit subject — parsed here (memoization not needed: the regex
   *  is cheap and rows re-render rarely) */
  message?: string
  /** pre-parsed type wins when provided */
  type?: ReturnType<typeof parseCommitType>
  className?: string
  /** uppercase the label (default) or keep lowercase */
  uppercase?: boolean
}

export function CommitTypeBadge({
  message,
  type,
  className = '',
  uppercase = true,
}: CommitTypeBadgeProps) {
  const t = type ?? (message ? parseCommitType(message) : 'other')
  const meta = TYPE_META[t]
  if (!meta || meta.hidden || !meta.chip) return null
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1 font-mono text-[9.5px] font-semibold leading-[15px] ${meta.chip} ${className}`}
      title={`commit type: ${t}`}
    >
      {uppercase ? t.toUpperCase() : t}
    </span>
  )
}
