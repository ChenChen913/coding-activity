/**
 * Programmatic SVG export for the commit graph.
 *
 * No DOM cloning, no extra dependencies: we re-render the graph from the
 * layout data into a standalone SVG string (system fonts only, inlined
 * colors), then rasterize it through an offscreen <canvas> at an arbitrary
 * pixel scale for ultra-high-resolution PNG output.
 *
 * Two modes:
 *  - 'view'   — exactly what the user currently sees (viewport + visible
 *               slice, labels included): horizontal mode renders the lane
 *               label gutter + bottom commit rail; both modes honor the
 *               active type filter (halo on matches, dimming on the rest)
 *  - 'poster' — the entire history, every single commit, auto-scaled to a
 *               long poster strip (never sampled, never truncated)
 */

import type { Geo, GraphLayout } from './layout'
import { LANE_W, LEFT_PAD, ROW_H, TOP_PAD, laneColor } from './layout'
import type { GraphCommit } from '@/lib/git/types'
import { parseCommitType, TYPE_META, type CommitType } from '@/lib/commit-type'

/* ------------------------------------------------------------------ */
/*  shared                                                             */
/* ------------------------------------------------------------------ */

const MAX_PNG_SIDE = 32_000 // stay under browser canvas limits after scaling

export interface ExportTheme {
  dark: boolean
  repoLabel: string
  branchLabel: string | null
  selectedHash: string | null
}

const SANS = `-apple-system, 'Segoe UI', 'Helvetica Neue', Arial, 'PingFang SC', sans-serif`
const MONO = `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`

function palette(dark: boolean) {
  return dark
    ? {
        bg: '#1c1917',
        fg: '#fafaf9',
        sub: '#a8a29e',
        faint: '#78716c',
        line: '#3f3a36',
        grid: '#292524',
        accent: '#34d399',
      }
    : {
        bg: '#fafaf9',
        fg: '#1c1917',
        sub: '#57534e',
        faint: '#a8a29e',
        line: '#e7e5e4',
        grid: '#efedeb',
        accent: '#059669',
      }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Date.now() - d.getTime() < 86_400_000
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** list-column time: HH:mm for recent commits, date for older ones
 *  (mirrors the on-screen message list) */
function listTime(iso: string): string {
  const d = new Date(iso)
  return Date.now() - d.getTime() < 86_400_000
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** escape hatch for names that end up inside font-family quotes — not needed,
 *  but keeps the SVG well-formed if a label ever contains quotes */
function escAttr(s: string): string {
  return esc(s).replace(/'/g, '&#39;')
}

/* ------------------------------------------------------------------ */
/*  type filter helpers (shared by view export — halo + dimming)       */
/* ------------------------------------------------------------------ */

interface TypeFx {
  /** halo stroke color for filter-matching nodes (null = filter off / no match) */
  halo: string | null
  /** optional outer ring (search matches — emerald) */
  ring?: string | null
  /** true when a filter is active and this commit is outside it */
  dim: boolean
}

function typeFxOf(
  typeKinds: CommitType[] | null,
): (c: GraphCommit) => TypeFx {
  if (!typeKinds || typeKinds.length === 0) return () => ({ halo: null, dim: false })
  const set = new Set<CommitType>(typeKinds)
  return (c) => {
    const t = parseCommitType(c.message)
    if (set.has(t)) return { halo: TYPE_META[t].color, dim: false }
    return { halo: null, dim: true }
  }
}

/** small type badge chip (SVG counterpart of CommitTypeBadge) — returns an
 *  empty string for structural/hidden types, matching the on-screen badge */
function badgeSvg(x: number, cy: number, t: CommitType): { s: string; w: number } {
  const meta = TYPE_META[t]
  if (!meta || meta.hidden || !meta.chip) return { s: '', w: 0 }
  const label = t.toUpperCase()
  const w = label.length * 5.8 + 8
  const h = 15
  const y = cy - h / 2
  return {
    w,
    s:
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${h}" rx="3" fill="${meta.color}1f" stroke="${meta.color}66"/>` +
      `<text x="${f(x + w / 2)}" y="${f(cy + 3)}" text-anchor="middle" font-family="${MONO}" font-size="8.5" font-weight="700" fill="${meta.color}">${label}</text>`,
  }
}

/* ------------------------------------------------------------------ */
/*  node / edge primitives                                             */
/* ------------------------------------------------------------------ */

function nodeSvg(
  c: GraphCommit,
  lane: number,
  x: number,
  y: number,
  r: number,
  bg: string,
  selected: boolean,
  theme: ExportTheme,
  fx?: TypeFx,
): string {
  const color = laneColor(lane)
  const parts: string[] = []
  if (fx && (fx.halo || fx.dim)) {
    parts.push(`<g opacity="${fx.dim ? 0.25 : 1}">`)
  }
  if (selected) {
    /* static snapshot of the on-screen locate flash (globals.css):
       soft glow disc + twin radar rings at different radii */
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.7)}" fill="${color}" opacity="0.28"/>`,
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 4)}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.9"/>`,
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 9)}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.45"/>`,
    )
  }
  if (fx?.ring) {
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 5.5)}" fill="none" stroke="${fx.ring}" stroke-width="1.5" opacity="0.9"/>`,
    )
  }
  if (fx?.halo) {
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 2.5)}" fill="none" stroke="${fx.halo}" stroke-width="1.3" opacity="0.85"/>`,
    )
  }
  parts.push(
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}" stroke="${bg}" stroke-width="${c.isMerge ? Math.max(2.2 * (r / 5), 1) : Math.max(1.4 * (r / 5), 0.6)}"/>`,
  )
  if (c.isMerge) {
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(Math.max(r * 0.38, 0.8))}" fill="${bg}" opacity="0.92"/>`,
    )
  }
  if (c.aiAgent) {
    const ax = x + r * 0.92
    const ay = y - r * 0.92
    parts.push(
      `<circle cx="${f(ax)}" cy="${f(ay)}" r="${f(Math.max(2.1 * (r / 5), 0.9))}" fill="#f59e0b" stroke="${bg}" stroke-width="${Math.max(1 * (r / 5), 0.4)}"/>`,
    )
  }
  if (fx && (fx.halo || fx.dim)) parts.push('</g>')
  return parts.join('')
}

function edgeSvg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontal: boolean,
  color: string,
  w: number,
  opacity: number,
): string {
  if (x1 === x2 && y1 === y2) return ''
  if (horizontal) {
    if (y1 === y2) return `<path d="M ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`
    const k = Math.min(w * 8, Math.abs(x1 - x2) / 2)
    const s = x2 >= x1 ? 1 : -1 // bend toward each other whichever way time runs
    return `<path d="M ${f(x1)} ${f(y1)} C ${f(x1 + s * k)} ${f(y1)} ${f(x2 - s * k)} ${f(y2)} ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`
  }
  if (x1 === x2) return `<path d="M ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`
  const k = Math.min(w * 8, (y2 - y1) / 2)
  return `<path d="M ${f(x1)} ${f(y1)} C ${f(x1)} ${f(y1 + k)} ${f(x2)} ${f(y2 - k)} ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`
}

function f(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/* ------------------------------------------------------------------ */
/*  view export                                                        */
/* ------------------------------------------------------------------ */

export interface ViewExportOptions extends ExportTheme {
  orientation: 'vertical' | 'horizontal'
  width: number
  height: number
  /** vertical layout: left time gutter width */
  gutterW: number
  /** vertical layout: lane area width */
  laneAreaW: number
  /** horizontal layout: top axis strip height */
  axisH: number
  /** horizontal layout: left lane-label gutter width (0 = none) */
  labelW: number
  /** horizontal layout: bottom commit rail height (0 = none) */
  railH: number
  /** horizontal layout: rail interleave rows (1 mobile / 3 desktop) */
  railRows: number
  /** horizontal layout: per-lane branch tip labels (null lanes = structural) */
  laneLabels: Array<{ name: string; isCurrent: boolean } | null> | null
  /** active type filter (null = off) — matches get a halo, the rest dim */
  typeKinds: CommitType[] | null
  /** live search matches (null = off) — hits get an emerald ring, the rest dim */
  searchHashes: string[] | null
  startRow: number
  endRow: number
  geo: Geo
  tx: number
  ty: number
  totalCommits: number
  /** optional full-history minimap strip appended below the view
   *  (the SVG twin of the on-screen overview) — null = off */
  minimap?: {
    /** first row visible in the exported viewport window */
    startRow: number
    /** last row visible in the exported viewport window */
    endRow: number
    /** layout row of the selected commit (-1 = none selected) */
    selectedRow: number
  } | null
}

export function buildViewSvg(layout: GraphLayout, o: ViewExportOptions): { svg: string; w: number; h: number } {
  const p = palette(o.dark)
  const { geo } = o
  const horiz = o.orientation === 'horizontal'
  const baseFxOf = typeFxOf(o.typeKinds)
  const sSet =
    o.searchHashes && o.searchHashes.length > 0
      ? new Set(o.searchHashes)
      : null
  /** search + type combine: a search miss dims even if the type matches;
   *  a search hit keeps any type halo plus an emerald outer ring */
  const fxOf = (c: GraphCommit): TypeFx => {
    const base = baseFxOf(c)
    if (!sSet) return base
    return sSet.has(c.hash)
      ? { ...base, ring: '#10b981', dim: false }
      : { halo: null, ring: null, dim: true }
  }

  const laneXOf = (lane: number) => LEFT_PAD + lane * geo.lw + geo.lw / 2
  const rowYOf = (row: number) => TOP_PAD + row * geo.rh + geo.rh / 2
  // newest (row 0) at the LEFT edge — matches the on-screen horizontal view
  const timeXOf = (row: number) => LEFT_PAD + row * geo.rh + geo.rh / 2
  const laneYOf = (lane: number) => TOP_PAD + lane * geo.lw + geo.lw / 2

  const parts: string[] = []
  parts.push(`<rect x="0" y="0" width="${f(o.width)}" height="${f(o.height)}" fill="${p.bg}"/>`)

  const rows = layout.nodes.slice(o.startRow, o.endRow + 1)
  const edges = layout.edges.filter(
    (e) => e.childRow <= o.endRow + 1 && e.parentRow >= o.startRow - 1,
  )

  if (!horiz) {
    /* ---- time gutter ---- */
    let lastY = -Infinity
    for (const m of layout.monthMarks) {
      if (m.row < o.startRow - 2 || m.row > o.endRow + 2) continue
      const y = rowYOf(m.row) - o.ty
      if (y - lastY < 14 || y < 8 || y > o.height - 4) continue
      lastY = y
      parts.push(
        `<text x="${f(o.gutterW - 8)}" y="${f(y + 3.5)}" text-anchor="end" font-family="${SANS}" font-size="${m.isYearStart ? 11 : 9.5}" ${m.isYearStart ? `font-weight="600" fill="${p.fg}" opacity="0.75"` : `fill="${p.sub}" opacity="0.85"`}>${m.isYearStart ? m.year : monthShort(m.month)}</text>`,
      )
    }

    /* ---- edges + nodes (lane area) ---- */
    const g: string[] = [`<g transform="translate(${f(o.gutterW)} 0)">`]
    for (const e of edges) {
      const x1 = laneXOf(e.childLane) + o.tx
      const y1 = rowYOf(e.childRow) - o.ty
      const x2 = laneXOf(e.parentLane) + o.tx
      const y2 = rowYOf(e.parentRow) - o.ty
      g.push(
        edgeSvg(x1, y1, x2, y2, false, laneColor(e.colorLane), geo.edgeW * (e.isSecondary ? 0.85 : 1), 0.92),
      )
    }
    for (const nd of rows) {
      g.push(
        nodeSvg(
          nd.commit,
          nd.lane,
          laneXOf(nd.lane) + o.tx,
          rowYOf(nd.row) - o.ty,
          geo.nodeR * (nd.commit.isMerge ? 1.15 : 1),
          p.bg,
          o.selectedHash === nd.commit.hash,
          o,
          fxOf(nd.commit),
        ),
      )
    }
    g.push('</g>')
    parts.push(g.join(''))

    /* ---- message list (type badge + subject + branch pills + author + time,
            with the same filter dimming as on screen) ---- */
    const listX = o.gutterW + o.laneAreaW
    if (listX < o.width - 60) {
      const listW = o.width - listX
      const lg: string[] = [`<g>`]
      lg.push(`<line x1="${f(listX)}" y1="0" x2="${f(listX)}" y2="${f(o.height)}" stroke="${p.line}"/>`)
      const showText = geo.rh >= 15
      for (const nd of rows) {
        const c = nd.commit
        const fx = fxOf(c)
        const y = rowYOf(nd.row) - o.ty
        if (y < -geo.rh || y > o.height + geo.rh) continue
        const top = y - geo.rh / 2
        const selected = o.selectedHash === c.hash
        const dimmed = fx.dim && !selected
        if (selected) {
          lg.push(`<rect x="${f(listX)}" y="${f(top)}" width="${f(listW)}" height="${f(geo.rh)}" fill="${p.fg}" opacity="0.07"/>`)
        }
        if (!showText) continue
        const rowG: string[] = [`<g opacity="${dimmed ? 0.4 : 1}">`]
        const timeW = 66
        const authorW = c.author.length > 0 ? Math.min(120, c.author.length * 6.4 + 8) : 0
        // type badge
        const badge = badgeSvg(listX + 12, y, parseCommitType(c.message))
        let cursorX = listX + 12 + badge.w
        if (badge.s) {
          rowG.push(badge.s)
          cursorX += 6
        }
        // branch pills (local branches get a lane-colored fill; remotes outline)
        let pillsW = 0
        const pills: string[] = []
        for (const b of c.headBranches.slice(0, 3)) {
          const isRemote = b.includes('/')
          const pw = Math.min(b.length * 5.6 + 12, 120)
          const pillY = y - 8
          if (isRemote) {
            pills.push(
              `<rect x="${f(cursorX + pillsW)}" y="${f(pillY)}" width="${f(pw)}" height="16" rx="8" fill="none" stroke="${p.line}"/>` +
              `<text x="${f(cursorX + pillsW + pw / 2)}" y="${f(y + 3)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="${p.sub}">${escAttr(clip(b, Math.floor(pw / 5.6)))}</text>`,
            )
          } else {
            pills.push(
              `<rect x="${f(cursorX + pillsW)}" y="${f(pillY)}" width="${f(pw)}" height="16" rx="8" fill="${laneColor(nd.lane)}" fill-opacity="0.85"/>` +
              `<text x="${f(cursorX + pillsW + pw / 2)}" y="${f(y + 3)}" text-anchor="middle" font-family="${SANS}" font-size="10" fill="#ffffff">${escAttr(clip(b, Math.floor(pw / 5.6)))}</text>`,
            )
          }
          pillsW += pw + 6
        }
        // message (budget: badge + pills + time + author)
        const msgMax = Math.max(
          10,
          Math.floor((listW - 24 - badge.w - (badge.s ? 6 : 0) - pillsW - timeW - authorW - 12) / 6.3),
        )
        rowG.push(
          `<text x="${f(cursorX + pillsW)}" y="${f(y + 4)}" font-family="${SANS}" font-size="12.5" ${selected ? `font-weight="600" fill="${p.fg}"` : `font-weight="500" fill="${p.fg}" opacity="0.92"`}>${escAttr(clip(c.message, msgMax))}</text>`,
        )
        rowG.push(...pills)
        if (authorW > 0) {
          rowG.push(
            `<text x="${f(o.width - timeW - 14)}" y="${f(y + 4)}" text-anchor="end" font-family="${SANS}" font-size="11.5" fill="${p.sub}">${escAttr(clip(c.author, 18))}</text>`,
          )
        }
        rowG.push(
          `<text x="${f(o.width - 12)}" y="${f(y + 4)}" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${p.sub}">${listTime(c.committedAt)}</text>`,
        )
        rowG.push('</g>')
        lg.push(rowG.join(''))
      }
      lg.push('</g>')
      parts.push(lg.join(''))
    }
  } else {
    /* ---- horizontal: everything lives right of the lane-label gutter ---- */
    const labelW = o.labelW
    const railH = o.railH
    const railY0 = o.height - railH
    const graphW = o.width - labelW

    /* lane-label gutter (branch tips pinned to the left edge) */
    parts.push(`<rect x="0" y="${f(o.axisH)}" width="${f(labelW)}" height="${f(Math.max(0, railY0 - o.axisH))}" fill="${p.bg}" opacity="0.82"/>`)
    parts.push(`<line x1="${f(labelW)}" y1="${f(o.axisH)}" x2="${f(labelW)}" y2="${f(railY0)}" stroke="${p.line}"/>`)
    if (o.laneLabels && geo.lw > 0) {
      const compact = geo.lw < 15
      const lg: string[] = []
      for (let i = 0; i < o.laneLabels.length; i++) {
        const y = laneYOf(i) - o.ty
        if (y < o.axisH - 10 || y > railY0 + 10) continue
        const ln = o.laneLabels[i]
        const color = laneColor(i)
        const h = compact ? Math.min(8, geo.lw - 2) : Math.min(20, geo.lw - 2)
        const top = Math.min(Math.max(y - h / 2, o.axisH + 2), railY0 - h - 2)
        if (ln) {
          lg.push(
            `<rect x="4" y="${f(top)}" width="${f(labelW - 8)}" height="${f(h)}" rx="4" fill="${color}14" stroke="${color}55"/>`,
          )
        }
        lg.push(`<circle cx="${f(4 + (compact ? (labelW - 8) / 2 : 8))}" cy="${f(top + h / 2)}" r="3" fill="${color}"/>`)
        if (!compact && ln) {
          lg.push(
            `<text x="${f(4 + 15)}" y="${f(top + h / 2 + 3.5)}" font-family="${SANS}" font-size="10" ${ln.isCurrent ? `font-weight="700" fill="${p.fg}"` : `font-weight="500" fill="${p.fg}" opacity="0.8"`}>${escAttr(clip(ln.name, Math.floor((labelW - 26) / 5.6)))}</text>`,
          )
        } else if (!compact) {
          lg.push(
            `<text x="${f(4 + 15)}" y="${f(top + h / 2 + 3.5)}" font-family="${MONO}" font-size="10" fill="${p.faint}" opacity="0.6">L${i + 1}</text>`,
          )
        }
      }
      parts.push(lg.join(''))
    }

    /* graph area (axis + edges + nodes + rail), clipped to the right of the gutter */
    const g: string[] = [
      `<g transform="translate(${f(labelW)} 0)" clip-path="url(#hgraph)">`,
      `<defs><clipPath id="hgraph"><rect x="0" y="0" width="${f(graphW)}" height="${f(o.height)}"/></clipPath></defs>`,
    ]

    /* top time axis + fixed direction anchors */
    g.push(`<line x1="0" y1="${f(o.axisH)}" x2="${f(graphW)}" y2="${f(o.axisH)}" stroke="${p.line}"/>`)
    let lastX = -Infinity
    for (const m of layout.monthMarks) {
      if (m.row < o.startRow - 2 || m.row > o.endRow + 2) continue
      const x = timeXOf(m.row) + o.tx
      if (x < 24 || x > graphW - 12 || x - lastX < (m.isYearStart ? 34 : 30)) continue
      lastX = x
      if (m.isYearStart) {
        g.push(
          `<line x1="${f(x)}" y1="${f(o.axisH)}" x2="${f(x)}" y2="${f(o.height)}" stroke="${p.grid}"/>`,
        )
      }
      g.push(
        `<text x="${f(x)}" y="${f(o.axisH - 8)}" text-anchor="middle" font-family="${SANS}" font-size="${m.isYearStart ? 11 : 9.5}" ${m.isYearStart ? `font-weight="600" fill="${p.fg}" opacity="0.75"` : `fill="${p.sub}" opacity="0.85"`}>${m.isYearStart ? m.year : monthShort(m.month)}</text>`,
      )
    }
    g.push(
      `<text x="10" y="${f(o.axisH - 8)}" font-family="${SANS}" font-size="10" font-weight="600" fill="${p.accent}">← newest</text>`,
      `<text x="${f(graphW - 10)}" y="${f(o.axisH - 8)}" text-anchor="end" font-family="${SANS}" font-size="10" font-weight="500" fill="${p.sub}">oldest →</text>`,
    )

    /* edges + nodes */
    const ng: string[] = [`<g transform="translate(0 ${f(o.axisH)})">`]
    for (const e of edges) {
      const x1 = timeXOf(e.childRow) + o.tx
      const y1 = laneYOf(e.childLane) - o.ty
      const x2 = timeXOf(e.parentRow) + o.tx
      const y2 = laneYOf(e.parentLane) - o.ty
      ng.push(
        edgeSvg(x1, y1, x2, y2, true, laneColor(e.colorLane), geo.edgeW * (e.isSecondary ? 0.85 : 1), 0.92),
      )
    }
    for (const nd of rows) {
      ng.push(
        nodeSvg(
          nd.commit,
          nd.lane,
          timeXOf(nd.row) + o.tx,
          laneYOf(nd.lane) - o.ty,
          geo.nodeR * (nd.commit.isMerge ? 1.15 : 1),
          p.bg,
          o.selectedHash === nd.commit.hash,
          o,
          fxOf(nd.commit),
        ),
      )
    }
    ng.push('</g>')
    g.push(ng.join(''))

    /* bottom commit rail — the counterpart of the vertical message list */
    if (railH > 0) {
      const railRows = Math.max(1, o.railRows)
      const chipH =
        railRows === 1 ? railH - 10 : (railH - 10 - (railRows - 1) * 2) / railRows
      g.push(`<line x1="0" y1="${f(railY0)}" x2="${f(graphW)}" y2="${f(railY0)}" stroke="${p.line}"/>`)
      const rg: string[] = []
      for (const nd of rows) {
        const c = nd.commit
        const cw = geo.rh
        const cx = timeXOf(nd.row) + o.tx
        if (cx < -160 || cx > graphW + 160) continue
        const slot = cw * railRows
        const fx = fxOf(c)
        const selected = o.selectedHash === c.hash
        const dimmed = fx.dim && !selected
        const t = parseCommitType(c.message)
        const tColor = TYPE_META[t].color
        const top = railY0 + 5 + (nd.row % railRows) * (chipH + 2)
        const cy = top + chipH / 2
        const chip: string[] = [`<g opacity="${dimmed ? 0.4 : 1}">`]
        if (slot < 14) {
          // ultra-dense: one structural tick per commit
          const w = Math.max(cw, 10)
          chip.push(
            `<rect x="${f(cx - w / 2)}" y="${f(railY0 + 8)}" width="${f(w)}" height="${f(railH - 16)}" fill="transparent"/>`,
            `<rect x="${f(cx - 1)}" y="${f(railY0 + 8)}" width="2" height="${f(railH - 16)}" rx="1" fill="${selected ? p.accent : laneColor(nd.lane)}"/>`,
          )
        } else if (slot < 46) {
          // dense: a type-colored dot per commit
          const w = Math.max(cw, 14)
          if (selected) {
            chip.push(`<rect x="${f(cx - w / 2)}" y="${f(top)}" width="${f(w)}" height="${f(chipH)}" rx="6" fill="${p.fg}" opacity="0.08"/>`)
          }
          chip.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="4" fill="${tColor}"/>`)
        } else {
          const w = Math.min(slot - 4, 320)
          if (selected) {
            chip.push(`<rect x="${f(cx - w / 2)}" y="${f(top)}" width="${f(w)}" height="${f(chipH)}" rx="6" fill="${p.fg}" opacity="0.08" stroke="${p.line}"/>`)
          }
          let innerX = cx - w / 2 + 6
          if (slot < 90) {
            // medium: type dot + short hash
            chip.push(`<circle cx="${f(innerX + 3)}" cy="${f(cy)}" r="2.8" fill="${tColor}"/>`)
            innerX += 10
            chip.push(
              `<text x="${f(innerX)}" y="${f(cy + 3.5)}" font-family="${MONO}" font-size="9" fill="${p.sub}">${escAttr(c.shortHash)}</text>`,
            )
            if (c.aiAgent) {
              chip.push(`<circle cx="${f(cx + w / 2 - 6)}" cy="${f(cy)}" r="2" fill="#f59e0b"/>`)
            }
          } else {
            // roomy: type badge + message (+ author at very high zoom)
            const badge = badgeSvg(innerX, cy, t)
            if (badge.s) {
              chip.push(badge.s)
              innerX += badge.w + 5
            }
            const authorW = slot >= 220 && c.author ? Math.min(80, c.author.length * 5.4 + 4) : 0
            const aiW = c.aiAgent ? 8 : 0
            const msgMax = Math.max(4, Math.floor((w - 12 - (badge.s ? badge.w + 5 : 0) - authorW - aiW) / 5.5))
            chip.push(
              `<text x="${f(innerX)}" y="${f(cy + 3.5)}" font-family="${SANS}" font-size="10" font-weight="${selected ? '600' : '500'}" fill="${p.fg}" opacity="0.95">${escAttr(clip(c.message, msgMax))}</text>`,
            )
            if (authorW > 0) {
              chip.push(
                `<text x="${f(cx + w / 2 - 6 - aiW)}" y="${f(cy + 3.5)}" text-anchor="end" font-family="${SANS}" font-size="9" fill="${p.sub}">${escAttr(clip(c.author, Math.floor(authorW / 5.4)))}</text>`,
              )
            }
            if (c.aiAgent) {
              chip.push(`<circle cx="${f(cx + w / 2 - 4)}" cy="${f(cy)}" r="2" fill="#f59e0b"/>`)
            }
          }
        }
        chip.push('</g>')
        rg.push(chip.join(''))
      }
      g.push(rg.join(''))
    }

    g.push('</g>')
    parts.push(g.join(''))

    /* rail header cell (above the gutter, bottom-left corner) */
    if (railH > 0) {
      parts.push(
        `<rect x="0" y="${f(railY0)}" width="${f(labelW)}" height="${f(railH)}" fill="${p.bg}" opacity="0.82"/>`,
        `<line x1="0" y1="${f(railY0)}" x2="${f(labelW)}" y2="${f(railY0)}" stroke="${p.line}"/>`,
        `<line x1="${f(labelW)}" y1="${f(railY0)}" x2="${f(labelW)}" y2="${f(o.height)}" stroke="${p.line}"/>`,
        `<text x="${f(labelW / 2)}" y="${f(railY0 + railH / 2 + 3)}" text-anchor="middle" font-family="${SANS}" font-size="9" font-weight="600" letter-spacing="1" fill="${p.sub}" opacity="0.8">COMMITS</text>`,
      )
    }
  }

  /* ---- optional full-history minimap strip (the SVG twin of the
          on-screen overview): every commit as a dot (AI amber, merges
          larger), the emerald window marks exactly what this export
          shows, search hits become emerald slivers, the selected commit
          gets a foreground marker — same visual language as on screen */
  let outH = o.height
  if (o.minimap && o.totalCommits > 0) {
    const m = o.minimap
    const total = Math.max(1, o.totalCommits)
    outH = o.height + MINIMAP_H
    const stripTop = o.height + 12
    const stripH = 22
    const stripBot = stripTop + stripH
    parts.push(
      `<rect x="0" y="${f(o.height)}" width="${f(o.width)}" height="${f(MINIMAP_H)}" fill="${p.bg}"/>`,
      `<line x1="0" y1="${f(o.height + 0.5)}" x2="${f(o.width)}" y2="${f(o.height + 0.5)}" stroke="${p.line}"/>`,
      `<text x="${f(o.width - 10)}" y="${f(o.height + 8.5)}" text-anchor="end" font-family="${SANS}" font-size="8.5" fill="${p.faint}">full history · ${total.toLocaleString('en-US')} commits · emerald window = this export</text>`,
    )
    const lanes = Math.max(1, layout.laneCount)
    for (const nd of layout.nodes) {
      const x = ((nd.row + 0.5) / total) * o.width
      const y = stripTop + ((nd.lane + 0.5) / lanes) * stripH
      const color = nd.commit.aiAgent ? '#f59e0b' : laneColor(nd.lane)
      const r = nd.commit.isMerge ? 1.25 : 0.85
      parts.push(
        `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}"/>`,
      )
    }
    if (sSet) {
      for (const nd of layout.nodes) {
        if (!sSet.has(nd.commit.hash)) continue
        const x = ((nd.row + 0.5) / total) * o.width
        parts.push(
          `<line x1="${f(x)}" y1="${f(stripTop - 2)}" x2="${f(x)}" y2="${f(stripBot + 2)}" stroke="#10b981" stroke-width="1.4"/>`,
        )
      }
    }
    const wx = (m.startRow / total) * o.width
    const ww = Math.max(2, ((m.endRow - m.startRow + 1) / total) * o.width)
    parts.push(
      `<rect x="${f(wx)}" y="${f(stripTop - 3)}" width="${f(ww)}" height="${f(stripH + 6)}" rx="2" fill="${p.accent}" fill-opacity="0.1" stroke="${p.accent}" stroke-width="1.5"/>`,
    )
    if (m.selectedRow >= 0) {
      const x = ((m.selectedRow + 0.5) / total) * o.width
      parts.push(
        `<line x1="${f(x)}" y1="${f(stripTop - 2)}" x2="${f(x)}" y2="${f(stripBot + 2)}" stroke="${p.fg}" stroke-width="1.6" opacity="0.75"/>`,
      )
    }
    parts.push(
      `<text x="10" y="${f(stripTop + stripH / 2 + 3)}" font-family="${MONO}" font-size="8" font-weight="600" letter-spacing="1" fill="${p.faint}">NEW</text>`,
      `<text x="${f(o.width - 10)}" y="${f(stripTop + stripH / 2 + 3)}" text-anchor="end" font-family="${MONO}" font-size="8" letter-spacing="1" fill="${p.faint}">OLD</text>`,
    )
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(o.width)}" height="${f(outH)}" viewBox="0 0 ${f(o.width)} ${f(outH)}">${parts.join('')}</svg>`
  return { svg, w: o.width, h: outH }
}

function monthShort(m: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m] ?? ''
}

/* ------------------------------------------------------------------ */
/*  poster export — the entire history, every commit                   */
/* ------------------------------------------------------------------ */

export interface PosterExportOptions extends ExportTheme {
  orientation: 'vertical' | 'horizontal'
  totalCommits: number
  /** longest side of the poster in SVG units (auto-shrinks for huge repos) */
  maxSide?: number
}

const POSTER_HEADER = 92
const POSTER_FOOTER = 120

/** height of the optional minimap strip appended to view exports */
const MINIMAP_H = 40

export function buildPosterSvg(
  layout: GraphLayout,
  o: PosterExportOptions,
): { svg: string; w: number; h: number; rowsPerUnit: number } {
  const p = palette(o.dark)
  const n = layout.nodes.length
  const horiz = o.orientation === 'horizontal'
  const maxSide = o.maxSide ?? 16_000
  const budget = maxSide - POSTER_HEADER - POSTER_FOOTER

  const lanesPx = LEFT_PAD * 2 + layout.laneCount * LANE_W
  const timePx = TOP_PAD * 2 + n * ROW_H

  // shrink row spacing until the long axis fits the budget
  const unit = Math.max(
    1.1,
    Math.min(ROW_H, budget / Math.max(n, 1)),
  )
  const rh = unit
  const contentLanes = Math.max(lanesPx, 240)
  const contentTime = TOP_PAD * 2 + n * rh

  const graphW = horiz ? Math.min(contentTime, budget + 1) : contentLanes
  const graphH = horiz ? contentLanes : Math.min(contentTime, budget + 1)
  const W = Math.ceil(graphW + (horiz ? 40 : 0))
  const H = Math.ceil(POSTER_HEADER + graphH + POSTER_FOOTER)

  const newest = layout.nodes[0]?.commit.committedAt
  const oldest = layout.nodes[n - 1]?.commit.committedAt
  const dateRange =
    newest && oldest
      ? `${timeLabel(oldest).slice(0, 10)} → ${timeLabel(newest).slice(0, 10)}`
      : ''

  const laneXOf = (lane: number) => LEFT_PAD + lane * LANE_W + LANE_W / 2
  const laneYOf = (lane: number) => TOP_PAD + lane * LANE_W + LANE_W / 2
  const timeYOf = (row: number) => TOP_PAD + row * rh + rh / 2 // vertical poster
  const timeXOf = (row: number) => LEFT_PAD + row * rh + rh / 2 // horizontal poster (newest at the left)

  const parts: string[] = []
  parts.push(`<rect width="${W}" height="${H}" fill="${p.bg}"/>`)

  /* header */
  const title = o.repoLabel
  const sub1 = `${n.toLocaleString('en-US')} commits · ${layout.laneCount} lanes${o.branchLabel ? ` · ${o.branchLabel}` : ''}`
  const sub2 = `${dateRange} · every commit included — no sampling`
  parts.push(
    `<text x="28" y="40" font-family="${SANS}" font-size="24" font-weight="700" fill="${p.fg}">${escAttr(clip(title, 64))}</text>`,
    `<text x="28" y="62" font-family="${SANS}" font-size="13" fill="${p.sub}">${escAttr(sub1)}</text>`,
    `<text x="28" y="80" font-family="${SANS}" font-size="12" fill="${p.faint}">${escAttr(sub2)}</text>`,
  )
  parts.push(
    `<text x="${W - 28}" y="44" text-anchor="end" font-family="${SANS}" font-size="13" font-weight="600" fill="${p.fg}" opacity="0.85">AI Coding Activity</text>`,
    `<text x="${W - 28}" y="62" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${p.faint}">git · single source of truth</text>`,
  )

  const gy = POSTER_HEADER
  const g: string[] = [`<g transform="translate(0 ${f(gy)})">`]

  const nodeR = Math.max(Math.min(rh * 0.32, 5.5), 0.7)
  const edgeW = Math.max(Math.min(rh * 0.22, 2.2), 0.35)

  if (!horiz) {
    /* year gridlines + labels along the left */
    let lastY = -Infinity
    for (const m of layout.monthMarks) {
      const y = timeYOf(m.row)
      if (y - lastY < 26) continue
      lastY = y
      if (m.isYearStart) {
        g.push(
          `<line x1="0" y1="${f(y)}" x2="${f(graphW)}" y2="${f(y)}" stroke="${p.grid}"/>`,
          `<text x="${f(LEFT_PAD - 10)}" y="${f(y + 3)}" text-anchor="end" font-family="${SANS}" font-size="10" font-weight="600" fill="${p.fg}" opacity="0.55">${m.year}</text>`,
        )
      }
    }
    for (const e of layout.edges) {
      g.push(
        edgeSvg(
          laneXOf(e.childLane),
          timeYOf(e.childRow),
          laneXOf(e.parentLane),
          timeYOf(e.parentRow),
          false,
          laneColor(e.colorLane),
          edgeW * (e.isSecondary ? 0.85 : 1),
          0.9,
        ),
      )
    }
    for (const nd of layout.nodes) {
      g.push(
        nodeSvg(
          nd.commit,
          nd.lane,
          laneXOf(nd.lane),
          timeYOf(nd.row),
          nodeR * (nd.commit.isMerge ? 1.15 : 1),
          p.bg,
          o.selectedHash === nd.commit.hash,
          o,
        ),
      )
    }
  } else {
    let lastX = -Infinity
    for (const m of layout.monthMarks) {
      const x = timeXOf(m.row)
      if (x - lastX < 34) continue
      lastX = x
      if (m.isYearStart) {
        g.push(
          `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${f(graphH)}" stroke="${p.grid}"/>`,
          `<text x="${f(x)}" y="${f(TOP_PAD - 6)}" text-anchor="middle" font-family="${SANS}" font-size="10" font-weight="600" fill="${p.fg}" opacity="0.55">${m.year}</text>`,
        )
      }
    }
    for (const e of layout.edges) {
      g.push(
        edgeSvg(
          timeXOf(e.childRow),
          laneYOf(e.childLane),
          timeXOf(e.parentRow),
          laneYOf(e.parentLane),
          true,
          laneColor(e.colorLane),
          edgeW * (e.isSecondary ? 0.85 : 1),
          0.9,
        ),
      )
    }
    for (const nd of layout.nodes) {
      g.push(
        nodeSvg(
          nd.commit,
          nd.lane,
          timeXOf(nd.row),
          laneYOf(nd.lane),
          nodeR * (nd.commit.isMerge ? 1.15 : 1),
          p.bg,
          o.selectedHash === nd.commit.hash,
          o,
        ),
      )
    }
  }
  g.push('</g>')
  parts.push(g.join(''))

  /* footer — activity density strip first: commit count per calendar
   *  time bucket (oldest → newest, left → right — standard timeline
   *  reading), amber = AI-assisted share stacked from the baseline.
   *  Empty buckets stay empty: quiet periods are honest periods. */
  const y0 = H - POSTER_FOOTER
  parts.push(
    `<line x1="0" y1="${f(y0 + 10)}" x2="${f(W)}" y2="${f(y0 + 10)}" stroke="${p.line}"/>`,
  )
  const stripX = 28
  const stripW = Math.max(W - 56, 40)
  const stripBase = y0 + 84
  const stripTop = 52
  const ta = oldest ? Date.parse(oldest) : NaN
  const tb = newest ? Date.parse(newest) : NaN
  const hasTime = Number.isFinite(ta) && Number.isFinite(tb) && tb > ta
  if (hasTime) {
    const B = Math.min(480, Math.max(60, Math.floor(stripW / 3)))
    const counts = new Array<number>(B).fill(0)
    const aiCounts = new Array<number>(B).fill(0)
    for (const nd of layout.nodes) {
      const t = Date.parse(nd.commit.committedAt)
      const frac = Math.min(0.9999, Math.max(0, (t - ta) / (tb - ta)))
      const i = Math.floor(frac * B)
      counts[i]++
      if (nd.commit.aiAgent) aiCounts[i]++
    }
    const maxC = Math.max(1, ...counts)
    const bw = stripW / B
    for (let i = 0; i < B; i++) {
      if (counts[i] === 0) continue
      const h = Math.max(2.5, (counts[i] / maxC) * stripTop)
      const x = stripX + i * bw + bw * 0.14
      const aiH = (aiCounts[i] / counts[i]) * h
      if (aiCounts[i] > 0) {
        parts.push(
          `<rect x="${f(x)}" y="${f(stripBase - aiH)}" width="${f(bw * 0.72)}" height="${f(aiH)}" fill="#f59e0b" opacity="0.9"/>`,
        )
      }
      parts.push(
        `<rect x="${f(x)}" y="${f(stripBase - h)}" width="${f(bw * 0.72)}" height="${f(Math.max(h - aiH, 0))}" fill="${p.sub}" opacity="0.45"/>`,
      )
    }
    parts.push(
      `<line x1="${f(stripX)}" y1="${f(stripBase)}" x2="${f(stripX + stripW)}" y2="${f(stripBase)}" stroke="${p.line}"/>`,
    )
    /* year ticks along the strip */
    const yA = new Date(ta).getUTCFullYear()
    const yB = new Date(tb).getUTCFullYear()
    let lastTick = -Infinity
    for (let yr = yA + 1; yr <= yB; yr++) {
      const tt = Date.UTC(yr, 0, 1)
      if (tt <= ta || tt >= tb) continue
      const x = stripX + ((tt - ta) / (tb - ta)) * stripW
      if (x - lastTick < 26) continue
      lastTick = x
      parts.push(
        `<line x1="${f(x)}" y1="${f(stripBase)}" x2="${f(x)}" y2="${f(stripBase + 4)}" stroke="${p.faint}"/>`,
        `<text x="${f(x)}" y="${f(stripBase + 15)}" text-anchor="middle" font-family="${SANS}" font-size="9.5" fill="${p.faint}">${yr}</text>`,
      )
    }
    /* caption + legend (skip caption when the poster is too narrow) */
    const aiTotal = layout.nodes.reduce(
      (a, nd) => a + (nd.commit.aiAgent ? 1 : 0),
      0,
    )
    const leg1 = `AI-assisted (${aiTotal.toLocaleString('en-US')})`
    const w2 = 'other commits'.length * 6.2
    const w1 = leg1.length * 6.2
    const legX2 = W - 28
    const sw2 = legX2 - w2 - 14
    const legX1 = sw2 - 6
    const sw1 = legX1 - w1 - 6
    if (stripX + 210 < sw1 - 20) {
      parts.push(
        `<text x="${f(stripX)}" y="${f(y0 + 26)}" font-family="${MONO}" font-size="10" font-weight="700" fill="${p.sub}" letter-spacing="2">COMMIT DENSITY OVER TIME</text>`,
      )
    }
    parts.push(
      `<rect x="${f(sw1)}" y="${f(y0 + 19)}" width="8" height="8" fill="#f59e0b"/>`,
      `<text x="${f(legX1)}" y="${f(y0 + 26)}" text-anchor="end" font-family="${SANS}" font-size="10" fill="${p.sub}">${leg1}</text>`,
      `<rect x="${f(sw2)}" y="${f(y0 + 19)}" width="8" height="8" fill="${p.sub}" opacity="0.45"/>`,
      `<text x="${f(legX2)}" y="${f(y0 + 26)}" text-anchor="end" font-family="${SANS}" font-size="10" fill="${p.sub}">other commits</text>`,
    )
  }
  parts.push(
    `<text x="28" y="${f(y0 + 114)}" font-family="${SANS}" font-size="11" fill="${p.faint}">Generated ${timeLabel(new Date().toISOString())} · AI Coding Activity · real git history, nothing fabricated</text>`,
  )

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`
  return { svg, w: W, h: H, rowsPerUnit: rh }
}

/* ------------------------------------------------------------------ */
/*  PNG rasterization + download                                       */
/* ------------------------------------------------------------------ */

export async function downloadSvgAsPng(
  svg: string,
  w: number,
  h: number,
  pixelScale: number,
  filename: string,
): Promise<{ w: number; h: number }> {
  const safeScale = Math.min(pixelScale, MAX_PNG_SIDE / Math.max(w, h))
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('SVG rasterization failed'))
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * safeScale)
    canvas.height = Math.round(h * safeScale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) throw new Error('PNG encoding failed')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(png)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    return { w: canvas.width, h: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}
