import type { RelayState } from '@estiva-app/protocol'
import { Card, Chip, cn, EmptyState, KindIcon, Panel, SectionHeader, SkeletonList, thingKindOf, WithTooltip } from '@estiva-app/ui'
import { IconFilePlus } from '@tabler/icons-react'
import { useState } from 'react'
import { relayLabel } from '../config'
import { exactly, whenOf } from '../home/recent'
import type { HomeRow, Recent } from '../home/useRecent'
import { pagePath } from '../route'

export interface HomePageProps {
  /** The relay this build is set to, or `null` when the app runs alone. */
  relay: string | null
  /** The connection's state: `'off'` when this build has no client. */
  state: RelayState | 'off'
  /** The signed-in person's name, once Estiva ID has said it. */
  name?: string
  /** The pages you touched last: `null` while read, `'failed'` when they could not be. */
  recent?: Recent
  /** New document: opens its dialog. */
  onNew?: () => void
  /** Now, in ms: what "2 minutes ago" counts from. A story or a test fixes it. */
  now?: number
}

const SAYS: Record<RelayState, (host: string, name?: string) => string> = {
  connecting: (host) => `Connecting to ${host}…`,
  authenticating: (host) => `Signing in to ${host}…`,
  live: (host, name) => (name ? `Connected to ${host} as ${name}.` : `Connected to ${host}.`),
  reconnecting: (host) => `Reconnecting to ${host}…`,
  failed: (host) => `Could not connect to ${host}.`,
}

/** A row's caption before its time: "QA · Miky, ", "QA · " while the name is read, and no place when it has none. */
function placeAndWho(r: HomeRow): string {
  const said = [r.folder, r.byName].filter(Boolean).join(' · ')
  if (!said) return ''
  return r.byName ? `${said}, ` : `${said} · `
}

/**
 * The first page: the pages you touched last, newest change first, each a
 * link to the page (Katerina's Home story in `proto/leaf-app`). Someone who
 * touched none sees their Folders' latest pages; a workspace with no pages
 * says so and offers New document.
 *
 * A build with no relay, or no sign-in, has nothing to list: it says so and
 * why, as a quiet caption under the empty state. The empty states go straight
 * into the frame's `main`, with no box around them: `main` is a flex column,
 * so one takes the room left and centres in it both ways, as its own page says.
 */
export function HomePage({ relay, state, name, recent = null, onNew, now }: HomePageProps) {
  // Home is drawn afresh each time it opens, so "now" is when it opened.
  const [opened] = useState(() => Date.now())
  if (!relay || state === 'off') {
    const line = !relay
      ? 'Running alone: no relay is set. Set VITE_RELAY_URL in .env.local to connect.'
      : `Not connected: ${relayLabel(relay)} needs sign-in, and this build has none.`
    return (
      <>
        <EmptyState message="Nothing here yet." />
        <p className="px-6 pb-6 text-center text-caption text-text-muted">{line}</p>
      </>
    )
  }
  if (recent === 'failed') return <EmptyState scope="page" message="Your recent documents could not be read. Reload to try again." />
  if (recent?.length === 0) {
    return (
      <EmptyState
        scope="page"
        icon={<IconFilePlus size={16} stroke={1.5} />}
        message="No documents yet."
        action={onNew ? { label: 'New document', onClick: onNew } : undefined}
      />
    )
  }
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title="Home" bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            <SectionHeader title="Recent" hover="none" />
            {recent === null ? (
              <SkeletonList rows={4} />
            ) : (
              recent.map((r) => (
                // The summary is one line under the title, and the row keeps to one line without it (the short-summary story's LeafRecentRow).
                <Card key={r.address} href={pagePath(r)} hover="fill" quietUntilHover className={cn('flex gap-3 px-3 py-2', r.summary ? 'items-start' : 'items-center')}>
                  <span className={cn('flex shrink-0', r.summary && 'pt-0.5')}>
                    <KindIcon kind={r.type ? thingKindOf(r.kind) : 'file'} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <WithTooltip label={r.title} wrapperClassName="min-w-0">
                        <span className="block truncate text-body-2-strong text-text-primary">{r.title}</span>
                      </WithTooltip>
                      {/* Another app's file says what it is, as its row in the tree does (record a-file-is-labelled-by-its-type-not-its-app). */}
                      {r.type && <Chip type="neutral" label={r.type} />}
                    </span>
                    {r.summary && <span className="block truncate text-body-2 text-text-secondary">{r.summary}</span>}
                  </span>
                  <span className={cn('shrink-0 text-caption text-text-muted', r.summary && 'pt-0.5')}>
                    {placeAndWho(r)}
                    <WithTooltip inline label={exactly(r.at)}>
                      <span>{whenOf(r.at, now ?? opened)}</span>
                    </WithTooltip>
                  </span>
                </Card>
              ))
            )}
            {state !== 'live' && <p className="pt-4 text-caption text-text-muted">{SAYS[state](relayLabel(relay), name)}</p>}
          </div>
        </Panel>
      </div>
    </div>
  )
}
