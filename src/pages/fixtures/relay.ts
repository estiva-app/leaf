import type { ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { KATERINA, MIKY } from './shipFiles'

/*
  What the relay holds for a file, for the stories that draw FilePage itself (Pages/File page, Pages/Ship file in
  Leaf): the page's own reads, the file's event, its changes and its comments, which say who is in it and its last
  edit, answered as the relay matches a filter.
*/

const HOUR = 3_600_000
const NOW = Date.now()

// Ids of their own ('e…'), so none is ever a fixture's own event id (`shipFiles.ts` counts from '0…').
let serial = 0
function event(kind: number, pubkey: string, at: number, tags: string[][], content = ''): SignedEvent {
  serial += 1
  return { id: serial.toString(16).padStart(64, 'e'), sig: '', kind, pubkey, created_at: Math.floor(at / 1000), tags, content }
}

/** What the relay holds for a file: Miky made it, Katerina edited its text two hours ago and was added, and she commented. */
export function factsOf(file: ForeignObject): SignedEvent[] {
  const folder = file.folder ?? ''
  const address = file.address ?? ''
  return [
    { ...event(file.kind, MIKY, NOW - 50 * HOUR, [['d', address.split(':')[2] ?? ''], ['h', folder]]), id: file.eventId },
    event(1851, KATERINA, NOW - 2 * HOUR, [['a', address], ['field', 'description'], ['value', 'Edited'], ['h', folder]]),
    event(1851, MIKY, NOW - HOUR, [['a', address], ['field', `member:${KATERINA}`], ['value', 'true'], ['h', folder], ['p', KATERINA]]),
    event(1111, KATERINA, NOW - 42 * 60_000, [['A', address], ['K', String(file.kind)], ['P', MIKY], ['h', folder]], 'A comment'),
  ]
}

/** The relay's answer to each filter, as it matches: by id, by kind, by `a` and by `A`. */
export function answer(held: readonly SignedEvent[], filters: Record<string, unknown>[]): SignedEvent[] {
  const has = (e: SignedEvent, tag: string, values: unknown) => !Array.isArray(values) || e.tags.some((t) => t[0] === tag && values.includes(t[1]))
  return held.filter((e) =>
    filters.some(
      (f) =>
        (!Array.isArray(f.ids) || f.ids.includes(e.id)) &&
        (!Array.isArray(f.kinds) || f.kinds.includes(e.kind)) &&
        has(e, 'a', f['#a']) &&
        has(e, 'A', f['#A']),
    ),
  )
}
