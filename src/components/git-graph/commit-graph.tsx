'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowUpDown,
  ArrowUpToLine,
  ImageDown,
  Loader2,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { GraphCommit } from '@/lib/git/types'
import {
  computeGeo,
  computeGraphLayout,
  edgePath,
  LEFT_PAD,
  laneColor,
  laneX,
  MAX_SCALE,
  MIN_SCALE,
  rowY,
  TEXT_MIN_ROW,
  TOP_PAD,
  type Geo,
  type GraphLayout,
} from './layout'
import { buildPosterSvg, buildViewSvg, downloadSvgAsPng } from './export-graph'
import { CommitTypeBadge } from '@/components/commit-type-badge'
import { parseCommitType, TYPE_META, type CommitType } from '@/lib/commit-type'

const GUTTER_W = 44
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const VISIBLE_BUFFER = 4
/** horizontal layout: height of the top time-axis strip */
const AXIS_H = 26
/** horizontal layout: width of the viewport-fixed lane-label gutter
 *  (branch tips), carved out of the left edge — narrower on phones */
const labelWOf = (w: number) => (w < 640 ? 76 : 112)
/** horizontal layout: rows of commit-info chips in the bottom rail
 *  (3 staggered rows on desktop so badge+message fits at default zoom) */
const railRowsOf = (w: number) => (w < 640 ? 1 : 3)
/** horizontal layout: height of the bottom commit-info rail — the
 *  counterpart of the vertical message list (a chip for EVERY visible
 *  commit + type/message chips wherever they fit, always on screen) */
const railHOf = (w: number) => (railRowsOf(w) === 1 ? 48 : 104)

export type Orientation = 'vertical' | 'horizontal'

interface Transform {
  scale: number
  tx: number
  ty: number
}

export interface CommitGraphProps {
  commits: GraphCommit[]
  loading: boolean
  fetching?: boolean
  error: Error | null
  onRetry?: () => void
  selectedHash: string | null
  onSelect: (hash: string | null) => void
  currentBranch: string
  /** toolbar slot: branch filter, search, … */
  extra?: ReactNode
  /** repository name for PNG export headers */
  repoLabel?: string
  /** active branch filter label for PNG export headers */
  branchLabel?: string | null
  /** controlled orientation — when omitted the component keeps its own
   *  state (persisted to localStorage) so it also works standalone */
  orientation?: Orientation
  /** fired when the user toggles vertical / horizontal */
  onOrientationChange?: (o: Orientation) => void
  /** active commit-type filter (Conventions card) — commits outside the
   *  selected kinds are dimmed so card ↔ graph ↔ timeline agree */
  typeFilterKinds?: CommitType[] | null
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** list-column time: HH:mm for recent commits, date for older ones */
function rowTime(iso: string): string {
  const d = new Date(iso)
  return Date.now() - d.getTime() < 86_400_000
    ? format(d, 'HH:mm')
    : format(d, 'yyyy-MM-dd')
}

/* ------------------------------------------------------------------ */
/*  Commit Graph — the interactive heart of the application            */
/* ------------------------------------------------------------------ */

export function CommitGraph({
  commits,
  loading,
  fetching,
  error,
  onRetry,
  selectedHash,
  onSelect,
  currentBranch,
  extra,
  repoLabel = 'repository',
  branchLabel = null,
  orientation: orientationProp,
  onOrientationChange,
  typeFilterKinds,
}: CommitGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [t, setT] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [intro, setIntro] = useState(false)
  /** internal fallback for uncontrolled usage (no orientation prop) */
  const [orientationLocal, setOrientationLocal] =
    useState<Orientation>('vertical')
  const [exporting, setExporting] = useState(false)
  /** travel-direction feedback for horizontal mode (1 = toward newer) */
  const [flowHint, setFlowHint] = useState<1 | -1 | null>(null)
  const orientation = orientationProp ?? orientationLocal
  const horiz = orientation === 'horizontal'

  const tRef = useRef(t)
  const sizeRef = useRef(size)
  const commitsRef = useRef(commits)

  const layout: GraphLayout | null = useMemo(
    () => (commits.length > 0 ? computeGraphLayout(commits) : null),
    [commits],
  )
  const layoutRef = useRef(layout)

  /* ---------------- drag / pinch state (refs, no re-render) --------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panStart = useRef<{ tx: number; ty: number; x: number; y: number } | null>(null)
  const pinchStart = useRef<{
    dist: number
    scale: number
    midX: number
    midY: number
    tx: number
    ty: number
  } | null>(null)
  const didPan = useRef(false)
  const panAnim = useRef<number | null>(null)
  const moveScheduled = useRef(false)
  const flowTimer = useRef<number | null>(null)

  const cancelPanAnim = useCallback(() => {
    if (panAnim.current !== null) {
      cancelAnimationFrame(panAnim.current)
      panAnim.current = null
    }
  }, [])

  /* ---------------- geometry (derived every render) ------------------ */
  const geo: Geo | null = useMemo(
    () =>
      layout ? computeGeo(layout, t.scale, commits.length) : null,
    [layout, t.scale, commits.length],
  )

  const isNarrow = size.w < 640
  const laneAreaW = geo
    ? Math.min(
        Math.max(140, Math.min(isNarrow ? size.w * 0.5 : size.w * 0.55, 520)),
        Math.max(geo.contentW, 90),
      )
    : 140

  const viewH = size.h
  /* horizontal geometry: the time axis runs along x, lanes stack on y.
     The lane-label gutter (branch tips) is carved out of the left edge:
     the time svg starts right of it and clips there, so commits can
     never slide underneath the fixed labels. */
  const labelW = horiz ? labelWOf(size.w) : 0
  const svgW = Math.max(60, size.w - labelW)
  const hTimeW = geo ? LEFT_PAD * 2 + commits.length * geo.rh : 0
  const hLanesH = geo ? TOP_PAD * 2 + geo.lw * Math.max((layout?.laneCount ?? 1) - 1, 0) + geo.lw : 0
  /** bottom commit-info rail carves into the canvas (horizontal only) */
  const railH = horiz ? railHOf(size.w) : 0
  const railRows = railRowsOf(size.w)
  const hGraphH = Math.max(0, size.h - AXIS_H - railH)
  const effTx = geo
    ? horiz
      ? hTimeW <= svgW || svgW === 0
        ? (svgW - hTimeW) / 2
        : clamp(t.tx, svgW - hTimeW, 0)
      : geo.contentW <= laneAreaW
        ? (laneAreaW - geo.contentW) / 2
        : clamp(t.tx, laneAreaW - geo.contentW, 0)
    : 0
  // screen y = world y - ty  →  ty ∈ [0, totalH - viewH] when content is
  // taller than the viewport; when shorter, content is centered vertically.
  const effTy = geo
    ? horiz
      ? hLanesH <= hGraphH || hGraphH === 0
        ? (hLanesH - hGraphH) / 2
        : clamp(t.ty, 0, hLanesH - hGraphH)
      : geo.totalH <= viewH || viewH === 0
        ? (geo.totalH - viewH) / 2
        : clamp(t.ty, 0, geo.totalH - viewH)
    : 0

  const txRef = useRef(effTx)
  const tyRef = useRef(effTy)

  // Mirror the latest render values into refs for event handlers and
  // async callbacks. This effect flushes after every commit — before any
  // user event can possibly fire — so handlers always see fresh values.
  useEffect(() => {
    tRef.current = t
    sizeRef.current = size
    commitsRef.current = commits
    layoutRef.current = layout
    txRef.current = effTx
    tyRef.current = effTy
  })

  /* ---------------- resize observer --------------------------------- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      if (rect.width > 0) setSize({ w: rect.width, h: rect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---------------- orientation persistence ------------------------ */
  /* uncontrolled mode only: read + persist locally. Controlled mode
     (orientation prop) delegates storage to the parent. */
  useEffect(() => {
    if (orientationProp) return
    try {
      const saved = localStorage.getItem('graph-orientation')
      if (saved === 'horizontal' || saved === 'vertical')
        setOrientationLocal(saved)
    } catch {
      /* private mode etc. — default vertical is fine */
    }
  }, [orientationProp])

  const toggleOrientation = useCallback(() => {
    const next: Orientation = horiz ? 'vertical' : 'horizontal'
    if (onOrientationChange) {
      onOrientationChange(next)
      return
    }
    setOrientationLocal(next)
    try {
      localStorage.setItem('graph-orientation', next)
    } catch {
      /* ignore */
    }
  }, [horiz, onOrientationChange])

  /* ---------------- travel-direction feedback (horizontal) --------- */
  /** flash "← newer / older →" while the user pans through time so the
   *  reading direction (latest at the left, past to the right) stays
   *  obvious — dir 1 = traveling toward older commits */
  const showFlow = useCallback((dir: 1 | -1) => {
    if (flowTimer.current !== null) window.clearTimeout(flowTimer.current)
    flowTimer.current = window.setTimeout(() => {
      flowTimer.current = null
      setFlowHint(null)
    }, 650)
    setFlowHint((prev) => (prev === dir ? prev : dir))
  }, [])

  useEffect(
    () => () => {
      if (flowTimer.current !== null) window.clearTimeout(flowTimer.current)
    },
    [],
  )

  /* ---------------- clamped pan/zoom helpers ------------------------ */

  const setTransform = useCallback(
    (next: Partial<Transform>) => {
      setT((prev) => ({ ...prev, ...next }))
    },
    [],
  )

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const prev = tRef.current
      const newScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE)
      const k = newScale / prev.scale
      if (k === 1) return
      // horizontal mode: the time svg starts right of the lane-label
      // gutter, so the x anchor must be svg-local for a stable zoom
      const ax = horiz ? px - labelWOf(sizeRef.current.w) : px
      setT({
        scale: newScale,
        tx: ax - (ax - prev.tx) * k,
        ty: (py + prev.ty) * k - py,
      })
    },
    [horiz],
  )

  const animateTo = useCallback(
    (target: Pick<Transform, 'ty'> & Partial<Pick<Transform, 'tx'>>) => {
      cancelPanAnim()
      const start = { ...tRef.current }
      const t0 = performance.now()
      const dur = 280
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur)
        const e = 1 - Math.pow(1 - p, 3)
        // merge partial transform — never drop scale via raw setT
        setTransform({
          ty: start.ty + (target.ty - start.ty) * e,
          ...(target.tx !== undefined
            ? { tx: start.tx + (target.tx - start.tx) * e }
            : {}),
        })
        panAnim.current = p < 1 ? requestAnimationFrame(step) : null
      }
      panAnim.current = requestAnimationFrame(step)
    },
    [cancelPanAnim, setTransform],
  )

  const computeFitScale = useCallback((): number => {
    const lay = layoutRef.current
    const { w, h } = sizeRef.current
    if (!lay) return 1
    if (horiz) {
      // fit lanes vertically inside the axis- and rail-bounded area
      const lanesPx = lay.laneCount * 34
      const availH = Math.max(60, h - AXIS_H - railHOf(w) - 24)
      return clamp(availH / Math.max(lanesPx, 1), MIN_SCALE, Math.min(MAX_SCALE, 1.35))
    }
    const narrow = w < 640
    const avail = Math.max(140, Math.min(narrow ? w * 0.5 : w * 0.55, 520))
    const laneWidths = lay.laneCount * 34
    const scale = (avail - 18 - 14) / Math.max(laneWidths, 1)
    return clamp(scale, MIN_SCALE, Math.min(MAX_SCALE, 1.35))
  }, [horiz])

  const fit = useCallback(() => {
    const lay = layoutRef.current
    const fitScale = computeFitScale()
    const k = fitScale / tRef.current.scale
    if (lay && horiz) {
      const g = computeGeo(lay, fitScale, commitsRef.current.length)
      const n = commitsRef.current.length
      const timeW = LEFT_PAD * 2 + n * g.rh
      const lanesH = TOP_PAD * 2 + g.lw * Math.max(lay.laneCount - 1, 0) + g.lw
      const { w, h } = sizeRef.current
      const svgW = Math.max(60, w - labelWOf(w))
      const graphH = Math.max(0, h - AXIS_H - railHOf(w))
      setT({
        scale: fitScale,
        tx: timeW <= svgW ? (svgW - timeW) / 2 : 0, // newest stays at the left edge
        ty: lanesH <= graphH ? (lanesH - graphH) / 2 : 0,
      })
      return
    }
    if (k !== 1) {
      zoomAt(laneAreaW / 2, sizeRef.current.h / 2, k)
    }
    // re-center horizontally
    if (lay) {
      const g = computeGeo(lay, fitScale, commitsRef.current.length)
      const areaW = laneAreaW
      const targetTx =
        g.contentW <= areaW ? (areaW - g.contentW) / 2 : clamp(0, areaW - g.contentW, 0)
      setTransform({ tx: targetTx })
    }
  }, [zoomAt, setTransform, computeFitScale, laneAreaW, horiz])

  /* ---------------- initial fit + intro on new data ------------------ */
  const sizeReady = size.w > 40

  useEffect(() => {
    if (!layout || !sizeReady) return
    const raf = requestAnimationFrame(() => {
      const fitScale = computeFitScale()
      if (horiz) {
        const lay = layoutRef.current
        if (lay) {
          const g = computeGeo(lay, fitScale, commitsRef.current.length)
          const n = commitsRef.current.length
          const timeW = LEFT_PAD * 2 + n * g.rh
          const lanesH = TOP_PAD * 2 + g.lw * Math.max(lay.laneCount - 1, 0) + g.lw
          const { w, h } = sizeRef.current
          const svgW = Math.max(60, w - labelWOf(w))
          const graphH = Math.max(0, h - AXIS_H - railHOf(w))
          setT({
            scale: fitScale,
            tx: timeW <= svgW ? (svgW - timeW) / 2 : 0,
            ty: lanesH <= graphH ? (lanesH - graphH) / 2 : 0,
          })
        }
      } else {
        setT({ scale: fitScale, tx: 0, ty: 0 })
      }
    })
    const timer = setTimeout(() => setIntro(true), 30)
    const timer2 = setTimeout(() => setIntro(false), 1700)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [layout, sizeReady, computeFitScale, horiz])

  /* ---------------- center on externally selected commit ------------- */
  useEffect(() => {
    if (!layout || !selectedHash) return
    const row = layout.rowOf.get(selectedHash)
    if (row === undefined) return
    const raf = requestAnimationFrame(() => {
      const lay = layoutRef.current
      const tr = tRef.current
      if (!lay) return
      const g = computeGeo(lay, tr.scale, commitsRef.current.length)
      const n = commitsRef.current.length

      if (horiz) {
        // screen x = label gutter + svg-local x = labelW + world time x + tx
        const wx = LEFT_PAD + row * g.rh + g.rh / 2
        const w = sizeRef.current.w
        const lw = labelWOf(w)
        const svgW = Math.max(60, w - lw)
        const x = lw + wx + txRef.current
        const h = sizeRef.current.h
        const lane = lay.laneOf.get(selectedHash) ?? 0
        const wy = TOP_PAD + lane * g.lw + g.lw / 2
        const y = AXIS_H + wy - tyRef.current
        const next: { ty?: number; tx?: number } = {}
        if (x < lw + 100 || x > w - 100) next.tx = svgW / 2 - wx
        if (y < 60 || y > h - 60) next.ty = AXIS_H + wy - h / 2
        if (next.ty !== undefined || next.tx !== undefined) {
          animateTo({
            ty: next.ty ?? tyRef.current,
            ...(next.tx !== undefined ? { tx: next.tx } : {}),
          })
        }
        return
      }

      const h = sizeRef.current.h
      const y = TOP_PAD + row * g.rh + g.rh / 2 - tr.ty
      const lane = lay.laneOf.get(selectedHash) ?? 0
      const x = laneX(lane, g) + txRef.current

      const next: { ty?: number; tx?: number } = {}
      if (y < 80 || y > h - 80) {
        next.ty = TOP_PAD + row * g.rh + g.rh / 2 - h / 2
      }
      const areaW = Math.min(
        Math.max(140, Math.min(sizeRef.current.w < 640 ? sizeRef.current.w * 0.5 : sizeRef.current.w * 0.55, 520)),
        Math.max(g.contentW, 90),
      )
      if (x < 48) next.tx = txRef.current + (48 - x)
      else if (x > areaW - 48) next.tx = txRef.current - (x - (areaW - 48))
      if (next.ty !== undefined) {
        animateTo({ ty: next.ty, ...(next.tx !== undefined ? { tx: next.tx } : {}) })
      } else if (next.tx !== undefined) {
        animateTo({ ty: tr.ty, tx: next.tx })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedHash, layout, animateTo, horiz])

  /* ---------------- wheel: pan vertically, ctrl = zoom --------------- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelPanAnim()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      if (e.ctrlKey || e.metaKey) {
        zoomAt(px, py, Math.exp(-e.deltaY * 0.0022))
      } else if (horiz) {
        // horizontal layout: the time axis runs along x — the vertical
        // wheel travels through time, sideways deltas move across lanes
        setT((prev) => ({ ...prev, tx: prev.tx - e.deltaY, ty: prev.ty + e.deltaX }))
        // wheel down (deltaY > 0) → tx shrinks → visible world x grows →
        // traveling toward OLDER commits (which live on the right) —
        // the same "scroll down = back in time" semantic as the vertical list
        if (e.deltaY !== 0) showFlow(e.deltaY > 0 ? 1 : -1)
      } else {
        setT((prev) => ({ ...prev, ty: prev.ty + e.deltaY, tx: prev.tx + e.deltaX }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, cancelPanAnim, horiz, showFlow])

  /* ---------------- pointer pan / pinch ------------------------------ */
  /* window-level move/up listeners are installed once; they no-op unless
     an interaction is active (the pointers map is populated by the
     container's pointerdown). This avoids stale closures entirely. */

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pts = pointers.current
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pts.size === 1 && panStart.current) {
        const s = panStart.current
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (Math.abs(dx) + Math.abs(dy) > 4) didPan.current = true
        // horizontal drag through time: content follows the finger —
        // dragging right (dx > 0) pulls NEWER commits into view
        // (the newest live at the left edge)
        if (Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy) && horiz)
          showFlow(dx > 0 ? -1 : 1)
        if (moveScheduled.current) return
        moveScheduled.current = true
        const fdx = dx
        const fdy = dy
        requestAnimationFrame(() => {
          moveScheduled.current = false
          // dragging content: finger down (fdy > 0) moves content down,
          // i.e. screen y grows → ty shrinks
          setT((prev) => ({ ...prev, tx: s.tx + fdx, ty: s.ty - fdy }))
        })
      } else if (pts.size === 2 && pinchStart.current) {
        const ps = pinchStart.current
        const [a, b] = [...pts.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const cont = containerRef.current
        const rectL = cont?.getBoundingClientRect().left ?? 0
        // horizontal mode: anchor x in svg-local space (right of the
        // lane-label gutter) so the pinch zooms around the true midpoint
        const midXRaw = (a.x + b.x) / 2 - rectL
        const midX = horiz
          ? midXRaw - labelWOf(cont?.clientWidth ?? 0)
          : midXRaw
        const midY = (a.y + b.y) / 2 - (cont?.getBoundingClientRect().top ?? 0)
        const newScale = clamp(ps.scale * (dist / ps.dist), MIN_SCALE, MAX_SCALE)
        const k = newScale / ps.scale
        didPan.current = true
        setT({
          scale: newScale,
          tx: midX - (ps.midX - ps.tx) * k,
          ty: (ps.midY + ps.ty) * k - midY,
        })
      }
    }

    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinchStart.current = null
      if (pointers.current.size === 0) panStart.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [showFlow, horiz])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      cancelPanAnim()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 1) {
        panStart.current = {
          tx: txRef.current,
          ty: tyRef.current,
          x: e.clientX,
          y: e.clientY,
        }
        didPan.current = false
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        // svg-local x when horizontal (see the pinch move handler)
        const midXRaw = (a.x + b.x) / 2 - rect.left
        pinchStart.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: tRef.current.scale,
          midX: horiz
            ? midXRaw - labelWOf(containerRef.current?.clientWidth ?? 0)
            : midXRaw,
          midY: (a.y + b.y) / 2 - rect.top,
          tx: tRef.current.tx,
          ty: tRef.current.ty,
        }
        panStart.current = null
      }
    },
    [cancelPanAnim, horiz],
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 1.35)
    },
    [zoomAt],
  )

  /* ---------------- keyboard navigation ------------------------------- */
  /* ArrowUp/ArrowDown move the selection through history (newest first),
     Escape clears it. In horizontal mode ←/→ travel through time too
     (→ = older, ← = newer). The container is focusable, so keyboard users
     can browse the graph without a mouse. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedHash) onSelect(null)
        return
      }
      const verticalKeys = e.key === 'ArrowDown' || e.key === 'ArrowUp'
      const horizontalKeys = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      if (!verticalKeys && !horizontalKeys) return
      e.preventDefault()
      const lay = layoutRef.current
      if (!lay || lay.nodes.length === 0) return
      let row = 0
      if (selectedHash) {
        const cur = lay.rowOf.get(selectedHash)
        if (cur !== undefined) row = cur
      }
      let delta: number
      if (horiz) {
        // newest lives at the left: → reads further into the past (row + 1)
        delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowUp' ? -1 : 1
      } else {
        delta = e.key === 'ArrowDown' ? 1 : -1
      }
      const next = clamp(row + delta, 0, lay.nodes.length - 1)
      onSelect(lay.nodes[next].commit.hash)
    },
    [selectedHash, onSelect, horiz],
  )

  /* ---------------- background click deselect -------------------------- */
  /* A click that lands on the SVG itself (not a node/edge group) and did
     not pan clears the selection. */
  const onBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !didPan.current) onSelect(null)
    },
    [onSelect],
  )

  /* ---------------- hover / tooltip ---------------------------------- */

  const rowFromClientY = useCallback((clientY: number): number | null => {
    const lay = layoutRef.current
    const el = containerRef.current
    if (!lay || !el) return null
    // clientY is viewport-relative; convert to container-relative FIRST.
    // (The old code skipped this subtraction, so whenever the graph sat
    // below the top of the viewport the hovered row was off by dozens of
    // rows — cursor and highlight disagreed.)
    const rect = el.getBoundingClientRect()
    const geoNow = computeGeo(lay, tRef.current.scale, commitsRef.current.length)
    // world y of the cursor; row r occupies world y ∈ [TOP_PAD + r·rh, TOP_PAD + (r+1)·rh)
    // (the row's DOM top is rowY(r) − ty − rh/2 = TOP_PAD + r·rh − ty — note the
    // rh/2 inside rowY cancels with the − rh/2 here, so NO extra half-row shift)
    const y = clientY - rect.top + tyRef.current - TOP_PAD // world y
    const r = Math.floor(y / geoNow.rh)
    return r >= 0 && r < commitsRef.current.length ? r : null
  }, [])

  /** horizontal layout: which row (commit) lives at this viewport x */
  const rowFromClientX = useCallback((clientX: number): number | null => {
    const lay = layoutRef.current
    const el = containerRef.current
    if (!lay || !el) return null
    const rect = el.getBoundingClientRect()
    const geoNow = computeGeo(lay, tRef.current.scale, commitsRef.current.length)
    const n = commitsRef.current.length
    // row 0 (newest) occupies world x ∈ [LEFT_PAD, LEFT_PAD + rh) at the
    // LEFT edge; screen x = labelW + world x + tx → world x = screen x − labelW − tx
    const x =
      clientX - rect.left - labelWOf(rect.width) - txRef.current - LEFT_PAD // world x
    const r = Math.floor(x / geoNow.rh) // row = column, 0 = newest (left)
    return r >= 0 && r < n ? r : null
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (pointers.current.size > 0) return // dragging
      const row = horiz ? rowFromClientX(e.clientX) : rowFromClientY(e.clientY)
      setHoveredRow((prev) => (prev === row ? prev : row))
      // position tooltip via DOM (no re-render)
      const el = containerRef.current
      const tip = tooltipRef.current
      if (el && tip) {
        const rect = el.getBoundingClientRect()
        const x = clamp(e.clientX - rect.left + 14, 8, Math.max(8, rect.width - 240))
        const y = clamp(e.clientY - rect.top + 14, 8, Math.max(8, rect.height - 120))
        tip.style.left = `${x}px`
        tip.style.top = `${y}px`
        tip.style.opacity = row !== null ? '1' : '0'
      }
    },
    [rowFromClientY, rowFromClientX, horiz],
  )

  const onMouseLeave = useCallback(() => {
    setHoveredRow(null)
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
  }, [])

  const selectCommit = useCallback(
    (hash: string) => {
      if (!didPan.current) onSelect(hash)
    },
    [onSelect],
  )

  /* ---------------- visible slice ------------------------------------ */

  const visible = useMemo(() => {
    if (!layout || !geo || size.w === 0) return null
    const n = layout.nodes.length
    let startRow: number
    let endRow: number
    if (horiz) {
      // time runs along x with row 0 (newest) at the LEFT edge — rows map
      // 1:1 onto columns, so the visible world range [−tx, −tx + svgW]
      // maps directly onto the row window (svg-local, right of the gutter)
      const cw = geo.rh
      startRow = clamp(
        Math.floor((-effTx - LEFT_PAD) / cw) - VISIBLE_BUFFER,
        0,
        n - 1,
      ) // newest boundary
      endRow = clamp(
        Math.ceil((-effTx + svgW - LEFT_PAD) / cw) + VISIBLE_BUFFER,
        0,
        n - 1,
      ) // oldest boundary
    } else {
      if (viewH === 0) return null
      startRow = Math.max(0, Math.floor((effTy - TOP_PAD) / geo.rh - 0.5) - VISIBLE_BUFFER)
      endRow = Math.min(n - 1, Math.ceil((viewH + effTy - TOP_PAD) / geo.rh - 0.5) + VISIBLE_BUFFER)
    }
    if (startRow > endRow) return null
    const nodes = layout.nodes.slice(startRow, endRow + 1)
    const edges = layout.edges.filter(
      (e) => e.childRow <= endRow + 1 && e.parentRow >= startRow - 1,
    )
    return { startRow, endRow, nodes, edges }
  }, [layout, geo, viewH, effTy, effTx, svgW, horiz])

  const hoveredCommit =
    hoveredRow !== null && layout ? layout.nodes[hoveredRow]?.commit : undefined

  /* ---------------- minimap (full-history overview strip) ----------- */
  /** every commit as a sub-pixel dot — row → x (newest at the LEFT,
   *  mirroring the horizontal reading direction), lane → y; AI-assisted
   *  commits glow amber, merges render slightly larger. Built once per
   *  layout/width into a single <g> string so panning the main view never
   *  re-renders thousands of circles. */
  const miniDots = useMemo(() => {
    if (!layout || size.w === 0) return null
    const n = layout.nodes.length
    if (n === 0) return null
    const lanes = Math.max(1, layout.laneCount)
    const W = size.w
    const s: string[] = []
    for (const nd of layout.nodes) {
      const x = ((nd.row + 0.5) / n) * W
      const y = 5 + ((nd.lane + 0.5) / lanes) * 20
      const color = nd.commit.aiAgent ? '#f59e0b' : laneColor(nd.lane)
      const r = nd.commit.isMerge ? 1.25 : 0.85
      s.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"/>`,
      )
    }
    return s.join('')
  }, [layout, size.w])

  const miniTotal = layout?.nodes.length ?? 0
  /** strip is only meaningful when history overflows the viewport */
  const showMiniMap =
    !!miniDots &&
    !!geo &&
    (horiz ? hTimeW > svgW : geo.totalH > viewH) &&
    miniTotal > 1

  const selectedMiniRow = useMemo(() => {
    if (!layout || !selectedHash) return null
    return layout.nodes.findIndex((nd) => nd.commit.hash === selectedHash)
  }, [layout, selectedHash])

  /** fraction (0..1 along the strip) → center the main view on that row.
   *  Clicks glide (animateTo); drags track the pointer 1:1 with raw
   *  transforms for a scrubber feel. Geometry comes from the rendered
   *  `geo` — the exact same values the screen shows — so the jump can
   *  never race a pending fit/scale change the way a recomputed
   *  transform snapshot could. */
  const miniJump = useCallback(
    (frac: number, animate: boolean) => {
      const lay = layoutRef.current
      const g = geo
      const n = commitsRef.current.length
      if (!lay || !g || n === 0) return
      const row = clamp(Math.round(frac * (n - 1)), 0, n - 1)
      const { w, h } = sizeRef.current
      if (horiz) {
        const timeW = LEFT_PAD * 2 + n * g.rh
        const sw = Math.max(60, w - labelWOf(w))
        if (timeW <= sw) return
        const worldX = LEFT_PAD + row * g.rh + g.rh / 2
        // screen x = world x + tx → bring worldX to the viewport center
        const tx = clamp(sw / 2 - worldX, sw - timeW, 0)
        if (animate) animateTo({ tx, ty: tyRef.current })
        else {
          cancelPanAnim()
          setTransform({ tx })
        }
      } else {
        if (g.totalH <= h) return
        const worldY = TOP_PAD + row * g.rh + g.rh / 2
        const ty = clamp(worldY - h / 2, 0, g.totalH - h)
        if (animate) animateTo({ ty })
        else {
          cancelPanAnim()
          setTransform({ ty })
        }
      }
    },
    [horiz, geo, animateTo, cancelPanAnim, setTransform],
  )

  const miniDragRef = useRef(false)
  const onMiniPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    miniDragRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture is best-effort */
    }
    const rect = e.currentTarget.getBoundingClientRect()
    miniJump(clamp((e.clientX - rect.left) / rect.width, 0, 1), true)
  }
  const onMiniPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!miniDragRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    miniJump(clamp((e.clientX - rect.left) / rect.width, 0, 1), false)
  }
  const onMiniPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!miniDragRef.current) return
    miniDragRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  /** commit → parsed conventional type (memoized; powers filter dimming
   *  and the type-colored halo on matching nodes) */
  const typeOf = useMemo(() => {
    const m = new Map<string, CommitType>()
    if (!layout) return m
    for (const nd of layout.nodes)
      m.set(nd.commit.hash, parseCommitType(nd.commit.message))
    return m
  }, [layout])

  const typeFilterActive = !!typeFilterKinds && typeFilterKinds.length > 0
  const typeSet = useMemo(
    () => (typeFilterKinds ? new Set<CommitType>(typeFilterKinds) : null),
    [typeFilterKinds],
  )
  /** true when a type filter is active and this commit is outside it */
  const isDimmed = useCallback(
    (hash: string) => {
      if (!typeSet) return false
      const t = typeOf.get(hash)
      return t === undefined || !typeSet.has(t)
    },
    [typeSet, typeOf],
  )
  /** type-colored halo stroke for filter-matching nodes (null = off) */
  const typeHalo = useCallback(
    (hash: string) => {
      if (!typeSet) return null
      const t = typeOf.get(hash)
      return t !== undefined && typeSet.has(t) ? TYPE_META[t].color : null
    },
    [typeSet, typeOf],
  )
  const filterColor =
    typeFilterKinds && typeFilterKinds.length > 0
      ? (TYPE_META[typeFilterKinds[0]]?.color ?? '#a8a29e')
      : null

  /** lane → branch tip label (horizontal mode): the branch whose tip
   *  commit lives on that lane — the current branch wins, then local
   *  names; lanes without any branch tip fall back to a lane number.
   *  Clicking a label jumps to that branch's tip commit. */
  const laneLabels = useMemo(() => {
    if (!layout) return []
    const out: Array<{
      name: string
      fullName: string
      hash: string
      isCurrent: boolean
    } | null> = new Array(layout.laneCount).fill(null)
    for (const nd of layout.nodes) {
      const bs = nd.commit.headBranches
      if (!bs || bs.length === 0) continue
      const isCurrent = bs.includes(currentBranch)
      const best = isCurrent
        ? currentBranch
        : (bs.find((b) => !b.includes('/')) ?? bs[0])
      const cur = out[nd.lane]
      if (!cur || (isCurrent && !cur.isCurrent)) {
        // strip a remote prefix (origin/…) for the compact label
        const name = best.includes('/')
          ? best.split('/').slice(1).join('/')
          : best
        out[nd.lane] = { name, fullName: best, hash: nd.commit.hash, isCurrent }
      }
    }
    return out
  }, [layout, currentBranch])

  const gutterMarks = useMemo(() => {
    if (!layout || !geo || !visible) return []
    const out: Array<{ y: number; label: string; strong: boolean }> = []
    let lastY = -Infinity
    const showMonths = geo.rh >= 19
    for (const m of layout.monthMarks) {
      if (m.row < visible.startRow - 2 || m.row > visible.endRow + 2) continue
      if (!m.isYearStart && !showMonths) continue
      const y = rowY(m.row, geo) - effTy
      if (y - lastY < 16) continue
      lastY = y
      out.push({
        y,
        label: m.isYearStart ? String(m.year) : MONTHS[m.month],
        strong: m.isYearStart,
      })
    }
    return out
  }, [layout, geo, visible, effTy])

  /* horizontal layout: month/year marks along the top time axis */
  const axisMarks = useMemo(() => {
    if (!layout || !geo || !visible || !horiz) return []
    const n = layout.nodes.length
    const out: Array<{ x: number; label: string; strong: boolean }> = []
    let lastX = -Infinity
    const showMonths = geo.rh >= 19
    for (const m of layout.monthMarks) {
      if (m.row < visible.startRow - 2 || m.row > visible.endRow + 2) continue
      if (!m.isYearStart && !showMonths) continue
      const x =
        LEFT_PAD +
        m.row * geo.rh +
        geo.rh / 2 +
        effTx +
        labelW // svg-local + label gutter = container x
      // keep clear of the fixed direction anchors at both ends
      if (x < 76 || x > size.w - 64) continue
      if (x - lastX < 30) continue
      lastX = x
      out.push({
        x,
        label: m.isYearStart ? String(m.year) : MONTHS[m.month],
        strong: m.isYearStart,
      })
    }
    return out
  }, [layout, geo, visible, effTx, labelW, size.w, horiz])

  /* ---------------- back-to-home (newest) footer button ------------- */
  /** true once the viewport has travelled away from the newest commits:
   *  vertical → scrolled down from the top; horizontal → panned away
   *  (rightward, tx < 0) from the left edge where the newest live */
  const awayFromHome = geo
    ? horiz
      ? hTimeW > svgW && effTx < -120
      : geo.totalH > viewH && effTy > 120
    : false

  /** horizontal home position: newest pinned to the LEFT edge of the
   *  time svg (or centered when the whole history fits) */
  const hHomeTx = hTimeW <= svgW ? (svgW - hTimeW) / 2 : 0
  /** horizontal far end: the oldest commits pinned to the right edge */
  const hOldestTx = hTimeW <= svgW ? (svgW - hTimeW) / 2 : svgW - hTimeW

  const goHome = useCallback(() => {
    if (horiz) {
      const lay = layoutRef.current
      if (!lay) return
      const g = computeGeo(lay, tRef.current.scale, commitsRef.current.length)
      const n = commitsRef.current.length
      const timeW = LEFT_PAD * 2 + n * g.rh
      const w = sizeRef.current.w
      const svgW = Math.max(60, w - labelWOf(w))
      animateTo({
        ty: tyRef.current,
        tx: timeW <= svgW ? (svgW - timeW) / 2 : 0,
      })
    } else {
      animateTo({ ty: 0 })
    }
  }, [horiz, animateTo])

  const zoomPct = Math.round(t.scale * 100)

  /* ---------------- PNG export --------------------------------------- */
  const isDark = useCallback(
    () => document.documentElement.classList.contains('dark'),
    [],
  )

  const exportPng = useCallback(
    async (pixelScale: 2 | 3 | 4) => {
      const lay = layoutRef.current
      const geoNow = geo
      if (!lay || !geoNow || !visible || size.w === 0) return
      setExporting(true)
      try {
        const { svg, w, h } = buildViewSvg(lay, {
          orientation,
          dark: isDark(),
          repoLabel,
          branchLabel,
          selectedHash,
          width: size.w,
          height: size.h,
          gutterW: GUTTER_W,
          laneAreaW,
          axisH: AXIS_H,
          labelW: horiz ? labelW : 0,
          railH: horiz ? railH : 0,
          railRows,
          laneLabels: horiz
            ? laneLabels.map((l) =>
                l ? { name: l.name, isCurrent: l.isCurrent } : null,
              )
            : null,
          typeKinds: typeFilterKinds ?? null,
          startRow: visible.startRow,
          endRow: visible.endRow,
          geo: geoNow,
          tx: effTx,
          ty: effTy,
          totalCommits: commits.length,
        })
        const dims = await downloadSvgAsPng(
          svg,
          w,
          h,
          pixelScale,
          `${repoLabel.replace(/[^\w.-]+/g, '-')}-graph-${pixelScale}x.png`,
        )
        toast.success(`Exported ${dims.w.toLocaleString()}×${dims.h.toLocaleString()} PNG`)
      } catch {
        toast.error('Export failed — try a smaller scale')
      } finally {
        setExporting(false)
      }
    },
    [geo, visible, size.w, size.h, orientation, isDark, repoLabel, branchLabel, selectedHash, laneAreaW, effTx, effTy, commits.length, horiz, labelW, railH, railRows, laneLabels, typeFilterKinds],
  )

  const exportPoster = useCallback(async () => {
    const lay = layoutRef.current
    if (!lay) return
    setExporting(true)
    try {
      const { svg, w, h } = buildPosterSvg(lay, {
        orientation,
        dark: isDark(),
        repoLabel,
        branchLabel,
        totalCommits: commits.length,
        selectedHash,
      })
      const dims = await downloadSvgAsPng(
        svg,
        w,
        h,
        2,
        `${repoLabel.replace(/[^\w.-]+/g, '-')}-poster.png`,
      )
      toast.success(
        `Poster exported — ${commits.length.toLocaleString()} commits, ${dims.w.toLocaleString()}×${dims.h.toLocaleString()}px`,
      )
    } catch {
      toast.error('Poster export failed')
    } finally {
      setExporting(false)
    }
  }, [orientation, isDark, repoLabel, branchLabel, selectedHash, commits.length])

  /* ---------------- render ------------------------------------------- */

  return (
    <div className="flex min-w-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {extra}
        <div className="ml-auto flex items-center gap-1">
          {fetching && (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {exporting && (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-emerald-600" aria-label="Exporting PNG" />
          )}
          {/* orientation toggle */}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={
              horiz
                ? 'Switch to vertical layout (time flows top to bottom)'
                : 'Switch to horizontal layout (time flows left to right)'
            }
            title={horiz ? 'Vertical layout' : 'Horizontal layout'}
            onClick={toggleOrientation}
          >
            {horiz ? (
              <ArrowUpDown className="h-3.5 w-3.5" />
            ) : (
              <ArrowLeftRight className="h-3.5 w-3.5" />
            )}
          </Button>
          {/* PNG export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                aria-label="Export graph as PNG image"
                title="Export PNG"
              >
                <ImageDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export PNG</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void exportPng(2)}>
                Current view · 2×
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportPng(3)}>
                Current view · 3× <span className="ml-auto text-[10px] text-muted-foreground">ultra-HD</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportPng(4)}>
                Current view · 4×
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void exportPoster()}>
                Full history poster
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {commits.length.toLocaleString()} commits
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Zoom out"
            onClick={() =>
              zoomAt(horiz ? size.w / 2 : laneAreaW / 2, size.h / 2, 1 / 1.25)
            }
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
            {zoomPct}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Zoom in"
            onClick={() => zoomAt(horiz ? size.w / 2 : laneAreaW / 2, size.h / 2, 1.25)}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Fit to screen"
            onClick={fit}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Jump to latest commits"
            title="Latest"
            onClick={() =>
              horiz
                ? animateTo({ ty: effTy, tx: hHomeTx })
                : animateTo({ ty: 0 })
            }
          >
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Jump to oldest commits"
            title="Oldest"
            onClick={() =>
              horiz
                ? animateTo({ ty: effTy, tx: hOldestTx })
                : animateTo({
                    ty: geo
                      ? geo.totalH <= viewH
                        ? (geo.totalH - viewH) / 2
                        : geo.totalH - viewH
                      : 0,
                  })
            }
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* canvas — slightly shorter when the minimap strip is mounted
          below it, so the card's overall height stays close to constant */}
      <div
        ref={containerRef}
        role="application"
        aria-label="Commit graph — arrow keys move the selection, Escape clears it"
        tabIndex={0}
        className={`relative touch-none select-none overflow-hidden overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 ${
          showMiniMap ? 'h-[380px] md:h-[530px]' : 'h-[400px] md:h-[560px]'
        }`}
        style={{ cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onKeyDown={onKeyDown}
      >
        {/* ---------- states ---------- */}
        {loading && (
          <div className="absolute inset-0 z-20 space-y-2.5 bg-background/80 p-4 backdrop-blur-sm">
            {[68, 40, 85, 55, 72, 45, 60, 80, 38, 65, 50, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-full" />
                <Skeleton
                  className="h-3 animate-pulse"
                  style={{ width: `${w}%` }}
                />
              </div>
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 p-6 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-red-600">
              <AlertTriangle className="h-4 w-4" />
              Unable to read Git history.
            </div>
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              {error.message}
            </p>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
          </div>
        )}

        {!loading && !error && commits.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
            <p className="text-sm font-medium">No commits yet.</p>
            <p className="text-xs text-muted-foreground">
              Make the first commit to start the history.
            </p>
          </div>
        )}

        {/* ---------- graph ---------- */}
        {layout && geo && visible && !loading && !error && (
          <>
            {/* time gutter (vertical layout only) */}
            {!horiz && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-[5] border-r bg-background/40"
                style={{ width: GUTTER_W }}
              >
              {gutterMarks.map((m, i) => (
                <div
                  key={i}
                  className={`absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums ${
                    m.strong
                      ? 'font-semibold text-foreground/70'
                      : 'text-muted-foreground'
                  }`}
                  style={{ top: m.y }}
                >
                  {m.label}
                </div>
              ))}
              </div>
            )}

            {/* horizontal layout: top time axis */}
            {horiz && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-[5] border-b bg-background/40"
                style={{ height: AXIS_H }}
              >
                {axisMarks.map((m, i) => (
                  <div
                    key={i}
                    className={`absolute top-1.5 -translate-x-1/2 text-[10px] tabular-nums ${
                      m.strong
                        ? 'font-semibold text-foreground/70'
                        : 'text-muted-foreground'
                    }`}
                    style={{ left: m.x }}
                  >
                    {m.label}
                  </div>
                ))}
                {/* fixed direction anchors — reading runs left → right,
                    newest first (mirrors the vertical top → down) */}
                <span className="absolute inset-y-0 left-0 flex items-center bg-gradient-to-r from-background via-background/85 to-transparent pl-2.5 pr-7 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  ← newest
                </span>
                <span className="absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-background via-background/85 to-transparent pl-7 pr-2.5 text-[10px] font-medium text-muted-foreground">
                  oldest →
                </span>
              </div>
            )}

            {/* horizontal layout: lane label gutter — branch tips pinned
                to the left edge; the time svg is clipped right of it, so
                commits never slide underneath these labels */}
            {horiz && geo && (
              <div
                className="pointer-events-none absolute bottom-0 left-0 z-[6] border-r bg-background/80 backdrop-blur-[2px]"
                style={{ top: AXIS_H, width: labelW }}
              >
                {laneLabels.map((ln, i) => {
                  const laneH = hLanesH > 0 ? geo.lw : 0
                  const y = TOP_PAD + i * laneH + laneH / 2 - effTy
                  if (y < -10 || y > size.h - AXIS_H - railH + 10) return null
                  const color = laneColor(i)
                  const compact = geo.lw < 15 // too zoomed out — dots only
                  const h = compact
                    ? Math.min(8, geo.lw - 2)
                    : Math.min(20, geo.lw - 2)
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`pointer-events-auto absolute left-1 right-1 flex items-center overflow-hidden rounded border outline-none transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-ring/60 ${
                        ln
                          ? 'cursor-pointer hover:border-foreground/40'
                          : 'cursor-default'
                      } ${compact ? 'justify-center' : 'gap-1 px-1'}`}
                      style={{
                        top: y - h / 2,
                        height: h,
                        borderColor: ln ? `${color}55` : 'transparent',
                        backgroundColor: ln ? `${color}14` : 'transparent',
                      }}
                      onClick={() => ln && selectCommit(ln.hash)}
                      title={
                        ln
                          ? `${ln.fullName}${ln.isCurrent ? ' (HEAD)' : ''} — click to jump to its tip commit`
                          : `lane ${i + 1} — a structural rail without a branch tip`
                      }
                      aria-label={
                        ln
                          ? `Lane ${i + 1}: branch ${ln.fullName}. Jump to its tip commit.`
                          : `Lane ${i + 1}`
                      }
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: color,
                          boxShadow: ln?.isCurrent ? `0 0 0 2px ${color}55` : undefined,
                        }}
                        aria-hidden
                      />
                      {!compact && (
                        <span
                          className={`truncate text-[10px] leading-none ${
                            ln
                              ? ln.isCurrent
                                ? 'font-semibold text-foreground'
                                : 'font-medium text-foreground/80'
                              : 'font-mono text-muted-foreground/50'
                          }`}
                        >
                          {ln ? ln.name : `L${i + 1}`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* horizontal layout: bottom commit-info rail — the
                counterpart of the vertical message list: EVERY visible
                commit gets a hit-area aligned under its column (ticks /
                type dots when zoomed out, badge + message when zoomed
                in); hover shows the full tooltip, click selects */}
            {horiz && (
              <div
                className="absolute bottom-0 left-0 right-0 z-[6]"
                style={{ height: railH }}
              >
                <div
                  className="absolute inset-y-0 left-0 flex items-center justify-center border-r border-t bg-background/75 px-1"
                  style={{ width: labelW }}
                >
                  <span className="truncate text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    commits
                  </span>
                </div>
                <div
                  className="absolute inset-y-0 overflow-hidden border-t bg-background/55 backdrop-blur-[2px]"
                  style={{ left: labelW, right: 0 }}
                  onMouseLeave={onMouseLeave}
                >
                  {visible.nodes.map((nd) => {
                    const c = nd.commit
                    const cw = geo.rh
                    const cx = LEFT_PAD + nd.row * cw + cw / 2 + effTx
                    const slot = cw * railRows
                    const dim = isDimmed(c.hash)
                    const isSelected = c.hash === selectedHash
                    const isHovered = hoveredRow === nd.row
                    const type = typeOf.get(c.hash)
                    const tColor = type ? TYPE_META[type].color : laneColor(nd.lane)
                    const chipH =
                      railRows === 1
                        ? railH - 10
                        : (railH - 10 - (railRows - 1) * 2) / railRows
                    const top = 5 + (nd.row % railRows) * (chipH + 2)
                    const stateCls = `${
                      isSelected
                        ? 'bg-accent ring-1 ring-inset ring-border'
                        : isHovered
                          ? 'bg-muted/60'
                          : ''
                    } ${!isSelected && dim ? 'opacity-40 saturate-50' : ''}`
                    if (slot < 14) {
                      // ultra-dense: one structural tick per commit
                      const w = Math.max(cw, 10)
                      return (
                        <button
                          key={c.hash}
                          type="button"
                          aria-label={`Commit ${c.shortHash} ${c.message}`}
                          className={`absolute cursor-pointer rounded ${stateCls}`}
                          style={{ left: cx - w / 2, width: w, top: 8, bottom: 8 }}
                          onClick={() => selectCommit(c.hash)}
                          onMouseEnter={() => setHoveredRow(nd.row)}
                        >
                          <span
                            className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full"
                            style={{
                              backgroundColor: isSelected
                                ? '#10b981'
                                : laneColor(nd.lane),
                            }}
                            aria-hidden
                          />
                        </button>
                      )
                    }
                    if (slot < 46) {
                      // dense: a type-colored dot per commit
                      const w = Math.max(cw, 14)
                      return (
                        <button
                          key={c.hash}
                          type="button"
                          aria-label={`Commit ${c.shortHash} ${c.message}`}
                          className={`absolute flex cursor-pointer items-center justify-center rounded-md ${stateCls}`}
                          style={{ left: cx - w / 2, width: w, top, height: chipH }}
                          onClick={() => selectCommit(c.hash)}
                          onMouseEnter={() => setHoveredRow(nd.row)}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tColor }}
                            aria-hidden
                          />
                        </button>
                      )
                    }
                    const w = Math.min(slot - 4, 320)
                    if (slot < 90) {
                      // medium: type dot + short hash
                      return (
                        <button
                          key={c.hash}
                          type="button"
                          aria-label={`Commit ${c.shortHash} ${c.message}`}
                          className={`absolute flex cursor-pointer items-center gap-1 overflow-hidden rounded-md px-1.5 ${stateCls}`}
                          style={{ left: cx - w / 2, width: w, top, height: chipH }}
                          onClick={() => selectCommit(c.hash)}
                          onMouseEnter={() => setHoveredRow(nd.row)}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tColor }}
                            aria-hidden
                          />
                          <span className="truncate font-mono text-[9px] text-muted-foreground">
                            {c.shortHash}
                          </span>
                          {c.aiAgent && (
                            <span
                              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                              aria-label="AI-assisted commit"
                            />
                          )}
                        </button>
                      )
                    }
                    // roomy: type badge + message (like the vertical list)
                    return (
                      <button
                        key={c.hash}
                        type="button"
                        aria-label={`Commit ${c.shortHash} ${c.message}`}
                        className={`absolute flex cursor-pointer items-center gap-1 overflow-hidden rounded-md px-1.5 ${stateCls}`}
                        style={{ left: cx - w / 2, width: w, top, height: chipH }}
                        onClick={() => selectCommit(c.hash)}
                        onMouseEnter={() => setHoveredRow(nd.row)}
                      >
                        <CommitTypeBadge message={c.message} />
                        <span
                          className={`truncate text-[10px] ${
                            isSelected ? 'font-semibold' : 'font-medium'
                          }`}
                        >
                          {c.message}
                        </span>
                        {slot >= 220 && (
                          <span className="ml-auto max-w-[80px] shrink-0 truncate text-[9px] text-muted-foreground">
                            {c.author}
                          </span>
                        )}
                        {c.aiAgent && (
                          <span
                            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                            aria-label="AI-assisted commit"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* lane area */}
            <svg
              className="absolute inset-y-0 block"
              style={
                horiz
                  ? { left: labelW, width: svgW, height: '100%' }
                  : { left: GUTTER_W, width: laneAreaW, height: '100%' }
              }
              shapeRendering="geometricPrecision"
              onClick={onBackgroundClick}
            >
              {horiz && (
                <HorizontalGraph
                  layout={layout}
                  geo={geo}
                  visible={visible}
                  effTx={effTx}
                  effTy={effTy}
                  hoveredRow={hoveredRow}
                  selectedHash={selectedHash}
                  intro={intro}
                  onSelect={selectCommit}
                  isDimmed={isDimmed}
                  typeHalo={typeHalo}
                />
              )}
              {!horiz && (
              <>
              {/* hovered row background */}
              {hoveredRow !== null && (
                <rect
                  x={0}
                  y={rowY(hoveredRow, geo) - effTy - geo.rh / 2}
                  width={laneAreaW}
                  height={geo.rh}
                  fill="currentColor"
                  className="text-foreground/[0.04]"
                />
              )}

              {/* edges */}
              <g>
                {visible.edges.map((e, i) => {
                  const d = edgePath(e, geo, effTx, effTy)
                  const color = laneColor(e.colorLane)
                  return intro ? (
                    <motion.path
                      key={`${e.childRow}-${e.parentRow}-${i}`}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={geo.edgeW * (e.isSecondary ? 0.85 : 1)}
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{
                        duration: 0.45,
                        delay: Math.min(e.childRow * 0.004, 0.5),
                        ease: 'easeOut',
                      }}
                    />
                  ) : (
                    <path
                      key={`${e.childRow}-${e.parentRow}-${i}`}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={geo.edgeW * (e.isSecondary ? 0.85 : 1)}
                      strokeLinecap="round"
                    />
                  )
                })}
              </g>

              {/* nodes */}
              <g>
                {visible.nodes.map((nd) => {
                  const x = laneX(nd.lane, geo) + effTx
                  const y = rowY(nd.row, geo) - effTy
                  const color = laneColor(nd.lane)
                  const isSelected = nd.commit.hash === selectedHash
                  const isHovered = hoveredRow === nd.row
                  const dim = isDimmed(nd.commit.hash)
                  const halo = typeHalo(nd.commit.hash)
                  const r =
                    geo.nodeR *
                    (nd.commit.isMerge ? 1.15 : 1) *
                    (isHovered ? 1.3 : 1)
                  const inner = (
                    <>
                      {isSelected && (
                        <circle
                          className="pulse-ring"
                          r={r + 4}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.5}
                        />
                      )}
                      {halo && (
                        <circle
                          r={r + 2.5}
                          fill="none"
                          stroke={halo}
                          strokeWidth={1.3}
                          opacity={0.85}
                        />
                      )}
                      <circle
                        r={r}
                        fill={color}
                        stroke="var(--background)"
                        strokeWidth={nd.commit.isMerge ? 2.2 : 1.4}
                      />
                      {nd.commit.isMerge && (
                        <circle
                          r={Math.max(r * 0.38, 1.1)}
                          fill="var(--background)"
                          fillOpacity={0.9}
                        />
                      )}
                      {nd.commit.aiAgent && (
                        <circle
                          cx={r * 0.92}
                          cy={-r * 0.92}
                          r={Math.max(2.1, r * 0.4)}
                          fill="#f59e0b"
                          stroke="var(--background)"
                          strokeWidth={1}
                        />
                      )}
                    </>
                  )
                  return intro ? (
                    <g
                      key={nd.commit.hash}
                      transform={`translate(${x} ${y})`}
                      className="cursor-pointer"
                      style={{ opacity: !isSelected && dim ? 0.25 : 1 }}
                      onClick={() => selectCommit(nd.commit.hash)}
                    >
                      <motion.g
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                        transition={{
                          duration: 0.28,
                          delay: Math.min(nd.row * 0.012, 0.45),
                          ease: 'easeOut',
                        }}
                      >
                        {inner}
                      </motion.g>
                    </g>
                  ) : (
                    <g
                      key={nd.commit.hash}
                      transform={`translate(${x} ${y})`}
                      className="cursor-pointer"
                      style={{ opacity: !isSelected && dim ? 0.25 : 1 }}
                      onClick={() => selectCommit(nd.commit.hash)}
                    >
                      {inner}
                    </g>
                  )
                })}
              </g>
              </>
              )}
            </svg>

            {/* message list (vertical layout only — rows align with lanes) */}
            {!horiz && (
            <div
              className="absolute inset-y-0 right-0 overflow-hidden border-l"
              style={{ left: GUTTER_W + laneAreaW }}
              onMouseLeave={onMouseLeave}
            >
              {visible.nodes.map((nd) => {
                const c = nd.commit
                const isSelected = c.hash === selectedHash
                const isHovered = hoveredRow === nd.row
                const showText = geo.rh >= TEXT_MIN_ROW
                const top = rowY(nd.row, geo) - effTy - geo.rh / 2
                if (!showText) {
                  return (
                    <div
                      key={c.hash}
                      role="button"
                      tabIndex={-1}
                      aria-label={`Commit ${c.shortHash} ${c.message}`}
                      className={`absolute left-0 right-0 cursor-pointer ${
                        isSelected ? 'bg-accent' : isHovered ? 'bg-muted/60' : ''
                      } ${!isSelected && isDimmed(c.hash) ? 'opacity-40 saturate-50' : ''}`}
                      style={{ top, height: geo.rh }}
                      onClick={() => selectCommit(c.hash)}
                      onMouseEnter={() => setHoveredRow(nd.row)}
                    />
                  )
                }
                return (
                  <div
                    key={c.hash}
                    role="button"
                    tabIndex={0}
                    aria-label={`Commit ${c.shortHash} ${c.message}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectCommit(c.hash)
                      }
                    }}
                    className={`absolute left-0 right-0 flex cursor-pointer items-center gap-2 px-3 outline-none focus-visible:bg-muted ${
                      isSelected ? 'bg-accent' : isHovered ? 'bg-muted/60' : ''
                    } ${!isSelected && isDimmed(c.hash) ? 'opacity-40 saturate-50' : ''}`}
                    style={{ top, height: geo.rh }}
                    onClick={() => selectCommit(c.hash)}
                    onMouseEnter={() => setHoveredRow(nd.row)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      <CommitTypeBadge message={c.message} />
                      <span
                        className={`min-w-[48px] truncate text-[13px] ${
                          isSelected ? 'font-semibold' : 'font-medium'
                        }`}
                      >
                        {c.message}
                      </span>
                      {c.headBranches.map((b) => {
                        const isCurrent = b === currentBranch
                        const isRemote = b.includes('/')
                        return (
                          <span
                            key={b}
                            className={`inline-flex min-w-0 max-w-[60%] shrink items-center gap-1 overflow-hidden rounded-full border px-1.5 py-px text-[10px] leading-4 ${
                              isCurrent
                                ? 'border-transparent font-semibold text-white'
                                : isRemote
                                  ? 'border-border text-muted-foreground'
                                  : 'text-white'
                            }`}
                            style={{
                              backgroundColor: isRemote
                                ? undefined
                                : isCurrent
                                  ? laneColor(nd.lane)
                                  : `${laneColor(nd.lane)}d9`,
                              ...(isRemote ? {} : { borderColor: `${laneColor(nd.lane)}66` }),
                            }}
                          >
                            {isCurrent && (
                              <span
                                className="h-1 w-1 shrink-0 rounded-full bg-white"
                                aria-hidden
                              />
                            )}
                            <span className="truncate">{b}</span>
                          </span>
                        )
                      })}
                    </span>
                    <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground lg:block">
                      {c.author}
                    </span>
                    <span className="w-16 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">
                      {rowTime(c.committedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
            )}

            {/* tooltip */}
            <div
              ref={tooltipRef}
              className="pointer-events-none absolute z-30 w-56 rounded-lg border bg-popover/95 p-2.5 text-popover-foreground shadow-lg backdrop-blur-sm transition-opacity duration-150"
              style={{ opacity: 0 }}
            >
              {hoveredCommit && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {hoveredCommit.shortHash}
                    </span>
                    <CommitTypeBadge message={hoveredCommit.message} />
                    {hoveredCommit.isMerge && (
                      <span className="rounded-full border px-1 py-px text-[9px] font-medium text-muted-foreground">
                        MERGE
                      </span>
                    )}
                    {hoveredCommit.aiAgent && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300">
                        ✦ {hoveredCommit.aiAgent}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs font-medium">
                    {hoveredCommit.message}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
                    <span className="truncate">{hoveredCommit.author}</span>
                    <span>
                      {format(
                        new Date(hoveredCommit.committedAt),
                        'yyyy-MM-dd HH:mm',
                      )}
                    </span>
                  </div>
                  {hoveredCommit.branchCount > 0 && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {hoveredCommit.branchCount} branches contain this commit
                    </div>
                  )}
                </>
              )}
            </div>

            {/* travel-direction feedback (horizontal) — flashes while
                panning, makes the axis reading direction unmistakable */}
            {horiz && (
              <AnimatePresence>
                {flowHint !== null && (
                  <motion.div
                    key="flow-hint"
                    initial={{ opacity: 0, y: 8, x: '-50%' }}
                    animate={{ opacity: 1, y: 0, x: '-50%' }}
                    exit={{ opacity: 0, y: 8, x: '-50%' }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    style={{ bottom: railH + 8 }}
                    className={`pointer-events-none absolute left-1/2 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-sm ${
                      flowHint === -1
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-border bg-background/85 text-muted-foreground'
                    }`}
                  >
                    {flowHint === -1 ? '← newer' : 'older →'}
                  </motion.div>
                )}
              </AnimatePresence>
            )}

          </>
        )}
      </div>

      {/* minimap — the whole history at a glance: every commit as a dot
          (newest at the left), the emerald window is your current
          viewport; click or drag to travel. Scrubber-style navigation
          that makes "where am I in 15 years of history" obvious. */}
      {showMiniMap && miniDots && (
        <div
          className="relative h-[30px] shrink-0 touch-none select-none border-t bg-background"
          aria-label="History minimap — click or drag to travel through the commit history"
          title="Minimap — every commit as a dot · click or drag to travel"
          style={{ cursor: 'crosshair' }}
          onPointerDown={onMiniPointerDown}
          onPointerMove={onMiniPointerMove}
          onPointerUp={onMiniPointerEnd}
          onPointerCancel={onMiniPointerEnd}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width="100%"
            height="30"
            viewBox={`0 0 ${Math.max(size.w, 1)} 30`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <g dangerouslySetInnerHTML={{ __html: miniDots }} />
          </svg>
          {/* reading-direction micro labels */}
          <span
            className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 font-mono text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40"
            aria-hidden
          >
            new
          </span>
          <span
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 font-mono text-[8px] uppercase tracking-wider text-muted-foreground/40"
            aria-hidden
          >
            old
          </span>
          {/* current viewport window */}
          {visible && miniTotal > 0 && (
            <div
              className="pointer-events-none absolute inset-y-[2px] rounded-[2px] border-2 border-emerald-600/70 bg-emerald-500/10 dark:border-emerald-400/60"
              style={{
                left: `${(visible.startRow / miniTotal) * 100}%`,
                width: `${Math.max(
                  0.6,
                  ((visible.endRow - visible.startRow + 1) / miniTotal) * 100,
                )}%`,
              }}
            />
          )}
          {/* selected commit marker */}
          {selectedMiniRow !== null && selectedMiniRow >= 0 && (
            <div
              className="pointer-events-none absolute inset-y-[3px] w-[2px] -translate-x-1/2 rounded-full bg-foreground/70"
              style={{
                left: `${((selectedMiniRow + 0.5) / Math.max(miniTotal, 1)) * 100}%`,
              }}
            />
          )}
        </div>
      )}

      {/* footer — OUTSIDE the canvas on purpose: the back-to-latest
          control can never be covered by hover tooltips, and the strip
          sits right beside the commit-detail panel (vertical: sidebar ·
          horizontal: the always-visible panel below) */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-t px-3">
        <div className="flex min-w-0 items-center gap-2">
          {typeFilterActive ? (
            <span
              role="status"
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: `${filterColor ?? '#a8a29e'}55`,
                backgroundColor: `${filterColor ?? '#a8a29e'}14`,
                color: filterColor ?? undefined,
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: filterColor ?? undefined }}
                aria-hidden
              />
              <span className="truncate">
                type filter:{' '}
                {typeFilterKinds?.slice(0, 3).join(' · ')}
                {(typeFilterKinds?.length ?? 0) > 3
                  ? ` +${(typeFilterKinds?.length ?? 0) - 3}`
                  : ''}{' '}
                — non-matching commits dimmed
              </span>
            </span>
          ) : (
            <span
              className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:inline-flex"
              aria-hidden
            >
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {horiz ? '← newest' : '↑ newest'}
              </span>
              <span className="text-border">·</span>
              <span>{horiz ? 'oldest →' : 'oldest ↓'}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {visible && (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[10px] font-medium tabular-nums text-muted-foreground">
              <span>
                {(visible.startRow + 1).toLocaleString()}–
                {(visible.endRow + 1).toLocaleString()}
              </span>
              <span className="text-border">/</span>
              <span>{commits.length.toLocaleString()}</span>
            </span>
          )}
          <AnimatePresence>
            {awayFromHome && (
              <motion.div
                key="back-home"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-emerald-500/40 px-2.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-200"
                  aria-label={
                    horiz
                      ? 'Back to the newest commits (left edge)'
                      : 'Back to the newest commits (top)'
                  }
                  title={horiz ? 'Back to latest' : 'Back to top'}
                  onClick={goHome}
                >
                  {horiz ? (
                    <ArrowLeftToLine className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpToLine className="h-3.5 w-3.5" />
                  )}
                  Back to latest
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Horizontal layout — newest (row 0) sits at the LEFT edge so the    */
/*  graph reads left → right exactly like the vertical list reads      */
/*  top → down; lanes stack top to bottom. Same data, same colors.     */
/* ------------------------------------------------------------------ */

function HorizontalGraph({
  layout,
  geo,
  visible,
  effTx,
  effTy,
  hoveredRow,
  selectedHash,
  intro,
  onSelect,
  isDimmed,
  typeHalo,
}: {
  layout: GraphLayout
  geo: Geo
  visible: { startRow: number; endRow: number; nodes: typeof layout.nodes; edges: typeof layout.edges }
  effTx: number
  effTy: number
  hoveredRow: number | null
  selectedHash: string | null
  intro: boolean
  onSelect: (hash: string) => void
  /** commit is outside the active type filter → render dimmed */
  isDimmed: (hash: string) => boolean
  /** type-colored halo stroke for filter-matching commits (null = off) */
  typeHalo: (hash: string) => string | null
}) {
  const cw = geo.rh // column width along x (reuses the row height metric)

  /** world x of a row — newest (row 0) at the LEFT edge, so reading
   *  left → right runs newest → oldest (mirrors vertical top → down) */
  const timeX = (row: number) => LEFT_PAD + row * cw + cw / 2
  /** world y of a lane center */
  const laneY = (lane: number) => TOP_PAD + lane * geo.lw + geo.lw / 2

  const pathOf = (e: (typeof layout.edges)[number]) => {
    const x1 = timeX(e.childRow) + effTx
    const y1 = laneY(e.childLane) - effTy
    const x2 = timeX(e.parentRow) + effTx
    const y2 = laneY(e.parentLane) - effTy
    if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`
    // child (newer) sits left of parent (older) — bend toward each other
    const k = Math.min(cw * 0.55, Math.max(0, (x2 - x1) / 2))
    return `M ${x1} ${y1} C ${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`
  }

  return (
    <g transform={`translate(0 ${AXIS_H})`}>
      {/* hovered commit column */}
      {hoveredRow !== null && (
        <rect
          x={timeX(hoveredRow) + effTx - geo.rh / 2}
          y={0}
          width={geo.rh}
          height={Math.max(layout.laneCount * geo.lw + TOP_PAD * 2, 10)}
          fill="currentColor"
          className="text-foreground/[0.04]"
        />
      )}

      {/* edges */}
      <g>
        {visible.edges.map((e, i) => {
          const d = pathOf(e)
          const color = laneColor(e.colorLane)
          return intro ? (
            <motion.path
              key={`${e.childRow}-${e.parentRow}-${i}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={geo.edgeW * (e.isSecondary ? 0.85 : 1)}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{
                duration: 0.45,
                delay: Math.min(e.childRow * 0.004, 0.5),
                ease: 'easeOut',
              }}
            />
          ) : (
            <path
              key={`${e.childRow}-${e.parentRow}-${i}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={geo.edgeW * (e.isSecondary ? 0.85 : 1)}
              strokeLinecap="round"
            />
          )
        })}
      </g>

      {/* nodes */}
      <g>
        {visible.nodes.map((nd) => {
          const x = timeX(nd.row) + effTx
          const y = laneY(nd.lane) - effTy
          const color = laneColor(nd.lane)
          const isSelected = nd.commit.hash === selectedHash
          const isHovered = hoveredRow === nd.row
          const dim = isDimmed(nd.commit.hash)
          const halo = typeHalo(nd.commit.hash)
          const r =
            geo.nodeR *
            (nd.commit.isMerge ? 1.15 : 1) *
            (isHovered ? 1.3 : 1)
          const inner = (
            <>
              {isSelected && (
                <circle
                  className="pulse-ring"
                  r={r + 4}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                />
              )}
              {halo && (
                <circle
                  r={r + 2.5}
                  fill="none"
                  stroke={halo}
                  strokeWidth={1.3}
                  opacity={0.85}
                />
              )}
              <circle
                r={r}
                fill={color}
                stroke="var(--background)"
                strokeWidth={nd.commit.isMerge ? 2.2 : 1.4}
              />
              {nd.commit.isMerge && (
                <circle
                  r={Math.max(r * 0.38, 1.1)}
                  fill="var(--background)"
                  fillOpacity={0.9}
                />
              )}
              {nd.commit.aiAgent && (
                <circle
                  cx={r * 0.92}
                  cy={-r * 0.92}
                  r={Math.max(2.1, r * 0.4)}
                  fill="#f59e0b"
                  stroke="var(--background)"
                  strokeWidth={1}
                />
              )}
            </>
          )
          return intro ? (
            <g
              key={nd.commit.hash}
              transform={`translate(${x} ${y})`}
              className="cursor-pointer"
              style={{ opacity: !isSelected && dim ? 0.25 : 1 }}
              onClick={() => onSelect(nd.commit.hash)}
            >
              <motion.g
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                transition={{
                  duration: 0.28,
                  delay: Math.min(nd.row * 0.012, 0.45),
                  ease: 'easeOut',
                }}
              >
                {inner}
              </motion.g>
            </g>
          ) : (
            <g
              key={nd.commit.hash}
              transform={`translate(${x} ${y})`}
              className="cursor-pointer"
              style={{ opacity: !isSelected && dim ? 0.25 : 1 }}
              onClick={() => onSelect(nd.commit.hash)}
            >
              {inner}
            </g>
          )
        })}
      </g>
    </g>
  )
}
