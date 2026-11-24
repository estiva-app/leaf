import {
  buildActionEvents,
  createFile,
  createPeopleCache,
  folderOf,
  KIND_CHANNEL_METADATA,
  KIND_FOLDER_STATE,
  openFile,
  resolveActingManifest,
  resolveForeignObject,
  resolveManifest,
  TEXT_FIELD,
  type ResolvedAction,
} from '@estiva-app/interop'
import type { CreatableKindRead, LauncherApplied, LauncherApply } from '@estiva-app/launcher'
import { KIND, pointerToAddress, referenceToPointer, type AddressPointer, type UnsignedEvent } from '@estiva-app/protocol'
import { relayStates } from '../document/fileMenu'
import { readFolders } from '../folders/workspace'
import { changeWriter, publish, query, viewerPubkey } from '../relay/bridge'
import { projections as manifests } from '../relay/manifests'

const people = createPeopleCache()

/*
  KIN-11 — Leaf's ⌘K makes another app's file in Leaf by following the action that app's manifest declares, as Peek's
  ⌘K does: Ship's Create issue and Create project, signed by the person in Leaf, and the page stays open.
  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-app-makes-another-apps-file-in-place-from-its-declared-action.md

  Only creations: Leaf's ⌘K offers no change to another app's file (the launcher offers none where the app says what it
  may sign). The steps are Peek's `creatableUnderAsViewer` and `applyActionAsViewer` for a creation, on interop's
  runtime, so the events are the ones Peek's ⌘K and Ship's own forms write.
*/

/** Ship's project and issue: the other app's files Leaf may make (Estiva ID's allowed kinds for Leaf, KIN-11). */
export const SHIP_PROJECT = 30850
export const SHIP_ISSUE = 30851

/** A change to a file's field (SPEC §6.2): the only kind a new file's text goes out as. */
const FILE_CHANGE = 1851

/** The kinds Leaf signs as a file: its documents, and the Ship files its ⌘K makes. */
const FILE_KINDS_LEAF_MAKES = new Set<number>([KIND.DOCUMENT, SHIP_PROJECT, SHIP_ISSUE])

/** Whether Leaf may sign an event of this kind from its ⌘K: a file it makes, never another (a topic, a message). */
export function leafMaySign(kind: number): boolean {
  return FILE_KINDS_LEAF_MAKES.has(kind)
}

/**
 * What can be created under each of the newest files of this kind, and where: the actions the kind's owner and the
 * other apps declare on it, with the files themselves as the choices of where it goes (an issue's project), and the
 * teams for a creation on a team (a project). Null when there is none to read.
 */
export async function creatableUnder(parentKind: number, limit = 50): Promise<CreatableKindRead | null> {
  const roots = await query([{ kinds: [parentKind], limit }])
  if (roots.length === 0) return null
  const ordered = [...roots].sort((a, b) => b.created_at - a.created_at)

  const parents: { address: string; title: string }[] = []
  let resolved: { actions: ResolvedAction[]; manifest?: string; noun?: string } | null = null
  for (const root of ordered) {
    const identifier = root.tags.find((t) => t[0] === 'd')?.[1]
    if (!identifier) continue
    const pointer: AddressPointer = { kind: root.kind, pubkey: root.pubkey, identifier, relays: [] }
    const address = pointerToAddress(pointer)
    if (!resolved) {
      // The one resolve: its projection is the kind's, so the actions are every file's of this kind.
      const object = await resolveForeignObject(address, query, people.viaRelay(query), 0, manifests).catch(() => null)
      if (!object) continue
      const owner = await resolveManifest(pointer, query, manifests).catch(() => null)
      resolved = {
        actions: object.actions.filter((a) => a.control === 'form'),
        ...(owner ? { manifest: owner.address } : {}),
        ...(object.noun ? { noun: object.noun } : {}),
      }
      parents.push({ address, title: object.slots.title?.value ?? identifier })
      continue
    }
    // Every other choice needs only its name, which its root carries: no resolve each.
    parents.push({ address, title: root.tags.find((t) => t[0] === 'title' || t[0] === 'name')?.[1] ?? identifier })
  }
  if (!resolved || resolved.actions.length === 0) return null

  // A creation on a team goes into one of the teams a person navigates by, not the newest channel records.
  const borrowed = resolved.actions.filter((a) => a.declaredBy)
  if (parentKind !== KIND_CHANNEL_METADATA || borrowed.length === 0) return { ...resolved, parents }
  const folders = await readFolders().catch(() => null)
  if (!folders) {
    // Which channels are teams is the listing's to say: without it, no creation that needs a team is offered.
    const kept = resolved.actions.filter((a) => !a.declaredBy)
    return kept.length > 0 ? { ...resolved, actions: kept, parents } : null
  }
  const teams = folders.flatMap((folder) => (folder.channel ? [{ address: folder.channel, title: folder.name ?? folder.id }] : []))
  return { ...resolved, parents, parentsFor: Object.fromEntries(borrowed.map((a) => [a.id, teams])) }
}

const fail = (reason: string): LauncherApplied => ({ ok: false, reason })

/**
 * Make what a declared creation makes, under the file or team the person chose (`naddr`), signed by them in Leaf: the
 * file, then the team command a listed one is followed by, and for an issue its text as its first change (SPEC §6.1,
 * §7.3). Anything but a creation is refused: Leaf's ⌘K offers none.
 */
export async function applyAction(args: LauncherApply): Promise<LauncherApplied> {
  const pubkey = viewerPubkey()
  if (!pubkey) return fail('Sign in to create it.')
  if (typeof args.value === 'string') return fail('Leaf does not do this.')
  let pointer: AddressPointer
  try {
    pointer = referenceToPointer(args.naddr) as AddressPointer
  } catch {
    return fail('That project or team could not be found. Pick it again.')
  }
  const address = pointerToAddress(pointer)

  // The declaring manifest: the parent's own, or another app's that offers the action on it (MAN-8). interop answers
  // with a borrowed one only where resolving the parent would have offered the action from it.
  const resolved = await resolveActingManifest(pointer, args.declaredBy, query, manifests).catch(() => null)
  if (!resolved) return fail(args.declaredBy ? 'That app no longer offers this action here.' : 'The app that makes this is not set up in this workspace, so nothing was made.')
  const declared = resolved.manifest.actions?.find((action) => action.id === args.actionId)
  if (!declared || declared.input?.type !== 'object' || !declared.input.properties) return fail('Leaf does not do this.')
  if (!leafMaySign(declared.emits.kind)) return fail('Leaf cannot make this.')

  const [root] = await query([{ kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 }]).catch(() => [])
  if (!root) return fail('That is not readable from here — you may not be in its team.')
  const folder = folderOf(root)
  if (!folder) return fail('That has no team, so there is nowhere to make it.')

  const value = Object.fromEntries(Object.entries(args.value).map(([k, v]) => [k, v === '@me' ? pubkey : v]))
  // A new file needs an identifier, and the runtime invents none: a `d` is a uuid (RFC 0.4 §4.3).
  const newId = crypto.randomUUID()

  // A listed creation is followed by a team command, built only from a read of the team's state, never a guess.
  let listing: { folderHasState?: boolean } = {}
  if (declared.emits.listed === true) {
    try {
      listing = { folderHasState: (await relayStates({ kinds: [KIND_FOLDER_STATE], '#d': [folder], limit: 1 })).length > 0 }
    } catch {
      return fail('The team could not be read, so nothing was made. Try again.')
    }
  }
  const common = {
    manifest: resolved.manifest,
    kind: pointer.kind,
    address,
    objectAuthor: pointer.pubkey,
    folder,
    actionId: args.actionId,
    newId,
    pubkey,
    ...listing,
  }

  // A new file's text is its first change, after the record (ISS-6, SPEC §7.3), never the record's own: a text that
  // did not land leaves the file made and says so, never "created" with its words lost.
  // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-new-files-text-is-its-first-change.md
  const kind = declared.emits.kind
  const { [TEXT_FIELD]: text = '', ...rest } = value
  const textAction = resolved.manifest.actions?.find(
    // Only a file change (`kind:1851`): a listing may name any kind for it, and Leaf signs nothing else as a file's text.
    (candidate) => candidate.emits.field === TEXT_FIELD && candidate.emits.kind === FILE_CHANGE && [candidate.appliesTo].flat().includes(String(kind)),
  )
  if (text && !textAction) return fail('Its app does not take this text from Leaf yet, so nothing was made.')
  const built = buildActionEvents({ ...common, value: rest, createdAtMs: Date.now() })
  if (typeof built === 'string') return fail(built)
  const [record, ...commands] = built as UnsignedEvent[]
  const file = { kind, pubkey, d: newId }
  const made = await createFile({
    root: record,
    ...(text ? { text: { value: text, ...(args.contentFormat ? { format: args.contentFormat } : {}) } } : {}),
    build: (input) => {
      const one = buildActionEvents({
        ...common,
        kind,
        address: `${kind}:${pubkey}:${newId}`,
        objectAuthor: pubkey,
        actionId: textAction!.id,
        newId: undefined,
        folderHasState: undefined,
        value: input.value,
        contentFormat: input.format,
        prev: input.prev,
        createdAtMs: input.createdAtMs,
      })
      return typeof one === 'string' ? one : (one[0] as UnsignedEvent)
    },
    sign: changeWriter.sign,
    publish: changeWriter.publish,
    query,
    current: async (field) => (await openFile(query, file, { text: field === TEXT_FIELD }).catch(() => undefined))?.fields[field]?.event,
  }).catch((error: unknown) => ({ ok: false as const, created: false as const, refused: error instanceof Error ? error.message : String(error) }))
  if (!made.ok && !made.created) return fail(made.refused)
  const created = `${kind}:${pubkey}:${newId}`
  // The team commands in order, stopping at the first refusal: the file exists by then, and only its listing is behind.
  for (const command of commands) {
    const followed = await publish(command)
    if (!followed.ok) return { ok: true, created, ...(made.ok ? {} : { textNotSaved: true }), incomplete: followed.reason ?? 'The team did not list it.' }
  }
  return made.ok ? { ok: true, created } : { ok: true, created, textNotSaved: true }
}
