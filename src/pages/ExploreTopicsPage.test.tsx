import type { FolderSummary } from '@estiva-app/interop'
import { parseMutedBlob } from '@estiva-app/conversation'
import { ToastProvider, TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ, ME, MIKY, archive, file, markSpace, muteList, relay, said, topic } from '../topics/fixtures/topicsRelay'

/* TOPI-4: Explore topics as a person sees it — its tabs, search and rows — and Join as the relay receives it. */

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
const rows = () => [...document.querySelectorAll('[data-topic]')].map((row) => within(row as HTMLElement).getAllByRole('link')[0].textContent)
const rowOf = (title: string) => document.querySelector(`[data-topic]:has(a[href*="${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"])`) as HTMLElement

let topics: Record<string, string> = {}
/* A page you muted too: Join takes only the topic off the list. */
let mutedPage = ''
beforeEach(() => {
  relay.reset()
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

describe('Explore topics', () => {
  it('opens on Your topics, newest first; Other topics and All A–Z; Archived apart, with no Join; never a space; each tab counted', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    expect(tab(/Your topics/).textContent).toContain('2')
    // A topic you muted is not yours: it is with the others, to join again.
    expect(tab(/Other topics/).textContent).toContain('3')
    expect(tab(/^All/).textContent).toContain('5')
    expect(tab(/Archived/).textContent).toContain('1')
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()

    fireEvent.click(tab(/Other topics/))
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
    const search = screen.getByLabelText('Find a topic')
    fireEvent.change(search, { target: { value: 'q4-pl' } })
    expect(rows()).toEqual(['Q4-plan'])
    fireEvent.change(search, { target: { value: 'lan' } })
    expect(rows()).toEqual([])
    expect(screen.getByText('No topic matches “lan”.')).toBeTruthy()
  })
})

describe('Join on Explore topics', () => {
  it('signs your follow of the topic at All and sends it, then shows the topic under Your topics', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other topics/))
    fireEvent.click(within(rowOf('Zebra launch')).getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(relay.sent).toHaveLength(1))
    const [follow] = relay.sent
    expect(follow.kind).toBe(1851)
    expect(follow.pubkey).toBe(ME)
    expect(follow.tags).toEqual(expect.arrayContaining([['a', topics.zebra], ['h', HQ], ['field', `follow:${ME}`], ['value', 'all']]))
    // The topics are read again at once: it leaves Other topics for Your topics, with no Join.
    await waitFor(() => expect(rows()).toEqual(['Apple roadmap', 'Quiet']))
    fireEvent.click(tab(/Your topics/))
    expect(rows()).toContain('Zebra launch')
    expect(within(rowOf('Zebra launch')).queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('takes a topic you muted off your mute list, leaving the rest of it, so it is yours again', async () => {
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other topics/))
    fireEvent.click(within(rowOf('Quiet')).getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(relay.sent.some((event) => event.kind === 30078)).toBe(true))
    const list = relay.sent.find((event) => event.kind === 30078)!
    expect(list.pubkey).toBe(ME)
    expect(list.tags).toContainEqual(['d', 'estiva:muted:v1'])
    // The stand-in's "ciphertext" is `enc:` before what was encrypted.
    expect(parseMutedBlob(list.content.replace(/^enc:/, ''))?.keys).toEqual([mutedPage])
    fireEvent.click(tab(/Your topics/))
    await waitFor(() => expect(rows()).toContain('Quiet'))
  })

  it('says nothing changed, in the relay’s words, when the relay refuses the join', async () => {
    relay.refuse = 'blocked: you are not in this team'
    open()
    await waitFor(() => expect(rows()).toEqual(['Hiring', 'Q4-plan']))
    fireEvent.click(tab(/Other topics/))
    fireEvent.click(within(rowOf('Apple roadmap')).getByRole('button', { name: 'Join' }))

    expect((await screen.findAllByText('Nothing changed: “Apple roadmap” could not be joined. blocked: you are not in this team')).length).toBeGreaterThan(0)
    expect(relay.sent).toEqual([])
    expect(within(rowOf('Apple roadmap')).getByRole('button', { name: 'Join' })).toBeTruthy()
  })
})
