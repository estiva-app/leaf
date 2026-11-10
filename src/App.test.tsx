import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { APP_TITLE } from './config'

describe('Leaf', () => {
  it('opens in its frame, anonymous in a build with no sign-in', () => {
    render(<App />)
    expect(screen.getAllByText(APP_TITLE).length).toBeGreaterThan(0)
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
    expect(screen.getByText(/^Running alone/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
  })

  it('opens Explore topics at /topics, named so in the browser tab (TOPI-4)', async () => {
    window.history.pushState(null, '', '/topics')
    try {
      render(<App />)
      expect(screen.getAllByText('Explore topics').length).toBeGreaterThan(0)
      expect(screen.queryByText('Nothing here yet.')).toBeNull()
      await waitFor(() => expect(document.title).toBe('Explore topics – Leaf'))
    } finally {
      window.history.pushState(null, '', '/')
    }
  })
})
