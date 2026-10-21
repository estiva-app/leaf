import { createContext, useContext, useEffect, useReducer } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { createPeopleCache, createProjectionCache, resolveForeignObjects, type ForeignObject } from '@estiva-app/interop'
import { query } from '../relay/bridge'

/** What each reference names: the file, `null` when it cannot be read, absent while it is being read. */
export type Resolved = Record<string, ForeignObject | null | undefined>

const manifests = createProjectionCache()
const people = createPeopleCache()
const known: Resolved = {}
/** A failed read is asked again this many times, after 5, 10 and 20 seconds. */
const RETRIES = 3
const RETRY_MS = 5000

/** The reads out now, by reference: a second chip or card asking for a file already being read waits for that read. */
const reading = new Map<string, Promise<void>>()
/** Every page and card holding read references, told when one is read again. */
const listeners = new Set<() => void>()

/**
 * Read one reference again, after a change from its card: the card then shows
 * what the relay now holds rather than what was chosen. A failed read keeps
 * what was known.
 */
export async function rereadReference(uri: string): Promise<void> {
  try {
    const found = await resolveForeignObjects([uri], query, people.viaRelay(query), manifests, { archivedWith: true })
    known[uri] = found[uri] ?? null
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
    const read = resolveForeignObjects(missing, query, people.viaRelay(query), manifests, { archivedWith: true })
      .then((found) => {
        for (const uri of missing) known[uri] = found[uri] ?? null
      })
      .catch(() => {
        // Read again rather than say "cannot be read" for a dropped connection: a row or a card waits on it, not only a chip.
        for (const uri of missing) delete known[uri]
        if (live && attempt < RETRIES) again = setTimeout(retry, RETRY_MS * 2 ** attempt)
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
  // A new object on every draw, so a chip reading it through context draws again when a read lands.
  return Object.fromEntries((key ? key.split('\n') : []).map((uri) => [uri, known[uri]]))
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
