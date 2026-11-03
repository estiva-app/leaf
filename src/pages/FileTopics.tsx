import { useEffect, useState } from 'react'
import { IconPlus, IconX } from '@tabler/icons-react'
import { Button, Chip, CommandPalette, EmptyState, CommandPaletteSearch, IconButton, KindIcon, SkeletonBar, useToast, type CommandPaletteRow } from '@estiva-app/ui'
import { readTopicChoices, topicChoicesNow, type TopicChoices, type TopicOfFile } from '../document/fileTopics'
import { useFileTopics, type FileTopicsState } from '../document/useFileTopics'

/** A topic's address kind: a topic lists no other topic (Miky, TOP-3 kickoff), so a topic has no Topics row. */
const TOPIC = '30840:'

/**
 * A file's Topics row on its page in Leaf (TOP-6): the topics whose list names it, Add to topic and Remove, read and
 * written here. Nothing for a topic, or a file with no address yet.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md
 */
export function FileTopicsOf({ address }: { address: string | undefined }) {
  const file = address && !address.startsWith(TOPIC) ? address.split(':')[2] : undefined
  const { state, busy, setListed } = useFileTopics(file)
  const { showToast } = useToast()
  if (!file) return null
  async function change(topic: TopicOfFile, listed: boolean) {
    const result = await setListed(topic, listed)
    if (!result.ok) showToast({ label: refusal(topic, listed, result.reason ?? ''), type: 'error' })
  }
  return <FileTopics topics={state} busy={busy} onChange={(topic, listed) => void change(topic, listed)} readChoices={readTopicChoices} choicesNow={topicChoicesNow} />
}

/**
 * What a refused add or remove says. The relay's reasons open with a machine prefix (NIP-01) and are not for people;
 * Estiva ID's are already sentences (`signingFailure`).
 */
export function refusal(topic: Pick<TopicOfFile, 'title'>, listed: boolean, reason: string): string {
  if (/^restricted:/.test(reason)) return `Only people in “${topic.title}”’s Folder can change what it lists.`
  if (/^rate-limited:/.test(reason)) return 'Too busy right now. Try again shortly.'
  // A refusal the relay will repeat (malformed, blocked): trying again cannot help.
  if (/^(invalid|blocked|pow):/.test(reason)) return listed ? `The workspace would not add it to “${topic.title}”.` : `The workspace would not remove it from “${topic.title}”.`
  if (!reason || /^[a-z-]+:/.test(reason)) return listed ? `Could not add it to “${topic.title}”. Try again.` : `Could not remove it from “${topic.title}”. Try again.`
  return reason
}

/**
 * **A file's topics**, as the Per app prototype draws a file's Topics row (estiva-ui `concept/cross-app-navigation`,
 * `Lens.tsx` FilePage) and Ship draws it in its rail (ship#359): one chip per topic whose list names this file, each
 * opening the topic in Peek, then Add to topic. "None" when no topic lists it.
 *
 * Add and each chip's ✕ follow the topic, not the file: the list is the topic's, so an archived file can still be put
 * in a topic, and an archived topic keeps its chip with no ✕.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-archived-file-is-read-only-in-every-app.md
 */
export function FileTopics({ topics, busy, onChange, readChoices, choicesNow }: {
  topics: FileTopicsState
  /** Topic addresses with a write on the way: their chip waits, with no ✕. */
  busy: ReadonlySet<string>
  /** Put the file on the topic's list, or take it off. */
  onChange: (topic: TopicOfFile, listed: boolean) => void
  /** The choices, read afresh on each open of Add to topic. */
  readChoices: () => Promise<TopicChoices>
  /** The choices already in hand, drawn while {@link readChoices} reads. */
  choicesNow?: () => TopicChoices | undefined
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-2 text-body-2" data-file-topics>
      <span className="text-text-secondary">Topics</span>
      {topics === undefined ? (
        <SkeletonBar className="h-3.5 w-24" />
      ) : topics === 'failed' ? (
        <span className="text-text-muted">Topics could not be read.</span>
      ) : (
        <>
          {topics.length === 0 && <EmptyState scope="section" message="None" />}
          {topics.map((topic) => (
            <span key={topic.address} className="flex items-center" data-file-topic={topic.address}>
              <Chip label={topic.title} leadingIcon={<KindIcon kind="topic" size={14} tone="inherit" />} href={topic.openUrl} onClick={(event) => openBeside(event, topic.openUrl)} />
              {!topic.archived && !busy.has(topic.address) && (
                <IconButton variant="muted" aria-label={`Remove from ${topic.title}`} tooltip={`Remove from ${topic.title}`} onClick={() => onChange(topic, false)}>
                  <IconX size={12} stroke={1.5} />
                </IconButton>
              )}
            </span>
          ))}
          <Button size="small" variant="muted" leadingIcon={<IconPlus size={14} stroke={1.5} />} onClick={() => setPicking(true)}>
            Add to topic
          </Button>
          {picking && (
            <AddToTopic
              listed={topics.map((topic) => topic.address)}
              readChoices={readChoices}
              choicesNow={choicesNow}
              onPick={(topic) => {
                setPicking(false)
                onChange(topic, true)
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * Every typed word starts a word of the title, in any order: search matches word starts only, everywhere.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/search-matches-every-word-as-a-word-start.md
 */
function startsWords(title: string, words: readonly string[]): boolean {
  const own = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.every((word) => own.some((w) => w.startsWith(word)))
}

/** A topic opens in Peek, beside Leaf rather than in its place, as every other app's file does from Leaf. */
function openBeside(event: { preventDefault: () => void }, url: string | undefined) {
  if (!url) return
  event.preventDefault()
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Add to topic's picker, in the kit's palette as Peek's Add file is: the topics you are a member of first, then every
 * other topic you can read, each A–Z; archived ones and the ones already listing this file left out. Typing narrows
 * both by title.
 */
function AddToTopic({ listed, readChoices, choicesNow, onPick, onClose }: {
  /** The addresses of the topics that list the file already. */
  listed: readonly string[]
  readChoices: () => Promise<TopicChoices>
  choicesNow?: () => TopicChoices | undefined
  onPick: (topic: TopicOfFile) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // Choices already in hand draw with the palette, so it never says "Reading topics…" for them.
  const [choices, setChoices] = useState<TopicChoices | 'failed' | undefined>(() => choicesNow?.())
  useEffect(() => {
    let live = true
    readChoices()
      .then((next) => live && setChoices(next))
      // A failed re-read keeps the choices already drawn.
      .catch(() => live && setChoices((drawn) => (typeof drawn === 'object' ? drawn : 'failed')))
    return () => {
      live = false
    }
  }, [readChoices])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = (topics: readonly TopicOfFile[]): CommandPaletteRow[] =>
    topics
      .filter((topic) => !listed.includes(topic.address) && startsWords(topic.title, words))
      .map((topic) => ({ id: topic.address, label: topic.title, icon: <KindIcon kind="topic" tone="inherit" />, onSelect: () => onPick(topic) }))
  const groups = typeof choices === 'object' ? [{ label: 'Your topics', rows: rows(choices.yours) }, { label: 'Other topics', rows: rows(choices.others) }].filter((group) => group.rows.length > 0) : []
  return (
    <CommandPalette open onOpenChange={(open) => !open && onClose()} label="Add to topic">
      <CommandPaletteSearch
        query={query}
        onQueryChange={setQuery}
        placeholder="Find a topic…"
        groups={groups}
        pending={choices === undefined ? 'Reading topics…' : undefined}
        empty={choices === 'failed' ? 'Topics could not be read.' : words.length ? `No topic is called “${query.trim()}”.` : 'No topic to add it to.'}
      />
    </CommandPalette>
  )
}
