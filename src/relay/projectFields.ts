import { projectFieldsOf, relayFileReadsOf, type ProjectFields, type RelayFileReads } from '@estiva-app/protocol'
import { RELAY_URL } from '../config'
import { fieldsOptIn } from './fieldsOptIn'

/** The relay's NIP-11 document, which needs no sign-in; `null` in a build with no relay. */
async function relayInfo(): Promise<unknown> {
  if (!RELAY_URL) return null
  const res = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay information failed: ${res.status}`)
  return res.json()
}

/** The kind a project is written as: the type the switch names, protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850

let held: Promise<RelayFileReads | undefined> | undefined

/** The relay's file reads from its NIP-11, read once per page; undefined (and asked again next time) when it cannot be read. */
function relayReads(): Promise<RelayFileReads | undefined> {
  // Asked inside the promise, so a read that throws is off, as a refused one is.
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

/**
 * Whether Leaf reads and writes projects by their fields (ALO-6, SPEC §6.13): Ship's switch, protocol's one rule for
 * the three apps — the relay announces it, or this tab opted in. The relay's NIP-11 is read once per page; signed out
 * it is asked again next time. Undefined is off: read and write as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export async function projectFields(): Promise<ProjectFields | undefined> {
  const reads = await relayReads()
  return reads ? projectFieldsOf(reads, fieldsOptIn()) : undefined
}

/**
 * Whether the relay answers the list read (SPEC §6.13), switched or not: finding a file's parents, and whether one of
 * them is archived, then reads each parent's current values rather than its every change (ALO-15).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function listReadOffered(): Promise<boolean> {
  return (await relayReads())?.list === true
}

/**
 * `resolveForeignRoots`' `{ archivedWith: true }`, with its `listRead` once switched. There `listRead` reads the files
 * themselves by the list read too (no text, a deleted one left out), not only the parents walked, so it waits for the
 * switch as Peek's root reads do.
 */
export async function archivedRootsOptions(): Promise<{ archivedWith: true; listRead?: true }> {
  return (await projectFields()) ? { archivedWith: true, listRead: true } : { archivedWith: true }
}

/** `{ archivedWith: true }`, with interop's `listRead` once the relay offers it: each parent walked costs its current values. */
export async function archivedWithOptions(): Promise<{ archivedWith: true; listRead?: true }> {
  return (await listReadOffered()) ? { archivedWith: true, listRead: true } : { archivedWith: true }
}

/** Whether `address` names a project: the one kind the switch covers. */
export function isProject(address: string | undefined): boolean {
  return !!address && address.startsWith(`${PROJECT_KIND}:`)
}

/** Whether `address` is a project read and written by its fields in this tab. */
export async function byFields(address: string | undefined): Promise<boolean> {
  return isProject(address) && !!(await projectFields())
}

/** The kinds the open read opens, for interop's `openRead`: projects once switched. */
export async function openReadOption(): Promise<{ openRead?: readonly number[] }> {
  return (await projectFields()) ? { openRead: [PROJECT_KIND] } : {}
}
