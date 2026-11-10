import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* LTN-2: the sidebar's topics are read after the Folders, so the page's text is not behind them. */

const ME = 'a'.repeat(64)
let reads = 0
let down = false
const answer = async () => {
  reads += 1
  if (down) throw new Error('The relay could not be reached.')
  return []
}
vi.mock('../relay/bridge', () => ({ viewerPubkey: () => ME, query: answer, queryAll: answer, publish: async () => ({ ok: true }) }))
vi.mock('../relay/manifests', () => ({ resolveQuery: async () => [], projections: undefined }))

const { resetTopicChoicesForTests } = await import('../document/fileTopics')
const { useSidebarTopics } = await import('./useSidebarTopics')

beforeEach(() => {
  reads = 0
  down = false
  resetTopicChoicesForTests()
})

describe('when the sidebar reads your topics', () => {
  it('asks the relay nothing until the Folders are read, then reads them', async () => {
    const { result, rerender } = renderHook(({ ready }) => useSidebarTopics(ready, () => null), { initialProps: { ready: false } })
    expect(result.current).toBe('loading')
    expect(reads).toBe(0)
    rerender({ ready: true })
    await waitFor(() => expect(result.current).toEqual([]))
    expect(reads).toBeGreaterThan(0)
  })

  it('says the topics could not be read when the relay cannot be reached', async () => {
    down = true
    const { result } = renderHook(() => useSidebarTopics(true, () => null))
    await waitFor(() => expect(result.current).toBe('failed'))
  })
})
