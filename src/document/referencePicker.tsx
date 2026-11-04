/**
 * What `[` offers on a Leaf page (SUM-7): files only — a page has no messages
 * — and in a comment box, files then its messages (Katerina, 30 Oct); ranked by `@estiva-app/conversation`'s
 * `rankReferences`, in its `referenceSectionsOf` order, as Peek and Ship draw them. Ship's `api/references.ts` is the
 * template.
 *
 * - **This Folder's files**, the listing the tree already read, then, once you
 *   type, **relay search**. Leaf keeps no read markers, so there is no
 *   recently-read tier. The page you are on is never offered.
 * - A file's summary is the row's second line, and an issue's `ref · project`
 *   moves up beside its title; a file with none keeps today's row.
 *
 * The editor asks synchronously on every keystroke, so the tiers are held here
 * and kept fresh by the page ({@link useReferencePage}); a tier or a search
 * landing tells the open list to draw again ({@link subscribeReferences}).
 */
import { useEffect } from 'react'
import { FILE_TIER, KIND_COMMENT, MESSAGE_TIER, messageCandidate, rankReferences, referenceSearch, referenceSectionsOf, type ReferenceCandidate } from '@estiva-app/conversation'
import { fileCandidates, searchFileReferences, type ForeignObject } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { LinkedIcon } from '@estiva-app/ui'
import type { CaptionedItem, ReferenceTriggerOptions } from '@estiva-app/ui/editor'
import { projections as manifests } from '../relay/manifests'
import { links } from '../comments/links'
import { linkedKindOf } from './linked'
import { query } from '../relay/bridge'

type ReferenceSection = ReturnType<NonNullable<ReferenceTriggerOptions['sections']>>[number]

/** The list's name and its one heading. */
export const REFERENCE_COPY = { ariaLabel: 'Files', files: 'Files', messages: 'Messages' }

// A Folder's rows, built once per listing the tree read: every page in it offers the same ones.
const BUILT = new WeakMap<readonly ForeignObject[], Promise<ReferenceCandidate[]>>()
function folderRows(folder: readonly ForeignObject[]): Promise<ReferenceCandidate[]> {
  let rows = BUILT.get(folder)
  if (!rows) {
    rows = fileCandidates(folder, FILE_TIER.folder, query, { cache: manifests })
    // A refused read is tried again on the next page, not remembered.
    rows.catch(() => BUILT.delete(folder))
    BUILT.set(folder, rows)
  }
  return rows
}

let folderFiles: ReferenceCandidate[] = []
let openFile: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

const search = referenceSearch({ search: (text) => searchFileReferences(text, query, { cache: manifests }) })

/**
 * Called while `[`'s list is open; told when the Folder's files or a search answer changes, or what an app link
 * names comes back, so a comment's caption reads that link as what it names.
 */
export function subscribeReferences(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = search.subscribe(listener)
  const unlinked = links.changed(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
    unlinked()
  }
}

/**
 * One row of `[`'s list, a file's or a message's alike. A message is its
 * author with its opening words; a file its title, what it is in, its summary,
 * and its kind's icon — a document is a page of text, not a generic file.
 */
function itemOf(candidate: ReferenceCandidate): CaptionedItem {
  if (candidate.type === 'message') {
    return { id: candidate.id, label: candidate.title, snippet: candidate.caption, uri: candidate.uri, ...(candidate.search ? { search: candidate.search } : {}) }
  }
  return {
    id: candidate.id,
    label: candidate.title,
    snippet: '',
    uri: candidate.uri,
    description: candidate.caption || undefined,
    summary: candidate.summary,
    icon: <LinkedIcon kind={linkedKindOf(candidate.kind)} tone="secondary" />,
  }
}

/** The one section `[` draws for what was typed. */
export function referenceSections(typed: string): ReferenceSection[] {
  return [{ label: REFERENCE_COPY.files, items: rankedFiles(typed, []).files.map(itemOf) }]
}

function rankedFiles(typed: string, messages: readonly ReferenceCandidate[]) {
  return rankReferences({
    messages,
    files: [...folderFiles, ...search.hits(typed)],
    query: typed,
    ownKinds: [KIND.DOCUMENT],
    exclude: openFile ? [openFile] : [],
  })
}

/** A comment `[` can offer, as the column holds it. */
export interface ReferableComment {
  id: string
  by: string
  /** When it was written, in ms. */
  at: number
  body: string
}

/**
 * A page's comments as `[`'s rows, the package's `messageCandidate` as Peek and
 * Ship build theirs: the author, the opening words with an app link read as
 * what it names, and found by their own words, not a link's raw text.
 */
const messageRows = (comments: readonly ReferableComment[], tier: number, nameOf: (pubkey: string) => string | undefined): ReferenceCandidate[] =>
  // The rows take seconds, as every app's do.
  comments.map((c) => messageCandidate({ id: c.id, kind: KIND_COMMENT, author: nameOf(c.by) ?? 'Someone', body: c.body, at: Math.floor(c.at / 1000) }, tier, nameOf, { resolveLink: links.known }))

/**
 * What `[` offers in a comment box: Files, then Messages (Katerina, 30 Oct),
 * in the package's order (`referenceSectionsOf`). A reply's box offers its own
 * thread's comments first, then the rest of the page's; a new comment's box
 * offers the page's (`here`, with nothing after it), as Ship's boxes do. Files
 * are the page's: this Folder's, then relay search, never the page itself.
 */
export function commentReferenceSections(
  scope: { here: readonly ReferableComment[]; rest: readonly ReferableComment[] },
  typed: string,
  nameOf: (pubkey: string) => string | undefined,
): ReferenceSection[] {
  const ranked = rankedFiles(typed, [...messageRows(scope.here, MESSAGE_TIER.here, nameOf), ...messageRows(scope.rest, MESSAGE_TIER.parent, nameOf)])
  return referenceSectionsOf(ranked).map(({ name, items }) => ({ label: REFERENCE_COPY[name], items: items.map(itemOf) }))
}

/**
 * Publishes what the page knows as `[`'s tiers, and takes it back when the page
 * goes: the file on screen (never offered) and its Folder's files, as the tree
 * read them.
 */
export function useReferencePage({ address, folder }: { address: string | undefined; folder: readonly ForeignObject[] | undefined }) {
  useEffect(() => {
    openFile = address ?? null
    return () => {
      openFile = null
    }
  }, [address])

  /*
    A refresh of the same Folder keeps its rows until the new answer lands;
    leaving the page takes them back, so another page — even in the same Folder,
    whose listing is the same array — puts them back here.
  */
  useEffect(() => {
    if (!folder) return
    let live = true
    folderRows(folder)
      .then((rows) => {
        if (!live) return
        folderFiles = rows
        notify()
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [folder, address])
  useEffect(
    () => () => {
      folderFiles = []
      notify()
    },
    [address],
  )
}
