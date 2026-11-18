import { Chip } from '@estiva-app/ui'
import { IconUsers } from '@tabler/icons-react'

/**
 * The team a page's thing belongs to: the one chip right after its name in the page's bar, the kit's Chip with the team
 * icon at a chip's 12px, as Peek draws it on an initiative's page and on another app's file (Katerina, 17 November: "one
 * chip after the name, the team"; 18 November, D4 and D7). Leaf has no team page, so it names the team and opens nothing.
 */
export function TeamChip({ name }: { name: string }) {
  return <Chip label={name} leadingIcon={<IconUsers size={12} stroke={1.5} aria-hidden />} />
}
