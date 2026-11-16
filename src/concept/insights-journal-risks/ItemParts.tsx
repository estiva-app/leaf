/**
 * CONCEPT — the parts Ship's Insights, Journal and Risks tabs draw: an item's card, the Triage, the Journal timeline,
 * the filter row and the source as marked. Reuses: the kit's Card, Chip, StatusMark, Button, IconButton, Avatar,
 * MetaText, EmptyState, Divider (the conversation's "New" line and Peek's date line); the timeline's line is Ship's
 * History line (a face, the words, when) on a vertical rule.
 * Miky's notes, 16 Nov: Accept (primary) and a secondary ✕ in place of Yes / No; an Insight shows its category, and
 * Insights are filtered by it; a card reads title, summary, then where it came from; the Journal's "New" is the
 * conversation's; a Journal entry shows its summary, an Update its whole text; details open in a side panel.
 */
import { Fragment, useState, type ReactNode } from 'react'
import { IconTrash, IconX } from '@tabler/icons-react'
import { Avatar, Button, Card, Chip, Divider, EmptyState, IconButton, MetaText, SkeletonList, StatusMark, Tabs, type ChipType } from '@estiva-app/ui'
import { TYPE_META, statusOption, type ItemType, type Status } from './MarkAs'
import { CATEGORIES, type Item, type Source } from './fixtures'

const WORD_CHIP: Record<Item['word'], ChipType> = { Insight: 'warning', Decision: 'info', Update: 'neutral', Concern: 'error', Question: 'neutral' }

export function StatusOf({ item }: { item: Pick<Item, 'type' | 'status'> }) {
  const o = statusOption(item.type, item.status)
  return <StatusMark status={{ label: o.label, colour: o.colour ?? 'neutral' }} />
}

/** "From Katerina's message in Peek · Universal Navigation" — or "Typed by hand" for an item with no source. */
export function sourceLine(source?: Source) {
  if (!source) return 'Typed by hand'
  return `From ${source.author.name}’s ${source.what} in ${source.app} · ${source.place}`
}

/** Where it came from, by whom, when: the card's last line. */
export function metaLine(item: Item) {
  const by = item.decidedBy ? `decided by ${item.decidedBy.name}, written by ${item.markedBy.name}` : item.source ? `marked by ${item.markedBy.name}` : `by ${item.markedBy.name}`
  return `${sourceLine(item.source)} · ${by} · ${item.at}`
}

/** The label an item's card wears: an Insight's category, else its word (Decision, Update, Concern, Question). */
export function ItemLabel({ item }: { item: Item }) {
  if (item.type === 'insight') return item.category ? <Chip type="neutral" label={item.category} /> : null
  return <Chip type={WORD_CHIP[item.word]} label={item.word} />
}

/** Accept (primary) and a secondary ✕ on a Proposed item, signed as you (Miky, 16 Nov, in place of Yes / No). */
export function AcceptReject({ onAnswer, waitingOn }: { onAnswer?: (accept: boolean) => void; waitingOn?: string }) {
  if (waitingOn) return <MetaText tone="muted">Waiting for {waitingOn}</MetaText>
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="small" variant="primary" onClick={() => onAnswer?.(true)}>
        Accept
      </Button>
      <IconButton variant="muted" tooltip="Reject" aria-label="Reject" onClick={() => onAnswer?.(false)}>
        <IconX size={16} stroke={1.5} />
      </IconButton>
    </div>
  )
}

export const acceptedStatus = (item: Pick<Item, 'type'>): Status => (item.type === 'risk' ? 'open' : 'accepted')

/** One item as a card in a list: its title, summary, then its label and where it came from; Accept / ✕ while Proposed. */
export function ItemCard({ item, me = 'miky', onOpen, selected }: { item: Item; me?: string; onOpen?: () => void; selected?: boolean }) {
  const [status, setStatus] = useState<Status>(item.status)
  const shown = { ...item, status }
  // A Decision naming someone else waits for them (Decided, 16 Nov); everyone else sees who.
  const waitingOn = status === 'proposed' && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  return (
    <Card fill="surface" hover="hairline" onPress={onOpen} selected={selected}>
      <div className="flex items-start gap-3 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-2 font-medium text-text-primary">{item.title}</span>
          {item.summary && <span className="line-clamp-2 text-body-2 text-text-secondary">{item.summary}</span>}
          <div className="flex min-w-0 items-center gap-2 pt-0.5">
            <ItemLabel item={item} />
            <span className="min-w-0 truncate">
              <MetaText tone="muted">{metaLine(item)}</MetaText>
            </span>
          </div>
        </div>
        {status === 'proposed' ? <AcceptReject waitingOn={waitingOn} onAnswer={(yes) => setStatus(yes ? acceptedStatus(item) : 'rejected')} /> : <StatusOf item={shown} />}
      </div>
    </Card>
  )
}

/** The filter row above a list. Insights: by category (Miky, 16 Nov). Journal and Risks: by status. */
export function FilterRow({ type, value, onChange, items }: { type: ItemType; value: string; onChange: (v: string) => void; items: Item[] }) {
  if (type === 'insight') {
    const tabs = [{ id: 'all', label: 'All', count: items.length }, ...CATEGORIES.map((c) => ({ id: c, label: c, count: items.filter((i) => i.category === c).length }))]
    return <Tabs tabs={tabs} active={value} onChange={onChange} size="small" />
  }
  const end = { insight: 'Outdated', journal: 'Superseded', risk: 'Resolved' }[type]
  const live = type === 'risk' ? 'Open' : 'Accepted'
  const tabs = [
    { id: 'all', label: 'All', count: items.length },
    { id: 'live', label: live, count: filterItems(items, 'live').length },
    { id: 'proposed', label: 'Proposed', count: filterItems(items, 'proposed').length },
    { id: 'ended', label: `${end} and rejected`, count: filterItems(items, 'ended').length },
  ]
  return <Tabs tabs={tabs} active={value} onChange={onChange} size="small" />
}

export const LIVE: Status[] = ['accepted', 'open']
export const ENDED: Status[] = ['outdated', 'superseded', 'resolved', 'rejected']
export function filterItems(items: Item[], filter: string) {
  if (filter === 'live') return items.filter((i) => LIVE.includes(i.status))
  if (filter === 'proposed') return items.filter((i) => i.status === 'proposed')
  if (filter === 'ended') return items.filter((i) => ENDED.includes(i.status))
  if ((CATEGORIES as string[]).includes(filter)) return items.filter((i) => i.category === filter)
  return items
}
/** Live first, then Proposed, then what ended; newest first inside each. */
export const byStanding = (items: Item[]) => {
  const rank = (s: Status) => (LIVE.includes(s) ? 0 : s === 'proposed' ? 1 : 2)
  return [...items].sort((a, b) => rank(a.status) - rank(b.status) || b.day.localeCompare(a.day))
}

/** A list's state: what to draw while it loads, when it failed, when it is empty. */
export type ListState = 'ready' | 'loading' | 'error' | 'empty'
export function ListStateView({ state, type, children }: { state: ListState; type: ItemType; children: ReactNode }) {
  if (state === 'loading') return <SkeletonList rows={4} />
  if (state === 'error') return <EmptyState scope="section" message={`Couldn’t load the ${TYPE_META[type].plural.toLowerCase()}. Try again.`} />
  if (state === 'empty')
    return (
      <EmptyState
        scope="section"
        icon={TYPE_META[type].icon(24)}
        message={
          {
            insight: 'No insights yet. Mark a message, a comment or a block as an Insight and it shows here.',
            journal: 'Nothing in the journal yet. Mark a message, a comment or a block as a Decision or an Update.',
            risk: 'No risks yet. Mark a message, a comment or a block as a Concern or a Question.',
          }[type]
        }
      />
    )
  return <>{children}</>
}

/** The Triage: what is new since your last visit and waits for an answer, at the top of Insights and Risks. */
export function Triage({ items, onOpen, openId }: { items: Item[]; onOpen?: (item: Item) => void; openId?: string }) {
  if (!items.length) return null
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-bg-inset p-3" aria-label="Triage">
      <span className="text-caption font-medium text-text-secondary">New since your last visit · {items.length}</span>
      {items.map((item) => (
        <ItemCard key={item.id} item={item} selected={item.id === openId} onOpen={() => onOpen?.(item)} />
      ))}
    </section>
  )
}
export const triageOf = (items: Item[]) => items.filter((i) => i.isNew && i.status === 'proposed')

/**
 * The Journal: History's lines on a vertical rule under Peek's date lines, newest first. The conversation's "New"
 * line sits where what you have seen begins; newest first, the new entries are above it.
 */
export function JournalTimeline({ items, onOpen, openId, me = 'miky' }: { items: Item[]; onOpen?: (item: Item) => void; openId?: string; me?: string }) {
  const sorted = [...items].sort((a, b) => b.day.localeCompare(a.day))
  const days: { day: string; at: string; items: Item[] }[] = []
  for (const item of sorted) {
    const last = days[days.length - 1]
    if (last && last.day === item.day) last.items.push(item)
    else days.push({ day: item.day, at: item.at, items: [item] })
  }
  const anyNew = sorted.some((i) => i.isNew)
  const firstSeen = anyNew ? sorted.find((i) => !i.isNew)?.id : undefined
  return (
    <ol className="flex flex-col" aria-label="Journal">
      {days.map((d) => (
        <li key={d.day} className="flex flex-col">
          {d.items[0].id === firstSeen && <Divider label="New ↑" tone="warning" />}
          <Divider look="section" label={d.at} />
          <ol className="ml-2 flex flex-col border-l border-border-default">
            {d.items.map((item) => (
              <Fragment key={item.id}>
                {item.id === firstSeen && item !== d.items[0] && <Divider label="New ↑" tone="warning" />}
                <TimelineEntry item={item} me={me} selected={item.id === openId} onOpen={() => onOpen?.(item)} />
              </Fragment>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

function TimelineEntry({ item, me, onOpen, selected }: { item: Item; me: string; onOpen: () => void; selected?: boolean }) {
  const [status, setStatus] = useState<Status>(item.status)
  const proposed = status === 'proposed'
  const waitingOn = proposed && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  const ended = status === 'superseded' || status === 'rejected'
  // An Update is read whole in the timeline; a Decision shows its summary (Miky, 16 Nov).
  const body = item.word === 'Update' ? (item.details ?? item.summary) : item.summary
  return (
    <li className="relative py-1 pl-4">
      {/* The dot on the line: filled when accepted, hollow while proposed. */}
      <span aria-hidden className={`absolute -left-[5px] top-5 size-2.5 rounded-full border-2 ${proposed ? 'border-border-strong bg-bg-surface' : ended ? 'border-border-default bg-border-default' : 'border-info-default bg-info-default'}`} />
      <Card fill="none" hover="fill" onPress={onOpen} selected={selected}>
        <div className="flex items-start gap-3 p-2">
          <Avatar name={(item.decidedBy ?? item.markedBy).name} size={20} />
          <div className={`flex min-w-0 flex-1 flex-col gap-1 ${ended ? 'opacity-60' : ''}`}>
            <span className="text-body-2 text-text-primary">
              <span className="text-text-secondary">{item.word} · </span>
              <span className={`font-medium ${status === 'superseded' ? 'line-through' : ''}`}>{item.title}</span>
            </span>
            {body && <span className="whitespace-pre-line text-body-2 text-text-secondary">{body}</span>}
            <MetaText tone="muted">
              {metaLine(item)}
              {status !== 'proposed' && status !== 'accepted' ? ` · ${statusOption(item.type, status).label}` : ''}
            </MetaText>
          </div>
          {proposed ? <AcceptReject waitingOn={waitingOn} onAnswer={(yes) => setStatus(yes ? 'accepted' : 'rejected')} /> : null}
        </div>
      </Card>
    </li>
  )
}

/** The source as it read when marked, pinned; "edited since marked" opens the words now (record #448). */
export function SourceAsMarked({ source }: { source?: Source }) {
  const [showNow, setShowNow] = useState(false)
  if (!source)
    return <MetaText tone="muted">Typed by hand — no message, comment or block behind it.</MetaText>
  return (
    <figure className="flex flex-col gap-2 rounded-lg border border-border-default p-3">
      <figcaption className="flex items-center gap-2">
        <Avatar name={source.author.name} size={20} />
        <span className="text-body-2 text-text-primary">{source.author.name}’s {source.what}</span>
        <MetaText tone="muted">
          in {source.app} · {source.place}
        </MetaText>
        <div className="flex-1" />
        {!source.gone && (
          <Button size="small" variant="muted" onClick={() => {}}>
            Open in {source.app}
          </Button>
        )}
      </figcaption>
      {/* An item points, never copies (record #448): a deleted source shows that it was deleted, and no words. */}
      {source.gone ? (
        <MetaText tone="muted">
          <IconTrash size={12} stroke={1.5} className="mr-1 inline" />
          This {source.what} was deleted. The item keeps its own title and details.
        </MetaText>
      ) : (
        <blockquote className="border-l-2 border-border-default pl-3 text-body-2 text-text-primary">{showNow && source.now ? source.now : source.quote}</blockquote>
      )}
      {source.gone ? null : source.now ? (
        <Button size="small" variant="muted" onClick={() => setShowNow((v) => !v)}>
          {showNow ? 'Show as marked' : 'Edited since marked — show it now'}
        </Button>
      ) : (
        <MetaText tone="muted">As marked</MetaText>
      )}
    </figure>
  )
}
