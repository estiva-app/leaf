import type { ForeignObject } from '@estiva-app/interop'
import { ToastProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/*
  Restore on a deleted page's notice (ALL-4): the page's team is read again, so the tree in the same tab draws the page
  again with its sub-pages beneath it, as a delete redraws it, and not only after a reload.
  The restore's own change on the wire (`deleted` empty, after the delete) is `setDeleted`'s, asserted in
  src/document/saveInOrder.test.ts › "restores a deleted … with the deleted field set empty, after the delete"; here it is
  mocked to answer as the relay would.
*/
const ME = 'a'.repeat(64)
const TEAM = '4a279f9d-9247-4479-8aea-dd15ffe86297'
const relay = vi.hoisted(() => ({ accepts: true }))

vi.mock('../relay/bridge', () => ({ viewerPubkey: () => ME, query: async () => [], publish: async () => ({ ok: true }) }))
vi.mock('../document/save', async (original) => ({
  ...(await original<typeof import('../document/save')>()),
  setDeleted: async () => (relay.accepts ? { ok: true } : { ok: false, reason: 'blocked: refused' }),
}))

const { FilePage } = await import('./FilePage')

const deleted = {
  kind: 30842,
  address: `30842:${ME}:page-1`,
  folder: TEAM,
  naddr: 'naddr1page',
  deleted: { by: ME, at: Math.floor(Date.now() / 1000) },
  actions: [{ id: 'restore', label: 'Restore', field: 'deleted', control: 'text' }],
  slots: { title: { value: 'Plan' } },
} as unknown as ForeignObject

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)

describe('Restore on a deleted page (ALL-4)', () => {
  it('reads its team again, so the tree draws it and the pages under it without a reload', async () => {
    relay.accepts = true
    const onChanged = vi.fn()
    render(<ToastProvider><FilePage file={deleted} loading={false} onChanged={onChanged} /></ToastProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(TEAM))
  })

  it('reads nothing again when the relay refuses the restore, and says so', async () => {
    relay.accepts = false
    const onChanged = vi.fn()
    render(<ToastProvider><FilePage file={deleted} loading={false} onChanged={onChanged} /></ToastProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    expect((await screen.findAllByText('Could not restore it. Try again.')).length).toBeGreaterThan(0)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
