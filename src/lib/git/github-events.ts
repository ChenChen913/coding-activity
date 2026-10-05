import type {
  GithubEventActivity,
  GithubEventKind,
  GithubEventsResult,
  GitRemoteInfo,
} from './types'

/**
 * Live activity beyond the local git clone: the GitHub public events API.
 *
 * Honesty rules for this module:
 *  - events are REAL GitHub API responses, never synthesized;
 *  - when the API is unreachable / rate-limited we return `available: false`
 *    with the true reason — the UI shows an honest note, not fake events;
 *  - responses are cached in-memory for 60 seconds (module survives across
 *    requests in the same process).
 */

const TTL_MS = 60_000
const cache = new Map<string, { value: GithubEventsResult; expires: number }>()

/* raw API shapes we actually consume (everything else is ignored) */
interface RawEvent {
  id?: number | string
  type?: string
  created_at?: string
  actor?: { login?: string }
  repo?: { name?: string }
  payload?: {
    ref?: string
    size?: number
    head?: string
    commits?: Array<{ message?: string }>
    action?: string
    number?: number
    pull_request?: { title?: string; html_url?: string; merged?: boolean }
    issue?: { title?: string; html_url?: string }
    release?: { tag_name?: string; name?: string; html_url?: string }
    forkee?: { full_name?: string }
    ref_type?: string
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Map one raw GitHub event into the compact activity shape. */
function mapEvent(
  e: RawEvent,
  repoUrl: string,
): GithubEventActivity | null {
  if (!e.id || !e.created_at) return null
  const actor = e.actor?.login ?? 'unknown'
  const id = String(e.id)
  const timestamp = e.created_at
  const p = e.payload ?? {}

  switch (e.type) {
    case 'PushEvent': {
      const branch = (p.ref ?? '').replace(/^refs\/heads\//, '') || 'branch'
      const size = p.size ?? 0
      return {
        id,
        kind: 'push',
        timestamp,
        title: `pushed ${plural(size, 'commit')} to ${branch}`,
        actor,
        detail: p.commits?.[0]?.message?.slice(0, 120),
        headHash: p.head,
        url: `${repoUrl}/commits/${branch}`,
      }
    }
    case 'PullRequestEvent': {
      const n = p.number ?? 0
      const pr = p.pull_request
      const merged = p.action === 'closed' && pr?.merged
      const action = merged ? 'merged' : (p.action ?? 'updated')
      return {
        id,
        kind: 'pr',
        timestamp,
        title: `${action} pull request #${n}`,
        actor,
        detail: pr?.title?.slice(0, 120),
        url: pr?.html_url,
      }
    }
    case 'IssuesEvent': {
      const n = p.number ?? 0
      return {
        id,
        kind: 'issue',
        timestamp,
        title: `${p.action ?? 'updated'} issue #${n}`,
        actor,
        detail: p.issue?.title?.slice(0, 120),
        url: p.issue?.html_url,
      }
    }
    case 'ReleaseEvent': {
      const tag = p.release?.tag_name ?? p.release?.name ?? 'release'
      return {
        id,
        kind: 'release',
        timestamp,
        title: `published release ${tag}`,
        actor,
        url: p.release?.html_url,
      }
    }
    case 'WatchEvent':
      return { id, kind: 'star', timestamp, title: 'starred the repository', actor }
    case 'ForkEvent':
      return {
        id,
        kind: 'fork',
        timestamp,
        title: 'forked the repository',
        actor,
        detail: p.forkee?.full_name,
      }
    case 'CreateEvent':
    case 'DeleteEvent': {
      const refType = p.ref_type ?? 'ref'
      const what = p.ref ? `${refType} ${p.ref}` : refType
      return {
        id,
        kind: 'branch',
        timestamp,
        title: `${e.type === 'CreateEvent' ? 'created' : 'deleted'} ${what}`,
        actor,
      }
    }
    default:
      return { id, kind: 'other' as GithubEventKind, timestamp, title: (e.type ?? 'event').replace(/Event$/, ''), actor }
  }
}

/** Fetch live GitHub events for a remote — honest degradation on failure. */
export async function getGithubEvents(
  repoId: string,
  remote: GitRemoteInfo | undefined,
): Promise<GithubEventsResult> {
  const fetchedAt = new Date().toISOString()
  const empty = (reason: GithubEventsResult['reason']): GithubEventsResult => ({
    repoId,
    available: false,
    reason,
    fetchedAt,
    events: [],
  })

  if (!remote?.githubOwner || !remote.githubRepo) {
    return empty('no-github-remote')
  }

  const cacheKey = `${repoId}:${remote.githubOwner}/${remote.githubRepo}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.value

  const api = `https://api.github.com/repos/${remote.githubOwner}/${remote.githubRepo}/events?per_page=100`

  let result: GithubEventsResult
  try {
    // Optional PAT: raises the rate limit from 60/h (shared IP) to 5,000/h
    // and also unlocks private-repo events when the token has scope.
    const token = process.env.GITHUB_TOKEN
    const res = await fetch(api, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-coding-activity',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    })

    if (res.status === 403 || res.status === 429) {
      result = empty('rate-limited')
    } else if (!res.ok) {
      result = empty(`http-${res.status}` as `http-${number}`)
    } else {
      const raw = (await res.json()) as RawEvent[]
      const repoUrl = remote.githubUrl ?? `https://github.com/${remote.githubOwner}/${remote.githubRepo}`
      const events = (Array.isArray(raw) ? raw : [])
        .map((e) => mapEvent(e, repoUrl))
        .filter((e): e is GithubEventActivity => e !== null)
      result = { repoId, available: true, fetchedAt, events }
    }
  } catch {
    result = empty('network')
  }

  cache.set(cacheKey, { value: result, expires: Date.now() + TTL_MS })
  return result
}
