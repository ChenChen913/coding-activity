/**
 * Lightweight syntax highlighter for diff lines.
 *
 * Zero-dependency, single-pass regex scanner tuned for one-line-at-a-time
 * diff rendering. Not a full parser — it aims for "90% of the visual value
 * with 1% of the complexity", and degrades gracefully to plain text for
 * unknown languages.
 */

export type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'func'
  | 'type'
  | 'prop' // object/json keys, css properties
  | 'tag' // html/xml tags, markdown headings
  | 'plain'

export interface Token {
  text: string
  type: TokenType
}

/* ------------------------------------------------------------------ */
/*  Language detection (by file extension)                             */
/* ------------------------------------------------------------------ */

type Lang =
  | 'clike' // ts/js/go/rust/java/c/cpp/php/swift/kotlin/scala/dart
  | 'hash' // python/shell/ruby/yaml/toml/ini/makefile
  | 'json'
  | 'css'
  | 'markdown'
  | 'html'
  | 'sql'
  | 'none'

interface LangSpec {
  lang: Lang
  keywords: Set<string>
  lineComment: string | null // '//' | '#' | '--'
  blockComment: boolean // support /* */ single-line
}

const TS_KEYWORDS =
  'abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number of package private protected public readonly return satisfy set static string super switch symbol this throw true try type typeof undefined union unknown var void while with yield'

const GO_KEYWORDS =
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota make new len cap append copy delete panic recover'

const RUST_KEYWORDS =
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'

const JAVA_KEYWORDS =
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed'

const CPP_KEYWORDS =
  'alignas alignof auto bool break case catch char class const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while #include #define'

const PHP_KEYWORDS =
  'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null int string bool float void self parent'

const SQL_KEYWORDS =
  'ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CHECK COLUMN CREATE CROSS DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FOREIGN FROM FULL GROUP HAVING IF IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY REFERENCES RIGHT SELECT SET TABLE THEN TRUNCATE UNION UNIQUE UPDATE VALUES VIEW WHEN WHERE WITH TRUE FALSE BEGIN COMMIT ROLLBACK'

function spec(ext: string): LangSpec | null {
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { lang: 'clike', keywords: new Set(TS_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'go':
      return { lang: 'clike', keywords: new Set(GO_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'rs':
      return { lang: 'clike', keywords: new Set(RUST_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'java':
      return { lang: 'clike', keywords: new Set(JAVA_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
      return { lang: 'clike', keywords: new Set(CPP_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'php':
      return { lang: 'clike', keywords: new Set(PHP_KEYWORDS.split(' ')), lineComment: '//', blockComment: true }
    case 'py':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'rb':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'dockerfile':
      return { lang: 'hash', keywords: new Set(), lineComment: '#', blockComment: false }
    case 'json':
      return { lang: 'json', keywords: new Set(), lineComment: null, blockComment: false }
    case 'css':
    case 'scss':
    case 'less':
      return { lang: 'css', keywords: new Set(), lineComment: '//', blockComment: true }
    case 'md':
    case 'mdx':
      return { lang: 'markdown', keywords: new Set(), lineComment: null, blockComment: false }
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
    case 'xml':
      return { lang: 'html', keywords: new Set(), lineComment: null, blockComment: false }
    case 'sql':
      return { lang: 'sql', keywords: new Set(SQL_KEYWORDS.split(' ')), lineComment: '--', blockComment: false }
    default:
      return null
  }
}

/** match a quoted string starting at position i (quote char q), tolerant of no close */
function matchQuoted(text: string, i: number, q: string): string {
  let j = i + 1
  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2
      continue
    }
    if (text[j] === q) return text.slice(i, j + 1)
    j++
  }
  return text.slice(i)
}

/** map a file path to a language spec, or null when unknown */
export function detectLanguage(path: string): LangSpec | null {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1) : base
  // Dockerfile / Makefile have no useful extension
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return spec('dockerfile')
  if (base === 'makefile') return spec('sh')
  return spec(ext)
}

/* ------------------------------------------------------------------ */
/*  Tokenizer                                                          */
/* ------------------------------------------------------------------ */

const MAX_CACHE = 12000
const cache = new Map<string, Token[]>()

/**
 * Tokenize one line of source. Results are cached (text is repeated heavily
 * across context/add/remove line pairs in diffs, so the cache pays off).
 */
export function tokenizeLine(text: string, language: ReturnType<typeof detectLanguage>): Token[] {
  if (!language || language.lang === 'none' || text.length === 0 || text.length > 2000) {
    return [{ text, type: 'plain' }]
  }
  const key = `${language.lang}|${text}`
  const hit = cache.get(key)
  if (hit) return hit

  let tokens: Token[]
  switch (language.lang) {
    case 'clike':
      tokens = scanClike(text, language)
      break
    case 'hash':
      tokens = scanHash(text)
      break
    case 'json':
      tokens = scanJson(text)
      break
    case 'css':
      tokens = scanCss(text)
      break
    case 'markdown':
      tokens = scanMarkdown(text)
      break
    case 'html':
      tokens = scanHtml(text)
      break
    case 'sql':
      tokens = scanClike(text, language)
      break
    default:
      tokens = [{ text, type: 'plain' }]
  }

  if (cache.size >= MAX_CACHE) {
    // evict oldest ~25% to amortize the cost
    const drop = Math.floor(MAX_CACHE / 4)
    let i = 0
    for (const k of cache.keys()) {
      if (i++ >= drop) break
      cache.delete(k)
    }
  }
  cache.set(key, tokens)
  return tokens
}

/* -------------------------- C-like family -------------------------- */

const C_STRING = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?/
const C_NUMBER = /\b0[xX][\da-fA-F_]+n?\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?\b/
const C_IDENT = /[A-Za-z_$#][\w$]*/

function scanClike(text: string, language: LangSpec): Token[] {
  const out: Token[] = []
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]

    // whitespace / plain punctuation chunk
    if (!/[A-Za-z_$#@0-9"'`]/.test(ch)) {
      let j = i + 1
      while (j < n && !/[A-Za-z_$#@0-9"'`]/.test(text[j])) j++
      out.push({ text: text.slice(i, j), type: 'plain' })
      i = j
      continue
    }

    // line comment
    if (language.lineComment && text.startsWith(language.lineComment, i)) {
      out.push({ text: text.slice(i), type: 'comment' })
      break
    }
    // block comment (single-line)
    if (language.blockComment && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out.push({ text: text.slice(i, stop), type: 'comment' })
      i = stop
      continue
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const m = text.slice(i).match(C_STRING)!
      const raw = m[0]
      out.push({ text: raw, type: 'string' })
      i += raw.length
      continue
    }
    // numbers
    if (/[0-9]/.test(ch)) {
      const m = text.slice(i).match(C_NUMBER)
      if (m) {
        out.push({ text: m[0], type: 'number' })
        i += m[0].length
        continue
      }
      // stray digit (unlikely) — fall into identifier loop below via plain
      out.push({ text: ch, type: 'number' })
      i++
      continue
    }
    // identifiers / keywords
    const m = text.slice(i).match(C_IDENT)
    if (m) {
      const word = m[0]
      const after = text.slice(i + word.length)
      let type: TokenType = 'plain'
      if (language.keywords.has(word) || language.keywords.has(word.toLowerCase())) {
        type = 'keyword'
      } else if (/^[A-Z]/.test(word)) {
        type = 'type'
      } else if (/^\s*\(/.test(after)) {
        type = 'func'
      } else if (/^\s*:/.test(after) && !/[=><!+\-*/%&|?]/.test(after[after.indexOf(':') + 1] ?? '')) {
        // object literal key: `foo:` but not `foo :=` or ternary — approximation
        type = 'prop'
      }
      out.push({ text: word, type })
      i += word.length
      continue
    }
    // fallback single char
    out.push({ text: ch, type: 'plain' })
    i++
  }
  return out
}

/* ------------------------- # comment family ------------------------ */

function scanHash(text: string): Token[] {
  const out: Token[] = []
  const hash = text.indexOf('#')
  if (hash !== -1 && (hash === 0 || /\s/.test(text[hash - 1])) && !text.startsWith('#!', 0)) {
    // `#` starts a comment (but not inside quotes — acceptably rare in these langs;
    // except CSS hex colors are handled by the css scanner, not here)
    let code = text.slice(0, hash)
    if (code) out.push(...scanPythonCode(code))
    out.push({ text: text.slice(hash), type: 'comment' })
    return out
  }
  return scanPythonCode(text)
}

const PY_KEYWORDS = new Set(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self cls print'.split(
    ' ',
  ),
)

function scanPythonCode(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      // handle triple quotes as string-to-end
      if (text.startsWith(ch.repeat(3), i)) {
        out.push({ text: text.slice(i), type: 'string' })
        return out
      }
      const raw = matchQuoted(text, i, ch)
      out.push({ text: raw, type: 'string' })
      i += raw.length
      continue
    }
    if (/[0-9]/.test(ch)) {
      const m = text.slice(i).match(C_NUMBER)
      if (m) {
        out.push({ text: m[0], type: 'number' })
        i += m[0].length
        continue
      }
    }
    if (/[A-Za-z_@]/.test(ch)) {
      const m = text.slice(i).match(/[A-Za-z_][\w]*/)
      if (m) {
        const word = m[0]
        const after = text.slice(i + word.length)
        let type: TokenType = 'plain'
        if (PY_KEYWORDS.has(word)) type = 'keyword'
        else if (/^[A-Z]/.test(word)) type = 'type'
        else if (/^\s*\(/.test(after)) type = 'func'
        out.push({ text: word, type })
        i += word.length
        continue
      }
    }
    let j = i + 1
    while (j < n && !/["'0-9A-Za-z_@]/.test(text[j])) j++
    out.push({ text: text.slice(i, j), type: 'plain' })
    i = j
  }
  return out
}

/* ------------------------------- JSON ------------------------------ */

function scanJson(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      const m = text.slice(i).match(C_STRING)!
      const raw = m[0]
      const rest = text.slice(i + raw.length)
      out.push({ text: raw, type: /^\s*:/.test(rest) ? 'prop' : 'string' })
      i += raw.length
      continue
    }
    if (/[0-9-]/.test(ch) && (/[0-9]/.test(ch) || /\d/.test(text[i + 1] ?? ''))) {
      const m = text.slice(i).match(/-?\d[\d.eE+-]*/)
      if (m) {
        out.push({ text: m[0], type: 'number' })
        i += m[0].length
        continue
      }
    }
    if (/[a-z]/.test(ch)) {
      const m = text.slice(i).match(/[a-z]+/)
      if (m) {
        out.push({ text: m[0], type: m[0] === 'true' || m[0] === 'false' || m[0] === 'null' ? 'keyword' : 'plain' })
        i += m[0].length
        continue
      }
    }
    let j = i + 1
    while (j < n && !/["'0-9a-z]/.test(text[j])) j++
    out.push({ text: text.slice(i, j), type: 'plain' })
    i = j
  }
  return out
}

/* ------------------------------- CSS ------------------------------- */

const CSS_PROP = /^(?:[a-z-]+)\s*:/ // `color:` at line-ish positions

function scanCss(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = text.length
  const trimmed = text.trimStart()
  const isDeclaration = CSS_PROP.test(trimmed) && !trimmed.startsWith('&') && !trimmed.startsWith('@')

  while (i < n) {
    const ch = text[i]
    if (ch === '/' && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out.push({ text: text.slice(i, stop), type: 'comment' })
      i = stop
      continue
    }
    if (ch === '"' || ch === "'") {
      const m = text.slice(i).match(C_STRING)!
      out.push({ text: m[0], type: 'string' })
      i += m[0].length
      continue
    }
    if (ch === '#') {
      const m = text.slice(i + 1).match(/^[\da-fA-F]{3,8}\b/)
      if (m) {
        out.push({ text: `#${m[0]}`, type: 'number' })
        i += 1 + m[0].length
        continue
      }
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /\d/.test(text[i + 1] ?? '')) || (ch === '-' && /[\d.]/.test(text[i + 1] ?? ''))) {
      const m = text.slice(i).match(/-?\.?\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|ex|pt|vh|xl)?[a-z%]*/)
      if (m) {
        out.push({ text: m[0], type: 'number' })
        i += m[0].length
        continue
      }
    }
    if (/[a-zA-Z-]/.test(ch)) {
      const m = text.slice(i).match(/[a-zA-Z-]+/)
      if (m) {
        const word = m[0]
        const after = text.slice(i + word.length)
        let type: TokenType = 'plain'
        if (isDeclaration && /^\s*:/.test(after)) type = 'prop'
        else if (/^\s*\(/.test(after)) type = 'func'
        else if (word.startsWith('--') || word.startsWith('@')) type = 'keyword'
        out.push({ text: word, type })
        i += word.length
        continue
      }
    }
    let j = i + 1
    while (j < n && !/[a-zA-Z0-9"'#.\-]/.test(text[j])) j++
    out.push({ text: text.slice(i, j), type: 'plain' })
    i = j
  }
  return out
}

/* ----------------------------- Markdown ---------------------------- */

function scanMarkdown(text: string): Token[] {
  // heading
  if (/^#{1,6}\s/.test(text)) {
    return [
      { text: text.match(/^#{1,6}\s/)![0], type: 'tag' },
      ...scanMarkdownInline(text.replace(/^#{1,6}\s/, '')),
    ]
  }
  // blockquote / hr / list markers
  if (/^\s*>/.test(text)) {
    const m = text.match(/^\s*>+\s?/)![0]
    return [{ text: m, type: 'comment' }, ...scanMarkdownInline(text.slice(m.length))]
  }
  const listM = text.match(/^(\s*)([-*+]|\d+\.)\s+/)
  if (listM) {
    return [
      { text: listM[0], type: 'keyword' },
      ...scanMarkdownInline(text.slice(listM[0].length)),
    ]
  }
  return scanMarkdownInline(text)
}

function scanMarkdownInline(text: string): Token[] {
  const out: Token[] = []
  // split by `code` spans first
  const parts = text.split(/(`[^`]*`)/g)
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      out.push({ text: part, type: 'string' })
    } else if (part) {
      // bold / italic markers
      let rest = part
      const emph = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/
      while (rest) {
        const m = rest.match(emph)
        if (!m || m.index === undefined) {
          out.push({ text: rest, type: 'plain' })
          break
        }
        if (m.index > 0) out.push({ text: rest.slice(0, m.index), type: 'plain' })
        out.push({ text: m[0], type: 'keyword' })
        rest = rest.slice(m.index + m[0].length)
      }
    }
  }
  return out
}

/* ------------------------------- HTML ------------------------------ */

function scanHtml(text: string): Token[] {
  const out: Token[] = []
  // <!-- comments -->
  const cm = text.match(/<!--[\s\S]*?(?:-->|$)/)
  if (cm && cm.index !== undefined && cm.index === 0) {
    return [{ text: text, type: 'comment' }]
  }
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '<') {
      const m = text.slice(i).match(/^<\/?[a-zA-Z][\w.-]*/)
      if (m) {
        out.push({ text: m[0], type: 'tag' })
        i += m[0].length
        continue
      }
      const incl = text.slice(i).match(/^<=?(?![<])/)
      if (incl) {
        out.push({ text: incl[0], type: 'plain' })
        i += incl[0].length
        continue
      }
    }
    if (ch === '>' || (ch === '/' && text[i + 1] === '>')) {
      const m = text.slice(i).match(/^\/?>/)
      out.push({ text: m[0], type: 'tag' })
      i += m[0].length
      continue
    }
    if (ch === '"' || ch === "'") {
      const m = text.slice(i).match(C_STRING)!
      out.push({ text: m[0], type: 'string' })
      i += m[0].length
      continue
    }
    const attr = text.slice(i).match(/^[a-zA-Z-]+(?==)/)
    if (attr) {
      out.push({ text: attr[0], type: 'prop' })
      i += attr[0].length
      continue
    }
    let j = i + 1
    while (j < n && !/<>"'=[a-zA-Z-]/.test(text[j])) j++
    if (j === i + 1) j++
    out.push({ text: text.slice(i, j), type: 'plain' })
    i = j
  }
  return out
}
