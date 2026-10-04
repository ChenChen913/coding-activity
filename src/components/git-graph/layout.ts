import type { GraphCommit } from '@/lib/git/types'

/* ------------------------------------------------------------------ */
/*  Geometry constants (world units, multiplied by zoom scale)         */
/* ------------------------------------------------------------------ */

/** vertical distance between two commits */
export const ROW_H = 26
/** horizontal distance between two lanes */
export const LANE_W = 34
/** vertical padding above the first row */
export const TOP_PAD = 14
/** horizontal padding before lane 0 */
export const LEFT_PAD = 18
export const MIN_SCALE = 0.3
export const MAX_SCALE = 2.2
/** below this effective row height the list column hides text (structure mode) */
export const TEXT_MIN_ROW = 15

/**
 * Lane palette — 10 distinguishable hues, no indigo, light-theme friendly.
 * Lane 0 (usually the default branch) reads as the "primary" teal.
 */
export const LANE_COLORS = [
  '#0d9488', // teal
  '#d97706', // amber
  '#e11d48', // rose
  '#8b5cf6', // violet
  '#0891b2', // cyan
  '#65a30d', // lime
  '#ea580c', // orange
  '#db2777', // pink
  '#c026d3', // fuchsia
  '#57534e', // warm gray (overflow lanes)
]

export function laneColor(lane: number): string {
  return LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]
}

/* ------------------------------------------------------------------ */
/*  Layout types                                                       */
/* ------------------------------------------------------------------ */

export interface LayoutNode {
  commit: GraphCommit
  row: number
  lane: number
}

export interface LayoutEdge {
  /** child row (always above the parent: git log --date-order is topological) */
  childRow: number
  childLane: number
  parentRow: number
  parentLane: number
  /** which lane's color the edge takes (see algorithm notes below) */
  colorLane: number
  /** true for merge secondary parents (2nd, 3rd, …) */
  isSecondary: boolean
}

export interface MonthMark {
  row: number
  year: number
  month: number
  isYearStart: boolean
}

export interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  laneCount: number
  rowOf: Map<string, number>
  laneOf: Map<string, number>
  monthMarks: MonthMark[]
}

/* ------------------------------------------------------------------ */
/*  Lane assignment algorithm (classic git-graph "rails" model)        */
/* ------------------------------------------------------------------ */

/**
 * Assign every commit to a lane so that:
 *  - a commit that is the awaited parent of an already-placed child takes
 *    the lane where it was awaited (the chain continues on the same rail);
 *  - a commit nobody waits for (a branch head) starts on the first free lane;
 *  - a merge's first parent continues the current lane, while each secondary
 *    parent is awaited on its own fresh lane — that rail is the branch fork;
 *  - when several children await the same parent, the parent takes the first
 *    awaiting lane and the other children's rails curve into it (converge).
 *
 * Edge coloring:
 *  - first-parent edge → child's lane color (a branch merging into main is
 *    drawn in the branch color);
 *  - secondary-parent edge → parent's lane color (a new branch emerges in
 *    its own color right at the fork).
 */
export function computeGraphLayout(commits: GraphCommit[]): GraphLayout {
  const n = commits.length
  const nodes: LayoutNode[] = new Array(n)
  const rowOf = new Map<string, number>()
  const laneOf = new Map<string, number>()
  const laneTail: (string | null)[] = []
  const laneExpected = new Map<string, number>()
  const present = new Set(commits.map((c) => c.hash))

  for (let row = 0; row < n; row++) {
    const commit = commits[row]

    let lane: number
    const awaited = laneExpected.get(commit.hash)
    if (awaited !== undefined) {
      lane = awaited
      laneExpected.delete(commit.hash)
      laneTail[lane] = null
    } else {
      lane = laneTail.indexOf(null)
      if (lane === -1) {
        lane = laneTail.length
        laneTail.push(null)
      }
    }

    nodes[row] = { commit, row, lane }
    rowOf.set(commit.hash, row)
    laneOf.set(commit.hash, lane)

    const first = commit.parents[0]
    if (first && present.has(first)) {
      if (!laneExpected.has(first)) {
        laneExpected.set(first, lane)
        laneTail[lane] = first
      }
      // else — converge: this rail ends, the edge will curve later
    } else {
      laneTail[lane] = null // root (or parent outside this subset)
    }

    for (let i = 1; i < commit.parents.length; i++) {
      const p = commit.parents[i]
      if (!p || !present.has(p) || laneExpected.has(p)) continue
      let forkLane = laneTail.indexOf(null)
      if (forkLane === -1) {
        forkLane = laneTail.length
        laneTail.push(null)
      }
      laneExpected.set(p, forkLane)
      laneTail[forkLane] = p
    }
  }

  /* ---------------- edges (second pass, final lanes) ---------------- */
  const edges: LayoutEdge[] = []
  for (let row = 0; row < n; row++) {
    const node = nodes[row]
    for (let i = 0; i < node.commit.parents.length; i++) {
      const parentHash = node.commit.parents[i]
      const parentRow = rowOf.get(parentHash)
      if (parentRow === undefined || parentRow <= row) continue
      edges.push({
        childRow: row,
        childLane: node.lane,
        parentRow,
        parentLane: laneOf.get(parentHash)!,
        colorLane: i === 0 ? node.lane : laneOf.get(parentHash)!,
        isSecondary: i > 0,
      })
    }
  }

  /* ---------------- time gutter marks ---------------- */
  const monthMarks: MonthMark[] = []
  let prevKey = ''
  for (let row = 0; row < n; row++) {
    const d = new Date(nodes[row].commit.committedAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (key !== prevKey) {
      const isYearStart = d.getMonth() === 0 || prevKey === ''
      monthMarks.push({
        row,
        year: d.getFullYear(),
        month: d.getMonth(),
        isYearStart,
      })
      prevKey = key
    }
  }

  return {
    nodes,
    edges,
    laneCount: Math.max(laneTail.length, 1),
    rowOf,
    laneOf,
    monthMarks,
  }
}

/* ------------------------------------------------------------------ */
/*  Screen-space geometry helpers                                      */
/* ------------------------------------------------------------------ */

export interface Geo {
  /** effective row height in px */
  rh: number
  /** effective lane width in px */
  lw: number
  nodeR: number
  edgeW: number
  /** total content width of the lane area (world px) */
  contentW: number
  /** total content height (world px) */
  totalH: number
}

export function computeGeo(
  layout: GraphLayout,
  scale: number,
  rowCount: number,
): Geo {
  const rh = ROW_H * scale
  const lw = Math.max(LANE_W * scale, 14)
  const nodeR = Math.min(Math.max(5 * scale, 3), 10)
  const edgeW = Math.min(Math.max(2 * Math.pow(scale, 0.7), 0.9), 3.6)
  return {
    rh,
    lw,
    nodeR,
    edgeW,
    contentW: LEFT_PAD + layout.laneCount * lw + 14,
    totalH: TOP_PAD * 2 + rowCount * rh,
  }
}

/** screen x of a lane center */
export function laneX(lane: number, geo: Geo): number {
  return LEFT_PAD + lane * geo.lw + geo.lw / 2
}

/** screen y of a row center */
export function rowY(row: number, geo: Geo): number {
  return TOP_PAD + row * geo.rh + geo.rh / 2
}

/** SVG path for one edge: straight on the same lane, S-curve otherwise */
export function edgePath(
  e: LayoutEdge,
  geo: Geo,
  tx: number,
  ty: number,
): string {
  const x1 = laneX(e.childLane, geo) + tx
  const y1 = rowY(e.childRow, geo) - ty
  const x2 = laneX(e.parentLane, geo) + tx
  const y2 = rowY(e.parentRow, geo) - ty
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const k = Math.min(geo.rh * 0.55, (y2 - y1) / 2)
  return `M ${x1} ${y1} C ${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}`
}
