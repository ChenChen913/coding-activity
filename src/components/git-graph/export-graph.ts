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
 *               slice, labels included)
 *  - 'poster' — the entire history, every single commit, auto-scaled to a
 *               long poster strip (never sampled, never truncated)
 */

import type { Geo, GraphLayout } from './layout'
import { LANE_W, LEFT_PAD, ROW_H, TOP_PAD, laneColor } from './layout'
import type { GraphCommit } from '@/lib/git/types'

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
      }
    : {
        bg: '#fafaf9',
        fg: '#1c1917',
        sub: '#57534e',
        faint: '#a8a29e',
        line: '#e7e5e4',
        grid: '#efedeb',
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

/** escape hatch for names that end up inside font-family quotes — not needed,
 *  but keeps the SVG well-formed if a label ever contains quotes */
function escAttr(s: string): string {
  return esc(s).replace(/'/g, '&#39;')
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
): string {
  const color = laneColor(lane)
  const parts: string[] = []
  if (selected) {
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 4)}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.9"/>`,
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
    return `<path d="M ${f(x1)} ${f(y1)} C ${f(x1 - k)} ${f(y1)} ${f(x2 + k)} ${f(y2)} ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`
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
  startRow: number
  endRow: number
  geo: Geo
  tx: number
  ty: number
  totalCommits: number
}

export function buildViewSvg(layout: GraphLayout, o: ViewExportOptions): { svg: string; w: number; h: number } {
  const p = palette(o.dark)
  const { geo } = o
  const n = layout.nodes.length
  const horiz = o.orientation === 'horizontal'

  const laneXOf = (lane: number) => LEFT_PAD + lane * geo.lw + geo.lw / 2
  const rowYOf = (row: number) => TOP_PAD + row * geo.rh + geo.rh / 2
  const timeXOf = (row: number) => LEFT_PAD + (n - 1 - row) * geo.rh + geo.rh / 2
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
        ),
      )
    }
    g.push('</g>')
    parts.push(g.join(''))

    /* ---- message list ---- */
    const listX = o.gutterW + o.laneAreaW
    if (listX < o.width - 60) {
      const listW = o.width - listX
      const lg: string[] = [`<g>`]
      lg.push(`<line x1="${f(listX)}" y1="0" x2="${f(listX)}" y2="${f(o.height)}" stroke="${p.line}"/>`)
      const showText = geo.rh >= 15
      for (const nd of rows) {
        const c = nd.commit
        const y = rowYOf(nd.row) - o.ty
        if (y < -geo.rh || y > o.height + geo.rh) continue
        const top = y - geo.rh / 2
        const selected = o.selectedHash === c.hash
        if (selected) {
          lg.push(`<rect x="${f(listX)}" y="${f(top)}" width="${f(listW)}" height="${f(geo.rh)}" fill="${p.fg}" opacity="0.07"/>`)
        }
        if (!showText) continue
        const timeW = 66
        const authorW = c.author.length > 0 ? Math.min(120, c.author.length * 6.4 + 8) : 0
        const msgX = listX + 12
        const msgMax = Math.max(10, Math.floor((listW - 24 - timeW - authorW - 12) / 6.3))
        lg.push(
          `<text x="${f(msgX)}" y="${f(y + 4)}" font-family="${SANS}" font-size="12.5" ${selected ? `font-weight="600" fill="${p.fg}"` : `font-weight="500" fill="${p.fg}" opacity="0.92"`}>${escAttr(clip(c.message, msgMax))}</text>`,
        )
        if (authorW > 0) {
          lg.push(
            `<text x="${f(o.width - timeW - 14)}" y="${f(y + 4)}" text-anchor="end" font-family="${SANS}" font-size="11.5" fill="${p.sub}">${escAttr(clip(c.author, 18))}</text>`,
          )
        }
        lg.push(
          `<text x="${f(o.width - 12)}" y="${f(y + 4)}" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${p.sub}">${timeLabel(c.committedAt)}</text>`,
        )
      }
      lg.push('</g>')
      parts.push(lg.join(''))
    }
  } else {
    /* ---- horizontal: top time axis ---- */
    parts.push(`<line x1="0" y1="${f(o.axisH)}" x2="${f(o.width)}" y2="${f(o.axisH)}" stroke="${p.line}"/>`)
    let lastX = -Infinity
    for (const m of layout.monthMarks) {
      if (m.row < o.startRow - 2 || m.row > o.endRow + 2) continue
      const x = timeXOf(m.row) + o.tx
      if (x < 24 || x > o.width - 12 || x - lastX < (m.isYearStart ? 34 : 30)) continue
      lastX = x
      if (m.isYearStart) {
        parts.push(
          `<line x1="${f(x)}" y1="${f(o.axisH)}" x2="${f(x)}" y2="${f(o.height)}" stroke="${p.grid}"/>`,
        )
      }
      parts.push(
        `<text x="${f(x)}" y="${f(o.axisH - 8)}" text-anchor="middle" font-family="${SANS}" font-size="${m.isYearStart ? 11 : 9.5}" ${m.isYearStart ? `font-weight="600" fill="${p.fg}" opacity="0.75"` : `fill="${p.sub}" opacity="0.85"`}>${m.isYearStart ? m.year : monthShort(m.month)}</text>`,
      )
    }

    /* ---- edges + nodes ---- */
    const g: string[] = [`<g transform="translate(0 ${f(o.axisH)})">`]
    for (const e of edges) {
      const x1 = timeXOf(e.childRow) + o.tx
      const y1 = laneYOf(e.childLane) - o.ty
      const x2 = timeXOf(e.parentRow) + o.tx
      const y2 = laneYOf(e.parentLane) - o.ty
      g.push(
        edgeSvg(x1, y1, x2, y2, true, laneColor(e.colorLane), geo.edgeW * (e.isSecondary ? 0.85 : 1), 0.92),
      )
    }
    for (const nd of rows) {
      g.push(
        nodeSvg(
          nd.commit,
          nd.lane,
          timeXOf(nd.row) + o.tx,
          laneYOf(nd.lane) - o.ty,
          geo.nodeR * (nd.commit.isMerge ? 1.15 : 1),
          p.bg,
          o.selectedHash === nd.commit.hash,
          o,
        ),
      )
    }
    g.push('</g>')
    parts.push(g.join(''))
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(o.width)}" height="${f(o.height)}" viewBox="0 0 ${f(o.width)} ${f(o.height)}">${parts.join('')}</svg>`
  return { svg, w: o.width, h: o.height }
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
const POSTER_FOOTER = 44

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
  const timeXOf = (row: number) => LEFT_PAD + (n - 1 - row) * rh + rh / 2 // horizontal poster

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

  /* footer */
  parts.push(
    `<line x1="0" y1="${f(H - POSTER_FOOTER + 10)}" x2="${f(W)}" y2="${f(H - POSTER_FOOTER + 10)}" stroke="${p.line}"/>`,
    `<text x="28" y="${f(H - POSTER_FOOTER + 30)}" font-family="${SANS}" font-size="11" fill="${p.faint}">Generated ${timeLabel(new Date().toISOString())} · AI Coding Activity · real git history, nothing fabricated</text>`,
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
