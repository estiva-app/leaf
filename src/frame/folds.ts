/**
 * Whether the sidebar and the comments column are shown (LED-3). Folded stays folded on this browser, across
 * documents and reloads, until unfolded (Miky, 28 Oct); a window too narrow for both columns opens with both folded
 * (Katerina, 28 Oct), whatever was kept.
 *
 * The sidebar's fold is the package's `useSidebarFold` since ui 0.95.0 (Katerina, 31 Oct: one fold in every app):
 * its button, Peek's motion, and the rules above. What is Leaf's: its key, which pages are a file, and how narrow
 * is too narrow. The comments column's fold stays here.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSidebarFold as useFrameFold } from '@estiva-app/ui'
import { COMMENTS_HASH, routeOf, useHash } from '../route'

export type Fold = 'comments'

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

/** Whether the window is narrow now, kept current as it is resized: the last edit moves into the ⋯ menu (Katerina, 28 Oct). */
export function useNarrow(): boolean {
  const [is, setIs] = useState(narrow)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(NARROW)
    const changed = () => setIs(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  return is
}

function kept(): Partial<Record<Fold, boolean>> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    return value && typeof value === 'object' ? (value as Partial<Record<Fold, boolean>>) : {}
  } catch {
    return {}
  }
}

/**
 * Whether the page open now is a file, which a link may have opened: a file opened from a link shows where it lives,
 * so a folded sidebar unfolds for it (Katerina, 30 Oct; until then folded stayed folded across documents, Miky,
 * 28 Oct). Home keeps it folded.
 */
export function isFilePage(): boolean {
  return routeOf(window.location.pathname).page !== 'home'
}

/** Whether the sidebar is shown, and the setter that remembers it: the package's fold, with Leaf's key, files and width. */
export function useSidebarFold(): [boolean, (open: boolean) => void] {
  return useFrameFold({ storageKey: 'leaf.sidebarFolded', isFile: isFilePage, foldWhen: NARROW })
}

function keep(fold: Fold, folded: boolean) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...kept(), [fold]: folded }))
  } catch {
    // Storage refused (private mode, full): it folds for this visit only.
  }
}

/**
 * Open or folded, and the setter that remembers it. Arriving at a file's comments (`#comments`, where its comment
 * count opens) shows the comments column for this visit, folded or not: the count opens the conversation.
 */
export function useFold(fold: Fold): [boolean, (open: boolean) => void] {
  const asked = useHash() === COMMENTS_HASH && fold === 'comments'
  const [open, setOpen] = useState(() => {
    if (!now.has(fold)) now.set(fold, !narrow() && !kept()[fold])
    if (asked) now.set(fold, true)
    return now.get(fold) as boolean
  })
  // Each arrival once, during render as React asks: a column folded after arriving stays folded.
  const [arrived, setArrived] = useState(asked)
  if (arrived !== asked) {
    setArrived(asked)
    if (asked && !open) {
      now.set(fold, true)
      setOpen(true)
    }
  }
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      now.set(fold, next)
      keep(fold, !next)
    },
    [fold],
  )
  return [open, change]
}
