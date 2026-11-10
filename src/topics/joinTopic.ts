import { buildMutedEvent, mutedFilter, parseMutedBlob, serializeMutedBlob, switchWrites } from '@estiva-app/conversation'
import type { ReadTopic } from '@estiva-app/interop'
import { nip44 } from '../auth/nip44'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { newestMuted } from './muted'

/** What Join did: joined; joined while the mute stays (Join again takes it out); or nothing, with why. */
export type JoinResult = { ok: true; stillMuted?: true } | { ok: false; reason: string }

/**
 * Join a topic from Explore topics (TOPI-4, as Ship's `joinTopic` and `joinPlace`): you follow it at All, as Peek's
 * Join does — the public changes conversation's `switchWrites` gives for All, a `follow:<you>` = `all` on the topic,
 * after a leave when you had left — and a mute you kept on it is taken out (§11.8 *Muting*), so it is yours in every
 * app. The mute list is read just before and never written over when it cannot be read.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-holds-three-kinds-of-place-and-add-puts-you-in-one.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-persons-level-on-a-place-is-theirs-alone.md
 */
export async function joinTopic(topic: ReadTopic): Promise<JoinResult> {
  const me = viewerPubkey()
  if (!me) return { ok: false, reason: 'Sign in again, then try again.' }
  let followed = false
  try {
    const writes = switchWrites(me, Date.now(), { place: { address: topic.address, team: topic.folder }, folder: topic.folder, choice: 'all', following: topic.following })
    for (const change of writes.changes) {
      const result = await publish(change)
      if (!result.ok) return { ok: false, reason: result.reason || 'The relay did not take it. Try again.' }
    }
    followed = true
    if (!writes.clearsMute) return { ok: true }
    const newest = newestMuted(await query([mutedFilter(me) as Record<string, unknown>]), me)
    if (!newest) return { ok: true }
    const list = parseMutedBlob(await nip44.decrypt(newest.content))
    // Joined, but the mute stays: said as that, not as a failure.
    if (!list) return { ok: true, stillMuted: true }
    if (!list.keys.includes(topic.address)) return { ok: true }
    const ciphertext = await nip44.encrypt(serializeMutedBlob(list.keys.filter((key) => key !== topic.address), Date.now()))
    const unmuted = await publish(buildMutedEvent(me, Date.now(), ciphertext))
    return unmuted.ok ? { ok: true } : { ok: true, stillMuted: true }
  } catch (error) {
    console.warn('[topics] join:', error)
    return followed ? { ok: true, stillMuted: true } : { ok: false, reason: 'Try again.' }
  }
}
