/**
 * Whether the sidebar and the comments column are shown (LED-3). Folded stays folded on this browser, across
 * documents and reloads, until unfolded (Miky, 28 Oct); a window too narrow for both columns opens with both folded
 * (Katerina, 28 Oct), whatever was kept.
 */
import { useCallback, useState } from 'react'

export type Fold = 'sidebar' | 'comments'

const KEY = 'leaf.folded'

/** Below this the page, the sidebar and the comments column do not fit side by side. */
export const NARROW = '(max-width: 1023px)'

function narrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches
}

function kept(): Partial<Record<Fold, boolean>> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Record<Fold, boolean>>
  } catch {
    return {}
  }
}

/** Open or folded, and the setter that remembers it. */
export function useFold(fold: Fold): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => !narrow() && !kept()[fold])
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
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
