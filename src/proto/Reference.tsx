import { InlineChip, KindIcon, WithTooltip } from '@estiva-app/ui'
import { PEOPLE, personOf, thingOf } from './fixtures'

/**
 * A `nostr:` reference where it was written (SPEC §13.1), drawn the way Peek's
 * `Reference` draws one: the package's InlineChip, the kind's icon, the name
 * cut at 24ch and the whole of it on hover in the package's tooltip (UIG-14).
 * A person is their name; anything unknown is its address, quiet, never blank.
 *
 * No link while writing, as Peek's composer chip (`link={false}`): a click in
 * the text is not a way out of it.
 */
export function Reference({ uri }: { uri: string }) {
  const person = personOf(uri)
  if (person) return <InlineChip tone="person">{`@${PEOPLE[person].name}`}</InlineChip>
  const thing = thingOf(uri)
  if (thing) {
    // The name, as Peek's sent chip has it; the whole name on hover, because the chip cuts it.
    return (
      <WithTooltip inline label={thing.label}>
        <InlineChip tone="neutral" icon={<KindIcon kind={thing.kind} size={14} tone="inherit" />} className="max-w-[24ch]">
          <span className="truncate">{thing.label}</span>
        </InlineChip>
      </WithTooltip>
    )
  }
  const short = `${uri.replace(/^nostr:/, '').slice(0, 12)}…`
  return (
    <WithTooltip inline label={uri}>
      <InlineChip tone="quiet">{short}</InlineChip>
    </WithTooltip>
  )
}
