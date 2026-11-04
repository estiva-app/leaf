import type { PublishResult, UnsignedEvent } from '@estiva-app/protocol'
import { ToastProvider } from '@estiva-app/ui'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { TopicsRead } from '@estiva-app/interop'
import type { TopicChoices, TopicOfFile } from '../document/fileTopics'

/* TOP-6: a Leaf file's page says which topics list it, each opening its page in Leaf (LTN-3), and adds it to a topic or removes it there. */

const ME = 'a'.repeat(64)
const MIKY = 'b'.repeat(64)
const DOC = '3518cd7b-5b85-49e8-ba94-4aacacad2163'
const ADDRESS = `30842:${MIKY}:${DOC}`
const WIDGETS: TopicOfFile = { address: `30840:${MIKY}:widgets`, folder: 'hq-folder', title: 'Widgets', openUrl: 'https://peek.estiva.app/topic/widgets', archived: false }
const DESIGN: TopicOfFile = { address: `30840:${MIKY}:design`, folder: 'design-folder', title: 'Design review', openUrl: 'https://peek.estiva.app/topic/design', archived: false }
const OLD: TopicOfFile = { address: `30840:${MIKY}:old`, folder: 'hq-folder', title: 'Old launch', archived: true }

const published: UnsignedEvent[] = []
let answers: PublishResult[] = []

vi.mock('../relay/bridge', () => ({
  viewerPubkey: () => ME,
  query: async () => [],
  queryAll: async () => [],
  publish: async (unsigned: UnsignedEvent) => {
    published.push(unsigned)
    return answers.shift() ?? { ok: true }
  },
}))
// The reads are interop's topicsOfFile and resolveForeignRoots, covered in estiva-foundation; the writes stay real, so each
// click is checked on the event that would reach the relay.
// 'pending': the read after a write has not answered yet, so what shows is the row's own rollback, not a fresh read.
// `held`: the choices this tab already holds, drawn while `choices` is read again.
const reads = vi.hoisted(() => ({ topics: [] as TopicOfFile[] | Error | 'pending', choices: { yours: [], others: [] } as TopicChoices | Error, held: undefined as TopicChoices | undefined }))
vi.mock('../document/fileTopics', async (original) => ({
  ...(await original<typeof import('../document/fileTopics')>()),
  readFileTopics: vi.fn(async () => {
    if (reads.topics === 'pending') return new Promise<never>(() => {})
    if (reads.topics instanceof Error) throw reads.topics
    return reads.topics
  }),
  readTopicChoices: vi.fn(async () => {
    if (reads.choices instanceof Error) throw reads.choices
    return reads.choices
  }),
  topicChoicesNow: vi.fn(() => reads.held),
}))

const { FileTopicsOf } = await import('./FileTopics')

function show(address = ADDRESS) {
  return render(
    <ToastProvider>
      <FileTopicsOf address={address} />
    </ToastProvider>,
  )
}

const row = () => screen.findByText('Topics').then((label) => label.closest('[data-file-topics]') as HTMLElement)
const tag = (e: UnsignedEvent, name: string) => e.tags.filter((t) => t[0] === name).map((t) => t[1])

beforeEach(() => {
  published.length = 0
  answers = []
  reads.topics = [WIDGETS]
  reads.choices = { yours: [DESIGN, WIDGETS], others: [] }
  reads.held = undefined
})
afterEach(cleanup)

describe('a file’s Topics row', () => {
  it("names each topic that lists the file, linking to the topic's own page in Leaf (LTN-3)", async () => {
    show()
    const link = await screen.findByRole('link', { name: /Widgets/ })
    expect(link.getAttribute('href')).toBe('/topic/widgets-widgets')
    expect(within(await row()).getByRole('button', { name: 'Remove from Widgets' })).toBeTruthy()
  })

  it('links a space to Peek once the topics read knows it for one, even when that read lands after the row (D4)', async () => {
    const { heldTopics } = await import('../document/fileTopics')
    onTestFinished(() => heldTopics.clear())
    show()
    const link = await screen.findByRole('link', { name: /Widgets/ })
    expect(link.getAttribute('href')).toBe('/topic/widgets-widgets')
    const space = { address: WIDGETS.address, space: true, yours: true, folder: 'hq-folder', listed: [], object: {} }
    await act(() => heldTopics.reload(async () => ({ me: ME, topics: [space], membership: {} }) as unknown as TopicsRead))
    expect(screen.getByRole('link', { name: /Widgets/ }).getAttribute('href')).toBe('https://peek.estiva.app/topic/widgets')
  })

  it('says None when no topic lists the file, and still offers Add to topic', async () => {
    reads.topics = []
    show()
    expect(await screen.findByText('None')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to topic' })).toBeTruthy()
  })

  it('says the topics could not be read when the read fails, rather than None', async () => {
    reads.topics = new Error('relay down')
    show()
    expect(await screen.findByText('Topics could not be read.')).toBeTruthy()
    expect(screen.queryByText('None')).toBeNull()
  })

  it('keeps an archived topic’s chip with no Remove', async () => {
    reads.topics = [OLD, WIDGETS]
    show()
    await screen.findByRole('link', { name: /Widgets/ })
    expect(screen.getByText('Old launch')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove from Old launch' })).toBeNull()
  })

  it('draws nothing on a topic’s own page: a topic lists no topic', async () => {
    const { container } = show(`30840:${MIKY}:widgets`)
    await waitFor(() => expect(container.querySelector('[data-file-topics]')).toBeNull())
    expect(screen.queryByText('Topics')).toBeNull()
  })
})

describe('Add to topic and Remove', () => {
  it('adds the file to a picked topic: a lists entry on that topic, in its Folder, signed by the reader', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Add to topic' }))
    const palette = await screen.findByRole('dialog')
    const pick = await within(palette).findByText('Design review')
    // What the relay answers once it holds the add.
    reads.topics = [DESIGN, WIDGETS]
    await user.click(pick)

    await waitFor(() => expect(published).toHaveLength(1))
    const [entry] = published
    expect(entry.kind).toBe(1851)
    expect(entry.pubkey).toBe(ME)
    expect(tag(entry, 'a')).toEqual([DESIGN.address])
    expect(tag(entry, 'field')).toEqual([`lists:${DOC}`])
    expect(tag(entry, 'value')).toEqual(['true'])
    expect(tag(entry, 'h')).toEqual(['design-folder'])
    expect(tag(entry, 'o')).toEqual([DOC])
    expect(await screen.findByRole('link', { name: /Design review/ })).toBeTruthy()
  })

  it('does not offer a topic that already lists the file', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Add to topic' }))
    const palette = await screen.findByRole('dialog')
    await within(palette).findByText('Design review')
    expect(within(palette).queryByText('Widgets')).toBeNull()
  })

  it('Add to topic draws the choices this tab holds at once, never “Reading topics…”, and keeps them when reading again fails', async () => {
    const user = userEvent.setup()
    reads.held = { yours: [DESIGN], others: [] }
    reads.choices = new Error('relay down')
    show()
    await user.click(await screen.findByRole('button', { name: 'Add to topic' }))
    const palette = await screen.findByRole('dialog')
    expect(within(palette).getByText('Design review')).toBeTruthy()
    expect(within(palette).queryByText('Reading topics…')).toBeNull()
    await waitFor(() => expect(within(palette).queryByText('Topics could not be read.')).toBeNull())
    expect(within(palette).getByText('Design review')).toBeTruthy()
  })

  it('finds a topic by the start of any word of its title', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Add to topic' }))
    const palette = await screen.findByRole('dialog')
    await user.type(within(palette).getByRole('combobox'), 'rev')
    expect(await within(palette).findByText('Design review')).toBeTruthy()
    await user.clear(within(palette).getByRole('combobox'))
    await user.type(within(palette).getByRole('combobox'), 'eview')
    expect(await within(palette).findByText('No topic is called “eview”.')).toBeTruthy()
  })

  it('removes the file from a topic: a lists entry set to false, and the chip goes', async () => {
    const user = userEvent.setup()
    show()
    const remove = await screen.findByRole('button', { name: 'Remove from Widgets' })
    // What the relay answers once it holds the remove.
    reads.topics = []
    await user.click(remove)
    await waitFor(() => expect(published).toHaveLength(1))
    expect(tag(published[0], 'a')).toEqual([WIDGETS.address])
    expect(tag(published[0], 'value')).toEqual(['false'])
    expect(tag(published[0], 'h')).toEqual(['hq-folder'])
    await waitFor(() => expect(screen.queryByRole('link', { name: /Widgets/ })).toBeNull())
  })

  it('puts the chip back and says why in words when the relay refuses a remove', async () => {
    answers = [{ ok: false, reason: 'restricted: not a channel member' }]
    const user = userEvent.setup()
    show()
    const remove = await screen.findByRole('button', { name: 'Remove from Widgets' })
    reads.topics = 'pending'
    await user.click(remove)
    expect((await screen.findAllByText('Only people in “Widgets”’s team can change what it lists.')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Widgets/ })).toBeTruthy()
  })

  it('takes the chip away again and says why in words when the relay refuses an add', async () => {
    answers = [{ ok: false, reason: 'restricted: not a channel member' }]
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Add to topic' }))
    const pick = await within(await screen.findByRole('dialog')).findByText('Design review')
    reads.topics = 'pending'
    await user.click(pick)
    expect((await screen.findAllByText('Only people in “Design review”’s team can change what it lists.')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Design review/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Widgets/ })).toBeTruthy()
  })
})
