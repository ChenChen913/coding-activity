import { NextResponse } from 'next/server'
import { getRepoOverview, listAvailableRepos } from '@/lib/git'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/git/repos
 * Lists every registered repository with live info.
 */
export async function GET() {
  try {
    const available = await listAvailableRepos()

    const repos = await Promise.all(
      available.map(async (entry) => {
        if (!entry.available) {
          return {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            available: false,
          }
        }
        try {
          const { repo, integrity } = await getRepoOverview({
            id: entry.id,
            name: entry.name,
            path: entry.path,
            description: entry.description,
          })
          return {
            id: repo.id,
            name: repo.name,
            fullName: repo.fullName,
            description: entry.description,
            currentBranch: repo.currentBranch,
            commitCount: repo.commitCount,
            branchCount: repo.branchCount,
            contributorCount: repo.contributorCount,
            mergeCount: repo.mergeCount,
            verifiedCount: integrity.verifiedCount,
            integrityMatch: integrity.match,
            available: true,
          }
        } catch (err) {
          return {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            available: false,
            error: err instanceof Error ? err.message : 'Failed to read repo',
          }
        }
      }),
    )

    return NextResponse.json({ repos })
  } catch (err) {
    return NextResponse.json(
      { error: 'Unable to list repositories.', detail: err instanceof Error ? err.message : undefined },
      { status: 500 },
    )
  }
}
