import { useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { addressOfPath, ownerPathOf } from '../fileAddress'
import { declaredManifests } from '../relay/manifests'

/** Paths already known to name an address: the one Leaf just put in the address bar opens without a second read. */
const known = new Map<string, string>()

/** Say that `path` (`/<word>/<ref>`) names `address`, before going there. */
export function rememberPath(path: string, address: string): void {
  known.set(path, address)
}

/**
 * The address another app's path names (`/issue/<slug>-<d>` on Leaf's host), read once per path; `path` is null on
 * any other route. A path that names nothing, or a read that failed, is `address: null` once it is done.
 */
export function usePathAddress(path: { word: string; ref: string } | null): { address: string | null; loading: boolean } {
  const word = path?.word
  const ref = path?.ref
  const key = word && ref ? `/${word}/${ref}` : null
  const [read, setRead] = useState<{ key: string; address: string | null } | null>(null)
  useEffect(() => {
    if (!word || !ref) return
    const at = `/${word}/${ref}`
    if (known.has(at)) return
    let live = true
    void addressOfPath(word, ref)
      .catch(() => null)
      .then((address) => {
        if (address) known.set(at, address)
        if (live) setRead({ key: at, address })
      })
    return () => {
      live = false
    }
  }, [word, ref])
  if (!key) return { address: null, loading: false }
  const remembered = known.get(key)
  if (remembered) return { address: remembered, loading: false }
  return read?.key === key ? { address: read.address, loading: false } : { address: null, loading: true }
}

/** Where another app's file is drawn on Leaf's host (`ownerPathOf`), once the manifests are read; null until then. */
export function useOwnerPath(file: ForeignObject | null): string | null {
  const [found, setFound] = useState<{ file: ForeignObject; path: string | null } | null>(null)
  useEffect(() => {
    if (!file) return
    let live = true
    void declaredManifests()
      .then((manifests) => ownerPathOf(file, manifests) ?? null)
      .catch(() => null)
      .then((path) => {
        if (live) setFound({ file, path })
      })
    return () => {
      live = false
    }
  }, [file])
  return file && found?.file === file ? found.path : null
}
