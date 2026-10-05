'use client'

import { useEffect, useState } from 'react'

/**
 * Reactive CSS media query (SSR-safe: starts at the given default, then
 * syncs after mount). Used to gate mobile-only UI (vaul drawers portal
 * to <body>, so CSS `md:hidden` on the trigger cannot hide them).
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update() // sync immediately on mount
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}

/** true below the md breakpoint (768px) — the mobile drawer range */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
