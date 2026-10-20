/**
 * What `/<word>/<ref>` on Leaf's host names, and which word a file is drawn
 * at: RFC 0.5 §7.7, Ship's `lib/handoff.ts` and `lib/typeWords.ts` (PRO-22)
 * with Leaf's relay.
 *
 * The path names the file and the host names the perspective: Ship's address
 * for an issue, with Leaf's host in front, is that issue, and Leaf draws it as
 * a page or, for a file it has no page for, hands off to its own app. Which
 * kind a word is, Leaf does not know: it is the `<type>` segment of a `urls`
 * shape some manifest publishes. Leaf's code holds no table of other apps'
 * words.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 */
import { blockUrlOf, eventIdFromRef, identifierFromRef, matchObjectUrl, objectRef, urlPatternsOf, type ForeignObject } from '@estiva-app/interop'
import { encodeNaddr } from '@estiva-app/protocol'
import { query } from './relay/bridge'
import { declaredManifests } from './relay/manifests'
import { isOtherAppsWord } from './route'

/** A published `kind:31990`, as far as words are concerned. */
export interface Manifest {
  tags: string[][]
}

interface FileShape {
  word: string
  kind: number
  pattern: string
}

/** How a path's file is looked for: by `#d` under some kinds, or by event id. */
export interface FileLookup {
  by: 'd' | 'id'
  identifier: string
  kinds: number[]
}

/** The `<type>` word of a `urls` pattern: `issue` out of `https://ship…/issue/<slug>-<d>`, `#/` routes included. */
function typeWordOf(pattern: string): string | null {
  const path = pattern.replace(/^[a-z]+:\/\/[^/?#]+/i, '').replace(/^\/?#/, '')
  const word = path.split(/[/?]/).filter(Boolean)[0]
  return word && !word.includes('<') ? word : null
}

function handledKinds(manifest: Manifest): number[] {
  return manifest.tags.filter((t) => t[0] === 'k').map((t) => Number(t[1])).filter(Number.isInteger)
}

/** A manifest's file shapes: those whose path carries the identity, not a thread inside a file. */
function fileShapesOf(manifest: Manifest): FileShape[] {
  return urlPatternsOf(manifest).flatMap((p) => {
    const [path, query = ''] = p.pattern.split('?')
    const word = typeWordOf(p.pattern)
    if (!word || !/<(d|id)>/.test(path) || /<[a-z]+>/.test(query)) return []
    return (p.kind !== undefined ? [p.kind] : handledKinds(manifest)).map((kind) => ({ word, kind, pattern: p.pattern }))
  })
}

/** `https://host` off a `urls` pattern, or null for one with no origin. */
function originOf(pattern: string): string | null {
  return /^https?:\/\/[^/?#]+/i.exec(pattern)?.[0] ?? null
}

/**
 * What `/<word>/<ref>` names, matched with the interop grammar on each
 * manifest's own host (rule 5), so the slug and the uuid tail read as every
 * consumer reads them. A word nobody declares falls back to every kind a
 * manifest declares a `<d>` shape for (rule 4), never a bare `#d`.
 */
export function lookupFor(word: string, ref: string, manifests: readonly Manifest[]): FileLookup | null {
  const path = `/${word}/${ref}`
  let found: FileLookup | null = null
  for (const manifest of manifests) {
    const patterns = urlPatternsOf(manifest)
    const origins = new Set(patterns.map((p) => originOf(p.pattern)).filter((o): o is string => !!o))
    for (const origin of origins) {
      const hit = matchObjectUrl(`${origin}${path}`, patterns)
      if (!hit || hit.within) continue
      if (found && (found.by !== hit.by || found.identifier !== hit.identifier)) continue
      found ??= { by: hit.by, identifier: hit.identifier, kinds: [] }
      if (hit.by === 'd') found.kinds.push(...(hit.kinds ?? (hit.kind !== undefined ? [hit.kind] : handledKinds(manifest))))
    }
  }
  if (found) return { ...found, kinds: [...new Set(found.kinds)] }

  const d = identifierFromRef(ref)
  if (d) {
    const kinds = manifests.flatMap((manifest) => fileShapesOf(manifest).filter((s) => s.pattern.split('?')[0].includes('<d>')).map((s) => s.kind))
    return kinds.length ? { by: 'd', identifier: d, kinds: [...new Set(kinds)] } : null
  }
  const id = eventIdFromRef(ref)
  return id ? { by: 'id', identifier: id, kinds: [] } : null
}

/**
 * The address `/<word>/<ref>` names, or null when it names no file Leaf can
 * open. **One author** holds the `d`: the query asks for two, and a `d` two
 * authors hold names nothing, so somebody publishing the same `(kind, d)`
 * cannot put their file at another's address. A message (`<id>`) is no file.
 */
export async function addressOfPath(word: string, ref: string): Promise<string | null> {
  const lookup = lookupFor(word, ref, await declaredManifests())
  if (!lookup || lookup.by !== 'd' || lookup.kinds.length === 0) return null
  const found = await query([{ kinds: lookup.kinds, '#d': [lookup.identifier], limit: 2 }])
  const authors = new Set(found.map((event) => `${event.kind}:${event.pubkey}`))
  return authors.size === 1 ? `${[...authors][0]}:${lookup.identifier}` : null
}

/** The `naddr` of an address `<kind>:<pubkey>:<d>`: what the tree and `/f/` know a file by. */
export function naddrOf(address: string): string {
  const [kind, pubkey, ...d] = address.split(':')
  return encodeNaddr({ kind: Number(kind), pubkey, identifier: d.join(':'), relays: [] })
}

/** The manifest whose NIP-89 `web` template made `url`: the app the file's "Open in" goes to (Ship's `manifestOfLink`). */
function manifestOfLink<M extends Manifest>(url: string, manifests: readonly M[]): M | undefined {
  return manifests.find((m) =>
    m.tags.some((t) => {
      if (t[0] !== 'web' || !t[1]?.includes('<bech32>')) return false
      const [before, after] = t[1].split('<bech32>')
      return url.startsWith(before) && url.endsWith(after) && url.length > before.length + after.length
    }),
  )
}

/**
 * Where another app's file is drawn on Leaf's host: `/<word>/<slug>-<d>`, the
 * word its own app declares for its kind (rule 4: drawn at its right type
 * word, the slug refreshed). The owner is the manifest the file's "Open in"
 * link came from, so no other relay member's 31990 chooses the word. Undefined
 * when that app declares no address for the kind.
 */
export function ownerPathOf(file: Pick<ForeignObject, 'kind' | 'address' | 'openUrl' | 'slots'>, manifests: readonly Manifest[]): string | undefined {
  if (!file.address || !file.openUrl) return undefined
  const owner = manifestOfLink(file.openUrl, manifests)
  /*
    Only a word Leaf's own route reads back as another app's: a manifest anyone may publish could otherwise name
    `document` (Leaf's page route, so every such file reads as not found) or `\evil.example`, which the URL parser
    takes for another origin and `replaceState` refuses with a throw.
  */
  const shape =
    owner &&
    fileShapesOf(owner).find((s) => s.kind === file.kind && isOtherAppsWord(s.word) && s.pattern.split('?')[0].includes('<d>') && !s.pattern.includes('#/'))
  if (!shape) return undefined
  const d = file.address.split(':').slice(2).join(':')
  return `/${shape.word}/${objectRef(d, file.slots.title?.value)}`
}

/**
 * Leaf's link to one block of another app's file (LTX-6): the block shape its
 * own app declares for its kind (Ship's `/issue/<slug>-<d>#block-<block>`),
 * with Leaf's host in front, so every reader takes it as that block and Leaf
 * opens it there. The owner is the manifest the file's "Open in" link came
 * from, as for `ownerPathOf`. Undefined when that app declares no block shape
 * for the kind (Peek's topics): there is then no link to copy.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 */
export function ownerBlockLinker(
  file: Pick<ForeignObject, 'kind' | 'address' | 'openUrl'>,
  manifests: readonly Manifest[],
  origin: string = window.location.origin,
): ((block: string, title?: string) => string | undefined) | undefined {
  const address = file.address
  const owner = address && file.openUrl ? manifestOfLink(file.openUrl, manifests) : undefined
  if (!address || !owner) return undefined
  const here = origin.replace(/\/+$/, '')
  // Only a word Leaf's own route reads back as another app's, for the reasons `ownerPathOf` gives.
  const shapes = urlPatternsOf(owner).flatMap((p) => {
    const at = originOf(p.pattern)
    const word = typeWordOf(p.pattern)
    return at && word && isOtherAppsWord(word) && p.kind === file.kind && p.pattern.includes('#block-<block>') ? [{ ...p, pattern: here + p.pattern.slice(at.length) }] : []
  })
  if (!shapes.length) return undefined
  const d = address.split(':').slice(2).join(':')
  return (block, title) => blockUrlOf(shapes, { kind: file.kind, d, title, block })
}
