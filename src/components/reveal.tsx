'use client'

/**
 * AI Coding Activity — Phase 6 · Reveal
 *
 * Scroll-triggered entrance choreography for dashboard cards. Uses
 * framer-motion `whileInView` (viewport once) so cards fade + rise as the
 * user scrolls down, with an optional stagger for grouped children.
 *
 * Purely presentational — data and layout are untouched.
 */

import { motion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

export interface RevealProps {
  children: ReactNode
  /** vertical offset (px) the block rises from */
  offsetY?: number
  /** entrance delay (s) — use for manual stagger */
  delay?: number
  duration?: number
  className?: string
  /** render as this tag (motion.div wrapper) */
  as?: 'div' | 'section'
}

export function Reveal({
  children,
  offsetY = 18,
  delay = 0,
  duration = 0.45,
  className,
  as = 'div',
}: RevealProps) {
  const Comp = as === 'section' ? motion.section : motion.div
  return (
    <Comp
      initial={{ opacity: 0, y: offsetY }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px 0px' }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </Comp>
  )
}

/** container variant that staggers direct RevealItem children */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.05 },
  },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
}
