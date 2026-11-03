import { useState } from 'react'
import { useFold } from '../frame/folds'
import { COMMENTS_HASH, useHash } from '../route'

/** A thing the column beside the page holds, and the header's button that shows or hides it. */
export interface Shown {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The column beside a page holds one thing at a time: its comments, its Overview, or nothing (Katerina, 3 November;
 * ONE-5, step 5), as Ship's does (ONE-6, step 4d). Showing one puts the other away; hiding the Overview brings back
 * what the column held before it.
 *
 * What is Leaf's: the comments' fold is remembered on this browser, across documents and reloads, and a narrow window
 * opens with it folded (LED-3, `useFold`), as before. The Overview is not remembered, as Ship's is not. While it is
 * shown the comments' fold is left as it was: that is what comes back when it is hidden, and what a reload opens on.
 * Arriving at a file's comments (`#comments`, where a comment count opens) shows them, the Overview put away.
 */
export function useSideColumn(): { comments: Shown; overview: Shown } {
  const [commentsOpen, setCommentsOpen] = useFold('comments')
  const [overview, setOverview] = useState(false)
  // Each arrival once, during render as React asks, as the fold does its own.
  const asked = useHash() === COMMENTS_HASH
  const [arrived, setArrived] = useState(asked)
  if (arrived !== asked) {
    setArrived(asked)
    if (asked) setOverview(false)
  }
  return {
    comments: {
      open: commentsOpen && !overview,
      onOpenChange: (open) => {
        if (open) {
          setOverview(false)
          setCommentsOpen(true)
        } else if (!overview) setCommentsOpen(false)
      },
    },
    overview: { open: overview, onOpenChange: setOverview },
  }
}
