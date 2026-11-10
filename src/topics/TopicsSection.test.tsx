import type { ForeignObject } from '@estiva-app/interop'
import { TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TopicsSection } from './TopicsSection'
import type { SidebarTopic } from './sidebarTopics'

/* LTN-2, TOPI-4: Leaf's sidebar Topics as a person sees them: five, then Explore topics, each folding to the files it lists. */

const page = (d: string, title: string): ForeignObject =>
  ({ address: `30842:${'a'.repeat(64)}:${d}`, kind: 30842, ref: d, naddr: `naddr-${d}`, slots: { title: { value: title } }, actions: [] }) as unknown as ForeignObject
const topicOf = (i: number, files = [page(`d${i}`, `Page ${i}`)]): SidebarTopic => ({ address: `30840:${'b'.repeat(64)}:t${i}`, title: `Topic ${i}`, files })

const draw = (topics: Parameters<typeof TopicsSection>[0]['topics'], fileNow = (f: ForeignObject) => f) =>
  render(
    <TooltipProvider>
      <TopicsSection topics={topics} fileNow={fileNow} />
    </TooltipProvider>,
  )
const rows = () => screen.queryAllByRole('link').map((link) => link.textContent)

afterEach(cleanup)

describe('the sidebar’s Topics', () => {
  it('shows five of your topics in the order handed, then Explore topics, which opens /topics; no More', () => {
    draw([1, 2, 3, 4, 5, 6, 7].map((i) => topicOf(i)))
    expect(rows()).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5', 'Explore topics'])
    expect(screen.getByRole('link', { name: 'Explore topics' }).getAttribute('href')).toBe('/topics')
    expect(screen.queryByRole('link', { name: 'More' })).toBeNull()
  })

  it('marks Explore topics as the current row while it is open', () => {
    render(
      <TooltipProvider>
        <TopicsSection topics={[topicOf(1)]} exploreNow fileNow={(f) => f} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('link', { name: 'Explore topics' }).getAttribute('aria-current')).toBe('page')
  })

  it('draws a topic listing nothing Leaf opens with no fold under it', () => {
    draw([topicOf(1, []), topicOf(2)])
    expect(rows()).toEqual(['Topic 1', 'Topic 2', 'Explore topics'])
    expect(screen.queryByRole('button', { name: 'Show what is under Topic 1' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show what is under Topic 2' })).toBeTruthy()
  })

  it('folds a topic open from its arrow, to its files, each a link to open it in Leaf, with the title the tree has now', () => {
    const plan = page('3518cd7b-5b85-49e8-ba94-4aacacad2163', 'Launch plan')
    draw([topicOf(1, [plan])], (f) => (f === plan ? page('3518cd7b-5b85-49e8-ba94-4aacacad2163', 'Launch plan, renamed') : f))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show what is under Topic 1' }))
    const file = screen.getByRole('link', { name: /Launch plan, renamed/ })
    expect(file.getAttribute('href')).toBe('/document/launch-plan-renamed-3518cd7b-5b85-49e8-ba94-4aacacad2163')
  })

  it("opens a topic's own page in Leaf from its name (LTN-3), marked as the current row while it is open", () => {
    render(
      <TooltipProvider>
        <TopicsSection topics={[topicOf(1), topicOf(2)]} topicNow="t2" fileNow={(f) => f} />
      </TooltipProvider>,
    )
    expect(screen.getByRole('link', { name: 'Topic 1' }).getAttribute('href')).toBe('/topic/topic-1-t1')
    expect(screen.getByRole('link', { name: 'Topic 2' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Topic 1' }).getAttribute('aria-current')).toBeNull()
  })

  it('shows placeholder rows while your topics are read, and says so when they could not be', () => {
    const { container, unmount } = draw('loading')
    expect(screen.getByText('Topics')).toBeTruthy()
    expect(within(container).queryAllByRole('link')).toEqual([])
    unmount()
    draw('failed')
    expect(screen.getByText('Your topics could not be read. Reload to try again.')).toBeTruthy()
    expect(rows()).toEqual(['Explore topics'])
  })

  it('says you are in no topics yet, with Explore topics as the way in, when you have none', () => {
    draw([])
    expect(screen.getByText('You’re in no topics yet.')).toBeTruthy()
    expect(rows()).toEqual(['Explore topics'])
  })
})
