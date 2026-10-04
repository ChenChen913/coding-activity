'use client'

/**
 * Theme toggle — cycles light → dark → system. Renders a stable icon
 * skeleton until mounted (next-themes resolves the actual theme
 * client-side; rendering the wrong icon during SSR would flash).
 */

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Laptop, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

const ORDER = ['light', 'dark', 'system'] as const
const LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
} as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // avoid hydration mismatch: render a neutral placeholder first
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(t)
  }, [])

  const current =
    mounted && (ORDER as readonly string[]).includes(theme ?? '')
      ? (theme as (typeof ORDER)[number])
      : 'system'
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]

  const Icon =
    current === 'light' ? Sun : current === 'dark' ? Moon : Laptop

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8"
      aria-label={`Theme: ${LABELS[current]} — switch to ${LABELS[next]}`}
      title={`Theme: ${LABELS[current]} (click → ${LABELS[next]})`}
      onClick={() => setTheme(next)}
    >
      {mounted ? (
        <Icon className="h-3.5 w-3.5" />
      ) : (
        <span className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  )
}
