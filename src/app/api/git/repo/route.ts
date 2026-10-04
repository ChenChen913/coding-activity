import { NextRequest, NextResponse } from 'next/server'
import { getRepoOverview, resolveRepo, RepoNotGitError } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/repo?repo=demo
 * Full overview of one repository: info + branches + contributors + integrity.
 */
export async function GET(request: NextRequest) {
  const repoId = request.nextUrl.searchParams.get('repo')

  try {
    const entry = await resolveRepo(repoId)
    const overview = await getRepoOverview(entry)
    return NextResponse.json(overview)
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
