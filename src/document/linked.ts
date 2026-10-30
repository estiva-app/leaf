import { createContext, useContext, useState } from 'react'
import { KIND, referenceToPointer, stripInlineFormatting } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { linkStateFrom, useToast, type LinkState, type LinkedFromOptions, type LinkedKind } from '@estiva-app/ui'
import { links } from '../comments/links'
import { useDirectory } from '../comments/people'
import { viewerPubkey } from '../relay/bridge'
import { COMMENTS_HASH, pagePath } from '../route'
import { useCardConversation } from './cardConversation'
import { rereadReference, useFile } from './references'
import { saveCardChoice } from './save'
import { sharesText } from './writable'

/*
  What a link in a page or a comment stands for, as the kit's chip, row and
  card draw it: the kit's one builder (`linkStateFrom`), which Peek and Ship
  use too, so one file draws as one card in every app (5ebf2756). What is
  Leaf's own is where a link opens, a message's words, and what an address is
  before it is read.
  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-edits-a-document-with-one-shared-editor.md
*/

/** What an address is, by its kind, before anything has been read. */
const KIND_WORDS: Record<number, { kind: LinkedKind; noun: string }> = {
  30850: { kind: 'project', noun: 'Project' },
  30851: { kind: 'issue', noun: 'Issue' },
  30840: { kind: 'topic', noun: 'Topic' },
  30842: { kind: 'page', noun: 'Document' },
}

/** The kind an `naddr` names, without asking the relay; `undefined` for anything else. */
function kindOfUri(uri: string): number | undefined {
  if (!/^nostr:naddr1/i.test(uri)) return undefined
  try {
    return referenceToPointer(uri).kind
  } catch {
    return undefined
  }
}

/** What a reference names, by its icon and its word, before anything has been read. */
function unreadOf(uri: string): { kind: LinkedKind; noun: string } {
  if (/^nostr:(?:nevent1|note1)/i.test(uri)) return { kind: 'message', noun: 'Message' }
  const kind = kindOfUri(uri)
  return (kind !== undefined && KIND_WORDS[kind]) || { kind: 'file', noun: 'File' }
}

/**
 * Where a link opens: the URL the page wrote, on a host an app serves (LTX-6),
 * else the address its own app gives it, https only — another app's address
 * comes from a manifest anyone may publish.
 */
function openerOf(object: { openUrl?: string }, written?: string): string {
  return links.opener(written, object.openUrl, window.location.origin) ?? (object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : '')
}

/**
 * Where a reference's read stands, for the kit: `undefined` is still read,
 * `null` an answer of nothing. `written` is the URL the text wrote for it.
 */
export function linkStateOf(
  uri: string,
  object: ForeignObject | null | undefined,
  written?: string,
  more: Pick<LinkedFromOptions, 'onAct' | 'conversation' | 'directory'> = {},
): LinkState {
  return linkStateFrom(object, unreadOf(uri), {
    hrefOf: (file, top) => openerOf(file, top ? written : undefined),
    previewText: (body) => stripInlineFormatting(body).trim(),
    ...more,
  })
}

/**
 * Where a file's comment count opens: its conversation. Leaf shows a file's
 * comments beside its page, so a file Leaf opens as a page (its own
 * documents, a file whose app shares its text) opens there with them shown
 * (`COMMENTS_HASH`). Any other file opens in its own app, as its title does:
 * Ship's count does the same for a file it does not own.
 */
function conversationOf(file: ForeignObject, opens: string): string {
  if (!file.address || !sharesText(file) || (file.kind !== KIND.DOCUMENT && !file.naddr)) return opens
  const title = file.slots.title?.isPubkey ? undefined : file.slots.title?.value
  return `${pagePath({ kind: file.kind, address: file.address, naddr: file.naddr, title })}${COMMENTS_HASH}`
}

/** A read file's comment count and where it opens, once counted (5ebf2756); nothing for a file with nowhere to open. */
function useConversation(read: ForeignObject | null | undefined, written?: string): LinkedFromOptions['conversation'] {
  const count = useCardConversation(read && !read.unreachable ? read.address : undefined)
  const opens = read ? openerOf(read, written) : ''
  return read && count !== undefined && opens ? { count, href: conversationOf(read, opens) } : undefined
}

/** A link alone on its line, with its comment count, as a card has (Katerina, 30 Oct: the count on rows too). */
export function useRowLinkState(uri: string, written?: string): LinkState {
  const read = useFile(uri)
  const conversation = useConversation(read, written)
  return linkStateOf(uri, read, written, conversation ? { conversation } : {})
}

const Acts = createContext(true)

/**
 * Whether the reader may change a file from its card here: not on an archived
 * page or in its closed comments, where a card's status and owner read as
 * words (Katerina, 30 Oct). A signed-out reader never may.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-archived-file-is-read-only-in-every-app.md
 */
export const CardActsProvider = Acts.Provider

/**
 * A file's status and owner pickers, as its card offers them: each change
 * written, and shown at once until the file is read again (`reread`, or a new
 * read handed in), since the relay is the authority on whether it happened. A
 * refused change says why. No `onAct` where the reader may not change it.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export function useFileChoices(
  read: ForeignObject | null | undefined,
  reread?: () => Promise<void>,
): { object: ForeignObject | null | undefined; onAct?: (actionId: string, value: string) => void } {
  const [chosen, choose] = useState<{ on: ForeignObject; actionId: string; value: string } | null>(null)
  // Held for the read it was made on: the next read is the relay's answer.
  const held = read && chosen?.on === read ? chosen : null
  const object = read && held ? { ...read, actions: read.actions.map((one) => (one.id === held.actionId ? { ...one, current: held.value } : one)) } : read
  const acts = useContext(Acts) && !!viewerPubkey()
  const { showToast } = useToast()
  const act = async (actionId: string, value: string) => {
    if (!read) return
    choose({ on: read, actionId, value })
    const result = await saveCardChoice(read, actionId, value)
    // The picker goes back to what the relay holds, so say why rather than let it look like a slip.
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    if (reread) await reread()
    if (!result.ok || reread) choose(null)
  }
  return { object, ...(acts ? { onAct: (actionId: string, value: string) => void act(actionId, value) } : {}) }
}

/**
 * A link's state with what a card adds: its comment count, and its status and
 * owner pickers ({@link useFileChoices}), the file read again after each
 * change. A field its own app shares may be changed from its card in any app
 * (Miky, 21 Oct).
 */
export function useCardLinkState(uri: string, written?: string): LinkState {
  const read = useFile(uri)
  const { object, onAct } = useFileChoices(read, () => rereadReference(uri))
  const conversation = useConversation(read, written)
  const directory = useDirectory()
  return linkStateOf(uri, object, written, {
    ...(onAct ? { onAct } : {}),
    directory,
    ...(conversation ? { conversation } : {}),
  })
}
