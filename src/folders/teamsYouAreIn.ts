import { useEffect, useState } from 'react'
import { teamMembersOf } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { queryAll, viewerPubkey } from '../relay/bridge'

const KIND_ROSTER = 39002
const ROSTER_COMMANDS: readonly number[] = [9000, 9001, 9021, 9022, 9007]
/** Buzz's ceiling per filter; a team's commands over its whole life stay far below it, as Peek's teams read says. */
const ROSTER_COMMANDS_LIMIT = 1_000

/**
 * The teams the viewer is in, for the sidebar's Other teams (Katerina, 23 November: "as Peek's Teams column"): every
 * team's `kind:39002` and the stored commands naming it, in one read, as Peek's teams read asks for them, and
 * conversation's `teamMembersOf` for each. **Throws when the read failed**: a failed read is not "in no team".
 */
export async function readTeamsYouAreIn(teams: readonly string[], viewer: string): Promise<ReadonlySet<string>> {
  if (teams.length === 0) return new Set()
  const events: SignedEvent[] = await queryAll([
    { kinds: [KIND_ROSTER], '#d': [...teams] },
    { kinds: [...ROSTER_COMMANDS], '#h': [...teams], limit: ROSTER_COMMANDS_LIMIT },
  ])
  return new Set(teams.filter((team) => teamMembersOf(team, events).some((member) => member.pubkey === viewer)))
}

/** The last answer and the teams it was for: the sidebar drawn again for the same teams does not wait for a read. */
let held: { key: string; value: ReadonlySet<string> } | undefined

/**
 * Which of these teams the viewer is in, read once per set of teams. `undefined` until read, signed out, and when the
 * read failed, so the sidebar lists every team in one list, as before, rather than guess who is in what.
 */
export function useTeamsYouAreIn(teams: readonly string[] | undefined): ReadonlySet<string> | undefined {
  const key = teams ? [...teams].sort().join(' ') : undefined
  const [answer, setAnswer] = useState<{ key: string; value: ReadonlySet<string> } | undefined>(() => (held && held.key === key ? held : undefined))
  useEffect(() => {
    const viewer = viewerPubkey()
    if (key === undefined || !viewer) return
    // The teams are asked about by their key: a new array of the same teams is not a new question.
    const ids = key ? key.split(' ') : []
    let live = true
    readTeamsYouAreIn(ids, viewer)
      .then((value) => {
        held = { key, value }
        if (live) setAnswer(held)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [key])
  return answer && answer.key === key ? answer.value : held && held.key === key ? held.value : undefined
}
