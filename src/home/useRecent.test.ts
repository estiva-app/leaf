import type { ForeignObject } from '@estiva-app/interop'
import { describe, expect, it } from 'vitest'
import type { WorkspaceFolder } from '../folders/useWorkspace'
import { shipIssue, shipProject } from '../pages/fixtures/shipFiles'
import { otherRowOf } from './useRecent'

const listing = (name: string, files: ForeignObject[]): WorkspaceFolder => ({
  folder: { id: `id-${name}`, name, hasState: true },
  contents: { id: `id-${name}`, hasState: true, files, source: 'state' } as WorkspaceFolder['contents'],
})

describe("Home's rows for another app's file", () => {
  it('lists an issue by its type, named by the Folder that lists its project', () => {
    const issue = shipIssue()
    const row = otherRowOf(issue, [listing('Estiva HQ', [shipProject()])])
    expect(row && [row.title, row.type, row.folder, row.folderId]).toEqual(['Sidebar should not show Peek topics', 'Issue', 'Estiva HQ', issue.folder])
  })

  it('leaves the place blank when no Folder the tree read lists it, never a Folder id', () => {
    expect(otherRowOf(shipIssue(), [])?.folder).toBe('')
  })

  it('lists no archived issue, no file whose app does not share its text, and nothing unreadable', () => {
    expect(otherRowOf(shipIssue({ archived: true }), [])).toBeNull()
    const issue = shipIssue()
    expect(otherRowOf({ ...issue, actions: [] }, [])).toBeNull()
    expect(otherRowOf({ ...issue, unreachable: true }, [])).toBeNull()
    expect(otherRowOf(null, [])).toBeNull()
  })
})
