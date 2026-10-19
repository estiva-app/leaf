import { nestingOf, type ForeignObject } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { Chip, KindIcon, thingKindOf, type NavTreeGroup, type NavTreeNode } from '@estiva-app/ui'
import { dOf, pagePath } from '../route'
import type { Workspace, WorkspaceFolder } from './useWorkspace'

/** What a file is called on screen: its title, or what a file with none is. */
export function titleOf(file: ForeignObject): string {
  return file.slots.title?.value?.trim() || 'Untitled'
}

/**
 * What kind of thing a file is, as a label: "Issue", "Project". Another app's
 * file is labelled by its type, and the app's name appears only in "Open in X"
 * (PRO-24, Miky 2 October).
 */
export function typeOf(file: ForeignObject): string {
  const noun = file.noun ?? thingKindOf(file.kind)
  return noun.charAt(0).toUpperCase() + noun.slice(1)
}

/**
 * A document is Leaf's own file: `kind:30842`, the type Leaf owns through its
 * manifest. A Peek topic (a bare `30840`) is not one — it is drawn like any other
 * app's file, labelled "Topic" and opened in Peek (Miky, 14 October).
 */
export function isDocument(file: ForeignObject): boolean {
  return file.kind === KIND.DOCUMENT
}

/** The id the tree selects a file by, and finds it again by. */
export function fileKey(file: ForeignObject): string {
  return file.naddr ?? file.ref
}

/** What the tree needs besides the listings: the rows read on opening, and how to ask for them. */
export type Expansion = Pick<Workspace, 'children' | 'opened' | 'setOpen' | 'setFolderOpen'>

function nodeOf(file: ForeignObject, nestedUnder: (f: ForeignObject) => ForeignObject[], expansion: Expansion): NavTreeNode {
  const node: NavTreeNode = {
    id: fileKey(file),
    label: titleOf(file),
    href: pagePath({ ...file, title: file.slots.title?.value }),
    icon: <KindIcon kind={isDocument(file) ? 'file' : thingKindOf(file.kind)} />,
    hint: isDocument(file) ? undefined : <Chip type="neutral" label={typeOf(file)} />,
  }
  const nested = nestedUnder(file).map((c) => nodeOf(c, nestedUnder, expansion))
  // A file whose app lists its own children — a project its issues — reads them when the row opens,
  // and draws them after anything filed under it in the Folder.
  if (!file.listsChildren) return nested.length ? { ...node, children: nested } : node
  const read = expansion.children[file.ref]
  const listed = Array.isArray(read) ? read.filter((c) => !c.unreachable).map((c) => nodeOf(c, () => [], expansion)) : undefined
  return {
    ...node,
    hasChildren: true,
    open: expansion.opened.has(file.ref),
    onOpenChange: (open) => expansion.setOpen(file, open),
    children: listed ? [...nested, ...listed] : read === null ? null : undefined,
    childrenMessage:
      read === 'failed' ? 'This could not be read. Close it and open it again to retry.' : listed?.length === 0 && nested.length === 0 ? 'Nothing in this yet.' : undefined,
  }
}

/**
 * The tree's groups: a Folder each, with what it holds nested as Peek nests it.
 * A file the viewer cannot read is not drawn at all — the row would disclose it.
 */
export function groupsOf(folders: WorkspaceFolder[] | null, expansion: Expansion): NavTreeGroup[] | null {
  if (!folders) return null
  return folders.map(({ folder, contents, failed }) => {
    const readable = contents?.files.filter((f) => !f.unreachable) ?? null
    const nesting = readable ? nestingOf(readable) : null
    return {
      id: folder.id,
      title: folder.name ?? folder.id,
      open: expansion.opened.has(folder.id),
      onOpenChange: (open) => expansion.setFolderOpen(folder.id, open),
      nodes: nesting ? nesting.roots.map((f) => nodeOf(f, nesting.childrenOf, expansion)) : failed ? [] : null,
      message: failed ? 'This could not be read. Reload to try again.' : readable?.length === 0 ? 'Nothing in this yet.' : undefined,
    }
  })
}

/** Find a file anywhere in the workspace by its key: in a Folder's listing, or among the rows read under one. */
export function findFile(
  folders: WorkspaceFolder[] | null,
  children: Workspace['children'],
  key: string,
): { file: ForeignObject; folder: WorkspaceFolder } | null {
  for (const folder of folders ?? []) {
    const file = filesIn(folder, children).find((f) => fileKey(f) === key && !f.unreachable)
    if (file) return { file, folder }
  }
  return null
}

/** A Folder's files: its listing, then the rows read under them. */
function filesIn(folder: WorkspaceFolder, children: Workspace['children']): ForeignObject[] {
  const listed = folder.contents?.files ?? []
  const under = listed.flatMap((f) => {
    const read = children[f.ref]
    return Array.isArray(read) ? read : []
  })
  return [...listed, ...under]
}

/**
 * Find a document by its `d`, the identity its `/document/<slug>-<d>` link
 * carries. The link names no author, so it is read by SPEC §7.7's one-author
 * rule: a `d` two authors hold names nothing, rather than whichever was read
 * first — the same link is a raw URL in every other app then.
 */
export function findDocument(
  folders: WorkspaceFolder[] | null,
  children: Workspace['children'],
  d: string,
): { file: ForeignObject; folder: WorkspaceFolder } | null {
  let found: { file: ForeignObject; folder: WorkspaceFolder } | null = null
  for (const folder of folders ?? []) {
    for (const file of filesIn(folder, children)) {
      if (!isDocument(file) || file.unreachable || !file.address || dOf(file.address) !== d) continue
      if (found && found.file.address !== file.address) return null
      found ??= { file, folder }
    }
  }
  return found
}
