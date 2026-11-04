import { useState } from 'react'
import type { Membership } from '@estiva-app/conversation'
import { MembersDialog, MembersPill, type MembersDialogCandidate, type MembersDialogMember } from '@estiva-app/ui'
import type { DirectoryPerson } from '../comments/people'

/** How many faces the pill draws; the count says the rest. */
const PILL_FACES = 3

/**
 * Who is in a file: the members pill in the page's header and the Members dialog it opens, with Join or Leave for
 * you and "Add members" once you are in, as Peek and Ship have them (Miky, LED-6's kickoff). Nothing is drawn until
 * the members are read, rather than a wrong count.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-add-a-person-to-a-file.md
 */
export function Members({
  members,
  me,
  directory,
  readOnly,
  onSetMine,
  onAdd,
}: {
  /** The file's members by key (SPEC §11.8); `undefined` until the first read. */
  members: ReadonlyMap<string, Membership> | undefined
  /** The viewer's key. */
  me: string | null
  /** The workspace's people: names and faces (an agent's is the robot), and whom "Add members" offers. */
  directory: Record<string, DirectoryPerson>
  /** No Join, Leave or Add: the file is archived. */
  readOnly?: boolean
  /** Join (`true`) or leave (`false`). Resolves `true` once the relay took it. */
  onSetMine: (member: boolean) => Promise<boolean>
  /** Add these people. Resolves `true` once the relay took every one. */
  onAdd: (pubkeys: string[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  if (!members) return null

  // The em dash for someone with no profile, as a comment's author is drawn — never the key.
  const named = (pubkey: string) => (pubkey === me ? 'You' : (directory[pubkey]?.displayName ?? '—'))
  // You first, then by name.
  const keys = [...members.keys()].sort((a, b) => Number(b === me) - Number(a === me) || named(a).localeCompare(named(b)))
  const rows: MembersDialogMember[] = keys.map((pubkey) => ({
    id: pubkey,
    name: named(pubkey),
    picture: directory[pubkey]?.picture,
    bot: directory[pubkey]?.bot,
  }))
  const candidates: MembersDialogCandidate[] = Object.entries(directory).map(([pubkey, person]) => ({
    id: pubkey,
    label: pubkey === me ? 'You' : person.displayName,
    picture: person.picture,
    bot: person.bot,
  }))
  const isMember = !!me && members.has(me)
  const canChange = !readOnly && !!me

  return (
    <>
      <MembersPill
        members={keys.slice(0, PILL_FACES).map((pubkey) => ({
          name: named(pubkey),
          picture: directory[pubkey]?.picture,
          bot: directory[pubkey]?.bot,
        }))}
        count={members.size}
        onClick={() => setOpen(true)}
      />
      {open && (
        <MembersDialog
          members={rows}
          count={members.size}
          self={
            canChange && me
              ? {
                  action: isMember ? 'leave' : 'join',
                  onToggle: () => onSetMine(!isMember),
                  id: me,
                }
              : undefined
          }
          candidates={candidates}
          onAdd={canChange && isMember ? (chosen) => onAdd(chosen.map((c) => c.id)) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
