# Leaf prototype

A clickable Leaf in Storybook, made from `@estiva-app/ui` parts only, on
invented data. Katerina's design work, for Jan to continue. **Not for main as
it is**: nothing here reads or writes a relay.

Storybook: **Pages › Leaf prototype**. Stories `A · …` read a comment in the
column beside the text; `B · …` in a bubble on the words. Her advice is A; it
is still her open question.

## It needs an unreleased estiva-ui

The prototype uses four pieces that exist only on the estiva-ui branch
`proto/text-comments` (pushed, not merged, not released, not yet reviewed by
Katerina):

- `ComposeBox`, `ComposeKeys`, `COMPOSE_EDITOR_CLASSES` — Peek's writing box
  moved into the package (Peek's drafts, uploads and highlights stay in Peek;
  Peek itself still uses its own copy).
- `SelectionToolbar` `actions` — the app's own buttons at the end of the
  strip (Leaf's Comment).
- `CommentHighlights` with `setCommentAnchors`, `commentRange`,
  `commentElement`, `quoteOfSelection` — comments drawn on their words.
- The `[` chip (`CaptionedReference`) shows its whole caption on hover.

So `package.json` here names the published `@estiva-app/ui`, and a plain
`npm ci` gives you a Storybook that does not compile. To run it:

```sh
# in the estiva-ui checkout, on proto/text-comments
npm ci && npm pack            # → estiva-app-ui-<version>.tgz

# here
npm ci
npm install --no-save ../estiva-ui/estiva-app-ui-<version>.tgz
rm -rf node_modules/.cache/storybook
npm run storybook
```

Any later `npm install <something>` here puts the published package back:
install the `.tgz` again after it. No CI runs on this branch; a pull request's
typecheck would fail for the same reason until the pieces are released. Once
they are, the branch can become `concept/leaf-prototype`, and `storybook.yml`
publishes its Storybook as a preview.

## What is real and what is a stand-in

- **Documents** are kept as the protocol stores them and go through
  `@estiva-app/protocol`: `documentForEditing` + `toEditorDocument` to open,
  `publishableFromEditor` to save. The editor is set up as Ship's
  `LiveDescription` and Peek's `BlockDocumentField` (TableKit, BlockId,
  ReferenceNode, UnknownBlock, AttachmentNode; no link mark, no strike).
- **Comments** are stored the same way and drawn with `RichText`
  (`toRenderTree`). The thread card is assembled in Leaf; Peek's real cards
  are app-local (one of her questions: a shared comment part).
- **A comment on words** is SPEC §13.6's block anchor plus the words as a
  quote, found again in the block. The protocol has no place for the quote yet.
  A quote that is no longer in its block is shown as detached.
- **`fixtures.tsx`** is all invented: people, files, threads, `nostr:` URIs
  that are not real addresses.

## Open, for Jan

- A quote beside a comment's `block` tag, so a comment keeps its words.
- How a person is named in a document: `fromEditorDocument` keeps only
  `reference` nodes, so there is no `@` in documents or comments yet.
- How a document and its versions are stored (Rename, Move, Version history
  and Archive are left out until then).

## Files

- `LeafPrototype.tsx` — the frame: AppShell inset, the Folders NavTree, Home.
- `DocumentPage.tsx` — a document, its editor, the comments column and bubble.
- `Reference.tsx` — Leaf's `nostr:` chip (as Peek's `Reference`).
- `fixtures.tsx` — the invented data.
- `LeafPrototype.stories.tsx` — the stories.
