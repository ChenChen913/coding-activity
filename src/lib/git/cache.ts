import { git } from './exec'

interface CacheEntry {
  value: unknown
  expires: number
}

/** module-level cache — survives between requests in the same process */
const store = new Map<string, CacheEntry>()
/** last seen repository signature per repo id */
const signatures = new Map<string, string>()

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/**
 * Repository signature: HEAD hash + a digest over every ref and its target.
 * When anything moves (new commit, branch created/deleted, force-push) the
 * signature changes and every cached entry for that repo is dropped.
 */
async function repoSignature(repoPath: string): Promise<string> {
  const [headRes, refsRes] = await Promise.allSettled([
    git(['rev-parse', 'HEAD'], repoPath, 5_000),
    git(['for-each-ref', '--format=%(refname) %(objectname)'], repoPath, 5_000),
  ])
  const head = headRes.status === 'fulfilled' ? headRes.value.trim() : 'no-head'
  const refs = refsRes.status === 'fulfilled' ? refsRes.value : ''
  return `${head}::${refs.length}:${hashString(refs)}`
}

export interface CachedOptions<T> {
  repoId: string
  repoPath: string
  /** cache key, unique per repo */
  key: string
  /** time to live in ms (default 30s) */
  ttlMs?: number
  producer: () => Promise<T>
}

/**
 * Memoize the result of `producer` for a repository. The cache is invalidated
 * eagerly whenever the repository signature changes, so data stays truthful
 * without expensive re-computation on every request.
 */
export async function cached<T>(opts: CachedOptions<T>): Promise<T> {
  const { repoId, repoPath, key, ttlMs = 30_000, producer } = opts

  const sig = await repoSignature(repoPath)
  if (signatures.get(repoId) !== sig) {
    const prefix = `${repoId}:`
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) store.delete(k)
    }
    signatures.set(repoId, sig)
  }

  const k = `${repoId}:${key}`
  const hit = store.get(k)
  if (hit && hit.expires > Date.now()) {
    return hit.value as T
  }

  const value = await producer()
  store.set(k, { value, expires: Date.now() + ttlMs })
  return value
}

export function clearCache(repoId?: string): void {
  if (!repoId) {
    store.clear()
    signatures.clear()
    return
  }
  const prefix = `${repoId}:`
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
  signatures.delete(repoId)
}
