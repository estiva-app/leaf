import { createContext, useContext, useEffect, useReducer } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { createPeopleCache, resolveForeignObjects, resolveForeignRoots, type ForeignObject } from '@estiva-app/interop'
import { FILE_KINDS, KIND, readAbsence, referenceToPointer } from '@estiva-app/protocol'
import { query } from '../relay/bridge'
import { projections as manifests } from '../relay/manifests'
import { archivedRootsOptions, archivedWithOptions } from '../relay/projectFields'
import { unavailableLinks } from './linkMemory'

/** What each reference names: the file, `null` when it cannot be read, absent while it is being read. */
export type Resolved = Record<string, ForeignObject | null | undefined>

const people = createPeopleCache()
/** What each file was read as, by its address (or its reference, for one that names none): see {@link keyOf}. */
const known: Resolved = {}
/** A failed read is asked again this many times, after 5, 10 and 20 seconds. */
const RETRIES = 3
const RETRY_MS = 5000
/** After the last retry: read again this often, quietly, while the link says it is not available. */
const QUIET_MS = 30_000

/** The reads out now, by {@link keyOf}: a second chip or card asking for a file already being read waits for that read. */
const reading = new Map<string, Promise<void>>()
/** Every page and card holding read references, told when one is read again. */
const listeners = new Set<() => void>()

/** What a read answered, kept for the tab and noted for the next open: nothing, or a file this reader cannot read, is not available. */
function answered(uris: readonly string[], found: Record<string, ForeignObject | null | undefined>): void {
  const empty: string[] = []
  for (const uri of uris) {
    known[keyOf(uri)] = found[uri] ?? null
    failing.delete(uri)
    const readable = !!found[uri] && !found[uri]!.unreachable
    unavailableLinks.note(uri, readable)
    if (readable) deleted.delete(keyOf(uri))
    else empty.push(uri)
  }
  askWhetherDeleted(empty)
}

/** References a trusted deletion names, by {@link keyOf}: "Issue deleted", not "Issue not available" (SPEC §13.6.1, deleted is not not-permitted). */
const deleted = new Set<string>()

/** Whether a trusted deletion names what `uri` names, as asked once its read came back empty. */
export function isDeleted(uri: string): boolean {
  return deleted.has(keyOf(uri))
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

const keys = new Map<string, string>()
/**
 * What a reference is read and kept by: the address it names, so two spellings of one file's link (with relay hints
 * and without, a link's and a mention's) share one read (ALO-24: one project's card was read twice in one open), or
 * the reference itself when it names no address.
 */
function keyOf(uri: string): string {
  let key = keys.get(uri)
  if (key === undefined) keys.set(uri, (key = addressOfReference(uri) ?? uri))
  return key
}

/** The kinds a card draws by their current fields alone, read by the list read once switched: a topic's card draws its messages. */
const LISTED_KINDS = FILE_KINDS.filter((kind) => kind !== KIND.FILE)

/** A file's events once each: the relay answers every filter on its own, so an issue asked by its own card and as its project's comes back twice. */
function onceEach(children: readonly ForeignObject[]): ForeignObject[] {
  const seen = new Set<string | undefined>()
  return children.filter((child) => !seen.has(child.address) && !!seen.add(child.address))
}

/** Every key a file draws as a person, as interop's full read names them: its person fields, controls and deleter. */
function pubkeysOf(object: ForeignObject): string[] {
  const found: string[] = []
  for (const slot of [...Object.values(object.slots), ...object.meta]) if (slot.isPubkey && slot.value) found.push(slot.value)
  for (const action of object.actions) if (action.control === 'pubkey' && action.current) found.push(action.current)
  if (object.deleted) found.push(object.deleted.by)
  return found
}

/**
 * Files by the list read (SPEC §6.13): each as it is now, its first record and its fields' newest changes, with its
 * own files under it (a project's issues) the same way, and the people they name in one lookup, because the list
 * read names nobody. Not every change ever made to it, nor its comments: a card draws neither, and counts its
 * comments with a read of its own (`useCardConversation`). Ship's cards read the same way (ALO-23). A file the list
 * read leaves out (deleted, or not readable here) is `null`, as the full read's.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
async function readListed(uris: readonly string[]): Promise<Resolved> {
  const addresses = uris.map(keyOf)
  const objects = await resolveForeignRoots(addresses, query, manifests, { archivedWith: true, listRead: true, children: true })
  const named = [...new Set(objects.flatMap((object) => [object, ...(object.children ?? [])].flatMap(pubkeysOf)))]
  const found = named.length ? await people.viaRelay(query)(named).catch(() => ({})) : {}
  const byAddress = new Map(
    objects.map((object) => [
      object.address,
      { ...object, people: found, ...(object.children ? { children: onceEach(object.children).map((child) => ({ ...child, people: found })) } : {}) },
    ]),
  )
  // One the list read leaves out (deleted, or in a team this reader is not in) by its full read, which costs little when
  // the relay holds nothing to send: it still names the file's app and kind, "Issue · you can't open it", not a blank.
  const left = uris.filter((uri) => !byAddress.has(keyOf(uri)))
  const full = left.length ? await readFull(left) : {}
  return Object.fromEntries(uris.map((uri) => [uri, byAddress.get(keyOf(uri)) ?? full[uri] ?? null]))
}

/** The files `uris` name, each with its every change and comments: interop's full read, as every card read before ALO-24. */
async function readFull(uris: readonly string[]): Promise<Resolved> {
  return resolveForeignObjects(uris, query, people.viaRelay(query), manifests, await archivedWithOptions())
}

/**
 * The files `uris` name: a project, issue or document by the list read once the relay keeps files in order
 * ({@link readListed}); anything else (a topic, an event, a relay not switched) by its full read, as before.
 */
async function readNow(uris: readonly string[]): Promise<Resolved> {
  const { listRead } = await archivedRootsOptions()
  const listed = listRead ? uris.filter((uri) => LISTED_KINDS.some((kind) => keyOf(uri).startsWith(`${kind}:`))) : []
  const rest = uris.filter((uri) => !listed.includes(uri))
  const [full, current] = await Promise.all([rest.length ? readFull(rest) : {}, listed.length ? readListed(listed) : {}])
  return { ...full, ...current }
}

/** The references asked in this moment, and their one read. */
let batch: { uris: Set<string>; read: Promise<Resolved> } | undefined

/**
 * The files `uris` name, in one read with every other chip, row and card asking in the same moment: a page's comments
 * mount their cards a few at a time, and each asked on its own (ALO-24). Every asker gets the whole read's answer.
 */
function readFiles(uris: readonly string[]): Promise<Resolved> {
  if (!batch) {
    const asked = new Set<string>()
    // After this render's effects, so every component it mounts has asked before the read goes, and no later.
    const read = Promise.resolve().then(() => {
      batch = undefined
      return readNow([...asked])
    })
    batch = { uris: asked, read }
  }
  for (const uri of uris) batch.uris.add(uri)
  return batch.read
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
        if ((absence === 'deleted') === deleted.has(address)) return
        if (absence === 'deleted') deleted.add(address)
        else deleted.delete(address)
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
    void readNow(uris)
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
    answered([uri], await readNow([uri]))
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
    // One reference per file: a second spelling of a file already asked waits for that read.
    const missing = [...new Map(all.filter((uri) => !(keyOf(uri) in known)).map((uri) => [keyOf(uri), uri])).values()]
    const asked = new Set(missing.map(keyOf))
    // Another chip or card's read: this one draws when it lands too, or reads again if it failed.
    const elsewhere = [...new Set(all.flatMap((uri) => (asked.has(keyOf(uri)) ? [] : (reading.get(keyOf(uri)) ?? []))))]
    if (missing.length === 0 && elsewhere.length === 0) return
    let live = true
    let again: ReturnType<typeof setTimeout> | undefined
    for (const read of elsewhere) {
      void read.finally(() => {
        if (!live) return
        // Its read failed: read again on the same backoff as a read of this one's own.
        if (all.some((uri) => !(keyOf(uri) in known))) {
          if (attempt < RETRIES) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
        } else landed()
      })
    }
    if (missing.length === 0) return () => void (live = false)
    for (const key of asked) known[key] = undefined
    // With its parent's archive too: an issue in an archived project is read-only, so its card offers no pickers.
    // A project, issue or document as it is now, with every card asking in this moment (ALO-24).
    const read = readFiles(missing)
      .then((found) => answered(missing, found))
      .catch(() => {
        // Read again rather than say "cannot be read" for a dropped connection: a row or a card waits on it, not only a chip.
        if (attempt < RETRIES) {
          for (const key of asked) delete known[key]
          if (live) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
          return
        }
        // The last retry failed too: not available, and read again quietly from now on (widget review, item 41).
        for (const uri of missing) {
          known[keyOf(uri)] = null
          failing.add(uri)
        }
        readQuietly()
      })
      .finally(() => {
        for (const key of asked) if (reading.get(key) === read) reading.delete(key)
        if (live) landed()
      })
    for (const key of asked) reading.set(key, read)
    return () => {
      live = false
      clearTimeout(again)
    }
  }, [key, attempt])
  // A new object on every draw, so a chip reading it through context draws again when a read lands. One this device
  // last found not available says so from the first paint while it is read, rather than a placeholder that shrinks.
  return Object.fromEntries((key ? key.split('\n') : []).map((uri) => [uri, known[keyOf(uri)] === undefined && unavailableLinks.has(uri) ? null : known[keyOf(uri)]]))
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
