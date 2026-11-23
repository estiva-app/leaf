import type { FolderSummary } from '@estiva-app/interop'
import { parseMutedBlob } from '@estiva-app/conversation'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ, ME, MIKY, archive, file, markSpace, muteList, nip44, relay, said, sign, topic } from '../topics/fixtures/topicsRelay'

/* TOPI-4: Explore initiatives as a person sees it — its tabs, search and rows — and Join as the relay receives it. */

vi.mock('../relay/bridge', async () => (await import('../topics/fixtures/topicsRelay')).bridge)
// Estiva ID's encryption is a round trip: the fixture's stand-in writes `enc:<plaintext>`, so what Join encrypted is read back below.
vi.mock('../auth/nip44', async () => ({ nip44: (await import('../topics/fixtures/topicsRelay')).nip44 }))
vi.mock('../relay/manifests', async () => ({ resolveQuery: (await import('../topics/fixtures/topicsRelay')).bridge.query, projections: undefined }))

const { ExploreTopicsPage } = await import('./ExploreTopicsPage')
const { resetTopicReadsForTests } = await import('../topics/topicReads')
const { resetMutedForTests } = await import('../topics/muted')
const { resetTopicChoicesForTests } = await import('../document/fileTopics')

const folders = [{ id: HQ, name: 'Launch team' }] as unknown as FolderSummary[]
const open = () =>
  render(
    <TooltipProvider>
      <ToastProvider>
        <ExploreTopicsPage folders={folders} />
      </ToastProvider>
    </TooltipProvider>,
  )
const tab = (name: RegExp) => screen.getByRole('tab', { name })
const rows = () => [...document.querySelectorAll('[role="row"]:has(a)')].map((row) => within(row as HTMLElement).getAllByRole('link')[0].textContent)
const rowOf = (title: string) => document.querySelector(`[role="row"]:has(a[href*="${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"])`) as HTMLElement

let topics: Record<string, string> = {}
/* A page you muted too: Join takes only the topic off the list. */
let mutedPage = ''
beforeEach(() => {
  relay.reset()
  nip44.refuseDecrypt = false
  resetTopicChoicesForTests()
  resetTopicReadsForTests()
  resetMutedForTests()
  const page = file(30842, 'Launch plan')
  topics = {
    plan: topic(ME, 'Q4-plan', [page], 1_700_000_300),
    hiring: topic(ME, 'Hiring', [], 1_700_000_100),
    zebra: topic(MIKY, 'Zebra launch', [page], 1_700_000_100),
    apple: topic(MIKY, 'Apple roadmap', [], 1_700_000_100),
    old: topic(MIKY, 'Old plans', [], 1_700_000_100),
    space: topic(MIKY, 'bugs', [], 1_700_000_100),
    quiet: topic(ME, 'Quiet', [], 1_700_000_100),
  }
  said(topics.hiring, 1_700_000_500)
  archive(topics.old)
  markSpace(topics.space)
  mutedPage = page.address!
  muteList([topics.quiet, mutedPage])
})
afterEach(cleanup)

describe('Explore initiatives', () => {
  it('opens on Your initiatives, newest first; Other initiatives and All A–Z; Archived apart, with no Join; never a space; each tab counted', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    // The count is the tab's last word: exactly it, so 15 never passes for 5.
    expect(tab(/Your initiatives/).textContent).toMatch(/^Your initiatives\D*2$/)
    // A topic you muted is not yours: it is with the others, to join again.
    expect(tab(/Other initiatives/).textContent).toMatch(/^Other initiatives\D*3$/)
    expect(tab(/^All/).textContent).toMatch(/^All\D*5$/)
    expect(tab(/Archived/).textContent).toMatch(/^Archived\D*1$/)
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()

    fireEvent.click(tab(/Other initiatives/))
    expect(rows()).toEqual(['Apple roadmap', 'Quiet', 'Zebra launch'])
    expect(screen.getAllByRole('button', { name: 'Join' })).toHaveLength(3)
    fireEvent.click(tab(/^All/))
    expect(rows()).toEqual(['Apple roadmap', 'Hiring', 'Q4-plan', 'Quiet', 'Zebra launch'])
    fireEvent.click(tab(/Archived/))
    expect(rows()).toEqual(['Old plans'])
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    // Each row opens the topic's page here, and names its team.
    expect(within(rowOf('Old plans')).getByRole('link').getAttribute('href')).toMatch(/^\/topic\/old-plans-/)
    expect(rowOf('Old plans').textContent).toContain('Launch team')
  })

  it('finds a topic by the start of a word of its name, never mid-word', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/^All/))
    const search = screen.getByLabelText('Find an initiative')
    fireEvent.change(search, { target: { value: 'q4-pl' } })
    expect(rows()).toEqual(['Q4-plan'])
    fireEvent.change(search, { target: { value: 'lan' } })
    expect(rows()).toEqual([])
    expect(screen.getByText('No initiative matches “lan”.')).toBeTruthy()
  })
})

describe('Join on Explore initiatives', () => {
  it('signs your own member change on the initiative, as Peek’s Join does (no level chosen, so Important), then shows it under Your initiatives', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Zebra launch')).getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(relay.sent).toHaveLength(1))
    const [join] = relay.sent
    expect(join.kind).toBe(1851)
    expect(join.pubkey).toBe(ME)
    expect(join.tags).toEqual(expect.arrayContaining([['a', topics.zebra], ['h', HQ], ['field', `member:${ME}`], ['value', 'true']]))
    // No level is chosen for you: nothing writes follow:<you>, so Important is what lights.
    expect(join.tags.some(([name, value]) => name === 'field' && value.startsWith('follow:'))).toBe(false)
    // The topics are read again at once: it leaves Other initiatives for Your initiatives, with no Join.
    await waitFor(() => expect(rows()).toEqual(['Apple roadmap', 'Quiet']))
    fireEvent.click(tab(/Your initiatives/))
    expect(rows()).toContain('Zebra launch')
    expect(within(rowOf('Zebra launch')).queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('takes a topic you muted off your mute list, leaving the rest of it, so it is yours again', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Quiet')).getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(relay.sent.some((event) => event.kind === 30078)).toBe(true))
    const list = relay.sent.find((event) => event.kind === 30078)!
    expect(list.pubkey).toBe(ME)
    expect(list.tags).toContainEqual(['d', 'estiva:muted:v1'])
    // The stand-in's "ciphertext" is `enc:` before what was encrypted.
    expect(parseMutedBlob(list.content.replace(/^enc:/, ''))?.keys).toEqual([mutedPage])
    fireEvent.click(tab(/Your initiatives/))
    await waitFor(() => expect(rows()).toContain('Quiet'))
  })

  it('says nothing changed, in the relay’s words, when the relay refuses the join', async () => {
    relay.refuse = 'blocked: you are not in this team'
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Apple roadmap')).getByRole('button', { name: 'Join' }))

    expect((await screen.findAllByText('Nothing changed: “Apple roadmap” could not be joined. blocked: you are not in this team')).length).toBeGreaterThan(0)
    // Only the follow was tried: after a refusal nothing else goes out.
    expect(relay.attempted.map((event) => event.kind)).toEqual([1851])
    expect(relay.sent).toEqual([])
    expect(within(rowOf('Apple roadmap')).getByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('joins a muted topic but never writes the mute list over when Estiva ID will not decrypt it, and says it is still muted', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    nip44.refuseDecrypt = true
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Quiet')).getByRole('button', { name: 'Join' }))

    expect((await screen.findAllByText('Joined “Quiet”, but it is still muted. Join again to unmute it.')).length).toBeGreaterThan(0)
    expect(relay.attempted.map((event) => event.kind)).toEqual([1851])
  })

  it('joins a muted topic and says it is still muted when the relay refuses the new mute list', async () => {
    relay.refuseKinds = [30078]
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Quiet')).getByRole('button', { name: 'Join' }))

    expect((await screen.findAllByText('Joined “Quiet”, but it is still muted. Join again to unmute it.')).length).toBeGreaterThan(0)
    expect(relay.sent.map((event) => event.kind)).toEqual([1851])
    expect(relay.attempted.map((event) => event.kind)).toEqual([1851, 30078])
  })
})

describe('Who is in an initiative, on Explore initiatives', () => {
  it('draws the faces of the people it lists beside their number, as Peek’s page does', async () => {
    // Miky made "Zebra launch", so it lists Miky: one face, with Miky's picture, and the number 1.
    relay.held.push(sign({ kind: 0, pubkey: MIKY, created_at: 1_700_000_000, tags: [], content: JSON.stringify({ name: 'Ada Lin', picture: 'https://example.test/ada.png' }) }))
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/^All/))
    const pill = await waitFor(() => within(rowOf('Zebra launch')).getByRole('img', { name: '1 member' }))
    await waitFor(() => expect(pill.querySelector('img[src="https://example.test/ada.png"]')).toBeTruthy())
    expect(pill.textContent).toContain('1')
  })
})

describe('What Join says, on Explore initiatives', () => {
  it('says you joined it and at which level, in Peek’s words, once the relay took it', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/^All/))
    fireEvent.click(within(rowOf('Zebra launch')).getByRole('button', { name: 'Join' }))
    // It lands at Important, as Peek's Join (Katerina, 18 November: "let's make it to important").
    expect((await screen.findAllByText('You joined Zebra launch. Notifications: Important.')).length).toBeGreaterThan(0)
  })

  it('says Everything when you had chosen All on the initiative you muted: Join keeps your own level', async () => {
    // You chose All on "Quiet" before muting it: a member change does not choose for you, so All is what lights again.
    relay.held.push(sign({ kind: 1851, pubkey: ME, created_at: 1_700_000_200, tags: [['a', topics.quiet], ['field', `follow:${ME}`], ['value', 'all'], ['h', HQ], ['p', ME]], content: '' }))
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other initiatives/))
    fireEvent.click(within(rowOf('Quiet')).getByRole('button', { name: 'Join' }))
    expect((await screen.findAllByText('You joined Quiet. Notifications: Everything.')).length).toBeGreaterThan(0)
  })
})
