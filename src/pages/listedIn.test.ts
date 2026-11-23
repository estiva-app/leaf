import { describe, expect, it } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { listedInOf } from './DocumentMenu'

const PK = 'a'.repeat(64)
const doc = { address: `30023:${PK}:doc-1`, folder: 'steer' } as unknown as ForeignObject

describe('listedInOf — the team a document is in, by the team lists, not its `h`', () => {
  it('is the team that lists it by its address', () => {
    const folders = [{ id: 'steer', hasState: true, addresses: [] }, { id: 'building', hasState: true, addresses: [doc.address] }] as FolderSummary[]
    expect(listedInOf(doc, folders)).toBe('building')
  })

  /* SHI-64: a move writes the file's id once the relay keeps it in order, so the team it went to lists only the id. */
  it('is the team that lists it by its id, not the team it was started in', () => {
    const folders = [{ id: 'steer', hasState: true, addresses: [] }, { id: 'building', hasState: true, addresses: [], ids: ['doc-1'] }] as FolderSummary[]
    expect(listedInOf(doc, folders)).toBe('building')
  })

  it('is its own Folder when no team lists it', () => {
    expect(listedInOf(doc, [{ id: 'building', hasState: true, addresses: [] }] as FolderSummary[])).toBe('steer')
  })
})
