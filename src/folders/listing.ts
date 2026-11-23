/**
 * Whether a team's list names the file at `address`: by its address (an `a`
 * entry) or by its id (an `o` entry, SPEC §3.3). A move writes the id once the
 * relay keeps the file in order, so a document moved since then is listed by
 * its id alone (SHI-64). Interop's own `listsFile`, which its package does not export.
 */
export function listsFile(folder: { addresses?: readonly string[]; ids?: readonly string[] }, address: string): boolean {
  if (folder.addresses?.includes(address)) return true
  const id = /^\d+:[0-9a-f]{64}:([^]*)$/.exec(address)?.[1]
  return id !== undefined && !!folder.ids?.includes(id)
}
