import { useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { readDocument } from '../document/save'

/**
 * A file opened by its `/f/<naddr>` address that no listing holds: an issue whose project row was never opened, or
 * one reloaded on its own page. Read by its address once the tree has been read without it; `naddr` is null while
 * the tree still holds the file or is still reading.
 */
export function useFileByAddress(naddr: string | null): { file: ForeignObject | null; loading: boolean } {
  const [read, setRead] = useState<{ naddr: string; file: ForeignObject | null } | null>(null)
  useEffect(() => {
    if (!naddr) return
    let live = true
    void readDocument(naddr)
      .catch(() => null)
      .then((file) => {
        if (live) setRead({ naddr, file })
      })
    return () => {
      live = false
    }
  }, [naddr])
  if (!naddr) return { file: null, loading: false }
  return read?.naddr === naddr ? { file: read.file, loading: false } : { file: null, loading: true }
}
