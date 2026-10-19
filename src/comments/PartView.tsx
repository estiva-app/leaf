import { useEffect, useState } from 'react'
import { resolvePart, serializeBlockDocument, toRenderTree, type Block, type PartPointer } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { PartCard, RichText, thingKindOf } from '@estiva-app/ui'
import { readDocument } from '../document/save'
import { titleOf } from '../folders/tree'
import { referenceOfValue } from './commentLines'

/**
 * How often a shown part is read again while the tab is visible, as Peek's
 * `PART_REFRESH_MS`: every card reads on its own, and the relay meters reads.
 */
const PART_REFRESH_MS = 30_000

/** What a part draws: waiting, the block as it is now, its file without it, or nothing a reader may see. */
type PartRead =
  | { state: 'loading' }
  | { state: 'resolved'; block: Block; object: ForeignObject }
  | { state: 'detached' | 'unaddressable'; object: ForeignObject }
  | { state: 'unavailable' }

/** Read one part once. Deleted and not this reader's to see read the same (Miky, 15 Oct): no title, no words. */
async function readPart(pointer: PartPointer): Promise<PartRead> {
  const reference = referenceOfValue(pointer.address)
  const object = reference ? await readDocument(reference.slice('nostr:'.length)) : null
  if (!object || object.unreachable) return { state: 'unavailable' }
  const body = object.slots.body
  if (!body) return { state: 'unaddressable', object }
  const part = resolvePart(pointer.block, { value: body.value, format: body.format === 'blocks' ? 'blocks' : 'marker' })
  if (part.state === 'resolved') return { state: 'resolved', block: part.block, object }
  return part.state === 'detached' || part.state === 'unaddressable' ? { state: part.state, object } : { state: 'unavailable' }
}

/** The part, read now, again every 30 s while the tab is visible, and when it comes back, as Peek's `usePart`. A failed read keeps what was shown. */
function usePart(pointer: PartPointer): PartRead {
  const { address, block } = pointer
  const [read, setRead] = useState<PartRead>({ state: 'loading' })
  useEffect(() => {
    let live = true
    let reading = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // One read at a time: the tab coming back while one is out waits for it, so there is only ever one chain of re-reads.
    const once = () => {
      if (reading) return
      reading = true
      clearTimeout(timer)
      void readPart({ address, block })
        .then((next) => {
          if (live) setRead(next)
        })
        .catch(() => {})
        .finally(() => {
          reading = false
          if (live && document.visibilityState === 'visible') timer = setTimeout(once, PART_REFRESH_MS)
        })
    }
    const back = () => {
      if (document.visibilityState === 'visible') once()
    }
    once()
    document.addEventListener('visibilitychange', back)
    return () => {
      live = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', back)
    }
  }, [address, block])
  return read
}

/**
 * One block of another page or issue, live under a comment or under the box
 * while it is written (SPEC §13.6.1): the package's PartCard frame around the
 * block as it is now, as Peek draws a message's part.
 */
export function PartView({ pointer }: { pointer: PartPointer }) {
  const read = usePart(pointer)
  const kind = thingKindOf(Number(pointer.address.split(':')[0]))
  if (read.state === 'loading' || read.state === 'unavailable') {
    return (
      <div data-part={read.state} data-part-address={pointer.address}>
        {read.state === 'loading' ? <PartCard state="loading" kind={kind} /> : <PartCard state="unavailable" kind={kind} noun={kind.charAt(0).toUpperCase() + kind.slice(1)} />}
      </div>
    )
  }
  const opener = read.object.openUrl && /^https?:\/\//i.test(read.object.openUrl) ? read.object.openUrl : undefined
  return (
    <div data-part={read.state} data-part-address={pointer.address} data-part-block={pointer.block}>
      <PartCard kind={thingKindOf(read.object.kind)} heading={titleOf(read.object)} href={opener}>
        {read.state === 'resolved' ? (
          <RichText blocks={toRenderTree(serializeBlockDocument({ type: 'doc', content: [read.block] }), 'blocks')} size="small" />
        ) : (
          <span className="text-caption italic text-text-muted">{read.state === 'detached' ? 'This part was deleted' : "This part can't be shown"}</span>
        )}
      </PartCard>
    </div>
  )
}
