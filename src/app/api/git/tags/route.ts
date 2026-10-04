import { NextRequest, NextResponse } from 'next/server'
import { getTags, resolveRepo, RepoNotGitError } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/tags?repo=demo
 * Every real tag of the repository (releases), with honest provenance:
 * annotated tags carry tagger + tag date, lightweight tags use the target
 * commit's date (labeled `dateSource: "commit"`).
 */
export async function GET(request: NextRequest) {
  const repoId = request.nextUrl.searchParams.get('repo')
  const started = Date.now()

  try {
    const entry = await resolveRepo(repoId)
    const tags = await getTags(entry.path)
    return NextResponse.json({
      repoId: entry.id,
      total: tags.length,
      fetchMs: Date.now() - started,
      tags,
    })
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
      { error: 'Unable to read git tags.', detail: message },
      { status: 500 },
    )
  }
}
