import { NextRequest, NextResponse } from 'next/server'
import {
  getRepoCommitIndex,
  resolveRepo,
  RepoNotGitError,
  type GitCommit,
} from '@/lib/git'
import type { CommitsResponse } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/commits?repo=demo&q=&author=&branch=&limit=&offset=
 *
 * Returns the commit list. By default EVERY commit is returned —
 * no artificial truncation. Filtering is explicit and reported honestly
 * (total / returned / filtered). `limit/offset` exist for consumers that
 * want paging; they are opt-in, never default.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const repoId = params.get('repo')
  const q = params.get('q')?.trim().toLowerCase() ?? ''
  const author = params.get('author')?.trim().toLowerCase() ?? ''
  const branch = params.get('branch')?.trim() ?? ''
  const limitRaw = params.get('limit')
  const offsetRaw = params.get('offset')

  try {
    const entry = await resolveRepo(repoId)
    const startedAt = performance.now()
    const { commits } = await getRepoCommitIndex(entry)

    const total = commits.length
    let filtered: GitCommit[] = commits

    if (branch) {
      filtered = filtered.filter(
        (c) => c.branches.includes(branch) || c.headBranches.includes(branch),
      )
    }

    if (author) {
      filtered = filtered.filter(
        (c) =>
          c.author.toLowerCase().includes(author) ||
          c.authorEmail.toLowerCase().includes(author),
      )
    }

    if (q) {
      filtered = filtered.filter(
        (c) =>
          c.message.toLowerCase().includes(q) ||
          c.fullMessage.toLowerCase().includes(q) ||
          c.hash.toLowerCase().startsWith(q) ||
          c.shortHash.toLowerCase() === q ||
          c.author.toLowerCase().includes(q) ||
          c.authorEmail.toLowerCase().includes(q),
      )
    }

    const filteredCount = filtered.length
    let returned = filtered

    const limit = limitRaw ? Number(limitRaw) : NaN
    const offset = offsetRaw ? Number(offsetRaw) : 0
    if (Number.isFinite(limit) && limit > 0) {
      returned = filtered.slice(
        Number.isFinite(offset) && offset > 0 ? offset : 0,
        (Number.isFinite(offset) && offset > 0 ? offset : 0) + limit,
      )
    }

    const fetchMs = Math.round(performance.now() - startedAt)

    const body: CommitsResponse = {
      repoId: entry.id,
      total,
      returned: returned.length,
      filtered:
        Boolean(q || author || branch) || filteredCount !== total,
      fetchMs,
      commits: returned,
    }

    return NextResponse.json(body)
  } catch (err) {
    if (err instanceof RepoNotGitError) {
      return NextResponse.json(
        {
          error: `Repository "${err.repoId}" exists but is not a git repository.`,
          hint: 'Open a git repository to begin.',
        },
        { status: 422 },
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.startsWith('Unknown repository')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Unable to read Git history.', detail: message },
      { status: 500 },
    )
  }
}
