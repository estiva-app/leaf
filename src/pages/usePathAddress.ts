import { useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { addressOfPath, documentAddressOf, ownerBlockLinker, ownerPathOf } from '../fileAddress'
import { declaredManifests } from '../relay/manifests'
import { routeOf } from '../route'

/** Paths already known to name an address: the one Leaf just put in the address bar opens without a second read. */
const known = new Map<string, string>()

/**
 * Say that `path` (`/<word>/<ref>`) names `address`, before going there. A document's own link is known by its `d`,
 * as its route reads it, whatever slug is in front: a page read by its address gets its link before the tree lists
 * it, and must not be read again on arriving there (APP-3).
 */
export function rememberPath(path: string, address: string): void {
  const route = routeOf(path)
  known.set(route.page === 'document' ? `/document/${route.d}` : path, address)
}

/**
 * The address another app's path names (`/issue/<slug>-<d>` on Leaf's host), read once per path; `path` is null on
 * any other route. A path that names nothing, or a read that failed, is `address: null` once it is done. Leaf's own
 * `/document/<d>` is read by its `d`: a page no listing holds, such as an archived one (LED-4).
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
    void (word === 'document' ? documentAddressOf(ref) : addressOfPath(word, ref))
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

/**
 * Leaf's link to a block of another app's file (`ownerBlockLinker`), once the
 * manifests are read; undefined until then and when its app declares none.
 * `origin` puts another host in front: the file's own app's, for a part that
 * opens there. Read again only when the file is another one, not on each live
 * save of it.
 */
export function useOwnerBlockLinker(file: Pick<ForeignObject, 'kind' | 'address' | 'openUrl'> | null, origin?: string): ReturnType<typeof ownerBlockLinker> {
  const kind = file?.kind
  const address = file?.address
  const openUrl = file?.openUrl
  const key = kind !== undefined && address && openUrl ? `${kind} ${address} ${openUrl} ${origin ?? ''}` : null
  const [found, setFound] = useState<{ key: string; linker: ReturnType<typeof ownerBlockLinker> } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    void declaredManifests()
      .then((manifests) => ownerBlockLinker({ kind: kind!, address, openUrl }, manifests, origin))
      .catch(() => undefined)
      .then((linker) => {
        if (live) setFound({ key, linker })
      })
    return () => {
      live = false
    }
  }, [key, kind, address, openUrl, origin])
  return key && found?.key === key ? found.linker : undefined
}
