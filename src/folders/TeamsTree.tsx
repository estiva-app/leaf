import { IconFilePlus } from '@tabler/icons-react'
import { CollapsibleSection, NavTree, type NavTreeGroup } from '@estiva-app/ui'

/**
 * The sidebar's teams, each a fold over its pages: yours first, the rest folded under "Other teams" with their count,
 * as Peek's Teams column splits them (Katerina, 23 November). The fold opens for a team in it whose page is open, as a
 * click would. Before Leaf knows which teams you are in (`yours` absent), every team is in one list, as before.
 */
export function TeamsTree({ groups, yours, failed, selected, selectedParent, openTeam, onNewDocument }: {
  /** Every team's group (`groupsOf`); `null` while the teams are read. */
  groups: NavTreeGroup[] | null
  /** The teams you are in (`useTeamsYouAreIn`); absent while read, or when the read failed. */
  yours?: ReadonlySet<string>
  /** The teams could not be read. */
  failed: boolean
  selected?: string
  selectedParent?: string
  /** The team holding the open page. */
  openTeam?: string
  /** New document, beside the heading, where some team takes one. */
  onNewDocument?: () => void
}) {
  const mine = groups && yours ? groups.filter((group) => yours.has(group.id)) : groups
  const others = groups && yours ? groups.filter((group) => !yours.has(group.id)) : []
  const otherOpen = !!openTeam && others.some((group) => group.id === openTeam)
  return (
    <>
      <NavTree
        title="Teams"
        titleActions={onNewDocument ? [{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: onNewDocument }] : undefined}
        groups={failed ? [] : mine}
        selected={selected}
        selectedParent={selectedParent}
        emptyMessage={failed ? 'Your teams could not be read. Reload to try again.' : others.length > 0 ? '' : 'No teams yet.'}
      />
      {!failed && others.length > 0 && (
        // Peek's fold, word and look: the kit's fold as a row among rows, with its count (Katerina, 16 November).
        <CollapsibleSection look="row" title="Other teams" count={others.length} defaultOpen={otherOpen} {...(otherOpen && openTeam ? { openFor: openTeam } : {})} contentClassName="gap-0.5">
          <NavTree groups={others} selected={selected} selectedParent={selectedParent} />
        </CollapsibleSection>
      )}
    </>
  )
}
