import type { FolderSummary } from '@estiva-app/interop'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.queryByRole('combobox', { name: 'Team' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Risks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Risks', STEER, ''))
  })

  it('opened from the sidebar, it still asks the Folder and says that Folder reads it', () => {
    render(<NewDocumentDialog folders={folders} defaultFolder={QA} onCreate={vi.fn(async () => true)} onClose={vi.fn()} />)
    expect(screen.getByText('New document')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Team' })).toBeTruthy()
    expect(screen.getByText('Everyone in QA can read it.')).toBeTruthy()
  })
})

describe('New document while it is made', () => {
  it('Create and Cancel wait while the document is made; a refusal keeps it open with what was typed, and a make closes it once', async () => {
    let answer: (done: boolean) => void = () => {}
    const onCreate = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const onClose = vi.fn()
    render(<NewDocumentDialog folders={folders} defaultFolder={QA} onCreate={onCreate} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Risks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const creating = await screen.findByRole('button', { name: 'Creating…' })
    expect((creating as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => answer(false))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Risks')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    await act(async () => answer(true))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
