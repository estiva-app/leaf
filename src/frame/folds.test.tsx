import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
