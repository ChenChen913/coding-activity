import type { GitCommit, GitCommitFile, GitCommitStats, GitFileStatus } from './types'
import { git, EMPTY_TREE } from './exec'
import { detectAiAgent } from './ai'
import { getBranches, getBranchContainment } from './branches'

/** unit separator between fields inside one record */
const US = '\x1f'
/** record separator between commits */
const RS = '\x1e'

/**
 * One `git log` call fetches EVERY commit with ALL its metadata.
 * A single call is the strongest guarantee against truncation:
 * either the whole history comes back, or the command fails loudly.
 */
const LOG_FORMAT = [
  '%H', // hash
  '%h', // short hash
  '%an', // author name
  '%ae', // author email
  '%cn', // committer name
  '%ce', // committer email
  '%at', // author date, unix
  '%ct', // committer date, unix
  '%P', // parent hashes
  '%s', // subject
  '%b', // body
]
  .map((f) => `%x1f${f}`)
  .join('')

export interface CommitIndex {
  commits: GitCommit[]
  byHash: Map<string, GitCommit>
}

/**
 * Parse raw `git log` output (US between fields, RS between records).
 * Body may span multiple lines — that is why records are split on RS first.
 */
export function parseLog(raw: string): GitCommit[] {
  const commits: GitCommit[] = []

  for (const record of raw.split(RS)) {
    if (!record.trim()) continue
    // each record starts with a leading US (see LOG_FORMAT)
    const fields = record.replace(/^\x1f/, '').split(US)
    if (fields.length < 11) continue

    const [
      hash,
      shortHash,
      author,
      authorEmail,
      committer,
      committerEmail,
      authoredUnix,
      committedUnix,
      parentsRaw,
      subject,
      body,
    ] = fields

    const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : []
    const bodyTrimmed = body.trim()
    const fullMessage = bodyTrimmed ? `${subject}\n\n${bodyTrimmed}` : subject

    commits.push({
      hash,
      shortHash,
      message: subject,
      fullMessage,
      author,
      authorEmail,
      committer,
      committerEmail,
      authoredAt: new Date(Number(authoredUnix) * 1000).toISOString(),
      committedAt: new Date(committedUnix ? Number(committedUnix) * 1000 : Number(authoredUnix) * 1000).toISOString(),
      parents,
      branches: [],
      headBranches: [],
      isMerge: parents.length > 1,
      aiAgent: detectAiAgent(fullMessage, author, authorEmail),
    })
  }

  return commits
}

/**
 * The complete commit list with branch membership attached.
 * This is THE data backbone of the whole application.
 */
export async function getCommitIndex(repoPath: string): Promise<CommitIndex> {
  const [logRaw, branches] = await Promise.all([
    git(
      ['log', '--all', '--date-order', `--format=${RS}${LOG_FORMAT}`],
      repoPath,
      120_000,
    ),
    getBranches(repoPath),
  ])

  const commits = parseLog(logRaw)
  const byHash = new Map(commits.map((c) => [c.hash, c]))

  const containment = await getBranchContainment(repoPath, branches)

  for (const commit of commits) {
    const containing = containment.get(commit.hash)
    if (containing) {
      // stable, de-duplicated branch names
      commit.branches = [...new Set(containing)]
    }
  }

  for (const branch of branches) {
    const head = byHash.get(branch.head)
    if (head) head.headBranches.push(branch.name)
  }

  return { commits, byHash }
}

/** git's own count of all commits — independent verification number. */
export async function getVerifiedCommitCount(repoPath: string): Promise<number> {
  const out = await git(['rev-list', '--all', '--count'], repoPath, 60_000)
  return Number(out.trim()) || 0
}

const STATUS_MAP: Record<string, GitFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
}

function parseNumstatLine(line: string): {
  additions: number
  deletions: number
  path: string
  isBinary: boolean
} | null {
  const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
  if (!m) return null
  const isBinary = m[1] === '-' || m[2] === '-'
  return {
    additions: isBinary ? 0 : Number(m[1]),
    deletions: isBinary ? 0 : Number(m[2]),
    path: m[3],
    isBinary,
  }
}

/**
 * Per-file stats for one commit.
 *
 * - diff base is the first parent (for merges this shows what the merge
 *   brought into the target branch — the standard Git tooling convention)
 * - root commits are diffed against the empty tree object
 * - renames are detected (-M) and reported with both paths
 */
export async function getCommitStats(
  repoPath: string,
  commit: GitCommit,
): Promise<GitCommitStats> {
  const base = commit.parents[0] ?? EMPTY_TREE

  const [numstatRaw, nameStatusRaw] = await Promise.all([
    git(
      ['diff', '--numstat', '--find-renames', base, commit.hash],
      repoPath,
      30_000,
    ),
    git(
      ['diff', '--name-status', '--find-renames', base, commit.hash],
      repoPath,
      30_000,
    ),
  ])

  const numstat = numstatRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseNumstatLine)

  const files: GitCommitFile[] = []
  let additions = 0
  let deletions = 0

  const statusLines = nameStatusRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  statusLines.forEach((line, i) => {
    const parts = line.split('\t')
    const rawStatus = parts[0]
    // strip similarity score: R100 -> R, C075 -> C
    const statusLetter = rawStatus.replace(/\d+$/, '')
    const status = STATUS_MAP[statusLetter] ?? 'unknown'

    let path: string
    let previousPath: string | undefined
    if ((status === 'renamed' || status === 'copied') && parts.length >= 3) {
      previousPath = parts[1]
      path = parts[2]
    } else {
      path = parts[1] ?? ''
    }

    // numstat prints renames as "old => new"; align by index, fallback by path
    let stat = numstat[i]
    if (stat && stat.path !== path && previousPath) {
      const alt = numstat.find(
        (n) => n?.path === `${previousPath} => ${path}` || n?.path === path,
      )
      if (alt) stat = alt
    }

    const additions_ = stat?.additions ?? 0
    const deletions_ = stat?.deletions ?? 0
    additions += additions_
    deletions += deletions_

    files.push({
      path,
      previousPath,
      additions: additions_,
      deletions: deletions_,
      status,
      isBinary: stat?.isBinary ?? false,
    })
  })

  return {
    diffBase: base,
    additions,
    deletions,
    filesChanged: files.length,
    files,
  }
}

/** Unified patch text for a commit (used by the detail panel). */
export async function getCommitDiff(
  repoPath: string,
  commit: GitCommit,
  maxBytes = 256 * 1024,
): Promise<{ diff: string; truncated: boolean }> {
  const base = commit.parents[0] ?? EMPTY_TREE
  const out = await git(
    [
      'diff',
      '--find-renames',
      '--no-color',
      '--unified=3',
      base,
      commit.hash,
    ],
    repoPath,
    30_000,
  )
  if (out.length <= maxBytes) return { diff: out, truncated: false }
  return { diff: out.slice(0, maxBytes), truncated: true }
}
