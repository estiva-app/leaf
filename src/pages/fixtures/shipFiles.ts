import { projectEvents, type ForeignObject, type ResolvedManifest } from '@estiva-app/interop'
import { descriptionTextToBlockDocument, serializeBlockDocument, type SignedEvent } from '@estiva-app/protocol'
import type { CommentItem, Thread } from '../../comments/comments'
import type { ThreadsState } from '../../comments/useThreads'
import shipManifest from './ship-manifest.json'

/*
  A Ship issue and a Ship project as Leaf would read them, for the stories of LTX's prototype: their events are
  projected by interop through Ship's real manifest (`estiva-ship:src/nostr/manifest.ts` `manifestContent()`,
  dumped on 19 Oct 2026), so the row under the title comes from the projection's slots, not from knowing 30850/30851.
*/

const SHIP = 'b'.repeat(64)
export const MIKY = 'a'.repeat(64)
export const KATERINA = 'c'.repeat(64)
const FOLDER = 'f0f0f0f0-0000-4000-8000-000000000001'
const AT = Math.floor(Date.UTC(2026, 9, 19, 9) / 1000)

let serial = 0
function event(kind: number, pubkey: string, tags: string[][], content = '', at = AT): SignedEvent {
  serial += 1
  return { id: serial.toString(16).padStart(64, '0'), sig: '0'.repeat(128), pubkey, kind, created_at: at, tags, content }
}

/** A `kind:1851` change to one field of a file, as Ship and Leaf both write it (SPEC §6.2). */
function change(target: string, field: string, value: string, by = MIKY, extra: string[][] = []): SignedEvent {
  return event(1851, by, [['a', target], ['field', field], ['value', value], ['h', FOLDER], ...extra], '', AT + serial)
}

/** A block document's text, in the `estiva-blocks-1` shape Ship's describe actions write. */
function blocks(...lines: string[]): string {
  return serializeBlockDocument(descriptionTextToBlockDocument(lines.join('\n\n')))
}

const manifest = { manifest: shipManifest as unknown as ResolvedManifest['manifest'], address: `31990:${SHIP}:estiva-ship`, viaRecommendation: true, webTemplate: 'https://ship.estiva.app/o/<bech32>' }

function projected(events: SignedEvent[], address: string): ForeignObject {
  const found = projectEvents(events, () => manifest).find((object) => object.address === address)
  if (!found) throw new Error(`Ship's manifest projected nothing at ${address}`)
  return {
    ...found,
    appName: 'Ship',
    openUrl: 'https://ship.estiva.app/',
    people: { [MIKY]: { displayName: 'Miky' }, [KATERINA]: { displayName: 'Katerina' } },
  }
}

const PROJECT = `30850:${MIKY}:ltx`
const ISSUE = `30851:${MIKY}:ltx-3`

const DESCRIPTION = blocks(
  '## Who, when',
  'Miky, 19 October: he opened Leaf and most rows in its tree only said "Open in Peek" or "Open in Ship".',
  '## What changes',
  'A Ship project or issue opens in Leaf as a page, with Ship\'s row under its title and its text in Leaf\'s editor.',
  '## Done when',
  'QA-1 changes an issue\'s description in Leaf and QA-2 reads it on ship.estiva.app.',
)

/** A Ship issue, with or without a description; archived when `archived` is set. */
export function shipIssue({ description = true, archived = false }: { description?: boolean; archived?: boolean } = {}): ForeignObject {
  const root = event(30851, MIKY, [['d', 'ltx-3'], ['title', 'Sidebar should not show Peek topics'], ['h', FOLDER], ['a', PROJECT]])
  const project = event(30850, MIKY, [['d', 'ltx'], ['name', 'Leaf edits any file\'s text'], ['key', 'LTX'], ['h', FOLDER]])
  return projected([
    project,
    root,
    change(ISSUE, 'ref', 'LTX-3'),
    change(ISSUE, 'status', 'in_progress'),
    change(ISSUE, 'assignee', KATERINA),
    change(ISSUE, 'summary', 'A Ship project or issue opens in Leaf with its row, and Leaf\'s tree stops listing Peek topics.'),
    ...(description ? [change(ISSUE, 'description', DESCRIPTION, MIKY, [['content-format', 'estiva-blocks-1']])] : []),
    ...(archived ? [change(ISSUE, 'archived', 'true')] : []),
  ], ISSUE)
}

/** A Ship project: its status, lead and key. */
export function shipProject(): ForeignObject {
  return projected([
    event(30850, MIKY, [['d', 'ltx'], ['name', 'Leaf edits any file\'s text'], ['key', 'LTX'], ['lead', MIKY], ['h', FOLDER]]),
    change(PROJECT, 'status', 'planned'),
    change(PROJECT, 'summary', 'Leaf becomes where you read and write any file\'s text.'),
    change(
      PROJECT,
      'description',
      blocks('## Goal', 'Leaf is where you read and write any file\'s text: a Ship project or issue opens in Leaf and its description is written there.'),
      MIKY,
      [['content-format', 'estiva-blocks-1']],
    ),
  ], PROJECT)
}

/** The text after Katerina's save, for "someone else's newer save". */
export const NEWER_DESCRIPTION = blocks(
  '## Who, when',
  'Katerina, 20 October: she rewrote this issue in Leaf while Miky had it open.',
)

/** The profiles a story's relay answers with: the names on the row, in the comments and in `@`. */
export const PROFILES: SignedEvent[] = [
  event(0, MIKY, [], JSON.stringify({ name: 'Miky' })),
  event(0, KATERINA, [], JSON.stringify({ name: 'Katerina' })),
]

function comment(by: string, body: string, minutesAgo: number): CommentItem {
  const at = Math.floor(Date.now() / 1000) - minutesAgo * 60
  return { id: `c${minutesAgo}`, by, at, body, edited: false, files: [], reactions: [], event: event(1111, by, [], body, at) }
}

/** A file's comments, as the column's read hands them over: one on the whole text with a reply. */
export function threadsOn(file: ForeignObject): ThreadsState {
  const threads: Thread[] = [
    {
      id: 'c42',
      root: comment(KATERINA, `Can the row under "${file.slots.title?.value ?? ''}" show the status as words, not only its colour?`, 42),
      replies: [comment(MIKY, 'Yes — words beside the mark, as on the card.', 12)],
      resolved: false,
    },
  ]
  return { threads, reactionsOmitted: 0, reactionsCut: false, failed: false, readAt: Date.now(), reread: () => {} }
}
