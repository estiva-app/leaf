import type { ForeignObject } from '@estiva-app/interop'
import { describe, expect, it } from 'vitest'
import { findFile, groupsOf, isDocument, typeOf, type Expansion } from './tree'
import type { WorkspaceFolder } from './useWorkspace'

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
      [folder([file({ ref: 'p', naddr: 'naddr1p', slots: { title: { value: 'Friday notes' } } }), file({ ref: 'x', naddr: 'naddr1x', unreachable: true })])],
      none,
    )!
    expect(groups[0].title).toBe('QA')
    expect(groups[0].nodes?.map((n) => [n.label, n.href])).toEqual([['Friday notes', '/f/naddr1p']])
  })

  it('labels another app\'s file by its type, never its app', () => {
    const issue = file({ kind: 30851, noun: 'issue', appName: 'Estiva Ship' })
    expect(typeOf(issue)).toBe('Issue')
  })

  it('draws a Peek topic as another app’s file, labelled "Topic", and a document with no label', () => {
    const topic = file({ ref: 't', kind: 30840, naddr: 'naddr1t', noun: 'topic', appName: 'Peek', slots: { title: { value: 'Standup' } } })
    const doc = file({ ref: 'd', naddr: 'naddr1d', noun: 'document', appName: 'Leaf', slots: { title: { value: 'Brief' } } })
    expect(isDocument(topic)).toBe(false)
    expect(isDocument(doc)).toBe(true)
    expect(typeOf(topic)).toBe('Topic')
    const [topicNode, docNode] = groupsOf([folder([topic, doc])], none)![0].nodes!
    expect(topicNode.hint).toBeTruthy()
    expect(docNode.hint).toBeUndefined()
  })

  it('says a Folder is empty, could not be read, or is still being read', () => {
    expect(groupsOf([folder([])], none)![0].message).toBe('Nothing in this yet.')
    expect(groupsOf([folder(null, true)], none)![0].message).toBe('This could not be read. Reload to try again.')
    expect(groupsOf([folder(null)], none)![0].nodes).toBeNull()
  })

  it("reads a project's issues when its row opens, and finds an issue opened from there", () => {
    const project = file({ ref: 'proj', kind: 30850, naddr: 'naddr1proj', listsChildren: true })
    const issue = file({ ref: 'iss', kind: 30851, naddr: 'naddr1iss', noun: 'issue' })
    const closed = groupsOf([folder([project])], none)![0].nodes![0]
    expect(closed.hasChildren).toBe(true)
    expect(closed.children).toBeUndefined()
    const read: Expansion = { ...none, children: { proj: [issue] }, opened: new Set(['proj']) }
    const open = groupsOf([folder([project])], read)![0].nodes![0]
    expect(open.open).toBe(true)
    expect(open.children?.map((n) => n.href)).toEqual(['/f/naddr1iss'])
    expect(findFile([folder([project])], read.children, 'naddr1iss')?.file.ref).toBe('iss')
  })
})
