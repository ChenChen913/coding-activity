import { isGitRepo } from './exec'
import type { GitRepoInfo } from './types'

export interface RepoRegistryEntry {
  id: string
  /** display name shown in the UI */
  name: string
  /** absolute path to the repository on disk */
  path: string
  description?: string
}

/**
 * The repository registry — every data source of the app.
 * "self" is this very project: the tool watches itself being built,
 * which is the soul of "AI Coding Activity".
 */
export function getRegistry(): RepoRegistryEntry[] {
  return [
    {
      id: 'demo',
      name: 'express',
      path: `${process.cwd()}/repos/demo`,
      description: 'expressjs/express — full clone, 6k+ commits, real merges',
    },
    {
      id: 'self',
      name: 'git-activity',
      path: process.cwd(),
      description: 'This project itself — watch the tool being built by AI',
    },
  ]
}

export function findRepoEntry(id?: string | null): RepoRegistryEntry | undefined {
  const registry = getRegistry()
  if (!id) return registry[0]
  return registry.find((r) => r.id === id)
}

export class RepoNotGitError extends Error {
  constructor(
    readonly repoId: string,
    readonly path: string,
  ) {
    super(`"${repoId}" is not a git repository (${path})`)
    this.name = 'RepoNotGitError'
  }
}

/** Resolve a repo id into a verified registry entry (throws when not a repo). */
export async function resolveRepo(id?: string | null): Promise<RepoRegistryEntry> {
  const entry = findRepoEntry(id)
  if (!entry) {
    throw new Error(`Unknown repository: "${id ?? ''}"`)
  }
  if (!(await isGitRepo(entry.path))) {
    throw new RepoNotGitError(entry.id, entry.path)
  }
  return entry
}

/** Cheap availability probe used by the repos listing endpoint. */
export async function listAvailableRepos(): Promise<
  Array<RepoRegistryEntry & { available: boolean }>
> {
  const registry = getRegistry()
  return Promise.all(
    registry.map(async (entry) => ({
      ...entry,
      available: await isGitRepo(entry.path),
    })),
  )
}

export type { GitRepoInfo }
