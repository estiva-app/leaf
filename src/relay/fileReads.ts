import { DOCUMENT_TYPE, FILE_KINDS, ISSUE_TYPE, PROJECT_TYPE, addressToPointer, relayFileReadsOf, type RelayFileReads } from '@estiva-app/protocol'
import { openFile, type QueryFn, type TimesFn } from '@estiva-app/interop'
import { RELAY_URL } from '../config'
import { queryTimes } from './bridge'

/**
 * How Leaf reads and writes files: one way, every file of every type kept in order by the relay (SPEC §6.13, ALL-8).
 * A list reads each file as its first record and its fields' current changes, a page opens with its current text,
 * every change names the change it follows, and a Delete is the file's `deleted` change.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/the-old-way-goes-once-miky-has-looked.md
 */

/** The kind a project is written as: protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850

/** The kind an issue is written as: protocol's `ISSUE_TYPE`. */
export const ISSUE_KIND = 30851

/** The kind a page is written as: protocol's `DOCUMENT_TYPE`. */
export const PAGE_KIND = 30842

const kindOf = (address: string | undefined): number | undefined => {
  const kind = Number(address?.split(':', 1)[0])
  return Number.isInteger(kind) ? kind : undefined
}

/**
 * Whether `address` names a file of the relay's file kinds (SPEC §6.13): a list reads it as its row only, its text
 * unread, so its page reads it again by its address before anything is drawn or written.
 */
export function isFileKind(address: string | undefined): boolean {
  const kind = kindOf(address)
  return kind !== undefined && FILE_KINDS.includes(kind)
}

/** The topics' and Home's times read (SPEC §6.13): when each file changed, never its changes. */
export const times: TimesFn = (filters) => queryTimes(filters)

/**
 * The change a file's next change to `field` follows (SPEC §6.2): that field's current change, or the file's first
 * record's id for its first change. Undefined when the file cannot be read: nothing is then written.
 */
export async function currentPrev(query: QueryFn, address: string, field: string): Promise<string | undefined> {
  let pointer
  try {
    pointer = addressToPointer(address)
  } catch {
    return undefined
  }
  const opened = await openFile(query, { kind: pointer.kind, pubkey: pointer.pubkey, d: pointer.identifier }, { text: false }).catch(() => undefined)
  return opened ? (opened.fields[field]?.id ?? opened.root.id) : undefined
}

/** The relay's NIP-11 document, which needs no sign-in; `null` in a build with no relay. */
async function relayInfo(): Promise<unknown> {
  if (!RELAY_URL) return null
  const res = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay information failed: ${res.status}`)
  return res.json()
}

let held: Promise<RelayFileReads | undefined> | undefined

/** The relay's file search from its NIP-11, read once per page; undefined (and asked again next time) when it cannot be read. */
function relayReads(): Promise<RelayFileReads | undefined> {
  held ??= Promise.resolve().then(relayInfo).then(
    (info) => {
      if (info === null) held = undefined
      return info === null ? undefined : relayFileReadsOf(info)
    },
    () => {
      held = undefined
      return undefined
    },
  )
  return held
}

/** Test seam: forget the relay's NIP-11, as a new page would. */
export function resetRelayReadsForTests(): void {
  held = undefined
}

const SEARCHED: readonly (readonly [string, number])[] = [
  [PROJECT_TYPE, PROJECT_KIND],
  [ISSUE_TYPE, ISSUE_KIND],
  [DOCUMENT_TYPE, PAGE_KIND],
]

/**
 * The kinds of projects, issues and pages the relay searches by their current words (`file_search.types`), so the
 * `[` picker finds a file by what it says now and never by an old change's words (ALO-6, ISS-6, ALL-4). Empty when
 * the relay's NIP-11 cannot be read: those are then found by their title.
 */
export async function searchedKinds(): Promise<number[]> {
  const search = (await relayReads())?.search ?? []
  return SEARCHED.flatMap(([type, kind]) => (search.includes(type) ? [kind] : []))
}
