/**
 * Marking a topic's conversation read, and getting it onto the relay: Leaf's first read-state write, as Ship's
 * `api/readStateSync.ts` (CRO-8) writes it, so a topic read in Leaf is read in Peek and Ship (SPEC §11).
 *
 * NIP-RS itself — the context grammar, the blob, the byte cap, the slot's identity, the fetch and the publish — is
 * `@estiva-app/conversation`'s, so Leaf writes the blob Peek and Ship write. What stays here is Leaf's own: where its
 * slot is kept, what it is called, and the one queue for the tab (a slot is one replaceable blob per installation, so
 * two queues would take turns overwriting each other's markers).
 *
 * Only the write half: Leaf draws no unread yet. A publish always carries the whole blob of this installation, so the
 * slot is first read back from the relay — a partial blob would silently drop every marker it left out.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-is-read-only-when-its-thread-is-opened.md
 */
import {
  REPLY_FLOOR_CONTEXT,
  READ_STATE_HORIZON_DAYS,
  advanceContexts as advance,
  createSlotCache,
  fetchReadState,
  loadSlotIdentity as loadSlot,
  publishReadState,
  rotateSlotId,
  toContextSeconds,
  type Nip44,
  type QueryFn,
  type SlotIdentity,
} from '@estiva-app/conversation'
import { nip44 } from '../auth/nip44'
import { changeWriter, query as bridgeQuery, viewerPubkey } from './bridge'

/** Leaf's slot, kept apart from anything else this app stores. Changing it gives every Leaf user a fresh slot. */
export const SLOT_STORAGE_KEY = 'leaf.readstate.slot'

/** Names Leaf in a new `client_id`: `leaf-1a2b3c4d`. */
const CLIENT_PREFIX = 'leaf'

/** Long enough to batch a few marks, short enough to survive a tab close (Ship's). */
export const PUBLISH_DEBOUNCE_MS = 3000

/** How long a conversation must be on screen before it counts as read (Ship's and Peek's). */
export const READ_DWELL_MS = 1500

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

const query: QueryFn = (filters) => bridgeQuery(filters as Record<string, unknown>[])

let identity: SlotIdentity | undefined
let slotCache = createSlotCache()
/** Everything this slot holds: its own blob from the relay, plus what was marked here. */
let known: Record<string, number> = {}
/** Marked but not yet in an accepted publish. */
let pending: Record<string, number> = {}
/** What the relay is believed to hold, so an unchanged blob is not published again. */
let published: Record<string, number> | undefined
let hydrated = false
let hydratedFor: string | undefined
let hydrating: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let retryMs = 0
let inFlight: Promise<void> = Promise.resolve()

function currentIdentity(): SlotIdentity {
  identity ??= loadSlot({ storage: safeStorage(), storageKey: SLOT_STORAGE_KEY, clientPrefix: CLIENT_PREFIX, random })
  return identity
}

function advanceContexts(current: Record<string, number>, updates: Record<string, number>): Record<string, number> {
  const { contexts, evicted } = advance(current, updates)
  if (evicted.length > 0) console.warn(`[read-state] over the byte cap; ${evicted.length} oldest markers dropped`)
  return contexts
}

const sameContexts = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/** Read this installation's own blob back, once per person, before the first write. */
async function hydrate(pubkey: string): Promise<void> {
  if (hydrated && hydratedFor === pubkey) return
  if (hydratedFor !== pubkey) {
    // Another person in this tab: nothing of the last one's carries over.
    hydrated = false
    published = undefined
    slotCache = createSlotCache()
  }
  hydrating ??= (async () => {
    const decrypt: Pick<Nip44, 'decrypt'> = { decrypt: (ciphertext) => nip44.decrypt(ciphertext) }
    const state = await fetchReadState(query, pubkey, decrypt, currentIdentity(), Date.now(), READ_STATE_HORIZON_DAYS, slotCache)
    // Unreachable is not empty: publishing then would drop every marker this slot held.
    if (!state.reachable) return
    // Our slot is there and would not decrypt (a 429 above all): writing over it would lose it. Try again later.
    if (state.ownUndecryptable) {
      console.warn('[read-state] own slot could not be decrypted; not publishing over it')
      return
    }
    // Another installation's blob at our coordinate (a copied profile): take a new slot id and start it empty.
    if (state.coordinateConflicted) identity = rotateSlotId(currentIdentity(), { storage: safeStorage(), storageKey: SLOT_STORAGE_KEY, random })
    // Seeded from our own slot, never the merge: a slot is this installation's account of what it read (Ship's note).
    const own = state.own?.contexts ?? {}
    const { [REPLY_FLOOR_CONTEXT]: floor, ...marked } = known
    const held = floor === undefined ? own : { ...own, [REPLY_FLOOR_CONTEXT]: Math.max(floor, own[REPLY_FLOOR_CONTEXT] ?? 0) }
    known = advanceContexts(held, marked)
    published = state.own?.contexts ?? {}
    hydrated = true
    hydratedFor = pubkey
  })().finally(() => {
    hydrating = undefined
  })
  await hydrating
}

/** Markers are still pending after a failed attempt: come back, backing off so an outage is not a busy loop. */
function retryLater(): void {
  if (timer !== undefined) return
  retryMs = retryMs === 0 ? PUBLISH_DEBOUNCE_MS : Math.min(retryMs * 2, 60_000)
  timer = setTimeout(() => {
    timer = undefined
    void flushReadState()
  }, retryMs)
}

/** Publish what is pending now. */
export function flushReadState(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  inFlight = inFlight.then(async () => {
    if (Object.keys(pending).length === 0) return
    const pubkey = viewerPubkey()
    if (!pubkey) return retryLater()
    try {
      await hydrate(pubkey)
    } catch (error) {
      console.warn('[read-state] could not read the slot back:', error)
    }
    if (!hydrated) return retryLater()
    const sending = pending
    const contexts = { ...known }
    pending = {}
    if (published && sameContexts(published, contexts)) return
    try {
      const result = await publishReadState({ sign: changeWriter.sign, publish: changeWriter.publish, nip44 }, pubkey, currentIdentity(), contexts, Date.now())
      if (result.ok) {
        published = contexts
        retryMs = 0
        return
      }
      console.warn('[read-state] publish refused:', result.reason)
    } catch (error) {
      console.warn('[read-state] publish failed:', error)
    }
    pending = advanceContexts(pending, sending)
    retryLater()
  })
  return inFlight
}

/** Mark these contexts read at `atMs`; the publish follows, debounced. Contexts come from the conversation package's builders. */
export function markRead(contexts: readonly (string | undefined)[], atMs: number = Date.now()): void {
  let moved = false
  for (const context of contexts) {
    if (!context) continue
    const seconds = toContextSeconds(atMs)
    const advanced = advanceContexts(known, { [context]: seconds })
    // Not newer, or not a context the blob takes: nothing to publish.
    if (advanced[context] === known[context]) continue
    known = advanced
    pending = advanceContexts(pending, { [context]: seconds })
    moved = true
  }
  if (!moved) return
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void flushReadState()
  }, PUBLISH_DEBOUNCE_MS)
}

/** Publish before the tab goes away — `visibilitychange` is the one a phone fires. */
export function installReadStateFlush(): () => void {
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flushReadState()
  }
  document.addEventListener('visibilitychange', onHidden)
  return () => document.removeEventListener('visibilitychange', onHidden)
}

/** Test seam: drop the tab's state so a suite starts clean. */
export function resetReadStateForTests(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  identity = undefined
  slotCache = createSlotCache()
  known = {}
  pending = {}
  published = undefined
  hydrated = false
  hydratedFor = undefined
  hydrating = undefined
  retryMs = 0
  inFlight = Promise.resolve()
}
