import type {
  GitContributor,
  GitIntegrity,
  GitRemoteInfo,
  GitRepoInfo,
  RepoOverview,
} from './types'
import { git } from './exec'
import { getBranches } from './branches'
import { getCommitIndex, getVerifiedCommitCount } from './commits'
import { cached } from './cache'
import type { RepoRegistryEntry } from './repos'

function parseGithubRemote(url: string): {
  githubUrl: string
  githubOwner: string
  githubRepo: string
} | null {
  // https://github.com/expressjs/express.git
  // git@github.com:expressjs/express.git
  const m =
    url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?$/i) ?? null
  if (!m) return null
  return {
    githubUrl: `https://github.com/${m[1]}/${m[2]}`,
    githubOwner: m[1],
    githubRepo: m[2],
  }
}

async function getRemote(repoPath: string): Promise<GitRemoteInfo | undefined> {
  try {
    const url = (await git(['remote', 'get-url', 'origin'], repoPath, 5_000))
      .trim()
    if (!url) return undefined
    const github = parseGithubRemote(url)
    return {
      name: 'origin',
      url,
      ...github,
    }
  } catch {
    return undefined // no origin remote — fine, local-only repo
  }
}

async function getCurrentBranch(repoPath: string): Promise<{
  branch: string
  detached: boolean
}> {
  try {
    const sym = (
      await git(['symbolic-ref', '--quiet', 'HEAD'], repoPath, 5_000)
    ).trim() // refs/heads/master
    return { branch: sym.replace(/^refs\/heads\//, ''), detached: false }
  } catch {
    return { branch: 'detached HEAD', detached: true }
  }
}

/**
 * Full overview of one repository: info, branches, contributors and an
 * integrity report that PROVES the full history was fetched.
 * Heavily cached (any ref/HEAD movement invalidates the cache).
 */
export async function getRepoOverview(
  entry: RepoRegistryEntry,
): Promise<RepoOverview> {
  return cached({
    repoId: entry.id,
    repoPath: entry.path,
    key: 'overview-v1',
    ttlMs: 60_000,
    producer: async () => {
      const [branches, index, verifiedCount, remote, headInfo] =
        await Promise.all([
          getBranches(entry.path),
          getCommitIndex(entry.path),
          getVerifiedCommitCount(entry.path),
          getRemote(entry.path),
          getCurrentBranch(entry.path),
        ])

      const { commits, byHash } = index

      // contributors from real author identities
      const contributorMap = new Map<string, GitContributor>()
      let mergeCount = 0
      let aiCommitCount = 0
      let firstCommitAt: string | undefined
      let lastCommitAt: string | undefined

      for (const commit of commits) {
        const key = commit.authorEmail || commit.author
        const existing = contributorMap.get(key)
        if (existing) {
          existing.commitCount += 1
        } else {
          contributorMap.set(key, {
            name: commit.author,
            email: commit.authorEmail,
            commitCount: 1,
            aiAgent: commit.aiAgent,
          })
        }
        if (commit.isMerge) mergeCount += 1
        if (commit.aiAgent) aiCommitCount += 1

        const t = commit.committedAt
        if (!firstCommitAt || t < firstCommitAt) firstCommitAt = t
        if (!lastCommitAt || t > lastCommitAt) lastCommitAt = t
      }

      // integrity report
      const uniqueHashes = byHash.size
      let orphanParents = 0
      let rootCount = 0
      for (const commit of commits) {
        if (commit.parents.length === 0) rootCount += 1
        for (const parent of commit.parents) {
          if (!byHash.has(parent)) orphanParents += 1
        }
      }

      const contributors = [...contributorMap.values()].sort(
        (a, b) => b.commitCount - a.commitCount,
      )

      const repo: GitRepoInfo = {
        id: entry.id,
        name: remote?.githubRepo ?? entry.name,
        fullName: remote?.githubOwner
          ? `${remote.githubOwner}/${remote.githubRepo}`
          : undefined,
        path: entry.path,
        description: entry.description,
        currentBranch: headInfo.branch,
        detached: headInfo.detached,
        remote,
        commitCount: commits.length,
        branchCount: branches.length,
        localBranchCount: branches.filter((b) => !b.isRemote).length,
        contributorCount: contributors.length,
        mergeCount,
        firstCommitAt,
        lastCommitAt,
        aiCommitCount,
      }

      const integrity: GitIntegrity = {
        fetchedCommits: commits.length,
        verifiedCount,
        match: commits.length === verifiedCount,
        uniqueHashes,
        orphanParents,
        mergeCount,
        rootCount,
      }

      return { repo, branches, integrity, contributors }
    },
  })
}

/** Cached commit index accessor (shares cache with overview where possible). */
export function getRepoCommitIndex(entry: RepoRegistryEntry) {
  return cached({
    repoId: entry.id,
    repoPath: entry.path,
    key: 'commits-v1',
    ttlMs: 60_000,
    producer: () => getCommitIndex(entry.path),
  })
}
