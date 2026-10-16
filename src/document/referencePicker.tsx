/**
 * What `[` offers on a Leaf page (SUM-7): files only — a page has no messages
 * — ranked by `@estiva-app/conversation`'s `rankReferences`, the order Peek and
 * Ship draw too. Ship's `api/references.ts` is the template.
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
import { FILE_TIER, rankReferences, referenceSearch, type ReferenceCandidate } from '@estiva-app/conversation'
import { createProjectionCache, fileCandidates, searchFileReferences, type ForeignObject } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { KindIcon, thingKindOf } from '@estiva-app/ui'
import type { CaptionedItem, ReferenceTriggerOptions } from '@estiva-app/ui/editor'
import { query } from '../relay/bridge'

type ReferenceSection = ReturnType<NonNullable<ReferenceTriggerOptions['sections']>>[number]

/** The list's name and its one heading. */
export const REFERENCE_COPY = { ariaLabel: 'Files', files: 'Files' }

const manifests = createProjectionCache()

let folderFiles: ReferenceCandidate[] = []
let openFile: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

const search = referenceSearch({ search: (text) => searchFileReferences(text, query, { cache: manifests }) })

/** Called while `[`'s list is open; told when the Folder's files or a search answer changes. */
export function subscribeReferences(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = search.subscribe(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
  }
}

function itemOf(candidate: ReferenceCandidate): CaptionedItem {
  return {
    id: candidate.id,
    label: candidate.title,
    snippet: '',
    uri: candidate.uri,
    description: candidate.caption || undefined,
    summary: candidate.summary,
    // What it is, as the tree's rows and the chips say it.
    icon: <KindIcon kind={thingKindOf(candidate.kind)} tone="secondary" />,
  }
}

/** The one section `[` draws for what was typed. */
export function referenceSections(typed: string): ReferenceSection[] {
  const ranked = rankReferences({
    messages: [],
    files: [...folderFiles, ...search.hits(typed)],
    query: typed,
    ownKinds: [KIND.DOCUMENT],
    exclude: openFile ? [openFile] : [],
  })
  return [{ label: REFERENCE_COPY.files, items: ranked.files.map(itemOf) }]
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

  // A refresh of the same Folder keeps its rows until the new answer lands; leaving the page takes them back.
  useEffect(() => {
    if (!folder) return
    let live = true
    fileCandidates(folder, FILE_TIER.folder, query, { cache: manifests })
      .then((rows) => {
        if (!live) return
        folderFiles = rows
        notify()
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [folder])
  useEffect(
    () => () => {
      folderFiles = []
      notify()
    },
    [address],
  )
}
