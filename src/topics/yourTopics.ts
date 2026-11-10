import { readYourTopics, type YourTopicsRead } from "@estiva-app/interop";
import { createRetryingRead } from "@estiva-app/platform";
import { useEffect, useSyncExternalStore } from "react";
import { nip44 } from "../auth/nip44";
import { heldTopics } from "../document/fileTopics";
import { query, viewerPubkey } from "../relay/bridge";
import { projections as manifests } from "../relay/manifests";
import { listReadOffered } from "../relay/projectFields";
import { isYours } from "./sidebarTopics";
import { REREAD_AFTER_MS } from "./topicReads";

/**
 * Only your topics, newest activity first, with your mute list (ALO-20, Ship's ALO-17): interop's lean read, what the
 * sidebar draws its five from on every page that does not read every topic itself. Your spaces come with it, marked, so
 * a link to one you are in goes to Peek from any page; the sidebar leaves them out itself.
 */
export const heldYourTopics = createRetryingRead<YourTopicsRead>({
  retryable: () => false,
});

/** The mute list last opened, so an unchanged one costs no `/nip44/decrypt` on the next read; a failure is not kept. */
let opened: { ciphertext: string; plaintext: string } | undefined;

async function decryptOnce(ciphertext: string): Promise<string | undefined> {
  if (opened?.ciphertext === ciphertext) return opened.plaintext;
  try {
    const plaintext = await nip44.decrypt(ciphertext);
    opened = { ciphertext, plaintext };
    return plaintext;
  } catch {
    // Estiva ID refused or was busy (a 429): nothing is left out as muted, as before.
    return undefined;
  }
}

/**
 * Your topics, read once more: one request a call, never paged by `queryAll`, which would ask each filter for a thousand
 * events and keep interop's rounds from ending on a short page. Throws, saying why, when nobody is signed in.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function loadYourTopics(): Promise<YourTopicsRead> {
  const me = viewerPubkey();
  if (!me) throw new Error("Sign in to read your topics.");
  const listRead = await listReadOffered();
  return readYourTopics(query, me, {
    cache: manifests,
    decrypt: decryptOnce,
    spaces: true,
    ...(listRead ? { listRead } : {}),
  });
}

/** Test seam: forget the read and the mute list opened. */
export function resetYourTopicsForTests(): void {
  heldYourTopics.clear();
  opened = undefined;
}

const subscribe = (listener: () => void) => heldYourTopics.subscribe(listener);
const snapshot = () => heldYourTopics.snapshot();

/** Your topics from the tab's held lean read: `undefined` while the first is out, `failed` when it did not land. */
export function useYourTopics(): YourTopicsRead | "failed" | undefined {
  const held = useSyncExternalStore(subscribe, snapshot);
  return held.value ?? (held.error !== undefined ? "failed" : undefined);
}

/**
 * Whether the tab's read of every topic, read since (Explore's Join, Add to topic), counts other topics as yours than
 * the lean read does: then the lean read is read again, so a topic joined on Explore is in the five back on Home.
 * Spaces are left out of both, as the sidebar leaves them out.
 */
function joinedOrLeftSince(lean: YourTopicsRead): boolean {
  const every = heldTopics.snapshot().value;
  if (!every) return false;
  const fromEvery = new Set(
    every.topics
      .filter((topic) => isYours(topic, lean.muted))
      .map((topic) => topic.address),
  );
  const fromLean = new Set(
    lean.topics.filter((topic) => !topic.space).map((topic) => topic.address),
  );
  return (
    fromEvery.size !== fromLean.size ||
    [...fromEvery].some((address) => !fromLean.has(address))
  );
}

/**
 * Read your topics once `ready`, and again when you come back to the tab after {@link REREAD_AFTER_MS} — never while
 * you work, so the five stay put (Miky, 6 Nov). Read again at once when the tab's read of every topic says you joined
 * or left one since. Nothing while `ready` is false.
 */
export function useYourTopicsRead(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const lean = heldYourTopics.snapshot().value;
    void (lean && joinedOrLeftSince(lean)
      ? heldYourTopics.reload(loadYourTopics)
      : heldYourTopics.ensure(loadYourTopics));
    let last = Date.now();
    const onReturn = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - last <= REREAD_AFTER_MS
      )
        return;
      last = Date.now();
      void heldYourTopics.reload(loadYourTopics);
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [ready]);
}
