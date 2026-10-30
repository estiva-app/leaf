import { IconExternalLink } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { Button, LinkKey, LinkPickers, linkStateFrom } from '@estiva-app/ui'
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
 * The owning app's row under another app's file's title: its status, then each of its manifest's meta slots in order
 * (Ship: an issue's key and assignee, a project's lead and key), and "Open in <app>" at its end. Its status and owner
 * take the same pickers its card has anywhere in Leaf, each change written as the card writes it (`useFileChoices`);
 * words where the reader may not change them (archived, signed out). Read from the projection's slots and actions,
 * never from the kind.
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
  const opener = openerOf(file)
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-3">
      {linked?.status && <LinkPickers status={linked.status} />}
      {file.meta.map((slot) =>
        slot.isPubkey ? (
          linked?.owner && ownerField && slot.field === ownerField ? (
            <LinkPickers key={slot.field} owner={linked.owner} ownerLabel={linked.ownerLabel ?? slot.label} />
          ) : (
            <LinkPickers
              key={slot.field ?? slot.label}
              readOnly
              ownerLabel={slot.label}
              owner={{ value: slot.value || undefined, options: slot.value ? [{ value: slot.value, label: file.people?.[slot.value]?.displayName ?? '—', picture: file.people?.[slot.value]?.picture }] : [] }}
            />
          )
        ) : slot.value ? (
          <LinkKey key={slot.field ?? slot.label}>{slot.value}</LinkKey>
        ) : null,
      )}
      {opener && file.appName && (
        <Button variant="muted" size="small" className="ml-auto" leadingIcon={<IconExternalLink />} onClick={() => window.open(opener, '_blank', 'noopener')}>
          {`Open in ${file.appName}`}
        </Button>
      )}
    </div>
  )
}
