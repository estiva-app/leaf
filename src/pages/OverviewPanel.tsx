import type { ReactNode } from 'react'
import { EmptyState, Panel, SectionHeader } from '@estiva-app/ui'

/**
 * A page's Overview: the panel the header's side-panel button shows in the comments' place, 384px as they are, so the
 * page does not move when one replaces the other (ONE-5, step 5), as Ship's Overview (ONE-6, step 4d). It holds the
 * page's "Initiatives", as Ship's Overview holds a project's and an issue's (Katerina, 23 November: Leaf's moves from
 * under the title into its Overview, as Ship's): the kit's heading, 16px above it, its 8px inset brought to the panel's
 * 16px edge, the chips and Add to initiative under it. A page with nothing to hold says so in the kit's empty line.
 */
export function OverviewPanel({ topics }: { topics?: ReactNode }) {
  if (!topics) {
    return (
      <Panel title="Overview" className="min-h-0 w-96 flex-1" bodyClassName="px-4 pt-3 pb-4">
        <EmptyState scope="section" message="Nothing here yet." />
      </Panel>
    )
  }
  return (
    <Panel title="Overview" className="min-h-0 w-96 flex-1" bodyClassName="flex flex-col pb-4">
      <SectionHeader title="Initiatives" hover="none" className="mx-2 mt-4" />
      <div className="px-4 pt-1">{topics}</div>
    </Panel>
  )
}
