import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigate } from '../route'
import { useFold } from './folds'

describe('the comments column and a link to a file’s comments (#comments)', () => {
  it('shows the column folded on this browser when a comment count’s link arrives, and a fold after that holds', () => {
    window.localStorage.setItem('leaf.folded', JSON.stringify({ comments: true }))
    window.history.replaceState(null, '', '/document/plan-1')
    const { result } = renderHook(() => useFold('comments'))
    expect(result.current[0]).toBe(false)
    act(() => navigate('/document/friday-plan-plan-1#comments'))
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })
})

describe('a folded sidebar and a file opened from a link (Katerina, 30 Oct)', () => {
  /** A fresh page load: the folds are read once per load, so each case loads the module again. */
  async function load(path: string, how: 'navigate' | 'reload') {
    vi.resetModules()
    window.localStorage.setItem('leaf.folded', JSON.stringify({ sidebar: true }))
    window.history.replaceState(null, '', path)
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: how }] as unknown as PerformanceEntryList)
    const { useFold: fresh } = await import('./folds')
    return renderHook(() => fresh('sidebar')).result
  }
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.removeItem('leaf.folded')
  })

  it('unfolds for a file opened from a link, and stays unfolded on this browser', async () => {
    const sidebar = await load('/document/plan-a1b2c3d4-0000-4000-8000-00000000000a', 'navigate')
    expect(sidebar.current[0]).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('leaf.folded')!).sidebar).toBe(false)
  })

  it('stays folded on a reload, and on Home', async () => {
    expect((await load('/document/plan-a1b2c3d4-0000-4000-8000-00000000000a', 'reload')).current[0]).toBe(false)
    expect((await load('/', 'navigate')).current[0]).toBe(false)
  })
})
