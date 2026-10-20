import { referenceToPointer, stripInlineFormatting } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { thingKindOf, type LinkState, type Linked, type LinkedChild, type LinkedKind, type LinkedPicker, type StatusColour } from '@estiva-app/ui'
import { writtenOpenerOf } from '../comments/links'
import { titleOf } from '../folders/tree'

/*
  What a link in a page stands for, as the kit's chip, row and card draw it
  (`LinkChip`, `LinkRow`, `LinkCard`), read from interop's projection of the
  file — Ship's and Peek's `lib/linked.ts`, with what the approved document
  stories show on a project's card: its key, lead, status, its issues and how
  many are done.
  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-edits-a-document-with-one-shared-editor.md
*/

const COLOURS: readonly StatusColour[] = ['neutral', 'blue', 'green', 'muted']

function colourOf(colour: string | undefined): StatusColour | undefined {
  return COLOURS.find((known) => known === colour)
}

/** What an address is, by its kind, before anything has been read. */
const KIND_WORDS: Record<number, { kind: LinkedKind; noun: string }> = {
  30850: { kind: 'project', noun: 'Project' },
  30851: { kind: 'issue', noun: 'Issue' },
  30840: { kind: 'topic', noun: 'Topic' },
  30842: { kind: 'page', noun: 'Document' },
}

/** The kind an `naddr` names, without asking the relay; `undefined` for anything else. */
function kindOfUri(uri: string): number | undefined {
  if (!/^nostr:naddr1/i.test(uri)) return undefined
  try {
    return referenceToPointer(uri).kind
  } catch {
    return undefined
  }
}

/** What a reference names, by its icon, before anything has been read. */
export function linkedKindOfUri(uri: string): LinkedKind {
  if (/^nostr:(?:nevent1|note1)/i.test(uri)) return 'message'
  const kind = kindOfUri(uri)
  return (kind !== undefined && KIND_WORDS[kind]?.kind) || 'file'
}

/** What "not available" calls a reference when nothing more is known. */
function nounOfUri(uri: string): string {
  if (/^nostr:(?:nevent1|note1)/i.test(uri)) return 'Message'
  const kind = kindOfUri(uri)
  return (kind !== undefined && KIND_WORDS[kind]?.noun) || 'File'
}

/** What a file is called, by its noun or its app: "Topic", "Estiva Ship". */
function nounOf(object: { noun?: string; appName?: string }): string | undefined {
  if (object.noun) return object.noun.charAt(0).toUpperCase() + object.noun.slice(1)
  return object.appName
}

/**
 * Where a link opens: the URL the page wrote, on a host an app serves (LTX-6),
 * else the address its own app gives it, https only — another app's address
 * comes from a manifest anyone may publish.
 */
function hrefOf(object: ForeignObject, written?: string): string {
  return writtenOpenerOf(written, object.openUrl) ?? (object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : '')
}

/** What the reader calls it, quietly before the title: an issue's ref ("WBD-5"), a project's key ("WBD"). */
function keyOf(object: ForeignObject): string | undefined {
  return object.meta.find((slot) => (slot.field === 'ref' || slot.field === 'key') && !slot.isPubkey && slot.value)?.value
}

/** The person a file names in its owner's place (its assignee, its lead), by name and picture. */
function ownerOf(object: ForeignObject): { pubkey: string; label?: string } | undefined {
  const slot = object.meta.find((one) => one.isPubkey && one.value && one.field !== object.slots.title?.field)
  return slot ? { pubkey: slot.value, label: slot.label } : undefined
}

/** The files inside it, as its card's rows: a project's issues, a Folder's files. */
function childrenOf(object: ForeignObject): LinkedChild[] | undefined {
  if (!object.children?.length) return undefined
  return object.children.map((child) => {
    const status = child.slots.status
    const owner = ownerOf(child)
    const person = owner ? child.people?.[owner.pubkey] : undefined
    const key = keyOf(child)
    return {
      id: child.address ?? child.eventId ?? child.ref,
      title: titleOf(child),
      href: hrefOf(child),
      ...(key ? { key } : {}),
      status: { label: status?.value ?? nounOf(child) ?? 'File', colour: colourOf(status?.colour) ?? 'muted' },
      ...(person?.displayName ? { owner: { name: person.displayName, ...(person.picture ? { picture: person.picture } : {}) } } : {}),
    }
  })
}

/** How many of its items are done, when every item has a status: the green ones, as Ship colours Done. */
function doneOf(object: ForeignObject): { done: number; total: number } | undefined {
  const children = object.children
  if (!children?.length || children.some((child) => !child.slots.status)) return undefined
  return { done: children.filter((child) => child.slots.status?.colour === 'green').length, total: children.length }
}

/**
 * The file a reference names, as the kit's link parts draw it. Its values read
 * as words: Leaf changes no status or owner from a card.
 */
export function linkedOf(object: ForeignObject, written?: string): Linked {
  const { slots, people } = object
  const id = object.address ?? object.eventId ?? object.ref
  const href = hrefOf(object, written)
  if (slots.title?.isPubkey) {
    // A message is titled by its author (RIC-11): drawn with their face, then its opening words.
    const person = people?.[slots.title.value]
    const name = person?.displayName ?? '—'
    const body = slots.body?.value ? stripInlineFormatting(slots.body.value).trim() : ''
    return { id, kind: 'message', title: name, href, author: { name, ...(person?.picture ? { picture: person.picture } : {}) }, ...(body ? { body } : {}) }
  }
  const status: LinkedPicker | undefined = slots.status
    ? { value: slots.status.value, options: [{ value: slots.status.value, label: slots.status.value, colour: colourOf(slots.status.colour) }] }
    : undefined
  const owner = ownerOf(object)
  const ownerPerson = owner ? people?.[owner.pubkey] : undefined
  const key = keyOf(object)
  const children = childrenOf(object)
  const done = doneOf(object)
  return {
    id,
    kind: object.kind === 30842 ? 'page' : thingKindOf(object.kind),
    title: titleOf(object),
    href,
    ...(key ? { key } : {}),
    // Interop reads every file kind's summary into its subtitle (SPEC §6.12).
    ...(slots.subtitle?.value ? { summary: slots.subtitle.value } : {}),
    ...(status ? { status } : {}),
    ...(owner
      ? {
          owner: { value: owner.pubkey, options: [{ value: owner.pubkey, label: ownerPerson?.displayName ?? '—', ...(ownerPerson?.picture ? { picture: ownerPerson.picture } : {}) }] },
          ...(owner.label ? { ownerLabel: owner.label } : {}),
        }
      : {}),
    ...(children ? { children } : {}),
    ...(done ? { done } : {}),
  }
}

/**
 * Where a reference's read stands, for the kit: `undefined` is still read,
 * `null` an answer of nothing. Nothing, and a file the reader may not read,
 * draw alike: "not available." (Miky, 15 Oct).
 */
export function linkStateOf(uri: string, object: ForeignObject | null | undefined, written?: string): LinkState {
  if (object === undefined) return { state: 'loading', kind: linkedKindOfUri(uri) }
  if (object === null) return { state: 'unavailable', kind: linkedKindOfUri(uri), noun: nounOfUri(uri) }
  if (object.unreachable) {
    const href = object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : undefined
    return {
      state: 'unavailable',
      kind: object.kind === 30842 ? 'page' : thingKindOf(object.kind),
      noun: nounOf(object) ?? 'File',
      ...(href ? { openIn: { app: object.appName ?? 'its app', href } } : {}),
    }
  }
  return { state: 'ready', linked: linkedOf(object, written) }
}
