import type { PublishResult, UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const published: UnsignedEvent[] = []
/* Who is signed in: ME, unless a test signs out. */
const signedIn = vi.hoisted(() => ({ pubkey: 'a'.repeat(64) as string | null }))
vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => signedIn.pubkey,
  query: async () => [],
  publish: async (event: UnsignedEvent): Promise<PublishResult> => {
    published.push(event)
    return { ok: true } as PublishResult
  },
}))

const { OwnerRow } = await import('./OwnerRow')
const { shipIssue } = await import('./fixtures/shipFiles')
const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

afterEach(() => {
  cleanup()
  published.length = 0
  signedIn.pubkey = ME
})

const row = (file = shipIssue()) =>
  render(
    <ToastProvider>
      <OwnerRow file={file} />
    </ToastProvider>,
  )

describe("Ship's row on a Ship issue's own page in Leaf", () => {
  it('offers the Status and Assignee pickers its card has, and a status chosen is written at the issue, in its own Folder', async () => {
    const issue = shipIssue()
    row(issue)
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Done' }))
    await waitFor(() => expect(published).toHaveLength(1))
    const [change] = published
    expect(change.kind).toBe(1851)
    expect([tag(change, 'a'), tag(change, 'field'), tag(change, 'value'), tag(change, 'h')]).toEqual([issue.address, 'status', 'done', issue.folder])
    // Shown at once, until the page reads the issue again.
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('Done')
  })

  it('shows the status and the assignee as words when the issue is archived', () => {
    row(shipIssue({ archived: true }))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('Katerina')).toBeTruthy()
  })

  it('shows them as words to a reader who is not signed in', () => {
    signedIn.pubkey = null
    row()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('In Progress')).toBeTruthy()
  })
})
