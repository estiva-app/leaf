import type { ForeignObject } from '@estiva-app/interop'
import type { PublishResult, SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/* LED-6: a page's header says who is in it and its last edit, and its Members dialog joins, leaves and adds as Peek's does. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const KAT = 'c'.repeat(64)
const JAN = 'd'.repeat(64)
const FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const ADDRESS = `30842:${MIKY}:page-1`
/* The page's own event, the id it was read with. */
const ROOT = 'f'.repeat(64)
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0)
const HOUR = 3_600_000

const published: UnsignedEvent[] = []
let answers: PublishResult[] = []
/* What the relay holds for the page: its own event, its changes and its comments. */
let held: SignedEvent[] = []

let n = 0
function event(kind: number, pubkey: string, at: number, tags: string[][], content = ''): SignedEvent {
  return { id: `e${++n}`.padEnd(64, '0'), sig: '', kind, pubkey, created_at: Math.floor(at / 1000), tags, content }
}
const change = (by: string, at: number, field: string, value: string) => event(1851, by, at, [['a', ADDRESS], ['field', field], ['value', value], ['h', FOLDER]])
const profile = (pubkey: string, name: string) => event(0, pubkey, NOW - 100 * HOUR, [], JSON.stringify({ name }))

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async (filters: { ids?: string[]; kinds?: number[]; authors?: string[]; '#a'?: string[]; '#A'?: string[]; '#d'?: string[] }[]) => {
    if (filters[0]?.kinds?.[0] === 0) return [profile(ME, 'Jan M'), profile(MIKY, 'Miky'), profile(KAT, 'Katerina'), profile(JAN, 'Jana')]
    // The relay's answer to each filter, as it matches: the page's root by `d`, its changes by `a`, its comments by `A`.
    return held.filter((e) =>
      filters.some(
        (f) =>
          (!f.ids || f.ids.includes(e.id)) &&
          (!f.kinds || f.kinds.includes(e.kind)) &&
          (!f.authors || f.authors.includes(e.pubkey)) &&
          (!f['#a'] || e.tags.some((t) => t[0] === 'a' && f['#a']?.includes(t[1]))) &&
          (!f['#A'] || e.tags.some((t) => t[0] === 'A' && f['#A']?.includes(t[1]))) &&
          (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']?.includes(t[1]))),
      ),
    )
  },
  publish: async (unsigned: UnsignedEvent) => {
    published.push(unsigned)
    const answer = answers.shift() ?? { ok: true }
    // What the relay took is there for the next read.
    if (answer.ok) held.push({ ...unsigned, id: `p${published.length}`.padEnd(64, '0'), sig: '' } as SignedEvent)
    return answer
  },
}))

const { FilePage } = await import('./FilePage')

function page(): ForeignObject {
  return { kind: 30842, address: ADDRESS, folder: FOLDER, naddr: 'naddr1page', eventId: ROOT, slots: { title: { value: 'Leaf feedback' } } } as unknown as ForeignObject
}

function show() {
  return render(
    <ToastProvider>
      <FilePage file={page()} loading={false} />
    </ToastProvider>,
  )
}

async function openMembers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /members?$/ }))
  return screen.findByRole('dialog', { name: /Members/ })
}

const tagOf = (e: UnsignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  Range.prototype.getClientRects = rects
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.getClientRects = rects
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  // Miky made it, Katerina edited its text two hours ago; since then a member was added and someone commented.
  held = [
    { ...event(30842, MIKY, NOW - 50 * HOUR, [['d', 'page-1'], ['h', FOLDER]]), id: ROOT },
    change(MIKY, NOW - 40 * HOUR, 'title', 'Leaf feedback'),
    change(KAT, NOW - 2 * HOUR, 'description', 'Members of the file are not visible'),
    event(1851, MIKY, NOW - HOUR, [['a', ADDRESS], ['field', `member:${KAT}`], ['value', 'true'], ['h', FOLDER], ['p', KAT]]),
    event(1111, JAN, NOW - 30 * 60_000, [['A', ADDRESS], ['K', '30842'], ['P', MIKY], ['h', FOLDER]], 'Agreed'),
  ]
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  published.length = 0
  answers = []
})

describe("a page's header", () => {
  it('says who edited its text last and when, not who commented or added a member since', async () => {
    show()
    expect(await screen.findByText('Edited 2 hours ago by Katerina')).toBeTruthy()
  })

  it('says "by you" when the viewer edited it last', async () => {
    held.push(change(ME, NOW - 5 * 60_000, 'summary', 'What we heard'))
    show()
    expect(await screen.findByText('Edited 5 minutes ago by you')).toBeTruthy()
  })

  it('says it was not edited when nothing but its making, a comment and an add are on the relay', async () => {
    held = held.filter((e) => e.kind !== 1851 || !['title', 'description'].includes(tagOf(e, 'field') ?? ''))
    show()
    expect(await screen.findByText('Not edited since it was made')).toBeTruthy()
  })

  it('moves the last edit into the ⋯ menu in a narrow window', async () => {
    const was = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    try {
      const user = userEvent.setup()
      show()
      await screen.findByRole('button', { name: '3 members' })
      expect(screen.queryByText('Edited 2 hours ago by Katerina')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'More' }))
      expect(await screen.findByRole('menuitem', { name: 'Edited 2 hours ago by Katerina' })).toBeTruthy()
    } finally {
      window.matchMedia = was
    }
  })

  it('counts its author, whoever was added and whoever commented as its members', async () => {
    const user = userEvent.setup()
    show()
    expect(await screen.findByRole('button', { name: '3 members' })).toBeTruthy()
    const dialog = await openMembers(user)
    for (const name of ['Miky', 'Katerina', 'Jana']) expect(within(dialog).getByText(name)).toBeTruthy()
  })
})

describe("a page's Members dialog", () => {
  it('offers Join to someone not in it, and no Add until they are', async () => {
    const user = userEvent.setup()
    show()
    const dialog = await openMembers(user)
    expect(within(dialog).queryByRole('button', { name: 'Add members' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({ kind: 1851, pubkey: ME })
    expect(published[0].tags).toEqual(expect.arrayContaining([['a', ADDRESS], ['field', `member:${ME}`], ['value', 'true'], ['h', FOLDER]]))
    expect(await screen.findByRole('button', { name: 'Add members' })).toBeTruthy()
  })

  it('adds a person as a member when the viewer is one, in the page’s Folder', async () => {
    // Jana has not commented here, so she is not in it yet.
    held = held.filter((e) => e.kind !== 1111)
    held.push(event(1851, MIKY, NOW - 10 * 60_000, [['a', ADDRESS], ['field', `member:${ME}`], ['value', 'true'], ['h', FOLDER], ['p', ME]]))
    const user = userEvent.setup()
    show()
    expect(await screen.findByRole('button', { name: '3 members' })).toBeTruthy()
    const dialog = await openMembers(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add members' }))
    await user.type(await screen.findByRole('combobox'), 'Jana')
    await user.click(await screen.findByRole('option', { name: /Jana/ }))
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({ kind: 1851, pubkey: ME })
    expect(published[0].tags).toEqual(expect.arrayContaining([['a', ADDRESS], ['field', `member:${JAN}`], ['value', 'true'], ['h', FOLDER]]))
    // The pill behind the open dialog, read again.
    expect(await screen.findByRole('button', { name: '4 members', hidden: true })).toBeTruthy()
  })

  it('leaves with a change the viewer signs, and the count goes down', async () => {
    held.push(event(1851, MIKY, NOW - 10 * 60_000, [['a', ADDRESS], ['field', `member:${ME}`], ['value', 'true'], ['h', FOLDER], ['p', ME]]))
    const user = userEvent.setup()
    show()
    expect(await screen.findByRole('button', { name: '4 members' })).toBeTruthy()
    const dialog = await openMembers(user)
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({ kind: 1851, pubkey: ME })
    expect(published[0].tags).toEqual(expect.arrayContaining([['field', `member:${ME}`], ['value', 'false']]))
    expect(await screen.findByRole('button', { name: '3 members', hidden: true })).toBeTruthy()
  })

  it('says so when the relay refuses an add, and keeps the count', async () => {
    held.push(event(1851, MIKY, NOW - 10 * 60_000, [['a', ADDRESS], ['field', `member:${ME}`], ['value', 'true'], ['h', FOLDER], ['p', ME]]))
    held = held.filter((e) => e.kind !== 1111)
    answers = [{ ok: false, status: 200, message: 'blocked' } as unknown as PublishResult]
    const user = userEvent.setup()
    show()
    const dialog = await openMembers(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add members' }))
    await user.type(await screen.findByRole('combobox'), 'Jana')
    await user.click(await screen.findByRole('option', { name: /Jana/ }))
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect((await screen.findAllByText('Could not add everyone. Try again.')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '3 members', hidden: true })).toBeTruthy()
  })

  it('offers no Join, Leave or Add on an archived page', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <FilePage file={{ ...page(), archived: { at: NOW - HOUR } } as unknown as ForeignObject} loading={false} />
      </ToastProvider>,
    )
    const dialog = await openMembers(user)
    expect(within(dialog).queryByRole('button', { name: /^(Join|Leave|Add members)$/ })).toBeNull()
  })
})
