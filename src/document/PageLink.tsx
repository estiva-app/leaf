import { createContext, useContext } from 'react'
import { InlineChip, LinkCard, LinkChip, LinkRow } from '@estiva-app/ui'
import type { ReferenceViewProps } from '@estiva-app/ui/editor'
import { decodeNpub } from '@estiva-app/protocol'
import { knownName } from '../comments/people'
import { linkStateOf, useCardLinkState } from './linked'
import { useFile } from './references'

const Names = createContext<(pubkey: string) => string | undefined>(knownName)

/** Hands the people's names to every person a page mentions, whose node views React does not otherwise reach. */
export const PageNamesProvider = Names.Provider

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
  if (place === 'card') return <PageCard uri={uri} href={href} />
  if (place === 'row') return <LinkRow link={link} preview={!editing} />
  return <LinkChip link={link} preview={!editing} />
}

/** A link its writer chose to show as its card: the card a comment draws, its values as words in the page. */
function PageCard({ uri, href }: Pick<ReferenceViewProps, 'uri' | 'href'>) {
  return <LinkCard link={useCardLinkState(uri, href)} readOnly />
}
