import { useEffect, useState } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { resolvePart, serializeBlockDocument, toRenderTree, type Block, type PartPointer } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { Button, PartCard, RichText } from '@estiva-app/ui'
import { blockLinkOf } from '../document/blockLink'
import { linkedKindOf } from '../document/linked'
import { readDocument } from '../document/save'
import { titleOf } from '../folders/tree'
import { useOwnerBlockLinker } from '../pages/usePathAddress'
import { navigate } from '../route'
import { referenceOfValue } from './commentLines'

/**
 * How often a shown part is read again while the tab is visible, as Peek's
 * `PART_REFRESH_MS`: every card reads on its own, and the relay meters reads.
 */
const PART_REFRESH_MS = 30_000

/**
 * Past this height a block is cut behind ShowMore's fade, and opens in place: Peek's and Ship's figure, about six
 * table rows, so a short table is still drawn whole.
 */
const CUT_AT = 160

/** What a part draws: waiting, the block as it is now, its file without it, or nothing a reader may see. */
export type PartRead =
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
 * Where a part opens, at its block: a Leaf page here, in this tab; another app's file on its own app's host, in a new
 * tab, when that app declares a link to a block (Ship's `#block-<block>`), else at the file's own address. Only an
 * https address of another app is followed, as every other link to another app: it comes from a manifest anyone may
 * publish.
 */
function usePlace(object: ForeignObject | undefined, block: string): { href: string; here: boolean } | undefined {
  const own = object ? blockLinkOf(object, block) : undefined
  const away = object && !own && object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : undefined
  const linker = useOwnerBlockLinker(away ? object! : null, away ? new URL(away).origin : undefined)
  if (own) {
    const url = new URL(own)
    return { href: `${url.pathname}${url.search}${url.hash}`, here: true }
  }
  if (!away) return undefined
  const atBlock = linker?.(block, object!.slots.title?.value)
  return { href: atBlock && new URL(atBlock).origin === new URL(away).origin ? atBlock : away, here: false }
}

/**
 * One block of another page or issue, live under a comment or under the box
 * while it is written (SPEC §13.6.1): read here, and drawn by {@link PartFrame}.
 */
export function PartView({ pointer }: { pointer: PartPointer }) {
  return <PartFrame pointer={pointer} read={usePart(pointer)} />
}

/**
 * A part from a read that has already happened: the package's PartCard frame
 * around the block as it is now, as Peek and Ship draw a message's part — cut
 * behind Show more when it is long, and the way to it, at the block, under it:
 * "Open" when it stays in Leaf, "Open in <app>" when it leaves (Ship's words,
 * Miky 2026-10-09). A document is labelled "Document", by its type.
 */
export function PartFrame({ pointer, read }: { pointer: PartPointer; read: PartRead }) {
  const kind = linkedKindOf(Number(pointer.address.split(':')[0]))
  const object = read.state === 'loading' || read.state === 'unavailable' ? undefined : read.object
  const place = usePlace(object, pointer.block)
  if (!object) {
    return (
      <div data-part={read.state} data-part-address={pointer.address}>
        {read.state === 'loading' ? <PartCard state="loading" kind={kind} /> : <PartCard state="unavailable" kind={kind} />}
      </div>
    )
  }
  const frame = { kind: linkedKindOf(object.kind), heading: titleOf(object), href: place?.href }
  if (read.state !== 'resolved') {
    return (
      <div data-part={read.state} data-part-address={pointer.address} data-part-block={pointer.block}>
        <PartCard {...frame}>
          <span className="text-caption italic text-text-muted">{read.state === 'detached' ? 'This part was deleted' : "This part can't be shown"}</span>
        </PartCard>
      </div>
    )
  }
  // A Button, not a Link, by Katerina's call (2026-10-08): the way out reads as an action, level with Show more.
  const open = place ? (
    <Button size="small" leadingIcon={<IconExternalLink stroke={1.5} className="size-3.5" />} onClick={() => (place.here ? navigate(place.href) : window.open(place.href, '_blank', 'noopener,noreferrer'))}>
      {place.here ? 'Open' : `Open in ${object.appName ?? 'app'}`}
    </Button>
  ) : undefined
  return (
    <div data-part={read.state} data-part-address={pointer.address} data-part-block={pointer.block}>
      {/* An attachment is never cut: its card is already the thumbnail. */}
      <PartCard {...frame} action={open} maxHeight={read.block.type === 'attachment' ? Infinity : CUT_AT}>
        <RichText blocks={toRenderTree(serializeBlockDocument({ type: 'doc', content: [read.block] }), 'blocks')} size="small" />
      </PartCard>
    </div>
  )
}
