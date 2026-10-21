import type { ForeignObject } from '@estiva-app/interop'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/* The relay's answers, one per read: a read that throws is a dropped connection. */
const reads = vi.hoisted(() => ({ answers: [] as (() => Promise<Record<string, unknown>>)[] }))
vi.mock('@estiva-app/interop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@estiva-app/interop')>()),
  resolveForeignObjects: () => reads.answers.shift()!(),
}))
vi.mock('../relay/bridge', () => ({ query: vi.fn(async () => []) }))

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
