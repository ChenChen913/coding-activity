import { NextRequest, NextResponse } from 'next/server'
import {
  getCommitDiff,
  getCommitStats,
  getRepoCommitIndex,
  resolveRepo,
  RepoNotGitError,
} from '@/lib/git'
import type { CommitDetailResponse } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/commit/[hash]?repo=demo&diff=1
 * Single commit with per-file stats (additions/deletions/status) and,
 * optionally, the unified diff text.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params
  const repoId = request.nextUrl.searchParams.get('repo')
  const withDiff = request.nextUrl.searchParams.get('diff') === '1'

  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) {
    return NextResponse.json(
      { error: `Invalid commit hash: "${hash}"` },
      { status: 400 },
    )
  }

  try {
    const entry = await resolveRepo(repoId)
    const { commits, byHash } = await getRepoCommitIndex(entry)

    // exact match first, then unique prefix match (like git itself)
    let commit = byHash.get(hash.toLowerCase())
    if (!commit) {
      const lower = hash.toLowerCase()
      const prefixMatches = commits.filter((c) => c.hash.startsWith(lower))
      if (prefixMatches.length === 1) {
        commit = prefixMatches[0]
      } else if (prefixMatches.length > 1) {
        return NextResponse.json(
          {
            error: 'Ambiguous commit hash prefix.',
            matches: prefixMatches.map((c) => c.shortHash),
          },
          { status: 300 },
        )
      }
    }

    if (!commit) {
      return NextResponse.json(
        { error: `Commit not found: ${hash}` },
        { status: 404 },
      )
    }

    const stats = await getCommitStats(entry.path, commit)

    const body: CommitDetailResponse = { commit, stats }

    if (withDiff) {
      const { diff, truncated } = await getCommitDiff(entry.path, commit)
      body.diff = diff
      body.diffTruncated = truncated
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
      { error: 'Unable to read commit details.', detail: message },
      { status: 500 },
    )
  }
}
