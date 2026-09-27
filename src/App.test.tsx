import { render, screen } from '@testing-library/react'
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
})
