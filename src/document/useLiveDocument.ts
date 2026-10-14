import { useEffect, useRef, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { relayClient } from '../relay/client'
import { viewerPubkey } from '../relay/bridge'
import { CHANGE, nameOf, readDocument } from './save'

/** Who saved the document's text last, when it was not you: the name in "<name> saved a newer version". */
export type ChangedBy = { pubkey: string; name: string | null }

/**
 * The open document, kept current: someone else's save arrives on the tab's
 * one connection (a `1851` naming this document, in its Folder) and the
 * document is read again on its own, so their text is on the page without a
 * reload. Your own save arrives the same way; the editor tells the two apart.
 */
export function useLiveDocument(opened: ForeignObject): { file: ForeignObject; changedBy: ChangedBy | null } {
  const [read, setRead] = useState<{ file: ForeignObject } | null>(null)
  const [changedBy, setChangedBy] = useState<ChangedBy | null>(null)
  const seen = useRef(new Set<string>())
  const { address, folder, naddr } = opened

  useEffect(() => {
    const client = relayClient()
    if (!client || !address || !folder || !naddr) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const me = viewerPubkey()
    // Several changes in a burst — a title and a body saved together — are one read.
    const reread = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void readDocument(naddr).then((file) => {
          if (live && file) setRead({ file })
        })
      }, 250)
    }
    // The tree read this document when Leaf opened, maybe long ago: read it fresh now, so a save made since is not written over.
    void readDocument(naddr).then((file) => {
      if (live && file) setRead((was) => was ?? { file })
    })
    const watch = client.watchFolders(
      [folder],
      (_folder, event) => {
        if (!event || event.kind !== CHANGE || seen.current.has(event.id)) return
        if (!event.tags.some((t) => t[0] === 'a' && t[1] === address)) return
        seen.current.add(event.id)
        if (event.pubkey !== me && event.tags.some((t) => t[0] === 'field' && t[1] === 'description')) {
          const pubkey = event.pubkey
          setChangedBy({ pubkey, name: null })
          void nameOf(pubkey).then((name) => {
            if (live) setChangedBy((by) => (by?.pubkey === pubkey ? { pubkey, name } : by))
          })
        }
        reread()
      },
      // Only what is saved from now: what came before is in the document as it was read.
      { kinds: [CHANGE], since: Math.floor(Date.now() / 1000) },
    )
    return () => {
      live = false
      clearTimeout(timer)
      watch.stop()
    }
  }, [address, folder, naddr])

  // The page is keyed by the document's address, so a read here is always this document's.
  return { file: read?.file ?? opened, changedBy }
}
