import { useEffect, useReducer } from 'react'
import { KIND_COMMENT, isReply, streamOf } from '@estiva-app/conversation'
import { query } from '../relay/bridge'

/**
 * How long a card's count is trusted without asking again: Ship's card count
 * (`useCardConversation`) holds its answer as long.
 */
const HELD_MS = 30_000

/** Each carded file's last count, for this tab: a page of cards for one file is one read, not one per card. */
const held = new Map<string, { at: number; count: number }>()
const asking = new Map<string, Promise<number | undefined>>()

function ask(address: string): Promise<number | undefined> {
  const flight = asking.get(address)
  if (flight) return flight
  const next = query([{ kinds: [KIND_COMMENT], '#A': [address], limit: 500 }])
    .then((events) => {
      // How many conversations, as Ship's and Peek's cards count them: the file's comments, not their replies.
      const count = streamOf(address, events).filter((event) => !isReply(event)).length
      held.set(address, { at: Date.now(), count })
      return count
    })
    // A failed read costs the count, never the card.
    .catch(() => held.get(address)?.count)
    .finally(() => asking.delete(address))
  asking.set(address, next)
  return next
}

/**
 * How many conversations a carded file has (5ebf2756), `undefined` while asked
 * or for something with no address. No unread dot: Leaf keeps no read state
 * for another file's conversation.
 */
export function useCardConversation(address: string | undefined): number | undefined {
  const [, landed] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!address) return
    const now = held.get(address)
    if (now && Date.now() - now.at < HELD_MS) return
    let live = true
    void ask(address).then(() => {
      if (live) landed()
    })
    return () => {
      live = false
    }
  }, [address])
  return address ? held.get(address)?.count : undefined
}
