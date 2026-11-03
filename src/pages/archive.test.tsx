import { ArchiveDialog, ArchivedNotice } from '@estiva-app/ui'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { archivedNoticeOf, archiveWordsOf } from './archive'

const BY = 'a'.repeat(64)
const NOW = new Date(2026, 10, 3, 15, 0)
const at = (date: Date) => date.getTime() / 1000
const nameOf = (pubkey: string) => (pubkey === BY ? 'Miky' : undefined)

afterEach(cleanup)

describe('the archived card, in Leaf’s words (a3257366)', () => {
  it('says the day as Peek’s card does: Today, Yesterday, else the weekday and date, with the year only when it is not this one', () => {
    const line = (date: Date) => {
      const { unmount } = render(<ArchivedNotice {...archivedNoticeOf({ by: BY, at: at(date) }, nameOf, undefined, NOW)} />)
      const text = screen.getByText(/^Archived by /).textContent
      unmount()
      return text
    }
    expect(line(new Date(2026, 10, 3, 9, 0))).toBe('Archived by Miky · Today')
    expect(line(new Date(2026, 10, 2, 23, 0))).toBe('Archived by Miky · Yesterday')
    expect(line(new Date(2026, 9, 28, 12, 0))).toBe('Archived by Miky · Wed, Oct 28')
    expect(line(new Date(2025, 9, 28, 12, 0))).toBe('Archived by Miky · Tue, Oct 28, 2025')
  })

  it('names someone with no profile by the start of their key, and shows the resolution', () => {
    render(<ArchivedNotice {...archivedNoticeOf({ by: 'b'.repeat(64), at: at(NOW), resolution: 'Superseded by the Q4 plan.' }, nameOf, undefined, NOW)} />)
    expect(screen.getByText('Archived by bbbbbbbb… · Today')).toBeTruthy()
    expect(screen.getByText('Superseded by the Q4 plan.')).toBeTruthy()
  })

  it('archived with the file above it, whose kind and title were not read, still says so and offers to open it', () => {
    render(<ArchivedNotice {...archivedNoticeOf({ by: BY, at: at(NOW), with: `30842:${BY}:parent-page` }, nameOf, {}, NOW)} onOpenParent={() => {}} />)
    expect(screen.getByText('Archived with its parent by Miky · Today')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open parent' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })
})

describe('the archive question, in Leaf’s words (LED-4)', () => {
  it('says what goes with the page as "under it", names the apps with one "in", and the button archives a page', () => {
    render(<ArchiveDialog {...archiveWordsOf('2 pages and 1 topic')} title="Launch plan" onArchive={() => true} onClose={() => {}} />)
    expect(screen.getByText('Archive “Launch plan”?')).toBeTruthy()
    expect(screen.getByText('This hides the page and the 2 pages and 1 topic under it from every list, in Leaf, Peek and Ship.')).toBeTruthy()
    expect(screen.getByText('Nothing is deleted: a link still opens it, and Unarchive brings everything back as it was.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive page' })).toBeTruthy()
  })
})
