import { BODY_SLOT, KIND_BARE_FILE, projectEvents, type FolderSummary, type ForeignObject, type ResolvedManifest } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type SignedEvent } from '@estiva-app/protocol'
import type { NavTreeGroup } from '@estiva-app/ui'
import type { HomeRow } from '../../home/useRecent'
import { rowOf } from '../../folders/tree'
import shipManifest from '../../pages/fixtures/ship-manifest.json'
import { KATERINA, MIKY } from '../../pages/fixtures/shipFiles'
import type { SidebarTopic } from '../../topics/sidebarTopics'
import type { TopicPageData } from '../../topics/useTopicPage'
import { topicPath } from '../../topics/topicLinks'
import type { TopicRowData } from './TopicRow'
import type { TopicsTab } from './ExploreTopicsPage'

/*
  The data behind Leaf's stories of "Topics: level up the topic experience", the spec's (estiva-ui
  `concept/topics-level-up`, `stories/topics-level-up/fixtures.ts`): real topic names from Estiva HQ, made-up contents.
  A topic's `at` is when anything last happened in it — a message by anyone, the agent's too, a file added, or a save,
  status or comment on a file it lists — the one order every app sorts by. Leaf's pages are Leaf's own files; Ship's
  projects and issues are projected through Ship's real manifest, as `pages/fixtures/shipFiles.ts` does.
*/

const SHIP = 'b'.repeat(64)
const NOW = Date.now()
const MIN = 60_000

export const TEAMS = {
  company: { id: 'f0f0f0f0-0000-4000-8000-0000000000c1', name: 'Estiva HQ' },
  design: { id: 'f0f0f0f0-0000-4000-8000-0000000000d1', name: 'Design' },
  engineering: { id: 'f0f0f0f0-0000-4000-8000-0000000000e1', name: 'Engineering' },
} as const
type Team = keyof typeof TEAMS

/** The teams as the tree read them, for a topic's page to name its team. */
export const FOLDERS = Object.values(TEAMS).map((t) => ({ id: t.id, name: t.name }) as FolderSummary)

let serial = 0
const nextId = () => (serial += 1).toString(16).padStart(64, '9')

/** Each fixture's `d`: a uuid, as the relay's are and as a link's slug needs (`identifierFromRef`). */
const D: Record<string, string> = {}
let uuids = 0
export const dOfId = (id: string) => (D[id] ??= `00000000-0000-4000-8000-${(uuids += 1).toString(16).padStart(12, '0')}`)

function event(kind: number, pubkey: string, tags: string[][], content = ''): SignedEvent {
  return { id: nextId(), sig: '0'.repeat(128), pubkey, kind, created_at: Math.floor(NOW / 1000) - 3600 + serial, tags, content }
}

const manifest = { manifest: shipManifest as unknown as ResolvedManifest['manifest'], address: `31990:${SHIP}:estiva-ship`, viaRecommendation: true, webTemplate: 'https://ship.estiva.app/o/<bech32>' }

function change(target: string, field: string, value: string, folder: string): SignedEvent {
  return event(1851, MIKY, [['a', target], ['field', field], ['value', value], ['h', folder]])
}

const text = (...lines: string[]) => serializeBlockDocument(descriptionTextToBlockDocument(lines.join('\n\n')))

type Spec = { id: string; title: string; team?: Team; archived?: boolean; summary?: string }

/** A Leaf page: its title, its summary and a line of text. */
function page({ id, title, team = 'company', archived, summary }: Spec): ForeignObject {
  const address = `30842:${MIKY}:${dOfId(id)}`
  return {
    kind: 30842,
    ref: address,
    address,
    folder: TEAMS[team].id,
    naddr: `naddr1${id}`,
    eventId: nextId(),
    meta: [],
    actions: [],
    ...(archived ? { archived: { at: Math.floor(NOW / 1000) - 86_400 * 20, by: MIKY } } : {}),
    slots: {
      title: { value: title },
      ...(summary ? { subtitle: { value: summary } } : {}),
      [BODY_SLOT]: { value: text(`${title}: notes the team keeps here.`, 'Made-up text for the prototype.'), format: 'blocks' },
    },
  } as unknown as ForeignObject
}

/** A Ship project or issue, projected through Ship's manifest: its status, its lead or assignee, its summary. */
function ship(kind: 30850 | 30851, { id, title, team = 'company', archived, summary }: Spec, status: string, project?: string): ForeignObject {
  const d = dOfId(id)
  const address = `${kind}:${MIKY}:${d}`
  const h = TEAMS[team].id
  const root =
    kind === 30850
      ? event(30850, MIKY, [['d', d], ['name', title], ['key', id.slice(0, 3).toUpperCase()], ['lead', MIKY], ['h', h]])
      : event(30851, MIKY, [['d', d], ['title', title], ['h', h], ...(project ? [['a', `30850:${MIKY}:${dOfId(project)}`]] : [])])
  const events = [
    root,
    change(address, 'status', status, h),
    ...(kind === 30851 ? [change(address, 'assignee', KATERINA, h)] : []),
    ...(summary ? [change(address, 'summary', summary, h)] : []),
    ...(archived ? [change(address, 'archived', 'true', h)] : []),
  ]
  const found = projectEvents(events, () => manifest).find((o) => o.address === address)
  if (!found) throw new Error(`Ship's manifest projected nothing at ${address}`)
  return { ...found, appName: 'Ship', openUrl: 'https://ship.estiva.app/', people: { [MIKY]: { displayName: 'Miky' }, [KATERINA]: { displayName: 'Katerina' } } }
}

/** Every file the topics list, by the spec's id. */
export const FILES: Record<string, ForeignObject> = {
  w2b2: ship(30850, { id: 'w2b2', title: 'Widgets 2: build 2', summary: 'Row and card widgets draw every file the same in Peek, Ship and Leaf.' }, 'in_progress'),
  spec: page({ id: 'spec', title: 'Widgets spec', summary: 'What a row and a card show, for every kind of file.' }),
  status: ship(30851, { id: 'status', title: 'Card widget draws status and lead' }, 'todo', 'w2b2'),
  w2b1: ship(30850, { id: 'w2b1', title: 'Widgets 2: build 1', summary: 'The first widgets, in Peek.' }, 'completed'),
  sketch: page({ id: 'sketch', title: 'Widget sketches', team: 'design' }),
  w3: ship(30850, { id: 'w3', title: 'Widgets 3' }, 'planned'),
  v0: page({ id: 'v0', title: 'Widgets v0 notes', archived: true }),
  pickers: ship(30850, { id: 'pickers', title: 'Widget pickers', archived: true }, 'completed'),
  speed: ship(30850, { id: 'speed', title: 'Peek opens instantly', team: 'engineering' }, 'in_progress'),
  speedkit: page({ id: 'speedkit', title: 'Speed kit', team: 'engineering' }),
  level: ship(30850, { id: 'level', title: 'Topics: level up the topic experience' }, 'in_progress'),
  proto: ship(30851, { id: 'proto', title: 'Topics level-up, prototyped' }, 'in_progress', 'level'),
  navdoc: page({ id: 'navdoc', title: 'Navigation notes' }),
  suits: page({ id: 'suits', title: 'Estiva Suits Update, 6 Nov' }),
  onb: page({ id: 'onb', title: 'Onboarding checklist', team: 'design' }),
  price: page({ id: 'price', title: 'Pricing draft' }),
}
const ALL_FILES = Object.values(FILES)

/** A file by its address, as the tree would hand it over. */
export const fileAt = (address: string) => ALL_FILES.find((f) => f.address === address) ?? null
/** A file by the key the tree selects it by. */
export const fileByKey = (key: string) => ALL_FILES.find((f) => (f.naddr ?? f.ref) === key) ?? null
/** A Leaf page by its `d`, as `/document/<slug>-<d>` names it. */
export const documentOfD = (d: string) => ALL_FILES.find((f) => f.kind === 30842 && f.address?.split(':')[2] === d) ?? null
/** Every file, for the relay's answers. */
export const EVERY_FILE = ALL_FILES

export interface Topic {
  id: string
  title: string
  summary?: string
  team: Team
  /** Miky is in it. */
  yours: boolean
  /** Newest activity, in minutes ago: the order. */
  at: number
  archived?: boolean
  files: string[]
  /** Ship's Topics row: projects done of all, conversations in Peek, new for you. */
  conversations: number
  fresh?: number
}

const t = (id: string, title: string, at: number, files: string[], extra: Partial<Topic> = {}): Topic => ({ id, title, team: 'company', yours: true, at, files, conversations: 3, ...extra })

export const TOPICS: Topic[] = [
  t('fast', 'Peek, Ship and Leaf are fast', 2, ['speed', 'speedkit'], { summary: 'Every app opens in under a second on Miky’s workspace.', team: 'engineering', conversations: 9, fresh: 2 }),
  t('level', 'Topics level-up', 20, ['level', 'proto'], { conversations: 5, fresh: 1 }),
  t('widgets', 'Widgets', 60, ['w2b2', 'spec', 'status', 'w2b1', 'sketch', 'w3', 'v0', 'pickers'], { summary: 'One way to draw a file inside another, in every app.', conversations: 14 }),
  t('nav', 'Universal Navigation', 180, ['navdoc'], { conversations: 21 }),
  t('suits', 'Estiva Suits Update', 1440, ['suits'], { conversations: 4 }),
  t('onb', 'Onboarding', 4000, ['onb'], { team: 'design', conversations: 2 }),
  t('price', 'Pricing', 9000, ['price'], { conversations: 1 }),
  t('hiring', 'Hiring', 300, [], { yours: false, summary: 'Who we look for next.', conversations: 6 }),
  t('brand', 'Brand refresh', 2000, ['sketch'], { yours: false, team: 'design', summary: 'Logo, colours and the site.', conversations: 3 }),
  t('interviews', 'Customer interviews', 6000, [], { yours: false, summary: 'What five companies told us.', conversations: 5 }),
  t('comments', 'Comments everywhere', 30000, ['v0'], { archived: true, summary: 'One comment box in Peek, Ship and Leaf.', conversations: 11 }),
  t('signin', 'Stay signed in', 40000, [], { archived: true, conversations: 7 }),
]

export const addressOf = (topic: Topic) => `${KIND_BARE_FILE}:${MIKY}:${dOfId(`topic-${topic.id}`)}`
export const topicOfD = (d: string) => TOPICS.find((x) => dOfId(`topic-${x.id}`) === d)
export const topicById = (id: string) => TOPICS.find((x) => x.id === id)!
const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
const byKindThenTitle = (a: ForeignObject, b: ForeignObject) => {
  const rank = (f: ForeignObject) => (f.kind === 30842 ? 0 : f.kind === 30850 ? 1 : 2)
  return rank(a) - rank(b) || byTitle({ title: a.slots.title?.value ?? '' }, { title: b.slots.title?.value ?? '' })
}

/** Your topics, newest activity first: the sidebar's order and Explore's "Your topics". `joined` are topics you joined here. */
export function yourTopics(joined: ReadonlySet<string> = new Set(), bumped?: string): Topic[] {
  const at = (x: Topic) => (x.id === bumped ? 0 : x.at)
  return TOPICS.filter((x) => !x.archived && (x.yours || joined.has(x.id))).sort((a, b) => at(a) - at(b))
}

/** Your topics as Leaf's sidebar takes them: each with the files it lists that Leaf opens, as today (pages, projects, issues, each A to Z, archived left out). */
export function sidebarTopics(joined?: ReadonlySet<string>, bumped?: string): SidebarTopic[] {
  return yourTopics(joined, bumped).flatMap((x) => {
    const files = x.files.map((id) => FILES[id]).filter((f) => !f.archived).sort(byKindThenTitle)
    return files.length ? [{ address: addressOf(x), title: x.title, files }] : []
  })
}

function rowData(x: Topic): TopicRowData {
  const projects = x.files.map((id) => FILES[id]).filter((f) => f.kind === 30850)
  return {
    address: addressOf(x),
    title: x.title,
    ...(x.summary ? { summary: x.summary } : {}),
    href: topicPath(addressOf(x), x.title),
    projects: { done: projects.filter((p) => p.slots.status?.value?.toLowerCase() === 'completed').length, total: projects.length },
    conversations: x.conversations,
    fresh: x.yours && !x.archived ? (x.fresh ?? 0) : 0,
  }
}

/** Explore's four lists: All, Other topics and Archived A to Z; Your topics in the sidebar's order. */
export function exploreLists(joined: ReadonlySet<string> = new Set()): Record<TopicsTab, TopicRowData[]> {
  const live = TOPICS.filter((x) => !x.archived)
  const mine = (x: Topic) => x.yours || joined.has(x.id)
  return {
    all: [...live].sort(byTitle).map(rowData),
    yours: yourTopics(joined).map(rowData),
    others: live.filter((x) => !mine(x)).sort(byTitle).map(rowData),
    archived: TOPICS.filter((x) => x.archived).sort(byTitle).map(rowData),
  }
}

/** A topic's page as Leaf's TopicPage reads it (`useTopicPage`). */
export function topicPageOf(x: Topic): TopicPageData {
  const files = x.files.map((id) => FILES[id]).sort(byKindThenTitle)
  return {
    address: addressOf(x),
    title: x.title,
    ...(x.summary ? { summary: x.summary } : {}),
    folder: TEAMS[x.team].id,
    archived: !!x.archived,
    space: false,
    peekUrl: `https://peek.estiva.app${topicPath(addressOf(x), x.title)}`,
    files: { live: files.filter((f) => !f.archived), archived: files.filter((f) => !!f.archived) },
  }
}

/** Leaf's Teams, as the tree draws them: each team a closed group of its pages. */
export function teamGroups(open?: string): NavTreeGroup[] {
  return (Object.keys(TEAMS) as Team[]).map((team) => ({
    id: TEAMS[team].id,
    title: TEAMS[team].name,
    open: open === TEAMS[team].id,
    nodes: ALL_FILES.filter((f) => f.kind === 30842 && !f.archived && f.folder === TEAMS[team].id).map(rowOf),
  }))
}

/** Home's Recent: the pages you touched last, newest first. */
export const RECENT: HomeRow[] = [
  { f: FILES.spec, team: 'company', by: 'Katerina', ago: 2 * 60 },
  { f: FILES.navdoc, team: 'company', by: 'Miky', ago: 3 * 60 },
  { f: FILES.speedkit, team: 'engineering', by: 'Estiva agent', ago: 26 * 60 },
  { f: FILES.suits, team: 'company', by: 'Estiva agent', ago: 30 * 60 },
  { f: FILES.onb, team: 'design', by: 'Katerina', ago: 3 * 24 * 60 },
].map(({ f, team, by, ago }) => ({
  address: f.address!,
  kind: f.kind,
  naddr: f.naddr!,
  eventId: f.eventId,
  folderId: TEAMS[team as Team].id,
  title: f.slots.title?.value ?? '',
  summary: f.slots.subtitle?.value,
  folder: TEAMS[team as Team].name,
  at: NOW - ago * MIN,
  by: MIKY,
  byName: by,
}))
