/**
 * Unified diff parser — turns `git diff` text into structured file blocks
 * that the DiffView component renders per-file (collapsible, line numbers).
 */

export type DiffLineType = 'context' | 'add' | 'remove' | 'hunk'

export interface DiffLine {
  type: DiffLineType
  /** text content without the leading +/-/space marker */
  text: string
  /** old-file line number (absent for additions) */
  oldNo?: number
  /** new-file line number (absent for deletions) */
  newNo?: number
}

export interface DiffFile {
  /** path as shown in the +++ line (b/ prefix stripped) */
  path: string
  /** path as shown in the --- line (a/ prefix stripped); /dev/null for added files */
  oldPath?: string
  /** true when the file is new or deleted → side-by-side numbers differ */
  isNew: boolean
  isDeleted: boolean
  isBinary: boolean
  additions: number
  deletions: number
  /** hunk content lines, in order */
  lines: DiffLine[]
}

export interface ParsedDiff {
  files: DiffFile[]
  truncated: boolean
}

const FILE_HEADER = /^diff --git /
const OLD_PATH = /^--- (a\/)?(.*)$/
const NEW_PATH = /^\+\+\+ (b\/)?(.*)$/
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const BINARY = /^Binary files .* differ$/
const RENAME_FROM = /^rename from (.+)$/
const RENAME_TO = /^rename to (.+)$/

/**
 * Parse unified diff text. Tolerant: unknown lines inside hunks are kept as
 * context; anything between file headers that is not recognized (index lines,
 * mode lines, similarity…) is skipped.
 */
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = []
  const truncated = /\u0000|truncat/i.test(raw.slice(-200))

  const lines = raw.split('\n')
  let current: DiffFile | null = null
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let renameFrom: string | undefined

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')

    if (FILE_HEADER.test(line)) {
      // start of a new file block
      current = null
      inHunk = false
      renameFrom = undefined
      // a/... b/... — prefer the +++ path below when it arrives; use this now
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/)
      if (m) {
        current = {
          path: m[2],
          oldPath: m[1],
          isNew: false,
          isDeleted: false,
          isBinary: false,
          additions: 0,
          deletions: 0,
          lines: [],
        }
        files.push(current)
      }
      continue
    }

    if (BINARY.test(line) && current) {
      current.isBinary = true
      inHunk = false
      continue
    }

    if (RENAME_FROM.test(line)) {
      renameFrom = line.match(RENAME_FROM)![1]
      continue
    }
    if (RENAME_TO.test(line) && current) {
      current.path = line.match(RENAME_TO)![1]
      if (renameFrom) current.oldPath = renameFrom
      continue
    }

    const oldM = line.match(OLD_PATH)
    if (oldM && current) {
      current.oldPath = oldM[2] === '/dev/null' ? undefined : oldM[2]
      current.isNew = oldM[2] === '/dev/null'
      continue
    }
    const newM = line.match(NEW_PATH)
    if (newM && current) {
      if (newM[2] === '/dev/null') {
        // deleted file: keep the path from the --- line
        current.isDeleted = true
        current.path = current.oldPath ?? current.path
        current.oldPath = undefined
      } else {
        current.path = newM[2]
      }
      continue
    }

    const hunkM = line.match(HUNK)
    if (hunkM && current) {
      inHunk = true
      oldNo = Number(hunkM[1])
      newNo = Number(hunkM[2])
      current.lines.push({
        type: 'hunk',
        text: `@@ -${hunkM[1]} +${hunkM[2]} @@${hunkM[3] ?? ''}`,
      })
      continue
    }

    if (inHunk && current) {
      if (line.startsWith('+')) {
        current.lines.push({ type: 'add', text: line.slice(1), newNo: newNo })
        current.additions += 1
        newNo += 1
      } else if (line.startsWith('-')) {
        current.lines.push({
          type: 'remove',
          text: line.slice(1),
          oldNo: oldNo,
        })
        current.deletions += 1
        oldNo += 1
      } else if (line.startsWith(' ') || line === '') {
        current.lines.push({
          type: 'context',
          text: line.startsWith(' ') ? line.slice(1) : '',
          oldNo: oldNo,
          newNo: newNo,
        })
        oldNo += 1
        newNo += 1
      }
      // "\ No newline at end of file" and friends are skipped silently
    }
  }

  return { files, truncated }
}

/** short label for the last path segment, for compact UI */
export function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** parent directory prefix ("src/lib/" for "src/lib/git/exec.ts") */
export function dirName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx + 1) : ''
}
