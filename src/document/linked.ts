import { useState } from 'react'
import { referenceToPointer, stripInlineFormatting } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { linkStateFrom, useToast, type LinkState, type LinkedFromOptions, type LinkedKind } from '@estiva-app/ui'
import { links } from '../comments/links'
import { useDirectory } from '../comments/people'
import { useCardConversation } from './cardConversation'
import { rereadReference, useFile } from './references'
import { saveCardChoice } from './save'

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
  return links.opener(written, object.openUrl, window.location.origin) ??(object.openUrl && /^https:\/\//i.test(object.openUrl) ? object.openUrl : '')
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
 * A link's state with what a card adds: its comment count, and its status and
 * owner pickers, each change written and the file read again, since the relay
 * is the authority on whether it happened. A field its own app shares may be
 * changed from its card in any app (Miky, 21 Oct). The choice shows at once
 * and is held until that read lands.
 */
export function useCardLinkState(uri: string, written?: string): LinkState {
  const read = useFile(uri)
  const [chosen, choose] = useState<{ actionId: string; value: string } | null>(null)
  const object = read && chosen ? { ...read, actions: read.actions.map((one) => (one.id === chosen.actionId ? { ...one, current: chosen.value } : one)) } : read
  const count = useCardConversation(read && !read.unreachable ? read.address : undefined)
  const directory = useDirectory()
  const { showToast } = useToast()
  const onAct = async (actionId: string, value: string) => {
    if (!read) return
    choose({ actionId, value })
    const result = await saveCardChoice(read, actionId, value)
    // The picker goes back to what the relay holds, so say why rather than let it look like a slip.
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    await rereadReference(uri)
    choose(null)
  }
  const href = object ? openerOf(object, written) : ''
  return linkStateOf(uri, object, written, {
    onAct: (actionId, value) => void onAct(actionId, value),
    directory,
    ...(count !== undefined && href ? { conversation: { count, href } } : {}),
  })
}
