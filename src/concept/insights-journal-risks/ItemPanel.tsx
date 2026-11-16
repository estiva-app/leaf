/**
 * CONCEPT — a marked block's item opened beside the page, in the comments' place (Miky, 16 Nov: "so it stays in
 * context"), as Ship opens an item beside its list and Peek a thread beside its topic: the kit's Panel, 384px, its ✕
 * closing it and bringing the comments back. The same detail as Ship's (ItemDetail), without Ship's comment column.
 */
import { IconX } from '@tabler/icons-react'
import { IconButton, Panel, ScrollArea } from '@estiva-app/ui'
import { ItemContent, ItemFields, ItemIdentity } from './ItemDetail'
import type { Item } from './fixtures'

/** The item as its list shows it: what it is, its fields, its content kind by kind, its source as marked. */
export function ItemPanel({ item, me = 'miky', onClose }: { item: Item; me?: string; onClose: () => void }) {
  return (
    <div className="flex w-[384px] min-h-0 flex-1 flex-col">
      <Panel
        title={<ItemIdentity item={item} />}
        actions={
          <IconButton variant="muted" tooltip="Close" aria-label="Close" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        }
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 pb-4">
            <span className="text-h3 text-text-primary">{item.title}</span>
            <ItemFields key={item.id} item={item} me={me} />
            <ItemContent item={item} me={me} />
          </div>
        </ScrollArea>
      </Panel>
    </div>
  )
}
