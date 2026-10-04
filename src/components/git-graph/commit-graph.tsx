'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Loader2,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraphCommit } from '@/lib/git/types'
import {
  computeGeo,
  computeGraphLayout,
  edgePath,
  LANE_COLORS,
  laneColor,
  laneX,
  MAX_SCALE,
  MIN_SCALE,
  rowY,
  TEXT_MIN_ROW,
  type Geo,
  type GraphLayout,
} from './layout'

const GUTTER_W = 44
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const VISIBLE_BUFFER = 4

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
}: CommitGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [t, setT] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [intro, setIntro] = useState(false)

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
        Math.max(140, Math.min(isNarrow ? size.w * 0.5 : size.w * 0.55, 460)),
        Math.max(geo.contentW, 90),
      )
    : 140

  const viewH = size.h
  const effTx = geo
    ? geo.contentW <= laneAreaW
      ? (laneAreaW - geo.contentW) / 2
      : clamp(t.tx, laneAreaW - geo.contentW, 0)
    : 0
  // screen y = world y - ty  →  ty ∈ [0, totalH - viewH] when content is
  // taller than the viewport; when shorter, content is centered vertically.
  const effTy = geo
    ? geo.totalH <= viewH || viewH === 0
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
      setT({
        scale: newScale,
        tx: px - (px - prev.tx) * k,
        ty: (py + prev.ty) * k - py,
      })
    },
    [],
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
    const { w } = sizeRef.current
    if (!lay) return 1
    const narrow = w < 640
    const avail = Math.max(140, Math.min(narrow ? w * 0.5 : w * 0.55, 460))
    const laneWidths = lay.laneCount * 34
    const scale = (avail - 18 - 14) / Math.max(laneWidths, 1)
    return clamp(scale, MIN_SCALE, Math.min(MAX_SCALE, 1.35))
  }, [])

  const fit = useCallback(() => {
    const fitScale = computeFitScale()
    const k = fitScale / tRef.current.scale
    if (k !== 1) {
      zoomAt(laneAreaW / 2, sizeRef.current.h / 2, k)
    }
    // re-center horizontally
    const lay = layoutRef.current
    if (lay) {
      const g = computeGeo(lay, fitScale, commitsRef.current.length)
      const areaW = laneAreaW
      const targetTx =
        g.contentW <= areaW ? (areaW - g.contentW) / 2 : clamp(0, areaW - g.contentW, 0)
      setTransform({ tx: targetTx })
    }
  }, [zoomAt, setTransform, computeFitScale, laneAreaW])

  /* ---------------- initial fit + intro on new data ------------------ */
  const sizeReady = size.w > 40

  useEffect(() => {
    if (!layout || !sizeReady) return
    const raf = requestAnimationFrame(() => {
      const fitScale = computeFitScale()
      setT({ scale: fitScale, tx: 0, ty: 0 })
    })
    const timer = setTimeout(() => setIntro(true), 30)
    const timer2 = setTimeout(() => setIntro(false), 1700)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [layout, sizeReady, computeFitScale])

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
      const h = sizeRef.current.h
      const y = 14 + row * g.rh + g.rh / 2 - tr.ty
      const lane = lay.laneOf.get(selectedHash) ?? 0
      const x = laneX(lane, g) + txRef.current

      const next: { ty?: number; tx?: number } = {}
      if (y < 80 || y > h - 80) {
        next.ty = 14 + row * g.rh + g.rh / 2 - h / 2
      }
      const areaW = Math.min(
        Math.max(140, Math.min(sizeRef.current.w < 640 ? sizeRef.current.w * 0.5 : sizeRef.current.w * 0.55, 460)),
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
  }, [selectedHash, layout, animateTo])

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
      } else {
        setT((prev) => ({ ...prev, ty: prev.ty + e.deltaY, tx: prev.tx + e.deltaX }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, cancelPanAnim])

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
        const midX = (a.x + b.x) / 2 - (containerRef.current?.getBoundingClientRect().left ?? 0)
        const midY = (a.y + b.y) / 2 - (containerRef.current?.getBoundingClientRect().top ?? 0)
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
  }, [])

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
        pinchStart.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: tRef.current.scale,
          midX: (a.x + b.x) / 2 - rect.left,
          midY: (a.y + b.y) / 2 - rect.top,
          tx: tRef.current.tx,
          ty: tRef.current.ty,
        }
        panStart.current = null
      }
    },
    [cancelPanAnim],
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, 1.35)
    },
    [zoomAt],
  )

  /* ---------------- hover / tooltip ---------------------------------- */

  const rowFromClientY = useCallback((clientY: number): number | null => {
    const lay = layoutRef.current
    if (!lay) return null
    const geoNow = computeGeo(lay, tRef.current.scale, commitsRef.current.length)
    const y = clientY + tyRef.current - 14 // world y
    const r = Math.floor((y - geoNow.rh / 2) / geoNow.rh)
    return r >= 0 && r < commitsRef.current.length ? r : null
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (pointers.current.size > 0) return // dragging
      const row = rowFromClientY(e.clientY)
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
    [rowFromClientY],
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
    if (!layout || !geo || viewH === 0) return null
    const n = layout.nodes.length
    const startRow = Math.max(0, Math.floor((effTy - 14) / geo.rh - 0.5) - VISIBLE_BUFFER)
    const endRow = Math.min(n - 1, Math.ceil((viewH + effTy - 14) / geo.rh - 0.5) + VISIBLE_BUFFER)
    if (startRow > endRow) return null
    const nodes = layout.nodes.slice(startRow, endRow + 1)
    const edges = layout.edges.filter(
      (e) => e.childRow <= endRow + 1 && e.parentRow >= startRow - 1,
    )
    return { startRow, endRow, nodes, edges }
  }, [layout, geo, viewH, effTy])

  const hoveredCommit =
    hoveredRow !== null && layout ? layout.nodes[hoveredRow]?.commit : undefined

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

  const zoomPct = Math.round(t.scale * 100)

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
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Zoom out"
            onClick={() =>
              zoomAt(laneAreaW / 2, size.h / 2, 1 / 1.25)
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
            onClick={() => zoomAt(laneAreaW / 2, size.h / 2, 1.25)}
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
            onClick={() => animateTo({ ty: 0 })}
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
              animateTo({
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

      {/* canvas */}
      <div
        ref={containerRef}
        role="application"
        aria-label="Commit graph"
        className="relative h-[440px] touch-none select-none overflow-hidden overscroll-contain md:h-[600px]"
        style={{ cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
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
            {/* time gutter */}
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

            {/* lane area */}
            <svg
              className="absolute inset-y-0 block"
              style={{ left: GUTTER_W, width: laneAreaW, height: '100%' }}
              shapeRendering="geometricPrecision"
            >
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
                      <circle
                        r={r}
                        fill={color}
                        stroke="white"
                        strokeWidth={nd.commit.isMerge ? 2.2 : 1.4}
                      />
                      {nd.commit.isMerge && (
                        <circle
                          r={Math.max(r * 0.38, 1.1)}
                          fill="white"
                          fillOpacity={0.9}
                        />
                      )}
                      {nd.commit.aiAgent && (
                        <circle
                          cx={r * 0.92}
                          cy={-r * 0.92}
                          r={Math.max(2.1, r * 0.4)}
                          fill="#f59e0b"
                          stroke="white"
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
                      onClick={() => selectCommit(nd.commit.hash)}
                    >
                      {inner}
                    </g>
                  )
                })}
              </g>
            </svg>

            {/* message list */}
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
                      }`}
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
                    }`}
                    style={{ top, height: geo.rh }}
                    onClick={() => selectCommit(c.hash)}
                    onMouseEnter={() => setHoveredRow(nd.row)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span
                        className={`truncate text-[13px] ${
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
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 ${
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
                                className="h-1 w-1 rounded-full bg-white"
                                aria-hidden
                              />
                            )}
                            {b}
                          </span>
                        )
                      })}
                    </span>
                    <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground lg:block">
                      {c.author}
                    </span>
                    <span className="w-[52px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {rowTime(c.committedAt)}
                    </span>
                  </div>
                )
              })}
            </div>

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
                    {hoveredCommit.isMerge && (
                      <span className="rounded-full border px-1 py-px text-[9px] font-medium text-muted-foreground">
                        MERGE
                      </span>
                    )}
                    {hoveredCommit.aiAgent && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700">
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

            {/* position indicator */}
            <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-full border bg-background/85 px-2.5 py-1 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur-sm">
              <span>
                {(visible.startRow + 1).toLocaleString()}–
                {(visible.endRow + 1).toLocaleString()}
              </span>
              <span className="text-border">/</span>
              <span>{commits.length.toLocaleString()}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
