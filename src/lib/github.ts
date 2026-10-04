/**
 * AI Coding Activity — GitHub URL helpers (isomorphic, pure functions)
 *
 * Deep links are derived ONLY from real data: the git remote URL parsed by
 * the server and identities found in git trailers/emails. When something
 * cannot be derived honestly these helpers return null and the UI hides
 * the link — nothing is guessed.
 */

import type { GitRemoteInfo } from './git/types'

/** https://github.com/{owner}/{repo}/commit/{hash} — null when no GitHub remote */
export function githubCommitUrl(
  remote: GitRemoteInfo | null | undefined,
  hash: string,
): string | null {
  if (!remote?.githubUrl) return null
  return `${remote.githubUrl}/commit/${hash}`
}

/**
 * https://github.com/{owner}/{repo}/tree/{branch}
 * Remote-tracking names ("origin/5.0") are mapped to the GitHub branch
 * name ("5.0") — the prefix stripped is the actual remote name.
 */
export function githubTreeUrl(
  remote: GitRemoteInfo | null | undefined,
  branch: string,
): string | null {
  if (!remote?.githubUrl) return null
  const prefix = `${remote.name}/`
  const name = branch.startsWith(prefix) ? branch.slice(prefix.length) : branch
  return `${remote.githubUrl}/tree/${name}`
}

/** https://github.com/{owner}/{repo}/releases/tag/{tag} */
export function githubTagUrl(
  remote: GitRemoteInfo | null | undefined,
  tagName: string,
): string | null {
  if (!remote?.githubUrl) return null
  return `${remote.githubUrl}/releases/tag/${encodeURIComponent(tagName)}`
}

/**
 * GitHub profile URL derived from a real noreply email —
 *   "49699333+dependabot[bot]@users.noreply.github.com" → app page
 *   "1234+octocat@users.noreply.github.com"              → user page
 *   legacy "octocat@users.noreply.github.com"            → user page
 * Bot accounts ([bot] suffix) live under /apps/, not /{name}.
 */
export function githubProfileFromEmail(
  email: string,
): { username: string; url: string } | null {
  const m = email.match(/^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i)
  if (!m) return null
  const username = m[1]
  if (username.endsWith('[bot]')) {
    return {
      username,
      url: `https://github.com/apps/${encodeURIComponent(
        username.slice(0, -'[bot]'.length),
      )}`,
    }
  }
  return { username, url: `https://github.com/${username}` }
}
