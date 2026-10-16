import { actionProblems, buildActionEvents } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { describe, expect, it } from 'vitest'
import { manifestContent } from './manifest'

/*
  What Claude and every other consumer send when they act on a document through
  Leaf's manifest (SPEC §7.3): the events, at the wire, before any signer.
*/

const ME = 'ab'.repeat(32)
const RELAY = 'cd'.repeat(32)
const FOLDER = '11111111-1111-4111-8111-111111111111'
const DOC = `${KIND.DOCUMENT}:${ME}:doc-1`
const manifest = manifestContent() as unknown as Parameters<typeof buildActionEvents>[0]['manifest']
const build = (args: Omit<Parameters<typeof buildActionEvents>[0], 'manifest' | 'pubkey' | 'createdAtMs'>) =>
  buildActionEvents({ manifest, pubkey: ME, createdAtMs: 1_759_000_000_000, ...args })
const tag = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]

describe("Leaf's manifest: a document's summary (SPEC §6.12)", () => {
  it('declares no action interop refuses', () => {
    expect(manifestContent().actions.flatMap((action) => actionProblems(action))).toEqual([])
  })

  it('summarize sends one plain-text change on `summary` in the document’s Folder', () => {
    const built = build({ kind: KIND.DOCUMENT, address: DOC, objectAuthor: ME, folder: FOLDER, actionId: 'summarize', value: 'Who reads this, and why.' })
    expect(Array.isArray(built)).toBe(true)
    const [change] = built as Exclude<typeof built, string>
    expect(change.kind).toBe(1851)
    expect(tag(change, 'a')).toBe(DOC)
    expect(tag(change, 'field')).toBe('summary')
    expect(tag(change, 'value')).toBe('Who reads this, and why.')
    expect(tag(change, 'h')).toBe(FOLDER)
    expect(tag(change, 'content-format')).toBeUndefined()
  })

  it('summarize with an empty value sends the clearing change', () => {
    const built = build({ kind: KIND.DOCUMENT, address: DOC, objectAuthor: ME, folder: FOLDER, actionId: 'summarize', value: '' })
    expect(Array.isArray(built) && built[0].tags.find((t) => t[0] === 'value')).toEqual(['value', ''])
  })

  it('New document puts the summary on the root as its `summary` tag', () => {
    const built = build({
      kind: 39000,
      address: FOLDER,
      objectAuthor: RELAY,
      folder: FOLDER,
      actionId: 'add-document',
      value: { title: 'Launch notes', summary: 'What launch means.' },
      newId: 'doc-2',
      folderHasState: true,
    })
    expect(Array.isArray(built)).toBe(true)
    const root = (built as Exclude<typeof built, string>).find((e) => e.kind === KIND.DOCUMENT)!
    expect(tag(root, 'title')).toBe('Launch notes')
    expect(tag(root, 'summary')).toBe('What launch means.')
    expect(tag(root, 'h')).toBe(FOLDER)
  })

  it('New document with a title and no summary is made, with no `summary` tag', () => {
    const built = build({ kind: 39000, address: FOLDER, objectAuthor: RELAY, folder: FOLDER, actionId: 'add-document', value: { title: 'Launch notes' }, newId: 'doc-3', folderHasState: true })
    expect(built).toBeInstanceOf(Array)
    const root = (built as Exclude<typeof built, string>).find((e) => e.kind === KIND.DOCUMENT)!
    expect(tag(root, 'title')).toBe('Launch notes')
    expect(root.tags.some((t) => t[0] === 'summary')).toBe(false)
  })
})
