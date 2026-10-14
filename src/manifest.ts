import { BLOCK_DOCUMENT_FORMAT, KIND, type NostrTag, type UnsignedEvent } from '@estiva-app/protocol'

/*
  Leaf's NIP-89 manifest (`kind:31990`, SPEC §7): how every other app draws,
  names and opens a document. A document (`kind:30842`) is the file type Leaf
  owns — the bare file's shape under a kind an app claims, where a Peek topic
  (`30840`) is owned by nobody (Miky, 14 October). Without this event Peek and
  Ship would show a document with no label and nowhere to open it, and Leaf's
  own Folder reads would not know the kind is a file.

  Published by `scripts/publish-manifest.ts` with Leaf's own manifest key —
  never through Estiva ID's /sign, whose ceiling for Leaf holds no 31990.
*/

/** The manifest's `d`: one per app, so a republish replaces it. */
export const MANIFEST_D_TAG = 'estiva-leaf'

/** Where "Open in Leaf" goes when no app URL is given: a dev server, never production by accident. */
export const DEFAULT_APP_URL = 'http://localhost:5173/'

const DOCUMENT = String(KIND.DOCUMENT)
const CHANGE = 1851
const COMMENT = 1111
const DELETION = 5
/** NIP-29's group metadata — a Folder, as interop reads one. */
const FOLDER = '39000'

/** The manifest's `content`: the same rules the bare file's built-in projection has, owned and named by Leaf. */
export function manifestContent() {
  return {
    name: 'Leaf',
    about: 'Documents in your Folders, written together by everyone in the Folder.',
    records: {
      changeKind: CHANGE,
      targetTag: 'a',
      fieldTag: 'field',
      valueTag: 'value',
      order: ['ts', 'created_at', 'id'],
      rule: 'last-write-wins-per-field',
      hiddenWhen: { field: 'archived', equals: 'true' },
    },
    projections: {
      [DOCUMENT]: {
        widget: 'card',
        noun: 'document',
        slots: {
          title: { tag: 'title', fold: 'title' },
          // A document's text is its `description` field, seeded from `content` (SPEC §6.10).
          body: { fold: 'description', field: 'content' },
          // A document may sit under a file of any kind, named by its own `a` (Miky, 14 October).
          list: { children: { kind: KIND.DOCUMENT, via: 'a', limit: 200, movedBy: 'parent', anyParent: true } },
        },
      },
    },
    actions: [
      {
        id: 'add-document',
        label: 'New document',
        description:
          'Start a document in a Folder: a title, and nothing else yet. Everyone who can read the Folder can read ' +
          'and change it, and the Folder lists it straight away. Write its text afterwards with describe.',
        effect: 'writes',
        appliesTo: FOLDER,
        emits: { kind: KIND.DOCUMENT, placement: 'h', listed: true },
        input: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      },
      {
        id: 'comment',
        label: 'Comment',
        description: 'Say something about this document. Every reader of the document sees it beside it.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: COMMENT, scope: 'address' },
        input: { type: 'string' },
      },
      {
        id: 'rename',
        label: 'Rename',
        description: 'Give this document a new title. A change, so anyone in its Folder may.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'title' },
        input: { type: 'string' },
      },
      {
        id: 'describe',
        label: 'Edit',
        description:
          "Replace this document's text with new text, as a whole block document. A change, so anyone in its " +
          'Folder may; the later save wins. Save when the person leaves the text, never per keystroke.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'description' },
        input: { type: 'string', format: BLOCK_DOCUMENT_FORMAT },
      },
      {
        id: 'move',
        label: 'Move',
        description:
          'Put this document under another file in the same Folder, or back at the top. Who can read it does not change.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'parent' },
        input: { type: 'string' },
      },
      {
        id: 'archive',
        label: 'Archive',
        description: 'Take this document out of every list, or bring it back: `true` archives, an empty value restores.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'archived' },
        input: { type: 'string', enum: 'archived' },
      },
      {
        id: 'delete',
        label: 'Delete',
        description: 'Ask the relay to delete this document. Only its author may; its comments stay as separate events.',
        effect: 'destructive',
        appliesTo: [DOCUMENT],
        emits: { kind: DELETION, listed: true },
      },
    ],
    vocabularies: {
      archived: [
        { value: '', label: 'Active', colour: 'neutral' },
        { value: 'true', label: 'Archived', colour: 'muted' },
      ],
    },
  }
}

/**
 * The unsigned `kind:31990`: `d`, the kind it claims, and NIP-89's `web` tag —
 * where "Open in Leaf" goes, Leaf's `/f/<naddr>` route. No `aspect`: an app
 * owning a kind is a specialized app (SPEC §7.8).
 */
export function buildManifest(pubkey: string, createdAtMs: number, appUrl = DEFAULT_APP_URL): UnsignedEvent {
  const tags: NostrTag[] = [
    ['d', MANIFEST_D_TAG],
    ['k', DOCUMENT],
    ['web', `${appUrl.replace(/\/+$/, '')}/f/<bech32>`, 'naddr'],
  ]
  return { pubkey, created_at: Math.floor(createdAtMs / 1000), kind: 31990, tags, content: JSON.stringify(manifestContent()) }
}
