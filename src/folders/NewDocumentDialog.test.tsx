import type { FolderSummary } from '@estiva-app/interop'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewDocumentDialog, type NewDocumentUnder } from './NewDocumentDialog'

const QA = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const STEER = '11111111-1111-4111-8111-111111111111'
const folders = [
  { id: QA, name: 'QA', hasState: true },
  { id: STEER, name: 'Steer', hasState: true },
] as unknown as FolderSummary[]
const LAUNCH: NewDocumentUnder = { address: `30842:${'a'.repeat(64)}:launch`, ref: 'launch', folder: QA, title: 'Launch plan', listedIn: STEER }

afterEach(cleanup)

describe('New document under a page (LFB-8)', () => {
  it('names the page, says its readers read it, asks no Folder, and makes it in the Folder listing the page', async () => {
    const onCreate = vi.fn(async () => true)
    render(<NewDocumentDialog folders={folders} defaultFolder={STEER} under={LAUNCH} onCreate={onCreate} onClose={vi.fn()} />)
    expect(screen.getByText('New document under Launch plan')).toBeTruthy()
    expect(screen.getByText('Everyone who can read Launch plan can read it.')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Folder' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Risks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Risks', STEER, ''))
  })

  it('opened from the sidebar, it still asks the Folder and says that Folder reads it', () => {
    render(<NewDocumentDialog folders={folders} defaultFolder={QA} onCreate={vi.fn(async () => true)} onClose={vi.fn()} />)
    expect(screen.getByText('New document')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Folder' })).toBeTruthy()
    expect(screen.getByText('Everyone in QA can read it.')).toBeTruthy()
  })
})
