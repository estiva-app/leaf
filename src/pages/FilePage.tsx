import { BODY_SLOT, type ForeignObject } from '@estiva-app/interop'
import { toRenderTree } from '@estiva-app/protocol'
import { EmptyState, KindIcon, Panel, RichText, SkeletonList, thingKindOf } from '@estiva-app/ui'
import { isPage, titleOf, typeOf } from '../folders/tree'

/**
 * One file, opened from the tree. A page shows its title and its text; writing
 * in it comes with LEAF-3. Another app's file says what it is and offers
 * "Open in <its app>" — the only place that app's name appears (PRO-24).
 */
export function FilePage({ file, loading }: { file: ForeignObject | null; loading: boolean }) {
  if (!file) {
    return loading ? <SkeletonList rows={3} /> : <EmptyState scope="page" message="This page could not be found, or you cannot read it." />
  }
  if (!isPage(file)) {
    const opener = file.openUrl
    return (
      <EmptyState
        scope="page"
        icon={<KindIcon kind={thingKindOf(file.kind)} />}
        message={`${typeOf(file)}: ${titleOf(file)}`}
        action={opener && file.appName ? { label: `Open in ${file.appName}`, onClick: () => window.open(opener, '_blank', 'noopener') } : undefined}
      />
    )
  }
  const body = file.slots[BODY_SLOT]
  const blocks = body?.value ? toRenderTree(body.value, body.format ?? 'marker') : []
  return (
    <div className="flex min-h-0 flex-1 [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title={titleOf(file)} bodyClassName="px-12 pt-10 pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {blocks.length ? <RichText blocks={blocks} /> : <EmptyState scope="section" message="Nothing written here yet." />}
          </div>
        </Panel>
      </div>
    </div>
  )
}
