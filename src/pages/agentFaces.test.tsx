/**
 * An agent's face is the robot wherever Leaf draws a face (ui 0.97.0, Katerina, 1 November): the profile's `bot`
 * (NIP-24) reaches the kit's face, never initials like a person's.
 */
import { namedProfilesOf, rosterOf } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const AGENT = 'c'.repeat(64)
const event = (kind: number, pubkey: string, content: string, tags: string[][] = []): SignedEvent => ({ id: `${kind}${pubkey}`.slice(0, 64), pubkey, created_at: 1_760_000_000, kind, tags, content, sig: '' })
const EVENTS = [
  event(13534, 'd'.repeat(64), '', [['member', ME], ['member', AGENT]]),
  event(0, ME, JSON.stringify({ name: 'Miky' })),
  // The Ship issue fixture's assignee, here an agent's profile.
  event(0, AGENT, JSON.stringify({ name: 'Claude', bot: true })),
]

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => 'a'.repeat(64),
  query: async (filters: { kinds?: number[] }[]) => {
    const kinds = filters.flatMap((f) => f.kinds ?? [])
    return EVENTS.filter((e) => kinds.includes(e.kind))
  },
  publish: async () => ({ ok: true }),
}))

const { directoryOf, useMentionPeople } = await import('../comments/people')
const { Members } = await import('./Members')
const { OwnerRow } = await import('./OwnerRow')
const { shipIssue } = await import('./fixtures/shipFiles')

/** The kit's robot, drawn in place of initials. */
const ROBOT = 'path[d^="M13.5 2C13.5 2.44425"]'
const isRobot = (face: Element | null | undefined) => !!face?.querySelector(ROBOT)

afterEach(cleanup)

describe('an agent’s face in Leaf', () => {
  it('is the robot on the members pill and in the Members dialog, and a person’s is not', async () => {
    const directory = directoryOf(namedProfilesOf(EVENTS), rosterOf(EVENTS))
    render(<Members members={new Map([[ME, {}], [AGENT, {}]]) as never} me={ME} directory={directory} onSetMine={vi.fn(async () => true)} onAdd={vi.fn(async () => true)} />)
    const pill = screen.getByRole('button', { name: /members$/ })
    expect(isRobot(within(pill).getByRole('img', { name: 'Claude' }))).toBe(true)
    expect(isRobot(within(pill).getByRole('img', { name: 'You' }))).toBe(false)
    await userEvent.setup().click(pill)
    const dialog = await screen.findByRole('dialog', { name: /Members/ })
    // A roster row is the face, then the name.
    const faceOf = (name: string) => within(dialog).getByText(name).parentElement!.parentElement!.firstElementChild
    expect(isRobot(faceOf('Claude'))).toBe(true)
    expect(isRobot(faceOf('You'))).toBe(false)
  })

  it('is the robot in the list @ offers', async () => {
    const view = renderHook(() => useMentionPeople())
    await waitFor(() => expect(view.result.current.people.map((p) => p.name)).toEqual(['Claude']))
    const { container } = render(<>{view.result.current.people[0].avatar}</>)
    expect(isRobot(container)).toBe(true)
  })

  it('is the robot on the person picker of another app’s file, as its card draws it', async () => {
    render(
      <ToastProvider>
        <OwnerRow file={shipIssue()} />
      </ToastProvider>,
    )
    await waitFor(() => expect(isRobot(screen.getByRole('combobox', { name: 'Assignee' }))).toBe(true))
  })
})
