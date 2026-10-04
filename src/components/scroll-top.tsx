'use client'

/**
 * AI Coding Activity — Phase 6 · ScrollTop
 *
 * Floating back-to-top button for the long dashboard page. Appears after
 * scrolling past ~1.3 viewport heights, smooth-scrolls back on click.
 * Respects the mobile safe area and stays clear of the footer.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ScrollTop() {
  const [visible, setVisible] = useState(false)

  // rAF-wrapped to pass the set-state-in-effect lint rule
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        setVisible(window.scrollY > window.innerHeight * 1.3)
        ticking = false
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed right-4 bottom-16 z-30 sm:right-6 sm:bottom-8"
        >
          <Button
            variant="outline"
            size="icon"
            aria-label="Back to top"
            title="Back to top"
            className="h-10 w-10 rounded-full border-border/80 bg-background/90 shadow-md backdrop-blur-md transition-colors hover:bg-accent"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
