import { BLOCK_DOCUMENT_FORMAT, BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import type { DocumentField } from './save'

const FIELDS: readonly DocumentField[] = ['title', 'summary', 'description']

/**
 * The fields of a file Leaf writes: all three on its own documents, and on another app's file each one its owner's
 * projection shares — an action that changes that field, found by the field it changes and never by its id or the
 * file's kind (SPEC §7.3). The text only as a block document, and only where the page shows it: a `body` slot that
 * reads the `description`, so Leaf never writes a text it does not draw. No `body` slot at all is a text not written
 * yet, or not read yet (a row of the list read, whose page reads it whole): the page draws it empty, to be written in
 * (Miky, ISS-6), not a dead end.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export function writableFields(file: ForeignObject): ReadonlySet<DocumentField> {
  if (file.kind === KIND.DOCUMENT) return new Set(FIELDS)
  const shared = new Set<DocumentField>()
  for (const action of file.actions) {
    // A borrowed action is another app's creation, never a change to this file's own fields.
    if (action.declaredBy || action.control !== 'text') continue
    const field = FIELDS.find((f) => f === action.field)
    if (!field) continue
    // interop leaves out a slot whose value is empty: a body that reads another field is the only one Leaf skips.
    const body = file.slots[BODY_SLOT]
    const shown = !body || body.field === 'description'
    if (field === 'description' && (action.format !== BLOCK_DOCUMENT_FORMAT || !shown)) continue
    shared.add(field)
  }
  return shared
}

/** Whether Leaf writes this file's text: its own documents, and any file whose owner shares it (a Ship project or issue). */
export function sharesText(file: ForeignObject): boolean {
  return writableFields(file).has('description')
}
