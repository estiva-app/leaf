import { DOCUMENT_TYPE, ISSUE_TYPE, PROJECT_TYPE, TOPIC_TYPE, fileFieldsOf, projectFieldsOf, relayFileReadsOf, type ProjectFields, type RelayFileReads } from '@estiva-app/protocol'
import type { TimesFn } from '@estiva-app/interop'
import { RELAY_URL } from '../config'
import { queryTimes } from './bridge'
import { documentFieldsOptIn, fieldsOptIn, issueFieldsOptIn, topicFieldsOptIn } from './fieldsOptIn'

/** The relay's NIP-11 document, which needs no sign-in; `null` in a build with no relay. */
async function relayInfo(): Promise<unknown> {
  if (!RELAY_URL) return null
  const res = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay information failed: ${res.status}`)
  return res.json()
}

/** The kind a project is written as: the type the switch names, protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850

/** The kind an issue is written as: protocol's `ISSUE_TYPE`, switched apart from projects (ISS-6). */
export const ISSUE_KIND = 30851

let held: Promise<RelayFileReads | undefined> | undefined

/** The relay's file reads from its NIP-11, read once per page; undefined (and asked again next time) when it cannot be read. */
function relayReads(): Promise<RelayFileReads | undefined> {
  // Asked inside the promise, so a read that throws is off, as a refused one is.
  held ??= Promise.resolve().then(relayInfo).then(
    (info) => {
      if (info === null) held = undefined
      return info === null ? undefined : relayFileReadsOf(info)
    },
    () => {
      held = undefined
      return undefined
    },
  )
  return held
}

/** Test seam: forget the relay's NIP-11, as a new page would. */
export function resetRelayReadsForTests(): void {
  held = undefined
  switchedHere = false
}

/**
 * Forget the relay's NIP-11, so the next question asks it again: the relay refused a change as one that must name the
 * change it follows, so it has made the switch since this tab read it (ALO-8). Every later read and write is switched.
 */
export function readRelayAgain(): void {
  held = undefined
  switchedHere = true
}

let switchedHere = false

/**
 * Whether this tab switched while open (ALO-8): what it shows was read the old way, so it holds no change for the text
 * it loaded, and a save follows the text's current change with the loaded text as the merge's base.
 */
export function switchedSinceLoad(): boolean {
  return switchedHere
}

/**
 * Whether Leaf reads and writes projects by their fields (ALO-6, SPEC §6.13): Ship's switch, protocol's one rule for
 * the three apps — the relay announces it, or this tab opted in. The relay's NIP-11 is read once per page; signed out
 * it is asked again next time. Undefined is off: read and write as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export async function projectFields(): Promise<ProjectFields | undefined> {
  const reads = await relayReads()
  return reads ? projectFieldsOf(reads, fieldsOptIn()) : undefined
}

/**
 * Whether Leaf reads and writes issues by their fields (ISS-6): the issues' own switch, protocol's `fileFieldsOf` for
 * `ISSUE_TYPE` — on once the relay keeps issues in order, or for a tab opened with `?issueFields=on` — apart from the
 * projects', as Ship's and Peek's. Undefined is off.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export async function issueFields(): Promise<ProjectFields | undefined> {
  const reads = await relayReads()
  return reads ? fileFieldsOf(reads, ISSUE_TYPE, issueFieldsOptIn()) : undefined
}

/**
 * Whether Leaf writes pages in order (ALL-4): the pages' own switch, protocol's `fileFieldsOf` for `DOCUMENT_TYPE` —
 * on once the relay keeps documents in order, or for a tab opened with `?documentFields=on`. Undefined is off: a save
 * names no change it follows and a delete is the NIP-09 one, as before. Reading a page without its old saves does not
 * wait for it ({@link treeListRead}).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-file-type-is-kept-in-order-and-a-delete-only-marks-the-file.md
 */
export async function documentFields(): Promise<ProjectFields | undefined> {
  const reads = await relayReads()
  return reads ? fileFieldsOf(reads, DOCUMENT_TYPE, documentFieldsOptIn()) : undefined
}

/** Whether Leaf writes a topic's file list in order (ALL-4): the topics' switch, or `?topicFields=on`. Undefined is off. */
export async function topicFields(): Promise<ProjectFields | undefined> {
  const reads = await relayReads()
  return reads ? fileFieldsOf(reads, TOPIC_TYPE, topicFieldsOptIn()) : undefined
}

/**
 * The types this tab writes in order, for interop's `inOrder`: each type whose switch is on here, the relay's or the
 * tab's. A Delete built from a manifest then marks the file deleted instead of asking the relay to remove it.
 */
export async function inOrderTypes(): Promise<readonly string[]> {
  const [projects, issues, documents, topics] = await Promise.all([projectFields(), issueFields(), documentFields(), topicFields()])
  return [
    ...(projects ? [PROJECT_TYPE] : []),
    ...(issues ? [ISSUE_TYPE] : []),
    ...(documents ? [DOCUMENT_TYPE] : []),
    ...(topics ? [TOPIC_TYPE] : []),
  ]
}

/** The switch for the type of the file at `address`: a project's, an issue's or a page's, undefined for any other kind or when off. */
export async function fieldsFor(address: string | undefined): Promise<ProjectFields | undefined> {
  if (isProject(address)) return projectFields()
  if (isIssue(address)) return issueFields()
  if (isPage(address)) return documentFields()
  return undefined
}

/**
 * Whether the relay answers the list read (SPEC §6.13), switched or not: finding a file's parents, and whether one of
 * them is archived, then reads each parent's current values rather than its every change (ALO-15).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function listReadOffered(): Promise<boolean> {
  return (await relayReads())?.list === true
}

/**
 * The topics' activity read's `times`, when the relay answers the times read (NIP-11 `file_list.times`): ordering
 * topics learns when the files on them changed, not their whole changes (ALO-22). Empty on any other relay, which is
 * read as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-may-answer-when-a-file-changed-without-the-change.md
 */
export async function timesRead(): Promise<{ times?: TimesFn }> {
  return (await relayReads())?.times === true ? { times: queryTimes } : {}
}

/**
 * `resolveForeignRoots`' `{ archivedWith: true }`, with its `listRead` once switched. There `listRead` reads the files
 * themselves by the list read too (no text, a deleted one left out), not only the parents walked, so it waits for the
 * switch as Peek's root reads do. The parents walked for an archive are read by the list read as soon as the relay
 * offers it, switched or not (`parentsListRead`, ALO-15).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function archivedRootsOptions(): Promise<{ archivedWith: true; listRead?: true; parentsListRead?: true }> {
  if (await projectFields()) return { archivedWith: true, listRead: true }
  return (await listReadOffered()) ? { archivedWith: true, parentsListRead: true } : { archivedWith: true }
}

/** `{ archivedWith: true }`, with interop's `listRead` once the relay offers it: each parent walked costs its current values. */
export async function archivedWithOptions(): Promise<{ archivedWith: true; listRead?: true }> {
  return (await listReadOffered()) ? { archivedWith: true, listRead: true } : { archivedWith: true }
}

/** Whether `address` names a project. */
export function isProject(address: string | undefined): boolean {
  return !!address && address.startsWith(`${PROJECT_KIND}:`)
}

/** Whether `address` names an issue. */
export function isIssue(address: string | undefined): boolean {
  return !!address && address.startsWith(`${ISSUE_KIND}:`)
}

/** The kind a page is written as: protocol's `DOCUMENT_TYPE`, switched apart from the others (ALL-4). */
export const PAGE_KIND = 30842

/** Whether `address` names a Leaf page. */
export function isPage(address: string | undefined): boolean {
  return !!address && address.startsWith(`${PAGE_KIND}:`)
}

/** Whether `address` names a file of a kind a switch covers: a project, an issue or a page. */
export function isSwitchedKind(address: string | undefined): boolean {
  return isProject(address) || isIssue(address) || isPage(address)
}

/** Whether `address` is a project or an issue read and written by its fields in this tab, each by its own switch. */
export async function byFields(address: string | undefined): Promise<boolean> {
  return !!(await fieldsFor(address))
}

/**
 * The kinds the open read opens, for interop's `openRead`: projects once switched, issues once theirs is (ISS-6), and
 * pages as soon as the relay offers the read (ALL-4): a page opens as its first record, its fields' current changes and
 * its current text, never every save made to it, whether or not the relay keeps pages in order yet.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function openReadOption(): Promise<{ openRead?: readonly number[] }> {
  const [projects, issues, offered] = await Promise.all([projectFields(), issueFields(), pageReadOffered()])
  const kinds = [...(projects ? [PROJECT_KIND] : []), ...(issues ? [ISSUE_KIND] : []), ...(offered ? [PAGE_KIND] : [])]
  return kinds.length ? { openRead: kinds } : {}
}

/** Whether the file at `address` is opened by the open read here, so what it names as current is the relay's current. */
export async function readsCurrent(address: string | undefined): Promise<boolean> {
  const { openRead } = await openReadOption()
  return !!address && !!openRead?.some((kind) => address.startsWith(`${kind}:`))
}

/**
 * Whether the relay searches pages by their current words (`file_search.types`), so the `[` picker finds a page by
 * what it says now and never by an old save's words (ALL-4); undefined on a relay that does not.
 */
export async function searchesPages(): Promise<boolean> {
  return !!(await relayReads())?.search.includes(DOCUMENT_TYPE)
}

/**
 * Whether the relay answers the list, text and times reads, so a page is read without its old saves: listed by its
 * current changes, opened with its current text, and ranked on Home by when its text last changed.
 */
async function pageReadOffered(): Promise<boolean> {
  const reads = await relayReads()
  return !!reads?.list && !!reads.text && !!reads.times
}

/**
 * The tree's `listRead`, once projects are switched, as Peek's tree reads it (`listReadOption`): listing the teams and
 * each team's files reads every file as its first record and its fields' current changes, not every change ever made
 * to it — a project's issues under its row too. Before, a cold Leaf open read every old change of every listed file:
 * 78 MB as Miky on 19 Nov, 48 MB of it projects' (ISS-6). Only the kinds Leaf lists and never edits from the tree:
 * Leaf's pages too, as soon as the relay offers the list and text reads, switched or not (ALL-4): the tree holds each
 * page's row, and a page opens by its address with its current text ({@link openReadOption}). Before, a cold open read
 * every save of every page: 12.3 MB of them on 19 Nov.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/opening-a-file-reads-its-current-text-not-its-history.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function treeListRead(): Promise<{ listRead?: true; listReadKinds?: readonly number[] }> {
  const [projects, offered, pages] = await Promise.all([projectFields(), listReadOffered(), pageReadOffered()])
  const kinds = [...(projects && offered ? [PROJECT_KIND, ISSUE_KIND] : []), ...(pages ? [PAGE_KIND] : [])]
  return kinds.length ? { listRead: true, listReadKinds: kinds } : {}
}

/** The kinds the tree may read by the list read: projects and issues once switched, pages once the relay offers it. */
const LISTED_KINDS = [PROJECT_KIND, ISSUE_KIND, PAGE_KIND] as const

/**
 * Whether `address` is of a kind the tree and Home may read by the list read: its row only, its text unread (ISS-6,
 * ALL-4). Only for files a read made with {@link treeListRead}'s `listRead`, which names the kinds it read that way.
 */
export function isListedKind(address: string | undefined): boolean {
  return LISTED_KINDS.some((kind) => !!address && address.startsWith(`${kind}:`))
}
