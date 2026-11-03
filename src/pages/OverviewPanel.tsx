import { EmptyState, Panel } from '@estiva-app/ui'

/**
 * A page's Overview: the panel the header's side-panel button shows in the comments' place, 384px as they are, so the
 * page does not move when one replaces the other (ONE-5, step 5), as Ship's Overview (ONE-6, step 4d). Empty for now:
 * nothing is planned for it yet (Katerina, 3 November: "have the button in the header and the overview panel ready but
 * empty"), so it says so in the kit's line for one empty part of a page, placed by the kit's Panel padding.
 */
export function OverviewPanel() {
  return (
    <Panel title="Overview" className="min-h-0 w-96 flex-1" bodyClassName="px-4 pt-3 pb-4">
      <EmptyState scope="section" message="Nothing here yet." />
    </Panel>
  )
}
