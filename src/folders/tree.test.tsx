import type { ForeignObject } from '@estiva-app/interop'
import { describe, expect, it } from 'vitest'
import { shipIssue, shipProject } from '../pages/fixtures/shipFiles'
import { findDocument, findFile, groupsOf, placeOf, typeOf, type Expansion } from './tree'
import type { WorkspaceFolder } from './useWorkspace'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const D = 'a1b2c3d4-0000-4000-8000-00000000000a'

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({ ref: 'r', kind: 30842, eventId: 'e', widget: 'card', slots: {}, meta: [], actions: [], viaRecommendation: false, ...over }) as ForeignObject

const folder = (files: ForeignObject[] | null, failed?: boolean): WorkspaceFolder => ({
  folder: { id: 'f1', name: 'QA', hasState: true },
  contents: files ? ({ id: 'f1', hasState: true, files, source: 'state' } as WorkspaceFolder['contents']) : null,
  failed,
})

const none: Expansion = { children: {}, opened: new Set(), setOpen: () => {}, setFolderOpen: () => {} }

describe('the Folders tree', () => {
  it("draws a document by its title, and leaves out a file the viewer cannot read", () => {
    const groups = groupsOf(
      [folder([file({ ref: 'p', naddr: 'naddr1p', address: `30842:${A}:${D}`, slots: { title: { value: 'Friday notes' } } }), file({ ref: 'x', naddr: 'naddr1x', unreachable: true })])],
      none,
    )!
    expect(groups[0].title).toBe('QA')
    // A document's row opens its own link, the one every app reads (SPEC §7.7).
    expect(groups[0].nodes?.map((n) => [n.label, n.href])).toEqual([['Friday notes', `/document/friday-notes-${D}`]])
  })

  it('finds a document by the d its link carries, and finds nothing when two authors hold that d', () => {
    const mine = file({ ref: 'm', naddr: 'naddr1m', address: `30842:${A}:${D}` })
    const issue = file({ ref: 'i', kind: 30851, naddr: 'naddr1i', address: `30851:${A}:${D}` })
    expect(findDocument([folder([issue, mine])], {}, D)?.file.ref).toBe('m')
    // Listed twice, in two Folders, it is still one document.
    expect(findDocument([folder([mine]), folder([mine])], {}, D)?.file.ref).toBe('m')
    const theirs = file({ ref: 't', naddr: 'naddr1t', address: `30842:${B}:${D}` })
    expect(findDocument([folder([mine]), folder([theirs])], {}, D)).toBeNull()
    expect(findDocument([folder([issue])], {}, D)).toBeNull()
  })

  it('labels another app\'s file by its type, never its app', () => {
    const issue = file({ kind: 30851, noun: 'issue', appName: 'Estiva Ship' })
    expect(typeOf(issue)).toBe('Issue')
  })

  it('lists pages and Ship projects, labelling a project by its type, and no Peek topic', () => {
    const topic = file({ ref: 't', kind: 30840, naddr: 'naddr1t', address: `30840:${A}:t`, noun: 'topic', appName: 'Peek', slots: { title: { value: 'Standup' } } })
    const doc = file({ ref: 'd', naddr: 'naddr1d', address: `30842:${A}:${D}`, noun: 'document', appName: 'Leaf', slots: { title: { value: 'Brief' } } })
    const nodes = groupsOf([folder([topic, doc, shipProject()])], none)![0].nodes!
    expect(nodes.map((n) => n.label)).toEqual(['Brief', "Leaf edits any file's text"])
    expect(nodes[0].hint).toBeUndefined()
    expect(nodes[1].hint).toBeTruthy()
  })

  it('draws a page filed under a topic at its Folder’s top level', () => {
    const topic = file({ ref: 't', kind: 30840, naddr: 'naddr1t', address: `30840:${A}:t`, slots: { title: { value: 'Standup' } } })
    const under = file({ ref: 'u', naddr: 'naddr1u', address: `30842:${A}:${D}`, parentRef: `30840:${A}:t`, slots: { title: { value: 'Minutes' } } })
    expect(groupsOf([folder([topic, under])], none)![0].nodes!.map((n) => n.label)).toEqual(['Minutes'])
  })

  it('says a Folder that holds only topics is empty', () => {
    const topic = file({ ref: 't', kind: 30840, naddr: 'naddr1t', address: `30840:${A}:t` })
    expect(groupsOf([folder([topic])], none)![0].message).toBe('Nothing in this yet.')
  })

  it('says a Folder is empty, could not be read, or is still being read', () => {
    expect(groupsOf([folder([])], none)![0].message).toBe('Nothing in this yet.')
    expect(groupsOf([folder(null, true)], none)![0].message).toBe('This could not be read. Reload to try again.')
    expect(groupsOf([folder(null)], none)![0].nodes).toBeNull()
  })

  it('draws the files a Folder kept through a busy re-read, not "could not be read" in their place (APP-9)', () => {
    const doc = file({ ref: 'd', naddr: 'naddr1d', address: `30842:${A}:${D}`, slots: { title: { value: 'Minutes' } } })
    const [group] = groupsOf([folder([doc], true)], none)!
    expect(group.message).toBeUndefined()
    expect(group.nodes!.map((n) => n.label)).toEqual(['Minutes'])
  })

  it('lets a page open only when a page is filed under it', () => {
    const D2 = 'a1b2c3d4-0000-4000-8000-00000000000b'
    const top = file({ ref: 'p', naddr: 'naddr1p', address: `30842:${A}:${D}`, listsChildren: true, slots: { title: { value: 'Brief' } } })
    const alone = file({ ref: 'q', naddr: 'naddr1q', address: `30842:${A}:${D2}`, listsChildren: true, slots: { title: { value: 'Notes' } } })
    const under = file({ ref: 'u', naddr: 'naddr1u', address: `30842:${A}:u`, parentRef: `30842:${A}:${D}`, listsChildren: true, slots: { title: { value: 'Minutes' } } })
    const [brief, notes] = groupsOf([folder([top, alone, under])], none)![0].nodes!
    expect(brief.children?.map((n) => n.label)).toEqual(['Minutes'])
    // It starts closed, as before, and opening it reads nothing: its pages are already listed.
    expect(brief.open).toBe(false)
    const asked: string[] = []
    const watching: Expansion = { ...none, setOpen: (f) => asked.push(`read ${f.ref}`), setFolderOpen: (id) => asked.push(`open ${id}`) }
    groupsOf([folder([top, alone, under])], watching)![0].nodes![0].onOpenChange?.(true)
    expect(asked).toEqual(['open p'])
    expect(brief.children?.[0].hasChildren).toBeFalsy()
    expect(brief.children?.[0].children).toBeUndefined()
    expect(notes.hasChildren).toBeFalsy()
    expect(notes.children).toBeUndefined()
  })

  it("reads a project's issues when its row opens, and finds an issue opened from there", () => {
    const project = shipProject()
    const issue = shipIssue()
    const closed = groupsOf([folder([project])], none)![0].nodes![0]
    expect(closed.hasChildren).toBe(true)
    expect(closed.children).toBeUndefined()
    const read: Expansion = { ...none, children: { [project.ref]: [issue] }, opened: new Set([project.ref]) }
    const open = groupsOf([folder([project])], read)![0].nodes![0]
    expect(open.open).toBe(true)
    expect(open.children?.map((n) => n.href)).toEqual([`/f/${issue.naddr}`])
    expect(findFile([folder([project])], read.children, issue.naddr!)?.file.ref).toBe(issue.ref)
  })

  it("opens to an issue read under its project, and to a page two pages down, Folder first (LFB-9)", () => {
    const project = shipProject()
    const issue = shipIssue()
    const refs = (place: ReturnType<typeof placeOf>) => [place.folder, ...place.above.map((f) => f.ref)]
    expect(refs(placeOf(folder([project]), issue, { [project.ref]: [issue] }))).toEqual(['f1', project.ref])
    const top = file({ ref: 'p', address: `30842:${A}:p` })
    const mid = file({ ref: 'm', address: `30842:${A}:m`, parentRef: `30842:${A}:p` })
    const low = file({ ref: 'l', address: `30842:${A}:l`, parentRef: `30842:${A}:m` })
    expect(refs(placeOf(folder([low, mid, top]), low, {}))).toEqual(['f1', 'p', 'm'])
    expect(refs(placeOf(folder([top]), top, {}))).toEqual(['f1'])
  })
})
