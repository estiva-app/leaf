import type { NavTreeGroup } from '@estiva-app/ui'
import { TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamsTree } from './TeamsTree'

/* Katerina, 23 November: as Peek's Teams column, your teams first and the rest folded under "Other teams". */

const group = (id: string, title: string): NavTreeGroup => ({ id, title, nodes: [] })
const TEAMS = [group('hq', 'Estiva HQ'), group('leaf', 'Leaf'), group('peek', 'Peek')]

const show = (props: Partial<Parameters<typeof TeamsTree>[0]> = {}) =>
  render(
    <TooltipProvider>
      <TeamsTree groups={TEAMS} failed={false} {...props} />
    </TooltipProvider>,
  )

/** The team headings shown, in order: a shut fold's are not offered. */
const headings = () => TEAMS.map((team) => team.title).filter((title) => screen.queryByRole('button', { name: new RegExp(`^${title}`) }))

afterEach(cleanup)

describe('the sidebar’s teams', () => {
  it('lists your teams first and folds the others under Other teams, shut, with their count', () => {
    show({ yours: new Set(['leaf']) })
    expect(headings()).toEqual(['Leaf'])
    const other = screen.getByRole('button', { name: /Other teams/ })
    expect(other.textContent).toContain('2')
    expect(other.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(other)
    expect(headings()).toEqual(['Estiva HQ', 'Leaf', 'Peek'])
  })

  it('opens Other teams for a team in it whose page is open', () => {
    show({ yours: new Set(['leaf']), openTeam: 'hq' })
    expect(screen.getByRole('button', { name: /Other teams/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('lists every team in one list until it knows which you are in', () => {
    show()
    expect(headings()).toEqual(['Estiva HQ', 'Leaf', 'Peek'])
    expect(screen.queryByRole('button', { name: /Other teams/ })).toBeNull()
  })

  it('says No teams yet only when there is no team at all', () => {
    show({ yours: new Set() })
    expect(screen.queryByText('No teams yet.')).toBeNull()
    cleanup()
    show({ groups: [], yours: new Set() })
    expect(screen.getByText('No teams yet.')).toBeTruthy()
  })
})
