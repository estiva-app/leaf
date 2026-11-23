import { IconFilePlus } from '@tabler/icons-react'
import { NavTree, NavTreeSection, type NavTreeGroup } from '@estiva-app/ui'
import { forgetOpenedFromInitiative } from '../topics/openedFrom'

/**
 * The sidebar's teams, each a fold over its pages: yours first, the rest folded under "Other teams" with their count,
 * as Peek's Teams column splits them (Katerina, 23 November). The fold opens for a team in it whose page is open, as a
 * click would. Before Leaf knows which teams you are in (`yours` absent), every team is in one list, as before. A row
 * clicked here is lit here, even one lit under an initiative a moment ago (`openedFrom`).
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
  // A plain click: the kit still follows the link after it.
  const spend = () => forgetOpenedFromInitiative()
  return (
    <>
      <NavTree
        title="Teams"
        titleActions={onNewDocument ? [{ icon: <IconFilePlus size={16} stroke={1.5} />, tooltip: 'New document', onClick: onNewDocument }] : undefined}
        groups={failed ? [] : mine}
        onSelect={spend}
        selected={selected}
        selectedParent={selectedParent}
        emptyMessage={failed ? 'Your teams could not be read. Reload to try again.' : others.length > 0 ? '' : 'No teams yet.'}
      />
      {!failed && others.length > 0 && (
        // Peek's word, in the look of the team names around it: Leaf's teams are the tree's headings, not rows as Peek's are
        // (Katerina, 23 November: yes).
        <NavTreeSection id="other-teams" title="Other teams" count={others.length} defaultOpen={otherOpen} {...(otherOpen && openTeam ? { openFor: openTeam } : {})}>
          <NavTree groups={others} selected={selected} selectedParent={selectedParent} onSelect={spend} />
        </NavTreeSection>
      )}
    </>
  )
}
