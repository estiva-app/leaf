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
import { encodeNpub, KIND } from '@estiva-app/protocol'
import { LinkCard, thingKindOf } from '@estiva-app/ui'
import { useReportFailure } from '@/lib/failureReports'
import { useDirectory, useMentionPeople } from '../comments/people'
import { linkStateOf } from '../document/linked'
import { PageLink } from '../document/PageLink'
import { fileHits, REFERENCE_COPY, referenceSections, subscribeFileHits, subscribeReferences } from '../document/referencePicker'
import { readDocument } from '../document/save'
import { naddrOf } from '../fileAddress'
import { openerOf } from '../pages/OwnerRow'
import { useFileByAddress } from '../pages/useFileByAddress'
import { documentPath, dOf, filePath, navigate, usePathname } from '../route'
import { topicOpener } from '../topics/topicLinks'
import type { ForeignObject } from '@estiva-app/interop'
import { applyAction, creatableUnder, leafMaySign } from './creations'
import { blocksOfPart, cursorBlockAtOpen, openPageActions, showPart } from './openPage'

/*
  KIN-5 — Leaf's ⌘K: the box Peek ships (@estiva-app/launcher), handed what only Leaf knows. A name finds files from
  every app; a sentence asks about the open page (its text and its comments); an answer becomes a comment or a block.
  Of the other apps Leaf lists Ship, whose Create issue and Create project it makes in Leaf by following Ship's manifest,
  as Peek's ⌘K does (KIN-11); an app with nothing Leaf may make is noise.
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

// Leaf, and each app that declares something Leaf may make: Ship's Create issue and Create project (KIN-11). Peek's
// actions are a topic and a message, which Leaf does not write, so it is not listed: an app with nothing to offer is noise.
const APPS = launcherApps('leaf').filter((app) => app.isHost || app.actions.some((action) => typeof action.emits?.kind === 'number' && leafMaySign(action.emits.kind)))
const IDLE = { state: { kind: 'idle' } as const, hits: [] as LauncherFileHit[] }

/** What `[` finds, as the box's file search: files from every app by the words of their fields. */
function useLeafFileSearch(query: string): ReturnType<LauncherHost['useFileSearch']> {
  const [, answered] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeFileHits(answered), [])
  const typed = query.trim()
  if (typed.length < 2) return IDLE
  // A Ship file opens in Ship: its row says so, as the story drew it, before the person leaves Leaf.
  const hits = fileHits(typed).map(({ id, title, summary, caption }) => {
    const away = SHIP_KINDS.has(kindOf(id)) ? 'Opens in Ship' : undefined
    const where = [caption, away].filter(Boolean).join(' · ')
    return { id, title, ...(summary ? { summary } : {}), ...(where ? { caption: where } : {}) }
  })
  return { state: { kind: 'done', count: hits.length }, hits }
}

const kindOf = (address: string) => Number(address.split(':')[0])
/** Ship's project and issue: what opens in Ship, not here. */
const SHIP_KINDS = new Set([30850, 30851])

/**
 * Where a file opens: a page here, a topic on Leaf's own topic page, anything else in its own app (a Ship issue in
 * Ship), from its manifest's address; one that gives none opens here.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-opens-in-the-app-you-are-in-when-it-has-a-page-made-for-that-kind.md
 */
export function openFile(address: string, title: string): void {
  const kind = kindOf(address)
  if (kind === KIND.DOCUMENT) return navigate(documentPath(dOf(address), title))
  // A topic on Leaf's topic page, as a link to it opens; a space is Peek's, and opens there below.
  const here = thingKindOf(kind) === 'topic' ? topicOpener({ address, slots: { title: { value: title } } as ForeignObject['slots'] }) : undefined
  if (here) return navigate(here)
  const naddr = naddrOf(address)
  void readDocument(naddr)
    .catch(() => null)
    .then((file) => {
      const away = file ? openerOf(file) : undefined
      // Only to Estiva's own Ship or Peek, beside Leaf: any key can publish a manifest until WOR-2, so a planted
      // address never takes the tab elsewhere (KIN-5 security review). Anything else opens here.
      if (away && isSibling(away)) window.location.assign(away)
      else navigate(filePath(naddr))
    })
}

/** Whether an address is on Ship's or Peek's host beside Leaf's (ship.estiva.app beside leaf.estiva.app). */
function isSibling(address: string): boolean {
  const here = window.location.origin
  if (!/\/\/leaf\./.test(here)) return false
  try {
    const origin = new URL(address).origin
    return origin === here.replace(/\/\/leaf\./, '//ship.') || origin === here.replace(/\/\/leaf\./, '//peek.')
  } catch {
    return false
  }
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
  // Where you were writing, as the approved story says; else under the passage it cites first; else at the end.
  const cursor = cursorBlockAtOpen()
  const after = cursor ?? (passage ? passage.id : (blocks?.[0] ?? null))
  // A row that cannot succeed is not offered: an archived or read-only page takes neither (KIN-5 review).
  return [
    ...(page.canComment
      ? [
          {
            id: 'comment',
            label: 'Draft a comment',
            description: blocks ? 'It will not send. Edit it first.' : 'On the whole document. It will not send. Edit it first.',
            icon: <IconMessagePlus size={16} stroke={1.5} />,
            run: () => page.draftComment(answer.text, blocks),
          },
        ]
      : []),
    ...(page.canEdit
      ? [
          {
            id: 'insert',
            label: 'Insert into the page',
            description: cursor
              ? 'Where your cursor was.'
              : passage
                ? 'Under the passage it cites first.'
                : after
                  ? 'Under the passage its first comment is on.'
                  : 'At the end of the document.',
            icon: <IconCornerDownLeft size={16} stroke={1.5} />,
            run: () => page.insert(answer.text, after),
          },
        ]
      : []),
  ]
}

/** `[` in a form's description: what the page editor's `[` offers. */
const FORM_REFERENCES: LauncherHost['form']['references'] = { sections: referenceSections, subscribe: subscribeReferences, ariaLabel: REFERENCE_COPY.ariaLabel, sectionLabel: REFERENCE_COPY.files }

/**
 * What the box's form needs of Leaf, for Ship's Create issue and Create project (KIN-11): `[` and `@` in a
 * description as the page editor has them, and a reference drawn as a page link. Neither form asks for a person, so
 * there is no picker.
 */
function useLeafForm(): LauncherHost['form'] {
  const people = useMentionPeople()
  return {
    references: FORM_REFERENCES,
    mentions: { people: () => people.people, uriOf: (person) => (person.pubkey ? `nostr:${encodeNpub(person.pubkey)}` : null) },
    referenceView: PageLink,
    personField: () => null,
  }
}

/** Leaf's ⌘K box, held by the frame (`useKeptLauncher`), with Leaf's New document when a team takes one. */
export function LeafLauncher({ onNewDocument, newDocumentIn, ...box }: KeptLauncherBox<LauncherContext> & { onNewDocument?: () => void; newDocumentIn?: string }) {
  const pathname = usePathname()
  const directory = useDirectory()
  const people = Object.entries(directory).map(([id, person]) => ({ id, name: person.displayName, ...(person.picture ? { avatarSrc: person.picture } : {}) }))
  const form = useLeafForm()
  const host: LauncherHost = {
    apps: APPS,
    mark: () => null,
    words: WORDS,
    path: { pathname, search: window.location.search },
    navigate,
    // A person opens in Peek beside Leaf; where there is none to find (a preview, localhost), no person is offered.
    people: /\/\/leaf\./.test(window.location.origin) ? people : [],
    openPerson,
    file: {
      glyph: (id) => thingKindOf(kindOf(id)),
      open: openFile,
      isOpen: (id) => pathname.includes(dOf(id)),
      preview: (id) => <FilePreview address={id} />,
    },
    useFileSearch: useLeafFileSearch,
    plain: (body) => body,
    // A creation another app declares, made here by following its manifest (KIN-11); nothing else is applied from Leaf's ⌘K.
    manifests: { creatableUnder, applyAction, resolveObject: async () => null },
    model: onDeviceModel,
    showSource: showPart,
    form,
    // Leaf signs its documents and the Ship files its ⌘K makes (Estiva ID's allowed kinds for Leaf), never a topic or a message.
    maySign: leafMaySign,
    ...(onNewDocument ? { ownActions: [{ id: 'new-document', label: 'New document', ...(newDocumentIn ? { description: `In ${newDocumentIn}` } : {}), icon: <IconFilePlus size={16} stroke={1.5} />, run: onNewDocument }] } : {}),
    answerActions,
    useReportFailure,
  }
  return <CommandLauncher host={host} {...box} />
}
