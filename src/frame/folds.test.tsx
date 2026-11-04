import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { navigate } from '../route'
import { isFilePage, useFold } from './folds'

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

/**
 * Katerina, 30 Oct: a file opened from a link shows where it lives, so a folded sidebar unfolds for it, and Home keeps
 * it folded. The fold itself, remembered and unfolded once per page load, is the package's, tested there (ui 0.95.0);
 * which pages are a file is Leaf's.
 */
describe('which of Leaf’s pages a link unfolds the sidebar for', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))
  const at = (path: string) => {
    window.history.replaceState(null, '', path)
    return isFilePage()
  }

  it('unfolds it for a document, and keeps it folded on Home', () => {
    expect(at('/document/plan-a1b2c3d4-0000-4000-8000-00000000000a')).toBe(true)
    expect(at('/')).toBe(false)
  })
})
