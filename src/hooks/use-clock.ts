'use client'

import { useEffect, useState } from 'react'

/**
 * A ticking clock. Returns null on the server and during the first client
 * render so SSR markup never mismatches.
 *
 * `updateMs` = 1000 keeps HH:mm:ss visibly alive (a product requirement —
 * the page must feel like it is running in real time).
 */
export function useClock(updateMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const update = () => setNow(new Date())
    // first value arrives on the next frame (never during the effect body),
    // then the interval keeps the page visibly alive.
    const raf = requestAnimationFrame(update)
    const id = setInterval(update, updateMs)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [updateMs])

  return now
}
