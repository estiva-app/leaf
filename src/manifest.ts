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

  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-document-is-its-own-type-of-file.md
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
    about: 'Documents in your teams, written together by everyone in the team.',
    /*
      Leaf is also the document app (SPEC §7.8, LTX-4): it writes the title,
      summary and text of any file whose own app shares them, as Peek shows
      every file's conversation. It owns documents as well; the `k` tag says so.
      why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
    */
    aspect: 'document',
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
          // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-text-is-a-readable-snapshot.md
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
          'Start a document in a team: a title and, if you like, a one- or two-sentence summary. Everyone who ' +
          'can read the team can read and change it, and the team lists it straight away. Write its text ' +
          'afterwards with describe.',
        effect: 'writes',
        appliesTo: FOLDER,
        emits: { kind: KIND.DOCUMENT, placement: 'h', listed: true },
        input: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            // The root's `summary` tag, the seed `summarize` folds over (SPEC §6.12). Plain text, so no `format`.
            summary: { type: 'string' },
          },
          required: ['title'],
        },
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
        description: 'Give this document a new title. A change, so anyone in its team may.',
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
          'team may; the later save wins. Save when the person leaves the text, never per keystroke.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'description' },
        input: { type: 'string', format: BLOCK_DOCUMENT_FORMAT },
      },
      /*
        The one-line summary under the title (SPEC §6.11, §6.12, §7.3): a
        `kind:1851` on `summary`. Its input declares no `format` — a summary is
        plain text, never a document — and a consumer finds it by `emits.field`,
        not by id. An empty value clears it; the root's seed does not come back.
        why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-summary-is-its-own-field.md
      */
      {
        id: 'summarize',
        label: 'Edit summary',
        description:
          "Set the one- or two-sentence summary shown under this document's title, in lists and on cards, about " +
          '240 characters of plain text; an empty value clears it. A change, so anyone in its team may.',
        effect: 'writes',
        appliesTo: [DOCUMENT],
        emits: { kind: CHANGE, field: 'summary' },
        input: { type: 'string' },
      },
      {
        id: 'move',
        label: 'Move',
        description:
          'Put this document under another file in the same team, or back at the top. Who can read it does not change.',
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
 * The unsigned `kind:31990`: `d`, the kind it claims, NIP-89's `web` tag —
 * where "Open in Leaf" goes, Leaf's `/f/<naddr>` route — and the `urls` shape
 * of a document's own link. Since LTX-4 its content also declares the
 * `document` aspect (SPEC §7.8).
 */
export function buildManifest(pubkey: string, createdAtMs: number, appUrl = DEFAULT_APP_URL): UnsignedEvent {
  const tags: NostrTag[] = [
    ['d', MANIFEST_D_TAG],
    ['k', DOCUMENT],
    ['web', `${appUrl.replace(/\/+$/, '')}/f/<bech32>`, 'naddr'],
    /*
      `urls` is inbound (SPEC §7.7): how any app reads a pasted Leaf link back
      to its document, drawing the page's chip, and with `#block-<id>` that
      block's live part — Ship's issue links in the same shape. The block menu's
      Copy link builds from it. The `/f/<naddr>` links Leaf gave out before are
      not declared: §7.7 keeps bech32 out of an app URL, so only Leaf opens them.
    */
    ['urls', `${appUrl.replace(/\/+$/, '')}/document/<slug>-<d>#block-<block>`, DOCUMENT],
  ]
  return { pubkey, created_at: Math.floor(createdAtMs / 1000), kind: 31990, tags, content: JSON.stringify(manifestContent()) }
}
