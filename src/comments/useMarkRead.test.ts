// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// The blob this leads to on the wire is `CommentsColumn.topic.test.tsx`'s; this is when the column asks for it.
const markRead = vi.fn()
vi.mock('../relay/readState', () => ({ markRead: (...a: unknown[]) => markRead(...a) }))

const { useMarkRead } = await import('./useMarkRead')

// A reply that arrives while a topic is open in Leaf is read too, as in Ship (SHI-38) and Peek (PEE-44).
describe('a message drawn while the topic is open is read too', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    markRead.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('runs the dwell again when a newer message is drawn, up to that message', () => {
    const { rerender } = renderHook(({ at }) => useMarkRead(['thread:a'], at), { initialProps: { at: 1_000_000 } })
    vi.advanceTimersByTime(1500)
    expect(markRead).toHaveBeenCalledTimes(1)

    rerender({ at: 1_000_000 })
    vi.advanceTimersByTime(1500)
    expect(markRead).toHaveBeenCalledTimes(1)

    rerender({ at: 1_010_000 })
    vi.advanceTimersByTime(1500)
    expect(markRead).toHaveBeenCalledTimes(2)
    expect(markRead).toHaveBeenLastCalledWith(['thread:a'], 1_010_000)
  })
})
