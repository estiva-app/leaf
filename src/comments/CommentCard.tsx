import { AttachedCard, LinkRow } from '@estiva-app/ui'
import { useCardLinkState } from '../document/linked'

/**
 * The one file's card under a comment, as Peek's and Ship's `MessageCard`
 * draw it: the kit's card, with ✕ for the comment's author on hover
 * (`onRemove`), and an old comment's `compact` card as the file's row. Under
 * the box it draws with no ✕ of its own: the box's AttachedCard holds that one,
 * and the kit draws an AttachedCard inside another as one.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md
 */
export function CommentCard({ uri, compact = false, opensAt, onRemove }: { uri: string; compact?: boolean; opensAt?: string; onRemove?: () => void }) {
  const link = useCardLinkState(uri, opensAt)
  return (
    <div data-card={compact ? 'compact' : 'detailed'} data-card-value={uri.replace(/^nostr:/i, '')}>
      {compact ? <LinkRow link={link} /> : <AttachedCard link={link} onRemove={onRemove} />}
    </div>
  )
}
