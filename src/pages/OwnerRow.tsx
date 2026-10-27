import { IconExternalLink } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { Button, LinkKey, LinkPickers, type StatusColour } from '@estiva-app/ui'

const COLOURS: readonly StatusColour[] = ['neutral', 'blue', 'green', 'muted']

/** Where "Open in <app>" goes: the address comes from the app's manifest, so only a web address is opened, never a script. */
export function openerOf(file: ForeignObject): string | undefined {
  return file.openUrl && /^https?:\/\//i.test(file.openUrl) ? file.openUrl : undefined
}

/**
 * The owning app's row under another app's file's title: its status, then each of its manifest's meta slots in order
 * (Ship: an issue's key and assignee, a project's lead and key), drawn read-only with the link kit's parts, and
 * "Open in <app>" at its end, where those fields are changed. Read from the projection's slots, never from the kind.
 */
export function OwnerRow({ file }: { file: ForeignObject }) {
  const status = file.slots.status
  const opener = openerOf(file)
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-3">
      {status?.value && (
        <LinkPickers readOnly status={{ value: status.value, options: [{ value: status.value, label: status.value, colour: COLOURS.find((c) => c === status.colour) }] }} />
      )}
      {file.meta.map((slot) =>
        slot.isPubkey ? (
          <LinkPickers
            key={slot.field ?? slot.label}
            readOnly
            ownerLabel={slot.label}
            owner={{ value: slot.value || undefined, options: slot.value ? [{ value: slot.value, label: file.people?.[slot.value]?.displayName ?? '—', picture: file.people?.[slot.value]?.picture }] : [] }}
          />
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
