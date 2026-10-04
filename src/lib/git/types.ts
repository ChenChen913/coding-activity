/**
 * AI Coding Activity — Core data models
 *
 * Git is the single source of truth. Every field here maps to real git data.
 * These types are shared between server (API routes) and client (visualization).
 */

export interface GitCommit {
  /** full commit hash (40 chars) */
  hash: string
  /** abbreviated hash */
  shortHash: string
  /** subject line (first line of message) */
  message: string
  /** full commit message including body */
  fullMessage: string
  author: string
  authorEmail: string
  committer: string
  committerEmail: string
  /** ISO 8601 — when the change was authored */
  authoredAt: string
  /** ISO 8601 — when the commit object was created */
  committedAt: string
  /** parent hashes in order (first parent = the branch that was merged INTO) */
  parents: string[]
  /** all branches (local + remote-tracking) that contain this commit */
  branches: string[]
  /** branches whose tip is exactly this commit */
  headBranches: string[]
  /** true when the commit has more than one parent */
  isMerge: boolean
  /**
   * AI agent detected from REAL commit trailers (Co-Authored-By: Claude,
   * "Generated with [Claude Code]", Cursor, Copilot, ...).
   * undefined when no real evidence exists — never fabricated.
   */
  aiAgent?: string
}

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'unknown'

export interface GitCommitFile {
  path: string
  /** original path when the file was renamed/copied */
  previousPath?: string
  additions: number
  deletions: number
  status: GitFileStatus
  isBinary: boolean
}

export interface GitCommitStats {
  /** diff base used for stats: parent hash, or the empty tree for root commits */
  diffBase: string
  additions: number
  deletions: number
  filesChanged: number
  files: GitCommitFile[]
}

export interface GitBranch {
  /** display name: "master" for local, "origin/master" for remote-tracking */
  name: string
  current: boolean
  /** remote name ("origin") when this is a remote-tracking branch */
  remote?: string
  /** full ref path, e.g. refs/remotes/origin/master */
  ref: string
  /** head commit hash */
  head: string
  shortHead: string
  isRemote: boolean
  /** upstream branch for local branches, e.g. "origin/master" */
  upstream?: string
}

export interface GitRemoteInfo {
  name: string
  url: string
  /** https://github.com/{owner}/{repo} when the remote points to GitHub */
  githubUrl?: string
  githubOwner?: string
  githubRepo?: string
}

export interface GitRepoInfo {
  id: string
  name: string
  /** e.g. "expressjs/express" when a GitHub remote exists */
  fullName?: string
  path: string
  description?: string
  currentBranch: string
  /** detached HEAD fallback */
  detached?: boolean
  remote?: GitRemoteInfo
  commitCount: number
  branchCount: number
  /** local branch count only */
  localBranchCount: number
  contributorCount: number
  mergeCount: number
  firstCommitAt?: string
  lastCommitAt?: string
  /** commits authored or co-authored by an AI agent (real evidence only) */
  aiCommitCount: number
}

export interface GitContributor {
  name: string
  email: string
  commitCount: number
  aiAgent?: string
  /** first / last commit dates (ISO) for this identity — real git dates */
  firstCommitAt?: string
  lastCommitAt?: string
}

export type ActivityType =
  | 'ai'
  | 'human'
  | 'commit'
  | 'push'
  | 'release'
  | 'github'
  | 'ci'
  | 'deploy'

/**
 * Unified activity stream. Commits are one kind of activity; future phases
 * map AI sessions, pushes, CI/deploys onto the same timeline. The structure
 * is intentionally open for Claude Code / Codex / Cursor / Gemini CLI, ...
 */
export interface Activity {
  id: string
  type: ActivityType
  timestamp: string
  title: string
  description?: string
  commitHash?: string
  aiAgent?: string
}

/**
 * Timeline projection of a commit — every commit IS an activity. Derived
 * client-side from the already-fetched commit list (no second fetch), so
 * the timeline always covers 100% of the repository history.
 */
export interface TimelineActivity extends Activity {
  shortHash: string
  author: string
  isMerge: boolean
  /** present when this activity is a real git tag (release) */
  release?: TimelineRelease
}

/** Real tag data attached to a timeline activity. */
export interface TimelineRelease {
  name: string
  isAnnotated: boolean
  /** where the activity date came from — honest provenance */
  dateSource: 'tagger' | 'commit'
  tagger?: string
  message?: string
}

/** A real git tag — every field comes from `git for-each-ref refs/tags`. */
export interface GitTag {
  name: string
  /** commit the tag points at (peeled for annotated tags) */
  commitHash: string
  isAnnotated: boolean
  /** tagger identity — only exists on annotated tags (real data) */
  tagger?: string
  taggerEmail?: string
  /** ISO 8601 — tagger date for annotated tags, commit date for lightweight */
  taggedAt: string
  /** honest provenance for taggedAt */
  dateSource: 'tagger' | 'commit'
  /** tag message subject (annotated) or the target commit subject (lightweight) */
  message?: string
}

export interface TagsResponse {
  repoId: string
  total: number
  fetchMs: number
  tags: GitTag[]
}

/* ------------------------------------------------------------------ */
/*  GitHub public events (live activity beyond the local git data)     */
/* ------------------------------------------------------------------ */

export type GithubEventKind =
  | 'push'
  | 'release'
  | 'pr'
  | 'issue'
  | 'star'
  | 'fork'
  | 'branch'
  | 'other'

/** One event from the GitHub public events API — real, never fabricated. */
export interface GithubEventActivity {
  id: string
  kind: GithubEventKind
  /** ISO 8601 created_at */
  timestamp: string
  title: string
  actor: string
  detail?: string
  /** head commit of a push — links the event into the local graph */
  headHash?: string
  url?: string
}

export interface GithubEventsResult {
  repoId: string
  available: boolean
  /** honest reason when unavailable */
  reason?: 'no-github-remote' | 'rate-limited' | 'network' | `http-${number}`
  fetchedAt: string
  events: GithubEventActivity[]
}

/** Server-side integrity report — proves every commit was fetched. */
export interface GitIntegrity {
  /** commits returned by the parser (git log --all) */
  fetchedCommits: number
  /** commits counted by git itself (git rev-list --all --count) */
  verifiedCount: number
  match: boolean
  uniqueHashes: number
  /** parent references pointing at commits we do not have (should be 0) */
  orphanParents: number
  mergeCount: number
  rootCount: number
}

export interface RepoOverview {
  repo: GitRepoInfo
  branches: GitBranch[]
  integrity: GitIntegrity
  contributors: GitContributor[]
}

/**
 * Graph-optimized projection of a commit.
 * Every commit is still present — slim only drops detail fields that the
 * graph does not render (full message body, committer identity, full
 * branch membership). The detail endpoint returns the full GitCommit.
 */
export interface GraphCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  authorEmail: string
  committedAt: string
  parents: string[]
  isMerge: boolean
  aiAgent?: string
  /** how many branches contain this commit (names available via detail) */
  branchCount: number
  /** branches whose tip is this commit — rendered as chips in the graph */
  headBranches: string[]
}

export interface CommitsResponse<
  T extends GitCommit | GraphCommit = GitCommit,
> {
  repoId: string
  /** total commits before any filtering (the honest full count) */
  total: number
  /** commits returned in this response */
  returned: number
  filtered: boolean
  fetchMs: number
  commits: T[]
}

export interface CommitDetailResponse {
  commit: GitCommit
  stats: GitCommitStats
  /** unified diff text (truncated), only when requested */
  diff?: string
  diffTruncated?: boolean
}
