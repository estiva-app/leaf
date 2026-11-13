/**
 * Marking a topic's conversation read, and getting it onto the relay, so a topic read in Leaf is read in Peek and Ship
 * (SPEC §11).
 *
 * The queue is `@estiva-app/conversation`'s `createReadStateQueue` (TOPIC-3), the one Ship uses: one per tab, since a
 * slot is one replaceable blob per installation; the whole blob on every publish, read back from our own slot before
 * each one; debounced on marks. What stays here is Leaf's own: where its slot is kept, what it is called, and how it
 * reaches the relay. Leaf draws no unread yet, so there is no read half.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-is-read-only-when-its-thread-is-opened.md
 */
import { READ_DWELL_MS, READ_STATE_PUBLISH_DEBOUNCE_MS, createReadStateQueue } from '@estiva-app/conversation'
import { nip44 } from '../auth/nip44'
import { changeWriter, query, viewerPubkey } from './bridge'

/** Leaf's slot, kept apart from anything else this app stores. Changing it gives every Leaf user a fresh slot. */
export const SLOT_STORAGE_KEY = 'leaf.readstate.slot'

/** Long enough to batch a few marks, short enough to survive a tab close. */
export const PUBLISH_DEBOUNCE_MS = READ_STATE_PUBLISH_DEBOUNCE_MS

/** How long a conversation must be on screen before it counts as read. */
export { READ_DWELL_MS }

/**
 * The tab's one queue. Leaf's `nip44.decrypt` throws on every refusal, a 429 above all, so our own slot read back
 * through it is never mistaken for one that will never decrypt.
 */
const queue = createReadStateQueue({
  storage: () => (typeof localStorage === 'undefined' ? undefined : localStorage),
  storageKey: SLOT_STORAGE_KEY,
  // Names Leaf in a new `client_id`: `leaf-1a2b3c4d`.
  clientPrefix: 'leaf',
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  pubkey: () => viewerPubkey() ?? undefined,
  query,
  nip44,
  sign: (event) => changeWriter.sign(event),
  publish: (event) => changeWriter.publish(event),
})

/** Publish what is pending now. */
export function flushReadState(): Promise<void> {
  return queue.flush()
}

/** Mark these contexts read at `atMs`; the publish follows, debounced. Contexts come from the conversation package's builders. */
export function markRead(contexts: readonly (string | undefined)[], atMs: number = Date.now()): void {
  queue.markRead(contexts, atMs)
}

/** Publish before the tab goes away — `visibilitychange` is the one a phone fires. */
export function installReadStateFlush(): () => void {
  return queue.installFlushOnHide(document)
}

/** Test seam: drop the tab's state so a suite starts clean. */
export function resetReadStateForTests(): void {
  queue.reset()
}
