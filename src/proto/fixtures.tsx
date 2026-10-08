import { publishableFromEditor, type ContentFormat, type EditorDocument } from '@estiva-app/protocol'
import type { CaptionedItem } from '@estiva-app/ui/editor'
import type { ThingKind } from '@estiva-app/ui'

/**
 * Invented data for the Leaf prototype: no real people, no real files. What a
 * relay would send is not decided yet (it is Jan's). Documents and comments are
 * kept the way the protocol stores them — a value and its format — and opened
 * and drawn through `@estiva-app/protocol`, as the real app will.
 */

export const PEOPLE = {
  ana: { name: 'Ana Duarte' },
  ravi: { name: 'Ravi Mehta' },
  mia: { name: 'Mia Chen' },
  me: { name: 'Sam Porter' },
} as const

export type PersonId = keyof typeof PEOPLE

/** A person, as a reference names them: `nostr:npub…` (invented, not a real key). */
export const personUri = (id: PersonId) => `nostr:npub-${id}`
export const personOf = (uri: string): PersonId | undefined => (Object.keys(PEOPLE) as PersonId[]).find((id) => personUri(id) === uri)

/** One thing another app owns, as `[` lists it and a chip names it. */
export interface Thing extends CaptionedItem {
  kind: ThingKind
  app: 'Ship' | 'Peek' | 'Leaf'
}

export const THINGS: Thing[] = [
  { id: 'onboarding', label: 'Onboarding revamp', snippet: 'Make the first week of a new team calm and clear.', uri: 'nostr:ship-project-onboarding', kind: 'project', app: 'Ship', description: 'Ship · project' },
  { id: 'invite', label: 'Invite by link', snippet: 'Anyone with the link joins the Folder.', uri: 'nostr:ship-issue-invite', kind: 'issue', app: 'Ship', description: 'Ship · issue' },
  { id: 'pricing', label: 'Pricing', snippet: 'Where the pricing questions go.', uri: 'nostr:peek-topic-pricing', kind: 'topic', app: 'Peek', description: 'Peek · topic' },
  { id: 'checklist', label: 'Checklist', snippet: 'Everything a new team needs on day one.', uri: 'nostr:leaf-doc-checklist', kind: 'file', app: 'Leaf', description: 'Leaf · document' },
]

export const thingOf = (uri: string | null) => THINGS.find((t) => t.uri === uri)
export const kindOf = (uri: string | null): ThingKind | undefined => thingOf(uri)?.kind

/** A body as the protocol stores it: the value, and the format its tag says. */
export interface Stored {
  value: string
  format: ContentFormat
}

/** What a save writes, from an editor's document. */
export const storedFrom = (doc: EditorDocument): Stored => {
  const { value, contentFormat } = publishableFromEditor(doc)
  return { value, format: contentFormat ? 'blocks' : 'marker' }
}

/** A Leaf document, as the prototype keeps it. */
export interface Doc {
  id: string
  title: string
  folder: string
  editedBy: PersonId
  edited: string
  /** When, in full: the tooltip behind `edited`. */
  editedAt: string
  body: Stored
}

const text = (t: string) => ({ type: 'text', text: t })
const ref = (uri: string) => ({ type: 'reference', attrs: { uri } })
const thing = (id: string) => ref(THINGS.find((x) => x.id === id)!.uri)
const p = (blockId: string, ...content: object[]) => ({ type: 'paragraph', attrs: { blockId }, content })
const h = (blockId: string, level: 1 | 2, t: string) => ({ type: 'heading', attrs: { level, blockId }, content: [text(t)] })
const li = (blockId: string, t: string) => ({ type: 'listItem', attrs: { blockId }, content: [{ type: 'paragraph', content: [text(t)] }] })
const doc = (...content: object[]) => storedFrom({ type: 'doc', content } as EditorDocument)

export const DOCS: Doc[] = [
  {
    id: 'launch-plan',
    title: 'Launch plan',
    folder: 'Launch',
    editedBy: 'ana',
    edited: '2 minutes ago',
    editedAt: '9 Oct 2026, 09:58',
    body: doc(
      p('lp-1', text('This page is where the launch lives: what we promise, who we start with, and how far along the work is. The work itself is '), thing('onboarding'), text(' in Ship.')),
      h('lp-2', 1, 'Goals'),
      { type: 'bulletList', attrs: { blockId: 'lp-3' }, content: [li('lp-3a', 'Every new team is set up in one sitting.'), li('lp-3b', 'No one has to ask where a document lives.'), li('lp-3c', 'The first week feels calm, not busy.')] },
      p('lp-4', text('We start with the teams who asked first, and grow from what they tell us.')),
      h('lp-5', 1, 'Who does what'),
      p('lp-6', text('Pricing questions go to '), thing('pricing'), text(' in Peek, and '), ref(personUri('ravi')), text(' owns the press notes. The day-one list is in '), thing('checklist'), text('.')),
      h('lp-7', 2, 'Open questions'),
      p('lp-8', text('Do we invite by link from the start, or only by name? See '), thing('invite'), text('.')),
    ),
  },
  {
    id: 'checklist',
    title: 'Checklist',
    folder: 'Launch',
    editedBy: 'ravi',
    edited: 'yesterday',
    editedAt: '8 Oct 2026, 16:20',
    body: doc(
      p('cl-1', text('What a new team needs on its first day.')),
      { type: 'orderedList', attrs: { blockId: 'cl-2' }, content: [li('cl-2a', 'A Folder with their name.'), li('cl-2b', 'One welcome topic in Peek.'), li('cl-2c', 'This list, copied.')] },
    ),
  },
  { id: 'blank', title: '', folder: 'Launch', editedBy: 'me', edited: 'just now', editedAt: '9 Oct 2026, 10:00', body: { value: '', format: 'marker' } },
]

/** One comment in a thread. */
export interface Comment {
  id: string
  by: PersonId
  when: string
  /** When, in full: the tooltip behind `when`. */
  at: string
  body: Stored
}

const said = (t: string): Stored => ({ value: t, format: 'marker' })

/**
 * A thread. `anchor` is SPEC §13.6's block id, plus the words the comment is
 * about (a quote, found again in the block); absent = the whole document.
 */
export interface Thread {
  id: string
  doc: string
  anchor?: { block: string; quote: string }
  comments: Comment[]
  resolved?: boolean
}

export const THREADS: Thread[] = [
  {
    id: 't1',
    doc: 'launch-plan',
    anchor: { block: 'lp-4', quote: 'the teams who asked first' },
    comments: [
      { id: 'c1', by: 'ana', when: '2h', at: '9 Oct 2026, 08:00', body: said('Should we name the teams here, or keep it general?') },
      { id: 'c2', by: 'ravi', when: '1h', at: '9 Oct 2026, 09:00', body: said('General. I am putting the names in Checklist instead.') },
    ],
  },
  {
    id: 't4',
    doc: 'launch-plan',
    anchor: { block: 'lp-6', quote: 'owns the press notes' },
    comments: [
      { id: 'c5', by: 'mia', when: '40m', at: '9 Oct 2026, 09:20', body: said('Still true after the reshuffle?') },
      { id: 'c6', by: 'ravi', when: '20m', at: '9 Oct 2026, 09:40', body: said('Yes, still mine.') },
    ],
  },
  {
    id: 't5',
    doc: 'launch-plan',
    anchor: { block: 'lp-2', quote: 'Aims' },
    comments: [{ id: 'c7', by: 'ana', when: '3 days ago', at: '6 Oct 2026, 11:15', body: said('Rename this to Goals?') }],
  },
  {
    id: 't2',
    doc: 'launch-plan',
    comments: [{ id: 'c3', by: 'mia', when: 'Yesterday', at: '8 Oct 2026, 17:05', body: said('Draft reads well. I will add the pricing part tomorrow.') }],
  },
  {
    id: 't3',
    doc: 'launch-plan',
    anchor: { block: 'lp-1', quote: 'where the launch lives' },
    comments: [{ id: 'c4', by: 'ravi', when: '3 days ago', at: '6 Oct 2026, 10:02', body: said('Typo in the second line.') }],
    resolved: true,
  },
]

/** The sidebar's Folders, and the documents in them. */
export interface TreeDoc {
  id: string
  label: string
  /** Not a Leaf document: another app's file, named by that app. */
  app?: 'Ship' | 'Peek'
  kind: ThingKind
  children?: TreeDoc[]
}

export interface TreeFolder {
  id: string
  title: string
  docs: TreeDoc[]
}

export const FOLDERS: TreeFolder[] = [
  {
    id: 'launch',
    title: 'Launch',
    docs: [
      {
        id: 'launch-plan',
        label: 'Launch plan',
        kind: 'file',
        children: [
          { id: 'checklist', label: 'Checklist', kind: 'file' },
          { id: 'press-notes', label: 'Press notes', kind: 'file' },
        ],
      },
      { id: 'onboarding', label: 'Onboarding revamp', kind: 'project', app: 'Ship' },
      { id: 'research', label: 'Research notes', kind: 'file' },
    ],
  },
  {
    id: 'design',
    title: 'Design',
    docs: [
      { id: 'type-scale', label: 'Type scale notes', kind: 'file' },
      { id: 'interviews', label: 'Interview guide', kind: 'file' },
      { id: 'pricing', label: 'Pricing', kind: 'topic', app: 'Peek' },
    ],
  },
  { id: 'handbook', title: 'Team handbook', docs: [] },
]

/** The Home page's recent documents, newest first. */
export const RECENT: { id: string; title: string; folder: string; by: PersonId; when: string; at: string }[] = [
  { id: 'launch-plan', title: 'Launch plan', folder: 'Launch', by: 'ana', when: '2 minutes ago', at: '9 Oct 2026, 09:58' },
  { id: 'checklist', title: 'Checklist', folder: 'Launch', by: 'ravi', when: 'Yesterday', at: '8 Oct 2026, 16:20' },
  { id: 'type-scale', title: 'Type scale notes', folder: 'Design', by: 'mia', when: '3 days ago', at: '6 Oct 2026, 14:40' },
  { id: 'interviews', title: 'Interview guide', folder: 'Design', by: 'me', when: 'Last week', at: '1 Oct 2026, 12:10' },
]
