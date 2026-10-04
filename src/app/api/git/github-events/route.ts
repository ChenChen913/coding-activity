import { NextRequest, NextResponse } from 'next/server'
import { getGithubEvents, getRemote, resolveRepo, RepoNotGitError } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/github-events?repo=demo
 * Live public events from the GitHub API for the repository's remote —
 * pushes, PRs, releases, stars, forks. Never fabricated: when the API is
 * unreachable or rate-limited the response says so (`available: false`
 * with the true reason) and the UI shows an honest note.
 */
export async function GET(request: NextRequest) {
  const repoId = request.nextUrl.searchParams.get('repo')

  try {
    const entry = await resolveRepo(repoId)
    const remote = await getRemote(entry.path)
    const result = await getGithubEvents(entry.id, remote)
    return NextResponse.json(result)
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
      { error: 'Unable to read GitHub events.', detail: message },
      { status: 500 },
    )
  }
}
