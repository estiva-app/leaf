/**
 * What the person was typing when their sign-in ended, kept through the passkey
 * trip (AUT-4 in Ship, AUT-5 here; Decided 17 Oct: "kept on the device through the passkey trip and
 * put back, unsaved, after the tap, as the comment box already does").
 *
 * Ship's file, for Leaf. The comment box already keeps its drafts on the device
 * as you type (`createDraftStore`). A page's text between saves and the New
 * document dialog keep nothing, and the passkey screen takes their page's place:
 * so each registers a reader while it is open ({@link useHeldTyping}),
 * and the ending reads them all ({@link holdTyping}) before `SessionGate` draws.
 * Coming back, each takes its text ({@link heldText}) and starts from it, not
 * yet saved.
 *
 * Only for an ending. Another tab signing out is a sign-out, and what was read
 * or typed does not stay on the device past one
 * (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/peek-keeps-a-plain-copy-on-the-device-until-sign-out.md).
 *
 * Kept per person: whoever signs in next on this device gets only their own.
 */
import { useEffect, useRef } from 'react'
import { DRAFT_MAX_AGE_MS } from '@estiva-app/conversation'

const PREFIX = 'leaf.held-typing'

/** Whose page this is: set once the app is entered (`followOtherTabs`), since the ending has already cleared the token. */
let person: string | undefined

export function holdTypingFor(pubkey: string | undefined): void {
  person = pubkey
  // Somebody else signing in on this device, or a hold left too long: it goes, as the plain copy does.
  const store = storage()
  if (!store) return
  try {
    for (const key of Object.keys(store)) {
      if (!key.startsWith(`${PREFIX}:`)) continue
      const mine = `${PREFIX}:${pubkey}:`
      if (pubkey === undefined || !key.startsWith(mine)) {
        store.removeItem(key)
        continue
      }
      if (heldText(key.slice(mine.length)) === undefined) store.removeItem(key)
    }
  } catch {
    // Blocked storage holds nothing.
  }
}

/** Each open place's text, or `undefined` when there is nothing unsaved in it. */
const readers = new Map<string, () => string | undefined>()

const storageKey = (who: string, key: string) => `${PREFIX}:${who}:${key}`

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Set by an ending, so the places it unmounts keep what it held (see {@link useHeldTyping}). */
let ending = false

/** The sign-in ended: keep every open place's unsaved text on the device. */
export function holdTyping(): void {
  ending = true
  const store = storage()
  if (!store || !person) return
  for (const [key, read] of readers) {
    const text = read()
    try {
      if (text) store.setItem(storageKey(person, key), JSON.stringify({ text, at: Date.now() }))
    } catch {
      // A full quota: the text is lost as it was before AUT-4, and nothing else breaks.
    }
  }
}

/** The text held for this place, for the person signed in now; `undefined` when there is none. */
export function heldText(key: string): string | undefined {
  const store = storage()
  if (!store || !person) return undefined
  try {
    const raw = store.getItem(storageKey(person, key))
    if (!raw) return undefined
    const { text, at } = JSON.parse(raw) as { text?: unknown; at?: unknown }
    if (typeof text !== 'string' || typeof at !== 'number' || Date.now() - at > DRAFT_MAX_AGE_MS) return undefined
    return text
  } catch {
    return undefined
  }
}

/** A dialog's held fields, as it wrote them with `JSON.stringify`; `null` when none. */
export function heldFields<T extends object>(key: string | undefined): Partial<T> | null {
  const text = key ? heldText(key) : undefined
  if (!text) return null
  try {
    const fields: unknown = JSON.parse(text)
    return fields && typeof fields === 'object' ? (fields as Partial<T>) : null
  } catch {
    return null
  }
}

/** Forget the text held for this place: saved, created or cancelled. */
export function releaseHeld(key: string): void {
  if (!person) return
  try {
    storage()?.removeItem(storageKey(person, key))
  } catch {
    // Blocked storage: nothing was held either.
  }
}

/** Signing out: nothing typed stays on the device. */
export function forgetHeldTyping(): void {
  const store = storage()
  if (!store) return
  try {
    for (const key of Object.keys(store)) if (key.startsWith(`${PREFIX}:`)) store.removeItem(key)
  } catch {
    // Blocked storage holds nothing.
  }
}

/**
 * Open a dialog again when it holds text from an ending, once its key is known
 * (a page can draw before the project it is about is read).
 */
export function useReopenHeld(key: string | undefined, open: () => void): void {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  })
  useEffect(() => {
    if (key && heldText(key) !== undefined) latest.current()
  }, [key])
}

/**
 * While this place is open, let an ending read its unsaved text. `read` is the
 * latest one given; `undefined` for `key` registers nothing.
 *
 * What was held stays held until the place is done with it: saved, created or
 * cancelled (it calls {@link releaseHeld}), or left by any other way than an
 * ending, so a dialog walked away from does not open by itself on the next
 * visit. A tab closed right after the tap unmounts nothing, and brings the text
 * back next time.
 */
export function useHeldTyping(key: string | undefined, read: () => string | undefined): void {
  const latest = useRef(read)
  // After each render, before the ending can ask: Leaf's lint keeps refs out of render.
  useEffect(() => {
    latest.current = read
  })
  useEffect(() => {
    if (!key) return
    readers.set(key, () => latest.current())
    return () => {
      readers.delete(key)
      if (!ending) releaseHeld(key)
    }
  }, [key])
}
