import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  readonly stderr?: string

  constructor(message: string, stderr?: string) {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

/**
 * Run a git command inside a repository and return stdout.
 * No shell is involved — args are passed directly to execFile.
 */
export async function git(
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 128 * 1024 * 1024, // large repos produce large log output
      windowsHide: true,
    })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string; killed?: boolean }
    if (e.killed) {
      throw new GitError(`Git command timed out: git ${args[0]} …`, e.stderr)
    }
    throw new GitError(
      e.message?.replace(/^Command failed:.*?\n/, '').slice(0, 300) ??
        'Unknown git error',
      e.stderr,
    )
  }
}

/** The well-known empty tree object — diff base for root commits. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** True when the directory is inside a git work tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(['rev-parse', '--is-inside-work-tree'], cwd, 5_000)
    return out.trim() === 'true'
  } catch {
    return false
  }
}
