/**
 * AI agent detection — based on REAL git evidence only.
 *
 * Modern AI coding tools leave honest traces in commit messages:
 *   Co-Authored-By: Claude <noreply@anthropic.com>
 *   🤖 Generated with [Claude Code]
 *   Co-Authored-By: Cursor <cursor@cursor.com>
 *   Co-Authored-By: Copilot <139878660+GitHubCopilot@users.noreply.github.com>
 *   Generated with Gemini CLI
 *
 * We never guess. No trailer → no aiAgent field.
 */

interface AgentPattern {
  agent: string
  patterns: RegExp[]
}

const AGENT_PATTERNS: AgentPattern[] = [
  {
    agent: 'Claude Code',
    patterns: [
      /Generated with \[Claude Code\]/i,
      /Co-Authored-By:.*Claude Code/i,
    ],
  },
  {
    agent: 'Claude',
    patterns: [
      /Co-Authored-By:.*<noreply@anthropic\.com>/i,
      /Co-Authored-By:.*\bClaude\b/i,
    ],
  },
  {
    agent: 'GitHub Copilot',
    patterns: [
      /Co-Authored-By:.*GitHubCopilot/i,
      /Co-Authored-By:.*\bCopilot\b/i,
    ],
  },
  {
    agent: 'Cursor',
    patterns: [
      /Generated with Cursor/i,
      /Co-Authored-By:.*\bCursor\b/i,
    ],
  },
  {
    agent: 'Gemini CLI',
    patterns: [/Generated with Gemini CLI/i, /Co-Authored-By:.*\bGemini\b/i],
  },
  {
    agent: 'Codex',
    patterns: [
      /Generated with Codex/i,
      /Co-Authored-By:.*\bCodex\b/i,
      /Co-Authored-By:.*<codex@openai\.com>/i,
    ],
  },
  {
    agent: 'Aider',
    patterns: [/Co-Authored-By:.*\bAider\b/i, /aider is AI pair programming/i],
  },
]

/**
 * Detect which AI agent (if any) participated in a commit.
 * Checks trailers first (body), then the author identity itself —
 * some bots commit directly under their own name.
 */
export function detectAiAgent(
  fullMessage: string,
  authorName?: string,
  authorEmail?: string,
): string | undefined {
  for (const { agent, patterns } of AGENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(fullMessage)) return agent
    }
  }
  const identity = `${authorName ?? ''} ${authorEmail ?? ''}`
  // bot-style direct authors (e.g. "dependabot[bot]") are automation, not AI
  // coding agents — intentionally not marked as aiAgent.
  if (/noreply@anthropic\.com/i.test(authorEmail ?? '')) return 'Claude'
  if (/\bcursor@cursor\.com/i.test(authorEmail ?? '')) return 'Cursor'
  return undefined
}
