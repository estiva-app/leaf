import { useEffect, useReducer } from 'react'
import { IconCornerDownLeft, IconFilePlus, IconMessagePlus } from '@tabler/icons-react'
import {
  CommandLauncher,
  launcherApps,
  onDeviceModel,
  type KeptLauncherBox,
  type LauncherAnswer,
  type LauncherAnswerAction,
  type LauncherContext,
  type LauncherFileHit,
  type LauncherHost,
  type LauncherWords,
} from '@estiva-app/launcher'
import { KIND } from '@estiva-app/protocol'
import { LinkCard, thingKindOf } from '@estiva-app/ui'
import { useReportFailure } from '@/lib/failureReports'
import { useDirectory } from '../comments/people'
import { linkStateOf } from '../document/linked'
import { fileHits, subscribeFileHits } from '../document/referencePicker'
import { readDocument } from '../document/save'
import { naddrOf } from '../fileAddress'
import { openerOf } from '../pages/OwnerRow'
import { useFileByAddress } from '../pages/useFileByAddress'
import { documentPath, dOf, filePath, navigate, usePathname } from '../route'
import { topicPath } from '../topics/topicLinks'
import { blocksOfPart, openPageActions, showPart } from './openPage'

/*
  KIN-5 — Leaf's ⌘K: the box Peek ships (@estiva-app/launcher), handed what only Leaf knows. A name finds files from
  every app; a sentence asks about the open page (its text and its comments); an answer becomes a comment or a block.
  Leaf lists no other app: none declares an action Leaf may sign today, and an app with nothing to offer is noise.
*/

const WORDS: LauncherWords = {
  anywhere: 'Anywhere in Leaf',
  inOpen: 'On this page',
  search: 'Search Leaf',
  searchOrAsk: 'Search, or ask about this page',
  openGroup: 'This page',
  nothingOpen: 'Open a page to ask about it.',
  nothingYet: 'Nothing has been written here yet.',
  reading: 'Reading the page…',
  downloadModel: 'Download the on-device model to ask about pages',
  part: { one: 'passage', many: 'passages' },
}

const APPS = launcherApps('leaf').filter((app) => app.isHost)
const IDLE = { state: { kind: 'idle' } as const, hits: [] as LauncherFileHit[] }

/** What `[` finds, as the box's file search: files from every app by the words of their fields. */
function useLeafFileSearch(query: string): ReturnType<LauncherHost['useFileSearch']> {
  const [, answered] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeFileHits(answered), [])
  const typed = query.trim()
  if (typed.length < 2) return IDLE
  const hits = fileHits(typed).map(({ id, title, summary, caption }) => ({ id, title, ...(summary ? { summary } : {}), ...(caption ? { caption } : {}) }))
  return { state: { kind: 'done', count: hits.length }, hits }
}

const kindOf = (address: string) => Number(address.split(':')[0])

/**
 * Where a file opens: a page here, a topic on Leaf's own topic page, anything else in its own app (a Ship issue in
 * Ship), from its manifest's address; one that gives none opens here.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-opens-in-the-app-you-are-in-when-it-has-a-page-made-for-that-kind.md
 */
function openFile(address: string, title: string): void {
  const kind = kindOf(address)
  if (kind === KIND.DOCUMENT) return navigate(documentPath(dOf(address), title))
  if (thingKindOf(kind) === 'topic') return navigate(topicPath(address, title))
  const naddr = naddrOf(address)
  void readDocument(naddr)
    .catch(() => null)
    .then((file) => {
      const away = file ? openerOf(file) : undefined
      if (away) window.location.assign(away)
      else navigate(filePath(naddr))
    })
}

/** The card a link to the file draws, beside the box while its row is lit. */
function FilePreview({ address }: { address: string }) {
  const naddr = naddrOf(address)
  const { file, loading } = useFileByAddress(naddr)
  const uri = `nostr:${naddr}`
  return <LinkCard link={loading ? { state: 'loading', kind: thingKindOf(kindOf(address)) } : linkStateOf(uri, file)} bare readOnly />
}

/** A person's DM is Peek's: on Leaf's sibling host, Peek's. */
function openPerson(pubkey: string): void {
  const peek = window.location.origin.replace(/\/\/leaf\./, '//peek.')
  if (peek !== window.location.origin) window.location.assign(`${peek}/app/dms/${encodeURIComponent(pubkey)}`)
}

/** What an answer about the page can become here: a new comment, or a block in the page (Miky, KIN-5 kickoff). */
function answerActions(answer: LauncherAnswer): LauncherAnswerAction[] {
  const page = openPageActions()
  if (!page) return []
  const first = answer.cited[0]
  const blocks = first ? blocksOfPart(first) : null
  const passage = answer.cited.find((part) => part.where === 'In the page')
  const after = passage ? passage.id : (blocks?.[0] ?? null)
  return [
    {
      id: 'comment',
      label: 'Draft a comment',
      description: blocks ? 'On the passage it cites first. It will not send: edit it first.' : 'On the whole page. It will not send: edit it first.',
      icon: <IconMessagePlus size={16} stroke={1.5} />,
      run: () => page.draftComment(answer.text, blocks),
    },
    {
      id: 'insert',
      label: 'Insert into the page',
      description: after ? 'As a block under the passage it cites first.' : 'As a block at the end of the page.',
      icon: <IconCornerDownLeft size={16} stroke={1.5} />,
      run: () => page.insert(answer.text, after),
    },
  ]
}

const NO_FORM: LauncherHost['form'] = {
  // Leaf opens no form: it lists no app whose action it may sign, and New document opens Leaf's own dialog.
  references: {} as LauncherHost['form']['references'],
  mentions: {} as LauncherHost['form']['mentions'],
  referenceView: () => null,
  personField: () => null,
}

/** Leaf's ⌘K box, held by the frame (`useKeptLauncher`), with Leaf's New document when a team takes one. */
export function LeafLauncher({ onNewDocument, ...box }: KeptLauncherBox<LauncherContext> & { onNewDocument?: () => void }) {
  const pathname = usePathname()
  const directory = useDirectory()
  const people = Object.entries(directory).map(([id, person]) => ({ id, name: person.displayName, ...(person.picture ? { avatarSrc: person.picture } : {}) }))
  const host: LauncherHost = {
    apps: APPS,
    mark: () => null,
    words: WORDS,
    path: { pathname, search: window.location.search },
    navigate,
    people,
    openPerson,
    file: {
      glyph: (id) => thingKindOf(kindOf(id)),
      open: openFile,
      isOpen: (id) => pathname.includes(dOf(id)),
      preview: (id) => <FilePreview address={id} />,
    },
    useFileSearch: useLeafFileSearch,
    plain: (body) => body,
    manifests: { creatableUnder: async () => null, applyAction: async () => ({ ok: false, reason: 'Leaf does not do this.' }), resolveObject: async () => null },
    model: onDeviceModel,
    showSource: showPart,
    form: NO_FORM,
    // Leaf signs documents, comments and their changes (Estiva ID's allowed kinds for Leaf), never another app's file.
    maySign: (kind) => kind === KIND.DOCUMENT,
    ...(onNewDocument ? { ownActions: [{ id: 'new-document', label: 'New document', icon: <IconFilePlus size={16} stroke={1.5} />, run: onNewDocument }] } : {}),
    answerActions,
    useReportFailure,
  }
  return <CommandLauncher host={host} {...box} />
}
