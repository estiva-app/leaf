import { IconExternalLink } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { Button, LinkedIcon, LinkKey, LinkPickers, linkStateFrom, thingKindOf, WithTooltip } from '@estiva-app/ui'
import { useDirectory } from '../comments/people'
import { useFileChoices } from '../document/linked'

/** Where "Open in <app>" goes: the address comes from the app's manifest, so only a web address is opened, never a script. */
export function openerOf(file: ForeignObject): string | undefined {
  return file.openUrl && /^https?:\/\//i.test(file.openUrl) ? file.openUrl : undefined
}

/** The person field the file's card offers a picker for: its manifest's person control, neither the title nor the move. */
function ownerFieldOf(file: ForeignObject): string | undefined {
  return file.actions.find((one) => one.control === 'pubkey' && one.field && one.field !== file.slots.title?.field && one.field !== file.parentField)?.field
}

/**
 * The owning app's row under another app's file's title: its status, then its people, in that order on every file
 * (Katerina, 30 Oct: Ship's manifest lists a project's lead before its key and an issue's key before its assignee, so
 * the key moved about). The key is above the title (`FileKey`), "Open" in the bar (`OpenIn`). Its status and
 * owner take the same pickers its card has anywhere in Leaf, each change written as the card writes it
 * (`useFileChoices`); words where the reader may not change them (archived, signed out). Read from the projection's
 * slots and actions, never from the kind.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export function OwnerRow({ file: read }: { file: ForeignObject }) {
  // The page reads the file again when its change arrives on the tab's connection (`useLiveDocument`): the choice shows until then.
  const { object, onAct } = useFileChoices(read)
  const file = object ?? read
  const directory = useDirectory()
  // The card's own builder, so the row's pickers are the card's: its options, its owner list, its words when archived.
  const link = linkStateFrom(file, { kind: 'file', noun: 'File' }, { hrefOf: () => '', previewText: (body) => body, directory, ...(onAct ? { onAct } : {}) })
  const linked = link.state === 'ready' ? link.linked : undefined
  const ownerField = ownerFieldOf(file)
  const people = file.meta.filter((slot) => slot.isPubkey)
  const owner = linked?.owner && ownerField ? people.find((slot) => slot.field === ownerField) : undefined
  const others = people.filter((slot) => slot !== owner)
  if (!linked?.status && people.length === 0) return null
  return (
    // 16px between groups, as LinkPickers parts a status and a person drawn as words; boxed, its own 8px.
    <div className="flex min-h-6 flex-wrap items-center gap-4">
      {(linked?.status || owner) && <LinkPickers status={linked?.status} owner={owner && linked?.owner} ownerLabel={owner ? (linked?.ownerLabel ?? owner.label) : undefined} />}
      {others.map((slot) => (
        <LinkPickers
          key={slot.field ?? slot.label}
          readOnly
          ownerLabel={slot.label}
          owner={{
            value: slot.value || undefined,
            options: slot.value ? [{ value: slot.value, label: file.people?.[slot.value]?.displayName ?? '—', picture: file.people?.[slot.value]?.picture, bot: file.people?.[slot.value]?.bot }] : [],
          }}
        />
      ))}
    </div>
  )
}

/**
 * Another app's file's key, above its title, with the icon the tree gives the file: "before the title, quieter than
 * it", as LinkKey's page says, in its brighter grey, since alone on a page the muted one reads at 2.71:1 (Katerina,
 * 30 Oct). Every meta slot that is not a person is drawn as a key, as the row drew it.
 */
export function FileKey({ file }: { file: ForeignObject }) {
  const keys = file.meta.filter((slot) => !slot.isPubkey && slot.value)
  if (keys.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <LinkedIcon kind={thingKindOf(file.kind)} size={14} />
      {keys.map((slot) => (
        <LinkKey key={slot.field ?? slot.label} tone="secondary">
          {slot.value}
        </LinkKey>
      ))}
    </div>
  )
}

/**
 * "Open" into another app's file's own app, right after the page's name in its bar (the kit's PageHeader `after`; ONE-5,
 * step 5), as Peek's file page has it: the kit's Button, quiet, with a real icon, a link to a new tab (Katerina,
 * 30 Oct). "Open" alone (Miky, 14 Oct: "Less words is better"); which app is in its name and its tooltip. Only where
 * there is somewhere to open.
 */
export function OpenIn({ opener, appName }: { opener: string; appName: string }) {
  const where = `Open in ${appName}`
  return (
    <WithTooltip label={where}>
      <Button href={opener} external size="small" leadingIcon={<IconExternalLink size={14} stroke={1.5} />} aria-label={where}>
        Open
      </Button>
    </WithTooltip>
  )
}
