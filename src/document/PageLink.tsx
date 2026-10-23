import { createContext, useContext, useEffect, useRef } from 'react'
import { InlineChip, LinkCard, LinkChip, LinkRow } from '@estiva-app/ui'
import type { ReferenceViewProps } from '@estiva-app/ui/editor'
import { decodeNpub } from '@estiva-app/protocol'
import { knownName } from '../comments/people'
import { linkStateOf, useCardLinkState } from './linked'
import { useFile } from './references'

const Names = createContext<(pubkey: string) => string | undefined>(knownName)

/** Hands the people's names to every person a page mentions, whose node views React does not otherwise reach. */
export const PageNamesProvider = Names.Provider

// Outside a page's text (a comment's box) an editable editor counts as being written in.
const Focused = createContext(true)

/** Says whether the page's text has the caret: a writer's page is always editable, so editable alone is not "being edited". */
export const PageFocusedProvider = Focused.Provider

/** The person a `nostr:npub` names, or `null` for any other reference. */
function personOf(uri: string): string | null {
  if (!/^nostr:npub1/i.test(uri)) return null
  try {
    return decodeNpub(uri.slice('nostr:'.length))
  } catch {
    return null
  }
}

/**
 * A link in a page, drawn by where it sits (`place`, §13.3): the kit's chip in
 * a sentence, its row alone on its line, its card in the row's place when its
 * writer chose Card. While editing, a click is the chip menu's, so nothing
 * shows its hover card. A person is `@` and their name.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-lone-links-chip-menu-offers-row-or-card.md
 */
export function PageLink({ uri, href, place = 'chip', editing = false }: ReferenceViewProps) {
  const nameOf = useContext(Names)
  const person = personOf(uri)
  if (person) return <InlineChip tone="person">{`@${nameOf(person) ?? `${uri.slice('nostr:'.length, 'nostr:'.length + 12)}…`}`}</InlineChip>
  return <FileLink uri={uri} href={href} place={place} editing={editing} />
}

/** A file's link, read once for the tab and shared with every other link to it. */
function FileLink({ uri, href, place, editing }: Required<Pick<ReferenceViewProps, 'place' | 'editing'>> & Pick<ReferenceViewProps, 'uri' | 'href'>) {
  const link = linkStateOf(uri, useFile(uri), href)
  if (place === 'card') return <PageCard uri={uri} href={href} editing={editing} />
  if (place === 'row') return <LinkRow link={link} preview={!editing} />
  return <LinkChip link={link} preview={!editing} />
}

/**
 * A link its writer chose to show as its card: the card a comment draws,
 * pickers included, and its values as words while the page's text is being
 * edited (Miky, 21 Oct) — while it has the caret, as Ship's description does.
 */
function PageCard({ uri, href, editing }: Pick<ReferenceViewProps, 'uri' | 'href' | 'editing'>) {
  const focused = useContext(Focused)
  const card = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = card.current
    if (!element) return
    // ProseMirror sees a press before React does and takes the caret into the text, which turned the card to words
    // under the pointer, its picker gone before it opened. It leaves alone a press whose default is prevented.
    const keep = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('button, [role="combobox"]')) event.preventDefault()
    }
    element.addEventListener('mousedown', keep)
    return () => element.removeEventListener('mousedown', keep)
  }, [])
  return (
    <span ref={card} className="contents">
      <LinkCard link={useCardLinkState(uri, href)} readOnly={editing && focused} />
    </span>
  )
}
