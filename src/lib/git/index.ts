export * from './types'
export { GitError, EMPTY_TREE, git, isGitRepo } from './exec'
export {
  getRegistry,
  findRepoEntry,
  resolveRepo,
  listAvailableRepos,
  RepoNotGitError,
  type RepoRegistryEntry,
} from './repos'
export { getBranches, getBranchContainment } from './branches'
export {
  parseLog,
  getCommitIndex,
  getVerifiedCommitCount,
  getCommitStats,
  getCommitDiff,
  type CommitIndex,
} from './commits'
export { getRepoOverview, getRepoCommitIndex } from './repo'
export { detectAiAgent } from './ai'
export { cached, clearCache } from './cache'
