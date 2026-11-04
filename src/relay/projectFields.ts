import { projectFieldsOf, relayFileReadsOf, type ProjectFields } from '@estiva-app/protocol'
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

let held: Promise<ProjectFields | undefined> | undefined

/**
 * Whether Leaf reads and writes projects by their fields (ALO-6, SPEC §6.13): Ship's switch, protocol's one rule for
 * the three apps — the relay announces it, or this tab opted in. The relay's NIP-11 is read once per page; signed out
 * it is asked again next time. Undefined is off: read and write as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export function projectFields(): Promise<ProjectFields | undefined> {
  // Asked inside the promise, so a read that throws is off, as a refused one is.
  held ??= Promise.resolve().then(relayInfo).then(
    (info) => {
      if (info === null) held = undefined
      return info === null ? undefined : projectFieldsOf(relayFileReadsOf(info), fieldsOptIn())
    },
    () => {
      held = undefined
      return undefined
    },
  )
  return held
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
