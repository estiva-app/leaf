/**
 * Whether the sidebar and the comments column are shown (LED-3). Folded stays folded on this browser, across
 * documents and reloads, until unfolded (Miky, 28 Oct); a window too narrow for both columns opens with both folded
 * (Katerina, 28 Oct), whatever was kept.
 */
import { useCallback, useState } from 'react'

export type Fold = 'sidebar' | 'comments'

const KEY = 'leaf.folded'

/** Below this the page, the sidebar and the comments column do not fit side by side. */
const NARROW = '(max-width: 1023px)'

/**
 * Each fold as it stands since this page loaded. A narrow window folds both when the page loads, not each time a
 * document opens: after that the person's choice holds.
 */
const now = new Map<Fold, boolean>()

function narrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches
}

function kept(): Partial<Record<Fold, boolean>> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    return value && typeof value === 'object' ? (value as Partial<Record<Fold, boolean>>) : {}
  } catch {
    return {}
  }
}

/** Open or folded, and the setter that remembers it. */
export function useFold(fold: Fold): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (!now.has(fold)) now.set(fold, !narrow() && !kept()[fold])
    return now.get(fold) as boolean
  })
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      now.set(fold, next)
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ ...kept(), [fold]: !next }))
      } catch {
        // Storage refused (private mode, full): it folds for this visit only.
      }
    },
    [fold],
  )
  return [open, change]
}
