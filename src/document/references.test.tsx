import type { ForeignObject } from '@estiva-app/interop'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LineCards } from './references'

afterEach(cleanup)

const URI = 'nostr:naddr1issue'
const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({ ref: 'r', kind: 30851, eventId: 'e', widget: 'card', slots: {}, meta: [], actions: [], viaRecommendation: false, ...over }) as ForeignObject
const issue = (subtitle: string) =>
  file({ noun: 'issue', slots: { title: { value: 'Fix the login' }, subtitle: { value: subtitle } } as ForeignObject['slots'] })

describe("a reference card shows the file's summary where it has room (SPEC §6.12)", () => {
  it('on the detailed card, under the title', () => {
    render(<LineCards cards={[{ uri: URI, layout: 'detailed' }]} resolved={{ [URI]: issue('Passkeys fail on Safari 18.') }} />)
    expect(screen.getByText('Fix the login')).toBeTruthy()
    expect(screen.getByText('Passkeys fail on Safari 18.')).toBeTruthy()
  })

  it('not on a row, which stays one line', () => {
    render(<LineCards cards={[{ uri: URI, layout: 'compact' }]} resolved={{ [URI]: issue('Passkeys fail on Safari 18.') }} />)
    expect(screen.getByText('Fix the login')).toBeTruthy()
    expect(screen.queryByText('Passkeys fail on Safari 18.')).toBeNull()
  })
})
