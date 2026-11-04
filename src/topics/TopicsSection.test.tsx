import type { ForeignObject } from '@estiva-app/interop'
import { TooltipProvider } from '@estiva-app/ui'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TopicsSection } from './TopicsSection'
import type { SidebarTopic } from './sidebarTopics'

/* LTN-2: Leaf's sidebar Topics as a person sees them: five, a More for the rest, each folding to the files it lists. */

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
  it('shows the first five of your topics, then More, which shows the rest in place and turns into Less', () => {
    draw([1, 2, 3, 4, 5, 6, 7].map((i) => topicOf(i)))
    expect(rows()).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5', 'More'])
    fireEvent.click(screen.getByRole('link', { name: 'More' }))
    expect(rows()).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5', 'Topic 6', 'Topic 7', 'Less'])
    fireEvent.click(screen.getByRole('link', { name: 'Less' }))
    expect(rows()).toHaveLength(6)
  })

  it('has no More with five topics or fewer', () => {
    draw([1, 2, 3, 4, 5].map((i) => topicOf(i)))
    expect(screen.queryByRole('link', { name: 'More' })).toBeNull()
  })

  it('folds a topic open on a click, to its files, each a link to open it in Leaf, with the title the tree has now', () => {
    const plan = page('3518cd7b-5b85-49e8-ba94-4aacacad2163', 'Launch plan')
    draw([topicOf(1, [plan])], (f) => (f === plan ? page('3518cd7b-5b85-49e8-ba94-4aacacad2163', 'Launch plan, renamed') : f))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Topic 1' }))
    const file = screen.getByRole('link', { name: /Launch plan, renamed/ })
    expect(file.getAttribute('href')).toBe('/document/launch-plan-renamed-3518cd7b-5b85-49e8-ba94-4aacacad2163')
  })

  it('shows placeholder rows while your topics are read, and says so when they could not be', () => {
    const { container, unmount } = draw('loading')
    expect(screen.getByText('Topics')).toBeTruthy()
    expect(within(container).queryAllByRole('link')).toEqual([])
    unmount()
    draw('failed')
    expect(screen.getByText('Your topics could not be read. Reload to try again.')).toBeTruthy()
  })

  it('draws no section at all when you have no topics to show', () => {
    const { container } = draw([])
    expect(container.textContent).toBe('')
  })
})
