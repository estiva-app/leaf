/**
 * CONCEPT — Insights, Journal and Risks (prototype issue 009bc509). An item's detail, beside its list or on its own
 * page, drawn from the same parts as the list it was opened from (Miky, 16 Nov: the details felt "out of touch"):
 * an Insight's category and its tool's chart or customer quote; an Update's measures and what it leaves open; a
 * Decision's brief; a Question's phase, options and decider; a Blocker's wait; a severity as its icon. Copied
 * unchanged into Leaf.
 */
import { useState } from 'react'
import { IconExternalLink, IconSparkles, IconUsers } from '@tabler/icons-react'
import { Button, Card, LinkPickers, MetaText, Select } from '@estiva-app/ui'
import { STATUSES, type Status } from './MarkAs'
import { ItemTag, JournalExtras, SourceAsMarked } from './ItemParts'
import { InsightVisual, QuestionOptions, SeverityMark, needs, waited } from './ItemKinds'
import { CATEGORIES, SEVERITIES, PEOPLE, type Item } from './fixtures'

/** An Insight sent by another tool on the protocol: its chart or quote is the source, live. */
export const fromTool = (item: Item) => item.source?.app === 'PostHog' || item.source?.app === 'Intercom'

/** What the detail is, as the list labels it: the word or category with its icon, and a risk's severity icon before it. */
export function ItemIdentity({ item }: { item: Item }) {
  return (
    <span className="flex items-center gap-2">
      {item.type === 'risk' && item.word !== 'Blocker' && <SeverityMark severity={item.severity} />}
      <ItemTag item={item} />
    </span>
  )
}

/**
 * An item's fields, each where the list showed it: the status with its type's words; the person a kind turns on (who
 * decided a Decision, who decides a Question, who a Blocker waits on); an Insight's category; a Concern's or a
 * Question's severity. Then one quiet line of where it lives and who marked it.
 */
export function ItemFields({ item, me = 'miky' }: { item: Item; me?: string }) {
  const [status, setStatus] = useState<Status>(item.status)
  const person = item.word === 'Decision' ? { p: item.decidedBy, label: 'Decided by' } : item.word === 'Question' ? { p: item.decider, label: 'Decides' } : item.word === 'Blocker' ? { p: item.waitingOn, label: 'Waiting on' } : undefined
  const [who, setWho] = useState(person?.p?.key)
  const [category, setCategory] = useState<string>(item.category ?? '')
  const [severity, setSeverity] = useState<string>(item.severity ?? '')
  const people = PEOPLE.map((p) => ({ value: p.key, label: p.name }))
  const waitingOn = status === 'proposed' && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LinkPickers
          status={{ value: status, options: STATUSES[item.type], onChange: (v) => setStatus(v as Status) }}
          {...(person ? { owner: { value: who, options: people, onChange: setWho }, ownerLabel: person.label } : {})}
        />
        {item.type === 'insight' && (
          <span className="w-32">
            <Select size="small" ariaLabel="Category" placeholder="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </span>
        )}
        {item.type === 'risk' && item.word !== 'Blocker' && (
          <span className="w-32">
            <Select size="small" ariaLabel="Severity" placeholder="Severity" value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
          </span>
        )}
      </div>
      {/* Two short lines, never one long one: where it lives, then who marked and accepted it. */}
      <div className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate">
          <MetaText tone="muted">
            <IconUsers size={12} stroke={1.5} className="mr-1 inline" />
            {item.team} · {item.about ? item.about.title : 'the team’s own'}
          </MetaText>
        </span>
        <span className="min-w-0 truncate">
          <MetaText tone="muted">
            {item.decidedBy ? 'Written' : 'Marked'} by {item.markedBy.name}, {item.at}
            {item.acceptedBy && status !== 'proposed' ? ` · accepted by ${item.acceptedBy.name}` : ''}
          </MetaText>
        </span>
      </div>
      {waitingOn && <MetaText tone="muted">Waiting for {waitingOn} to accept</MetaText>}
    </div>
  )
}

/** A Question's phase and next step, as its box's footer says it (Miky, 16 Nov), with Decide for its decider. */
function QuestionPhase({ item, me }: { item: Item; me: string }) {
  return (
    <Card fill="inset" className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-body-2 font-medium text-text-primary">{needs(item, me)}</span>
      {item.step === 'decide' && item.decider?.key === me && (
        <Button variant="primary" size="small" onClick={() => undefined}>
          Decide
        </Button>
      )}
      {(item.step ?? 'raised') === 'raised' && (
        <Button variant="outlined" size="small" leadingIcon={<IconSparkles size={14} stroke={1.5} />} onClick={() => undefined}>
          Research options
        </Button>
      )}
    </Card>
  )
}

/** A Blocker's wait: what stops, and who has to act, for how long. */
function BlockerWait({ item }: { item: Item }) {
  return (
    <Card fill="inset" className="flex flex-col gap-1 px-3 py-2">
      {item.blocks && (
        <span className="text-body-2">
          <span className="text-text-muted">Stops: </span>
          {item.blocks}
        </span>
      )}
      {item.waitingOn && <span className="text-body-2 text-text-muted">Waiting {waited(item.day)}</span>}
    </Card>
  )
}

/**
 * The item's own content under its fields, kind by kind, as its list shows it. `words`: draw the summary and details
 * here (the side panel); the item page leaves them to its header and description.
 */
export function ItemContent({ item, me = 'miky', words = true }: { item: Item; me?: string; words?: boolean }) {
  const tool = fromTool(item)
  const quote = item.visual?.kind === 'quote'
  return (
    <div className="flex flex-col gap-3">
      {item.word === 'Question' && item.status !== 'proposed' && <QuestionPhase item={item} me={me} />}
      {item.word === 'Blocker' && item.status !== 'proposed' && <BlockerWait item={item} />}
      {item.visual && (
        <Card fill="inset" className="flex flex-col p-3">
          <InsightVisual visual={item.visual} />
        </Card>
      )}
      {words && item.summary && !quote && !(item.word === 'Update' && item.details) && <span className="text-body-2 text-text-primary">{item.summary}</span>}
      {words && item.details && <span className="whitespace-pre-line text-body-2 text-text-secondary">{item.details}</span>}
      <JournalExtras item={item} />
      {item.word === 'Question' &&
        (item.options ? (
          <div className="flex flex-col gap-2">
            <span className="text-caption font-medium text-text-primary">Options{item.optionsBy ? ` · researched by ${item.optionsBy.name}` : ''}</span>
            <QuestionOptions options={item.options} full />
          </div>
        ) : (
          <MetaText tone="muted">No options yet.</MetaText>
        ))}
      {/* A tool's insight: its chart or quote is the source, so a link to it, not a copy as marked. */}
      {tool && item.source ? (
        <MetaText tone="muted">
          <span className="inline-flex items-center gap-1">
            {item.source.app} · {item.source.place}
            {!quote && ' · Updated 5 min ago'}
            <IconExternalLink size={12} stroke={1.5} />
          </span>
        </MetaText>
      ) : (
        <SourceAsMarked source={item.source} />
      )}
    </div>
  )
}
