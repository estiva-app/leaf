import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
  The column beside a page holds its comments, its Overview, or nothing (Katerina, 3 November; ONE-5, step 5), as
  Ship's `useSideColumn` (ONE-6, step 4d): one at a time, and hiding the Overview brings back what was there. Leaf's
  comments' fold is remembered (LED-3) and stays exactly as it was; the Overview is not remembered.
*/

/** Leaf loaded afresh, as a reload does: what this page load remembers starts over, the browser's storage stays. */
async function load() {
  vi.resetModules()
  const [{ useSideColumn }, { navigate }] = await Promise.all([import('./sideColumn'), import('../route')])
  return { side: renderHook(() => useSideColumn()), navigate }
}

/** What the column holds now. */
function holds({ comments, overview }: { comments: { open: boolean }; overview: { open: boolean } }): string {
  return overview.open ? (comments.open ? 'both' : 'overview') : comments.open ? 'comments' : 'none'
}

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the column beside a page: the comments, the Overview, or nothing (ONE-5, step 5)', () => {
  it('shows the Overview in the comments’ place, and hiding it brings the comments back', async () => {
    const { side } = await load()
    expect(holds(side.result.current)).toBe('comments')
    act(() => side.result.current.overview.onOpenChange(true))
    expect(holds(side.result.current)).toBe('overview')
    act(() => side.result.current.overview.onOpenChange(false))
    expect(holds(side.result.current)).toBe('comments')
  })

  it('hiding the Overview leaves the column empty when the comments were hidden before it', async () => {
    const { side } = await load()
    act(() => side.result.current.comments.onOpenChange(false))
    act(() => side.result.current.overview.onOpenChange(true))
    expect(holds(side.result.current)).toBe('overview')
    act(() => side.result.current.overview.onOpenChange(false))
    expect(holds(side.result.current)).toBe('none')
  })

  it('Show comments while the Overview is shown puts the Overview away', async () => {
    const { side } = await load()
    act(() => side.result.current.comments.onOpenChange(false))
    act(() => side.result.current.overview.onOpenChange(true))
    act(() => side.result.current.comments.onOpenChange(true))
    expect(holds(side.result.current)).toBe('comments')
    // And it is remembered as shown, as Show comments always was.
    expect(JSON.parse(window.localStorage.getItem('leaf.folded') ?? '{}').comments).toBe(false)
  })

  it('the Overview is not remembered, and leaves the comments’ fold as it was: a reload opens on what was kept', async () => {
    const first = await load()
    act(() => first.side.result.current.overview.onOpenChange(true))
    first.side.unmount()
    expect(holds((await load()).side.result.current)).toBe('comments')
    // Hidden before the Overview: still hidden after a reload.
    const third = await load()
    act(() => third.side.result.current.comments.onOpenChange(false))
    act(() => third.side.result.current.overview.onOpenChange(true))
    third.side.unmount()
    expect(holds((await load()).side.result.current)).toBe('none')
  })

  it('a comment count’s link (#comments) shows the comments, the Overview put away', async () => {
    window.history.replaceState(null, '', '/document/plan-1')
    const { side, navigate } = await load()
    act(() => side.result.current.overview.onOpenChange(true))
    act(() => navigate('/document/friday-plan-plan-1#comments'))
    expect(holds(side.result.current)).toBe('comments')
  })
})
