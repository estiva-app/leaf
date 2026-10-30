import type { ForeignObject } from '@estiva-app/interop'
import { ToastProvider } from '@estiva-app/ui'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/* The relay's answers, one per read: a read that throws is a dropped connection. */
const reads = vi.hoisted(() => ({ answers: [] as ((options?: { archivedWith?: boolean }) => Promise<Record<string, unknown>>)[] }))
vi.mock('@estiva-app/interop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@estiva-app/interop')>()),
  resolveForeignObjects: (...args: unknown[]) => reads.answers.shift()!(args[4] as { archivedWith?: boolean } | undefined),
}))
vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []), publish: vi.fn(), viewerPubkey: () => 'c4'.repeat(32) }))

import { CommentCard } from '../comments/CommentCard'
import { PageLink } from './PageLink'
import { ReferencesProvider, useReferences } from './references'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({ ref: 'r', kind: 30851, eventId: 'e', widget: 'card', slots: {}, meta: [], actions: [], viaRecommendation: false, ...over }) as ForeignObject
const issue = (subtitle: string) =>
  file({ noun: 'issue', slots: { title: { value: 'Fix the login' }, subtitle: { value: subtitle } } as ForeignObject['slots'] })

/** A comment's line that is only a link, with the page's references read as the column reads them. */
function Row({ uri }: { uri: string }) {
  return (
    <ReferencesProvider value={useReferences([uri])}>
      <PageLink uri={uri} place="row" />
    </ReferencesProvider>
  )
}

describe('a link drawn as a row', () => {
  it('reads its file again after a dropped connection, rather than wait as a placeholder for good', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const uri = 'nostr:naddr1retried'
    reads.answers.push(
      () => Promise.reject(new Error('socket closed')),
      async () => ({ [uri]: issue('Summary') }),
    )
    render(<Row uri={uri} />)
    await act(async () => {})
    expect(screen.queryByText('Fix the login')).toBeNull()
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)))
    expect(screen.getByText('Fix the login')).toBeTruthy()
    expect(reads.answers).toHaveLength(0)
  })
})

describe('a link’s card under a comment', () => {
  it('shows the status of an issue whose project is archived as words, not a picker', async () => {
    const uri = 'nostr:naddr1inarchivedproject'
    const project = '30850:f3:p'
    // The relay marks it archived with its project only when asked to read the project's archive too.
    reads.answers.push(async (options) => ({
      [uri]: file({
        noun: 'issue',
        slots: { title: { value: 'Fix the login' }, status: { value: 'Todo', field: 'status' } } as ForeignObject['slots'],
        actions: [
          { id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' }] },
        ] as ForeignObject['actions'],
        ...(options?.archivedWith ? { archived: { by: 'f3', at: 1, with: project } } : {}),
      }),
    }))
    render(<Card uri={uri} />)
    expect(await screen.findByText('Fix the login')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull()
  })

  it('offers the status picker for an issue nothing archives', async () => {
    const uri = 'nostr:naddr1inliveproject'
    reads.answers.push(async () => ({
      [uri]: file({
        noun: 'issue',
        slots: { title: { value: 'Fix the signup' }, status: { value: 'Todo', field: 'status' } } as ForeignObject['slots'],
        actions: [
          { id: 'set-status', label: 'Status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' }] },
        ] as ForeignObject['actions'],
      }),
    }))
    render(<Card uri={uri} />)
    expect(await screen.findByText('Fix the signup')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeNull()
  })
})

/** The card under a comment, with the page's references read as the column reads them. */
function Card({ uri }: { uri: string }) {
  return (
    <ToastProvider>
      <ReferencesProvider value={useReferences([uri])}>
        <CommentCard uri={uri} />
      </ReferencesProvider>
    </ToastProvider>
  )
}

/**
 * A new page load: the tab's reads and the device's memory read afresh, as a reload reads them. The relay's answers
 * and the device's storage carry over, as they do across a reload.
 */
async function freshTab() {
  vi.resetModules()
  const references = await import('./references')
  const { PageLink: Link } = await import('./PageLink')
  return function FreshRow({ uri }: { uri: string }) {
    return (
      <references.ReferencesProvider value={references.useReferences([uri])}>
        <Link uri={uri} place="row" />
      </references.ReferencesProvider>
    )
  }
}

const dropped = () => Promise.reject(new Error('socket closed'))
const hangs = () => new Promise<Record<string, unknown>>(() => {})

describe('a link whose reads keep failing (widget review, item 41)', () => {
  it('says it is not available after its last retry, never a placeholder for good, and draws its file once a quiet read answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const FreshRow = await freshTab()
    const uri = 'nostr:naddr1keepsfailing'
    // The first read and its three retries, after 5, 10 and 20 seconds.
    reads.answers.push(dropped, dropped, dropped, dropped, async () => ({ [uri]: issue('Back again') }))
    render(<FreshRow uri={uri} />)
    await act(async () => {})
    for (const wait of [5000, 10_000, 20_000]) await act(async () => void (await vi.advanceTimersByTimeAsync(wait)))
    expect(screen.getByText(/not available/)).toBeTruthy()
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))
    expect(screen.getByText('Fix the login')).toBeTruthy()
    expect(reads.answers).toHaveLength(0)
  })
})

describe('a link this device found not available (widget review, item 42)', () => {
  afterEach(() => window.localStorage.clear())

  it('says so from the first paint on the next open, while it is read again, instead of a placeholder that shrinks', async () => {
    const uri = 'nostr:naddr1gonelasttime'
    reads.answers.push(async () => ({}))
    const Before = await freshTab()
    render(<Before uri={uri} />)
    expect(await screen.findByText(/not available/)).toBeTruthy()
    cleanup()
    reads.answers.push(hangs)
    const After = await freshTab()
    render(<After uri={uri} />)
    expect(screen.getByText(/not available/)).toBeTruthy()
  })

  it('is not remembered for reads that only failed: the next open waits for its read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const uri = 'nostr:naddr1droppedlasttime'
    reads.answers.push(dropped, dropped, dropped, dropped)
    const Before = await freshTab()
    render(<Before uri={uri} />)
    await act(async () => {})
    for (const wait of [5000, 10_000, 20_000]) await act(async () => void (await vi.advanceTimersByTimeAsync(wait)))
    expect(screen.getByText(/not available/)).toBeTruthy()
    cleanup()
    reads.answers.length = 0
    reads.answers.push(hangs)
    const After = await freshTab()
    render(<After uri={uri} />)
    await act(async () => {})
    expect(screen.queryByText(/not available/)).toBeNull()
  })
})
