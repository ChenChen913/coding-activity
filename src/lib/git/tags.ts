import type { GitTag } from './types'
import { git } from './exec'
import { cached } from './cache'

/**
 * Real git tags — every release the repository ever cut.
 *
 * A single `git for-each-ref refs/tags` call returns every tag with its
 * peeled target, tagger identity and date. Annotated tags carry their own
 * tagger + tag date; lightweight tags have none, so the activity date is
 * the target commit's date — and `dateSource` says which is which, so the
 * UI can label it honestly instead of pretending.
 */

const FIELD = '\x1f'
const RECORD = '\x1e'

const FORMAT = [
  '%(refname:short)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(taggername)',
  '%(taggeremail)',
  '%(taggerdate:iso8601-strict)',
  '%(contents:subject)',
].join(FIELD)

/**
 * Commit dates for a set of hashes, resolved in batches with one
 * `git log --no-walk` per chunk (no per-tag subprocess storms).
 */
async function commitDates(
  repoPath: string,
  hashes: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(hashes)]
  const CHUNK = 400 // ~16KB of argv per call, safe everywhere
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const out = await git(
      ['log', '--no-walk=unsorted', `--format=%H${FIELD}%cI`, ...chunk],
      repoPath,
      30_000,
    )
    for (const line of out.split('\n')) {
      if (!line) continue
      const sep = line.indexOf(FIELD)
      if (sep <= 0) continue
      const hash = line.slice(0, sep)
      const date = line.slice(sep + 1)
      if (/^[0-9a-f]{40}$/.test(hash) && date) map.set(hash, date)
    }
  }
  return map
}

/** Parse the raw for-each-ref output into GitTag records. */
function parseTags(raw: string): GitTag[] {
  const tags: GitTag[] = []
  for (const record of raw.split(RECORD)) {
    if (!record.trim()) continue
    const f = record.split(FIELD)
    if (f.length < 8) continue
    const [name, objtype, obj, peeled, tagger, taggerEmailRaw, taggerDate, subject] = f

    const isAnnotated = objtype === 'tag'
    const commitHash = (isAnnotated ? peeled : obj) ?? ''
    if (!/^[0-9a-f]{40}$/.test(commitHash)) continue

    const email = taggerEmailRaw.replace(/^<|>$/g, '').trim() || undefined

    tags.push({
      name: name.trim(),
      commitHash,
      isAnnotated,
      tagger: tagger?.trim() || undefined,
      taggerEmail: email,
      // filled in below for lightweight tags (commit date)
      taggedAt: taggerDate?.trim() || '',
      dateSource: isAnnotated ? 'tagger' : 'commit',
      message: subject?.trim() || undefined,
    })
  }
  return tags
}

/** All tags of a repository, newest activity first. Cached with ref movement. */
export async function getTags(repoPath: string): Promise<GitTag[]> {
  return cached({
    repoId: repoPath,
    repoPath,
    key: 'tags-v1',
    ttlMs: 60_000,
    producer: async () => {
      const raw = await git(
        ['for-each-ref', 'refs/tags', `--format=${FORMAT}${RECORD}`],
        repoPath,
        30_000,
      )
      const tags = parseTags(raw)

      // lightweight tags have no tagger date — resolve the target commit's
      // date in batches and use it (honestly labeled via dateSource)
      const needDates = tags.filter((t) => !t.taggedAt)
      if (needDates.length > 0) {
        const dates = await commitDates(
          repoPath,
          needDates.map((t) => t.commitHash),
        )
        for (const t of needDates) {
          const d = dates.get(t.commitHash)
          if (d) t.taggedAt = d
        }
      }

      return tags
        .filter((t) => t.taggedAt) // skip undatable tags rather than guess
        .sort((a, b) => b.taggedAt.localeCompare(a.taggedAt))
    },
  })
}
