import { createContext, useContext, useEffect, useReducer } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { createPeopleCache, resolveForeignObjects, type ForeignObject } from '@estiva-app/interop'
import { readAbsence, referenceToPointer } from '@estiva-app/protocol'
import { query } from '../relay/bridge'
import { projections as manifests } from '../relay/manifests'
import { archivedWithOptions } from '../relay/projectFields'
import { unavailableLinks } from './linkMemory'

/** What each reference names: the file, `null` when it cannot be read, absent while it is being read. */
export type Resolved = Record<string, ForeignObject | null | undefined>

const people = createPeopleCache()
const known: Resolved = {}
/** A failed read is asked again this many times, after 5, 10 and 20 seconds. */
const RETRIES = 3
const RETRY_MS = 5000
/** After the last retry: read again this often, quietly, while the link says it is not available. */
const QUIET_MS = 30_000

/** The reads out now, by reference: a second chip or card asking for a file already being read waits for that read. */
const reading = new Map<string, Promise<void>>()
/** Every page and card holding read references, told when one is read again. */
const listeners = new Set<() => void>()

/** What a read answered, kept for the tab and noted for the next open: nothing, or a file this reader cannot read, is not available. */
function answered(uris: readonly string[], found: Record<string, ForeignObject | null | undefined>): void {
  const empty: string[] = []
  for (const uri of uris) {
    known[uri] = found[uri] ?? null
    failing.delete(uri)
    const readable = !!found[uri] && !found[uri]!.unreachable
    unavailableLinks.note(uri, readable)
    if (readable) deleted.delete(uri)
    else empty.push(uri)
  }
  askWhetherDeleted(empty)
}

/** References a trusted deletion names: "Issue deleted", not "Issue not available" (SPEC §13.6.1, deleted is not not-permitted). */
const deleted = new Set<string>()

/** Whether a trusted deletion names what `uri` names, as asked once its read came back empty. */
export function isDeleted(uri: string): boolean {
  return deleted.has(uri)
}

/** The address an `naddr` reference names, or nothing: no deletion names anything else by its address. */
function addressOfReference(uri: string): string | undefined {
  if (!/^nostr:naddr1/i.test(uri)) return undefined
  try {
    const { kind, pubkey, identifier } = referenceToPointer(uri)
    return `${kind}:${pubkey}:${identifier}`
  } catch {
    return undefined
  }
}

/**
 * Ask, for each reference whose read came back empty, whether a trusted deletion names it (protocol's `readAbsence`,
 * the read Peek and Ship make). A failed ask leaves it as it was: neither answer is known.
 */
function askWhetherDeleted(uris: readonly string[]): void {
  for (const uri of uris) {
    const address = addressOfReference(uri)
    if (!address) continue
    void readAbsence(address, query)
      .then((absence) => {
        if ((absence === 'deleted') === deleted.has(uri)) return
        if (absence === 'deleted') deleted.add(uri)
        else deleted.delete(uri)
        for (const listener of listeners) listener()
      })
      .catch(() => {})
  }
}

/**
 * The references whose reads still failed after the last retry: drawn as not
 * available — never a placeholder for good — and read again every 30 s, in
 * one read, until one answers. No Try again: it comes back on its own.
 */
const failing = new Set<string>()
let quiet: ReturnType<typeof setTimeout> | undefined
function readQuietly(): void {
  if (quiet !== undefined || failing.size === 0) return
  quiet = setTimeout(() => {
    quiet = undefined
    const uris = [...failing]
    void archivedWithOptions()
      .then((options) => resolveForeignObjects(uris, query, people.viaRelay(query), manifests, options))
      .then((found) => {
        answered(uris, found)
        for (const listener of listeners) listener()
      })
      .catch(() => {})
      .finally(readQuietly)
  }, QUIET_MS)
}

/**
 * Read one reference again, after a change from its card: the card then shows
 * what the relay now holds rather than what was chosen. A failed read keeps
 * what was known.
 */
export async function rereadReference(uri: string): Promise<void> {
  try {
    answered([uri], await resolveForeignObjects([uri], query, people.viaRelay(query), manifests, await archivedWithOptions()))
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

/** The files a page's references name, read once per tab and shared by every chip and card. */
export function useReferences(uris: readonly string[]): Resolved {
  const key = [...new Set(uris)].sort().join('\n')
  const [, landed] = useReducer((n: number) => n + 1, 0)
  const [attempt, retry] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(landed)
    return () => void listeners.delete(landed)
  }, [])
  useEffect(() => {
    const all = key ? key.split('\n') : []
    const missing = all.filter((uri) => !(uri in known))
    // Another chip or card's read: this one draws when it lands too, or reads again if it failed.
    const elsewhere = [...new Set(all.flatMap((uri) => (missing.includes(uri) ? [] : (reading.get(uri) ?? []))))]
    if (missing.length === 0 && elsewhere.length === 0) return
    let live = true
    let again: ReturnType<typeof setTimeout> | undefined
    for (const read of elsewhere) {
      void read.finally(() => {
        if (!live) return
        // Its read failed: read again on the same backoff as a read of this one's own.
        if (all.some((uri) => !(uri in known))) {
          if (attempt < RETRIES) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
        } else landed()
      })
    }
    if (missing.length === 0) return () => void (live = false)
    for (const uri of missing) known[uri] = undefined
    // With its parent's archive too: an issue in an archived project is read-only, so its card offers no pickers.
    // Each parent by the list read once the relay offers it: its current values, not every change (ALO-15).
    const read = archivedWithOptions()
      .then((options) => resolveForeignObjects(missing, query, people.viaRelay(query), manifests, options))
      .then((found) => answered(missing, found))
      .catch(() => {
        // Read again rather than say "cannot be read" for a dropped connection: a row or a card waits on it, not only a chip.
        if (attempt < RETRIES) {
          for (const uri of missing) delete known[uri]
          if (live) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
          return
        }
        // The last retry failed too: not available, and read again quietly from now on (widget review, item 41).
        for (const uri of missing) {
          known[uri] = null
          failing.add(uri)
        }
        readQuietly()
      })
      .finally(() => {
        for (const uri of missing) if (reading.get(uri) === read) reading.delete(uri)
        if (live) landed()
      })
    for (const uri of missing) reading.set(uri, read)
    return () => {
      live = false
      clearTimeout(again)
    }
  }, [key, attempt])
  // A new object on every draw, so a chip reading it through context draws again when a read lands. One this device
  // last found not available says so from the first paint while it is read, rather than a placeholder that shrinks.
  return Object.fromEntries((key ? key.split('\n') : []).map((uri) => [uri, known[uri] === undefined && unavailableLinks.has(uri) ? null : known[uri]]))
}

const References = createContext<Resolved>({})

/** Hands the page's read references to every chip inside the editor, whose node views React does not otherwise reach. */
export const ReferencesProvider = References.Provider

/**
 * The file one reference names: from the page's read when it holds it, else
 * read here, so a chip a pasted link became or the card under the comment box
 * still finds its file (COMM-8).
 */
export function useFile(uri: string): ForeignObject | null | undefined {
  const page = useContext(References)
  const own = useReferences(uri in page ? [] : [uri])
  return uri in page ? page[uri] : own[uri]
}

/** Every reference in the editor's document, so each chip and card has its file read. */
export function useEditorReferences(editor: Editor | null): Resolved {
  const key = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return ''
      const uris = new Set<string>()
      ed.state.doc.descendants((node) => {
        if (node.type.name === 'reference' && node.attrs.uri) uris.add(String(node.attrs.uri))
      })
      return [...uris].join('\n')
    },
  })
  return useReferences(key ? key.split('\n') : [])
}
