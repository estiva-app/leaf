/**
 * CONCEPT — a marked block's item opened beside the page, in the comments' place (Miky, 16 Nov: "so it stays in
 * context"), as Ship opens an item beside its list and Peek a thread beside its topic: the kit's Panel, 384px, its ✕
 * closing it and bringing the comments back. The same panel as Ship's concept, without Ship's comment column.
 */
import { useState } from 'react'
import { IconUsers, IconX } from '@tabler/icons-react'
import { IconButton, LinkPickers, MetaText, Panel, ScrollArea, Select } from '@estiva-app/ui'
import { STATUSES, TYPE_META, type Status } from './MarkAs'
import { SourceAsMarked } from './ItemParts'
import { CATEGORIES, PEOPLE, type Item } from './fixtures'

/** The item whole: title, its status and fields, summary, details, its source as marked. */
export function ItemPanel({ item, me = 'miky', onClose }: { item: Item; me?: string; onClose: () => void }) {
  const meta = TYPE_META[item.type]
  const [status, setStatus] = useState<Status>(item.status)
  const [decider, setDecider] = useState(item.decidedBy?.key)
  const [category, setCategory] = useState<string>(item.category ?? '')
  const people = PEOPLE.map((p) => ({ value: p.key, label: p.name }))
  const waitingOn = status === 'proposed' && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  return (
    <div className="flex w-[384px] min-h-0 flex-1 flex-col">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <span className={meta.text}>{meta.icon(16)}</span>
            {item.word}
          </span>
        }
        actions={
          <IconButton variant="muted" tooltip="Close" aria-label="Close" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        }
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 pb-4">
            <span className="text-h3 text-text-primary">{item.title}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <LinkPickers
                status={{ value: status, options: STATUSES[item.type], onChange: (v) => setStatus(v as Status) }}
                {...(item.type === 'journal' ? { owner: { value: decider, options: people, onChange: setDecider }, ownerLabel: 'Decided by' } : {})}
              />
              {item.type === 'insight' && (
                <Select size="small" ariaLabel="Category" placeholder="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              )}
            </div>
            <MetaText tone="muted">
              <IconUsers size={12} stroke={1.5} className="mr-1 inline" />
              {item.team} · about {item.about ? item.about.title : 'nothing yet'} · marked by {item.markedBy.name} · {item.at}
            </MetaText>
            {waitingOn && <MetaText tone="muted">Waiting for {waitingOn} to accept.</MetaText>}
            {item.summary && <span className="text-body-2 text-text-primary">{item.summary}</span>}
            {item.details && <span className="whitespace-pre-line text-body-2 text-text-secondary">{item.details}</span>}
            <SourceAsMarked source={item.source} />
          </div>
        </ScrollArea>
      </Panel>
    </div>
  )
}
