import { buildMembershipChange, buildMutedEvent, mutedFilter, parseMutedBlob, serializeMutedBlob } from '@estiva-app/conversation'
import type { ReadTopic } from '@estiva-app/interop'
import { nip44 } from '../auth/nip44'
import { publish, query, viewerPubkey } from '../relay/bridge'
import { newestMuted } from './muted'

/**
 * What Join did: joined, at the level that now lights for you; joined while the mute stays (Join again takes it out); or
 * nothing, with why.
 */
export type JoinResult = { ok: true; level: 'important' | 'all'; stillMuted?: true } | { ok: false; reason: string }

/**
 * Join an initiative from Explore initiatives (TOPI-4), as Peek's Join on its Explore does (Katerina, 18 November: "let's
 * make it to important"): your own member change on it, `member:<you>` = true, which puts you in at Important unless
 * you chose a level before — then that level stays, and the result says which. It was a `follow:<you>` = `all` until
 * then. A mute you kept on it is taken out (§11.8 *Muting*), as before, so it is yours in every app. The mute list is
 * read just before and never written over when it cannot be read.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-holds-three-kinds-of-place-and-add-puts-you-in-one.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-persons-level-on-a-place-is-theirs-alone.md
 */
export async function joinTopic(topic: ReadTopic): Promise<JoinResult> {
  const me = viewerPubkey()
  if (!me) return { ok: false, reason: 'Sign in again, then try again.' }
  // What lights once in: a level you chose before stays (you can only have one and still be outside it while muted);
  // otherwise the member change's Important.
  const level = topic.following.in && topic.following.level === 'all' ? 'all' : 'important'
  let followed = false
  try {
    const result = await publish(buildMembershipChange(me, Date.now(), { file: topic.address, folder: topic.folder, person: me, member: true }))
    if (!result.ok) return { ok: false, reason: result.reason || 'The relay did not take it. Try again.' }
    followed = true
    const newest = newestMuted(await query([mutedFilter(me) as Record<string, unknown>]), me)
    if (!newest) return { ok: true, level }
    const list = parseMutedBlob(await nip44.decrypt(newest.content))
    // Joined, but the mute stays: said as that, not as a failure.
    if (!list) return { ok: true, level, stillMuted: true }
    if (!list.keys.includes(topic.address)) return { ok: true, level }
    const ciphertext = await nip44.encrypt(serializeMutedBlob(list.keys.filter((key) => key !== topic.address), Date.now()))
    const unmuted = await publish(buildMutedEvent(me, Date.now(), ciphertext))
    return unmuted.ok ? { ok: true, level } : { ok: true, level, stillMuted: true }
  } catch (error) {
    console.warn('[topics] join:', error)
    return followed ? { ok: true, level, stillMuted: true } : { ok: false, reason: 'Try again.' }
  }
}
