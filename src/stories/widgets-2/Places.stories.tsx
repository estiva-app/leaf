/**
 * Widgets 2, on a Leaf page (WID-3): every place a link draws in Leaf, by where
 * it sits (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/where-a-link-sits-decides-how-it-draws.md).
 * A chip in a sentence, a row alone on its line, and the chip menu that switches
 * a lone link to its card in that line's place. Leaf has no comments and no
 * Mentioned in, so neither is drawn here.
 *
 * The widgets come from the ui kit's `concept` prerelease, one copy for every
 * app; the frame is FilePage's DocumentView, redrawn from its class lists.
 * Prototype only: lives on `concept/widgets-2` and is never merged.
 */
import { AppProvider, Panel, TooltipProvider } from '@estiva-app/ui'
import {
  ChipMenu,
  ISSUE,
  LinkPicker,
  MESSAGE,
  PAGE,
  PlacedDocument,
  PlacedLines,
  PROJECT,
  SlashMenuWithLink,
  TOPIC,
  type Line,
  type Thing,
} from '@estiva-app/ui/widgets-2'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

const loading = (thing: Thing): Thing => ({ ...thing, state: 'loading' })
const unavailable = (thing: Thing): Thing => ({ ...thing, state: 'unavailable' })

/** FilePage's DocumentView: the panel, the page's column, its heading. */
function LeafPage({ title = 'Page two', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1 [contain:size]">
        <div className="flex min-w-0 flex-1 flex-col">
          <Panel title={title} bodyClassName="px-12 pt-10 pb-24">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              <h1 className="text-h1 text-text-primary">{title}</h1>
              {children}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Widgets 2/On a page',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <AppProvider navigate={() => {}}>
          <Story />
        </AppProvider>
      </TooltipProvider>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const PAGE_LINES: Line[] = [
  ['Some words before a link to ', ISSUE, ', and the sentence goes on after it, as a chip.'],
  ['Two in one sentence: ', PROJECT, ' and ', TOPIC, '.'],
  ISSUE,
  PROJECT,
  ['A line of words with no link at all, between the rows.'],
  TOPIC,
  MESSAGE,
  PAGE,
]

/** A page as you write it: chips in sentences, a row for each link alone on its line. Click a row for its menu, then choose Card. */
export const ChipsAndRows: Story = {
  render: () => (
    <LeafPage>
      <PlacedDocument lines={PAGE_LINES} />
    </LeafPage>
  ),
}

/** The chip menu, open on a lone-line link: Open, and Show as Row or Card. */
export const ChipMenuOpen: Story = {
  render: () => {
    const lines: Line[] = [['Words before the link, then the link alone on the next line.'], ISSUE, ['Words after it.']]
    return (
      <LeafPage>
        <PlacedLines
          lines={lines}
          onLink={() => {}}
          under={(i) =>
            i === 1 ? (
              <div className="absolute left-0 top-full z-10 mt-1">
                <ChipMenu thing={ISSUE} />
              </div>
            ) : null
          }
        />
      </LeafPage>
    )
  },
}

/** On a chip in a sentence the menu offers Open only: a card never sits inside a sentence. */
export const ChipMenuInASentence: Story = {
  render: () => (
    <LeafPage>
      <div className="relative flex flex-col gap-2">
        <PlacedLines lines={[['Some words before a link to ', ISSUE, ', and the sentence goes on after it.']]} />
        <div className="absolute left-40 top-full z-10 mt-1">
          <ChipMenu thing={ISSUE} alone={false} />
        </div>
      </div>
    </LeafPage>
  ),
}

/** Card chosen: the card takes that line's place, nothing is added below the page. Click it for the menu, choose Row to go back. */
export const CardInItsPlace: Story = {
  render: () => {
    const lines: Line[] = [['Words before the link.'], ISSUE, ['Words between.'], PROJECT, ['Words after.'], MESSAGE]
    return (
      <LeafPage>
        <PlacedDocument lines={lines} initialCards={[1, 3, 5]} />
      </LeafPage>
    )
  },
}

/** Still loading and not available to this reader, as a chip, a row and a card. */
export const LoadingAndNotAvailable: Story = {
  render: () => {
    const lines: Line[] = [
      ['A chip still loading: ', loading(ISSUE), ', and one not available: ', unavailable(ISSUE), '.'],
      loading(ISSUE),
      unavailable(PROJECT),
      loading(PROJECT),
      unavailable(PAGE),
    ]
    return (
      <LeafPage>
        <PlacedDocument lines={lines} initialCards={[3, 4]} />
      </LeafPage>
    )
  },
}

/** The `/` menu on an empty line, with its widget entry (Miky's QA note: "`/` section where you can use `[` to insert a widget"). Leaf's Insert has Table, and now the link. */
export const SlashMenu: Story = {
  render: () => (
    <LeafPage>
      <PlacedLines lines={[['Words on the line above.']]} />
      <div className="relative">
        <p className="text-body-2 text-text-secondary">/</p>
        <div className="absolute left-0 top-full z-10 mt-1">
          <SlashMenuWithLink file={false} />
        </div>
      </div>
    </LeafPage>
  ),
}

/** After the widget entry (or `[`): the files to link, each led by its kind's icon. */
export const LinkPickerOpen: Story = {
  render: () => (
    <LeafPage>
      <PlacedLines lines={[['Words on the line above.']]} />
      <div className="relative">
        <p className="text-body-2 text-text-primary">[ite</p>
        <div className="absolute left-0 top-full z-10 mt-1">
          <LinkPicker files={[ISSUE, PROJECT, TOPIC, MESSAGE, PAGE]} query="ite" />
        </div>
      </div>
    </LeafPage>
  ),
}
