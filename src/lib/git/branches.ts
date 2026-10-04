import type { GitBranch } from './types'
import { git } from './exec'

const US = '\x1f'

/**
 * List all local and remote-tracking branches.
 * Remote-tracking branches (refs/remotes/origin/*) are first-class citizens
 * because cloned repositories usually have no local branches besides the
 * default one.
 */
export async function getBranches(repoPath: string): Promise<GitBranch[]> {
  const out = await git(
    [
      'for-each-ref',
      'refs/heads',
      'refs/remotes',
      `--format=%(refname)${US}%(objectname)${US}%(HEAD)${US}%(upstream:short)`,
    ],
    repoPath,
    15_000,
  )

  const branches: GitBranch[] = []

  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [ref, head, headMark, upstream] = line.split(US)
    if (!ref || !head) continue

    const isRemote = ref.startsWith('refs/remotes/')
    // skip symbolic refs like refs/remotes/origin/HEAD
    if (isRemote && ref.endsWith('/HEAD')) continue

    let name: string
    let remote: string | undefined
    if (isRemote) {
      // refs/remotes/origin/master -> "origin/master"
      name = ref.slice('refs/remotes/'.length)
      remote = name.split('/')[0]
    } else {
      // refs/heads/master -> "master"
      name = ref.slice('refs/heads/'.length)
    }

    branches.push({
      name,
      ref,
      remote,
      isRemote,
      head,
      shortHead: head.slice(0, 7),
      current: headMark === '*',
      upstream: upstream || undefined,
    })
  }

  // local branches first, then remotes; each group alphabetical
  branches.sort((a, b) => {
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return branches
}

/**
 * For every branch, the set of commits it contains (git rev-list).
 * Returns a map: commit hash -> branch display names containing it.
 */
export async function getBranchContainment(
  repoPath: string,
  branches: GitBranch[],
): Promise<Map<string, string[]>> {
  const memberships = new Map<string, string[]>()

  for (const branch of branches) {
    // hashes only, one per line
    const out = await git(['rev-list', branch.ref], repoPath, 60_000)
    for (const line of out.split('\n')) {
      const hash = line.trim()
      if (!hash) continue
      const existing = memberships.get(hash)
      if (existing) {
        existing.push(branch.name)
      } else {
        memberships.set(hash, [branch.name])
      }
    }
  }

  return memberships
}
