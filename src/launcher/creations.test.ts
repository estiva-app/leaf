import { afterEach, describe, expect, it, vi } from 'vitest'
import { addrToNaddr, type UnsignedEvent } from '@estiva-app/protocol'

/*
  KIN-11: Leaf's ⌘K makes Ship's issue and project by following Ship's manifest. Asserted on the events that would
  reach the relay. Only which manifest declares the action is stubbed (`resolveActingManifest`, interop's own tests
  cover how it is found); the events are built by interop's real runtime from Ship's declarations, copied below.
*/

const ME = 'a'.repeat(64)
const SHIP = 'b'.repeat(64)
const RELAY = 'd'.repeat(64)
const TEAM = '05ed05b2-0687-4be9-a096-7ab21d79fad4'
const PROJECT_D = '11111111-1111-4111-8111-111111111111'
const PROJECT = `30850:${SHIP}:${PROJECT_D}`

/* Ship's add-issue, describe-issue, add-project and describe-project, as its manifest declares them (estiva-ship src/nostr/manifest.ts). */
const SHIP_MANIFEST = {
  records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value', order: ['ts', 'created_at', 'id'], rule: 'last-write-wins-per-field' },
  actions: [
    {
      id: 'add-issue',
      label: 'Add issue',
      description: 'Add an issue to a project.',
      effect: 'writes',
      appliesTo: '30850',
      emits: { kind: 30851, setTag: 'a', toAddressOf: 'self' },
      input: {
        type: 'object',
        properties: { title: { type: 'string' }, description: { type: 'string', target: 'content', format: 'estiva-blocks-1' }, summary: { type: 'string' } },
        required: ['title'],
      },
    },
    { id: 'describe-issue', label: 'Edit description', description: 'Its text.', effect: 'writes', appliesTo: '30851', emits: { kind: 1851, field: 'description' }, input: { type: 'string', format: 'estiva-blocks-1' } },
    {
      id: 'add-project',
      label: 'New project',
      description: 'Create a project in a team.',
      effect: 'writes',
      appliesTo: '39000',
      emits: { kind: 30850, placement: 'buzz-channel', listed: true },
      input: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string', target: 'content' }, key: { type: 'string' }, summary: { type: 'string' } },
        required: ['name'],
      },
    },
    { id: 'describe-project', label: 'Edit description', description: 'Its text.', effect: 'writes', appliesTo: '30850', emits: { kind: 1851, field: 'description' }, input: { type: 'string' } },
    { id: 'rename-issue', label: 'Rename', description: 'Its title.', effect: 'writes', appliesTo: '30851', emits: { kind: 1851, field: 'title' }, input: { type: 'string' } },
  ],
}

/* The manifest that claims Ship's kinds: Ship's, unless a test plants another app's claim. */
let kindOwner = `31990:${SHIP}:estiva-ship`

/* What resolving a project, or a team, offers: Ship's add-issue on a project, and Ship's add-project borrowed on a team beside the team's own New file. */
const offered = (address: string) =>
  address.startsWith('30850:')
    ? { actions: [{ id: 'add-issue', label: 'Add issue', control: 'form' }, { id: 'rename-project', label: 'Rename', control: 'text' }], slots: { title: { value: 'Website' } }, noun: 'project' }
    : { actions: [{ id: 'create-file', label: 'New file', control: 'form' }, { id: 'add-project', label: 'New project', control: 'form', declaredBy: { address: `31990:${SHIP}:estiva-ship` } }], slots: { title: { value: 'Ops' } } }

vi.mock('@estiva-app/interop', async (original) => ({
  ...(await original<typeof import('@estiva-app/interop')>()),
  // A creation borrowed on a team comes with only the creations declared there, as interop's answers it.
  resolveActingManifest: async (pointer: { kind: number }, declaredBy?: string) =>
    pointer.kind === 39000 && declaredBy
      ? { address: declaredBy, manifest: { ...SHIP_MANIFEST, actions: SHIP_MANIFEST.actions.filter((a) => [a.appliesTo].flat().includes('39000')) } }
      : { address: `31990:${SHIP}:estiva-ship`, manifest: SHIP_MANIFEST },
  resolveManifest: async () => ({ address: kindOwner, manifest: SHIP_MANIFEST }),
  resolveForeignObject: async (reference: string) => {
    const { naddrToAddr } = await import('@estiva-app/protocol')
    return offered(/^\d+:/.test(reference) ? reference : naddrToAddr(reference))
  },
}))

/* The teams a person navigates by, as Leaf's sidebar lists them. */
vi.mock('../folders/workspace', () => ({ readFolders: async () => [{ id: TEAM, name: 'Ops', channel: `39000:${RELAY}:${TEAM}` }] }))

const published: UnsignedEvent[] = []
/* Kinds the relay refuses, as Estiva ID refuses a kind the app may not sign. */
let refused: number[] = []
let teamHasState = false
let impostor = false
const IMPOSTOR = 'e'.repeat(64)
const OTHER_TEAM = '22222222-2222-4222-8222-222222222222'

vi.mock('../relay/bridge', () => {
  const answer = (event: UnsignedEvent) => {
    if (refused.includes(event.kind)) return { ok: false, reason: 'kind_not_allowed' }
    published.push(event)
    return { ok: true, eventId: 'f'.repeat(64) }
  }
  return {
    viewerPubkey: () => ME,
    changeWriter: {
      sign: async (event: UnsignedEvent) => ({ ...event, id: 'f'.repeat(64), sig: '' }),
      publish: async (event: UnsignedEvent) => answer(event),
    },
    publish: async (event: UnsignedEvent) => answer(event),
    query: async (filters: { kinds?: number[]; '#d'?: string[] }[]) => {
      const [filter] = filters
      const kind = filter.kinds?.[0]
      if (kind === 30850) {
        // Another key's record reusing the project's id, in another team, answered first: only `authors` tells them apart.
        const roots = [
          ...(impostor ? [{ kind: 30850, pubkey: IMPOSTOR, tags: [['d', PROJECT_D], ['title', 'Website'], ['h', OTHER_TEAM]], content: '', created_at: 2, id: '2'.repeat(64), sig: '' }] : []),
          { kind: 30850, pubkey: SHIP, tags: [['d', PROJECT_D], ['title', 'Website'], ['h', TEAM]], content: '', created_at: 1, id: '1'.repeat(64), sig: '' },
        ]
        const authors = (filter as { authors?: string[] }).authors
        return authors ? roots.filter((root) => authors.includes(root.pubkey)) : roots
      }
      if (kind === 39000) return (filter['#d'] ?? [TEAM]).map((d) => ({ kind: 39000, pubkey: RELAY, tags: [['d', d]], content: '', created_at: 1, id: `c-${d}`, sig: '' }))
      if (kind === 30890 && teamHasState) return [{ kind: 30890, pubkey: RELAY, tags: [['d', TEAM]], content: '', created_at: 1, id: '3'.repeat(64), sig: '' }]
      return []
    },
  }
})

const { applyAction, creatableUnder } = await import('./creations')

const tag = (event: UnsignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

afterEach(() => {
  published.length = 0
  refused = []
  teamHasState = false
  impostor = false
  kindOwner = `31990:${SHIP}:estiva-ship`
})

describe("Leaf's ⌘K offers Ship's Create issue and Create project, with where each can go (KIN-11)", () => {
  it('offers Add issue under the projects, by their names, and no field change as a creation', async () => {
    const read = await creatableUnder(30850)

    expect(read?.actions.map((a) => a.id)).toEqual(['add-issue'])
    expect(read?.parents).toEqual([{ address: PROJECT, title: 'Website' }])
  })

  it("offers Ship's New project on a team, into the teams the sidebar lists", async () => {
    const read = await creatableUnder(39000)

    expect(read?.actions.map((a) => a.id)).toEqual(['create-file', 'add-project'])
    expect(read?.parentsFor?.['add-project']).toEqual([{ address: `39000:${RELAY}:${TEAM}`, title: 'Ops' }])
  })
})

describe("Leaf's ⌘K makes Ship's files by Ship's declared actions (KIN-11)", () => {
  it('adds an issue to the chosen project, signed by the person, with its text as its first change', async () => {
    const result = await applyAction({
      naddr: addrToNaddr(PROJECT, []),
      actionId: 'add-issue',
      value: { title: 'Escape should keep the sentence', description: 'Typed in Leaf.', summary: '' },
    })

    expect(result.ok).toBe(true)
    expect(result.textNotSaved).toBeUndefined()
    const [issue, text] = published
    expect(issue.kind).toBe(30851)
    expect(issue.pubkey).toBe(ME)
    expect(tag(issue, 'title')).toBe('Escape should keep the sentence')
    expect(tag(issue, 'a')).toBe(PROJECT)
    expect(tag(issue, 'h')).toBe(TEAM)
    expect(issue.content).toBe('')
    expect(result.created).toBe(`30851:${ME}:${tag(issue, 'd')}`)
    expect(text.kind).toBe(1851)
    expect(tag(text, 'field')).toBe('description')
    expect(tag(text, 'a')).toBe(result.created)
    expect(`${text.content} ${tag(text, 'value') ?? ''}`).toContain('Typed in Leaf.')
  })

  it("puts the issue in the chosen project's team, never in another key's record that reuses its id", async () => {
    impostor = true
    const result = await applyAction({ naddr: addrToNaddr(PROJECT, []), actionId: 'add-issue', value: { title: 'Mine' } })

    expect(result.ok).toBe(true)
    expect(tag(published[0], 'h')).toBe(TEAM)
    expect(tag(published[0], 'a')).toBe(PROJECT)
  })

  it('creates a project in the chosen team and lists it there', async () => {
    teamHasState = true
    const result = await applyAction({
      naddr: addrToNaddr(`39000:${RELAY}:${TEAM}`, []),
      actionId: 'add-project',
      value: { name: 'Website launch', description: '', key: 'WEB', summary: '' },
      declaredBy: `31990:${SHIP}:estiva-ship`,
    })

    expect(result).toMatchObject({ ok: true })
    expect(result.incomplete).toBeUndefined()
    const [project, listed] = published
    expect(project.kind).toBe(30850)
    expect(project.pubkey).toBe(ME)
    expect(project.tags.some((t) => t[1] === 'Website launch')).toBe(true)
    expect(listed.kind).toBe(1852)
    // The listing names the new project, by its id (or its address).
    expect(listed.tags.some((t) => t.slice(1).some((v) => v === tag(project, 'd') || v === `30850:${ME}:${tag(project, 'd')}`))).toBe(true)
  })

  it("creates a project with the text it was given as its first description change, by Ship's Edit description", async () => {
    const result = await applyAction({
      naddr: addrToNaddr(`39000:${RELAY}:${TEAM}`, []),
      actionId: 'add-project',
      value: { name: 'Website launch', description: 'Everything for the launch.', key: '', summary: '' },
      declaredBy: `31990:${SHIP}:estiva-ship`,
    })

    expect(result).toMatchObject({ ok: true })
    expect(result.textNotSaved).toBeUndefined()
    const [project, text] = published
    expect(project.kind).toBe(30850)
    expect(project.content).toBe('')
    expect(project.tags.some((t) => t.includes('Everything for the launch.'))).toBe(false)
    expect(text.kind).toBe(1851)
    expect(text.pubkey).toBe(ME)
    expect(tag(text, 'field')).toBe('description')
    expect(tag(text, 'a')).toBe(result.created)
    expect(`${text.content} ${tag(text, 'value') ?? ''}`).toContain('Everything for the launch.')
  })

  it("makes no project with text when another app's manifest claims the project, so Leaf writes no text Ship did not declare", async () => {
    kindOwner = `31990:${IMPOSTOR}:estiva-ship`
    const result = await applyAction({
      naddr: addrToNaddr(`39000:${RELAY}:${TEAM}`, []),
      actionId: 'add-project',
      value: { name: 'Website launch', description: 'Everything for the launch.' },
      declaredBy: `31990:${SHIP}:estiva-ship`,
    })

    expect(result.ok).toBe(false)
    expect(published).toEqual([])
  })

  it("signs no other kind as a project's text when a listing names two actions by the text action's id", async () => {
    SHIP_MANIFEST.actions.unshift({ id: 'describe-project', label: 'Edit description', description: 'Planted.', effect: 'writes', appliesTo: '30850', emits: { kind: 1111, field: 'note' }, input: { type: 'string' } } as never)
    try {
      await applyAction({
        naddr: addrToNaddr(`39000:${RELAY}:${TEAM}`, []),
        actionId: 'add-project',
        value: { name: 'Website launch', description: 'Everything for the launch.' },
        declaredBy: `31990:${SHIP}:estiva-ship`,
      })
      expect(published.map((e) => e.kind)).not.toContain(1111)
    } finally {
      SHIP_MANIFEST.actions.shift()
    }
  })

  it('says nothing was made when the workspace refuses the new file', async () => {
    refused = [30851]
    const result = await applyAction({ naddr: addrToNaddr(PROJECT, []), actionId: 'add-issue', value: { title: 'Refused' } })

    expect(result.ok).toBe(false)
    expect(published).toEqual([])
  })

  it("makes nothing when a listing names another kind for the issue's text, so Leaf signs only a file change as it", async () => {
    const describe = SHIP_MANIFEST.actions.find((a) => a.id === 'describe-issue')!
    describe.emits.kind = 1111
    try {
      const result = await applyAction({ naddr: addrToNaddr(PROJECT, []), actionId: 'add-issue', value: { title: 'Planted', description: 'Words' } })
      expect(result.ok).toBe(false)
      expect(published).toEqual([])
    } finally {
      describe.emits.kind = 1851
    }
  })

  it('changes nothing for an action that is not a creation', async () => {
    const result = await applyAction({ naddr: addrToNaddr(PROJECT, []), actionId: 'rename-issue', value: 'New title' })

    expect(result).toEqual({ ok: false, reason: 'Leaf does not do this.' })
    expect(published).toEqual([])
  })
})
