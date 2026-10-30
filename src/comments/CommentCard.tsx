import { AttachedCard, LinkCard, LinkRow } from '@estiva-app/ui'
import { useCardLinkState } from '../document/linked'

/**
 * The one file's card under a comment, as Peek's and Ship's `MessageCard`
 * draw it: the kit's card, with ✕ for the comment's author on hover
 * (`onRemove`), and an old comment's `compact` card as the file's row. Under
 * the box (`bare`) it is the card alone: the box's own AttachedCard holds it
 * and its ✕, so there is one AttachedCard, not one inside another.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
export function CommentCard({ uri, compact = false, opensAt, onRemove, bare = false }: { uri: string; compact?: boolean; opensAt?: string; onRemove?: () => void; bare?: boolean }) {
  const link = useCardLinkState(uri, opensAt)
  return (
    <div data-card={compact ? 'compact' : 'detailed'} data-card-value={uri.replace(/^nostr:/i, '')}>
      {compact ? <LinkRow link={link} /> : bare ? <LinkCard link={link} /> : <AttachedCard link={link} onRemove={onRemove} />}
    </div>
  )
}
