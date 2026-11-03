import { cn, Divider, PageHeader, Panel, SkeletonBar, SkeletonConversation } from '@estiva-app/ui'
import { OverviewPanel } from './OverviewPanel'

/**
 * A page before it is read, in the shape it arrives in (ONE-5, step 5), as Ship's PageSkeleton draws an issue (UIG-14,
 * ONE-6 step 4e): the kit's PageHeader with a bar for the name, then the title, the summary, the Topics row and three
 * lines of text where a Leaf page draws them, and beside it what the column will hold: the comments under "Comments" with the kit's own
 * placeholder for them, as the column draws them while they are read; the Overview; or nothing, when the comments are
 * hidden. It was three list rows. Revealed after 150ms (the kit's `animate-skeleton-in`), so a fast read never
 * flashes it.
 *
 * Built from the kit's parts in Leaf, as the kit asks of a placeholder that knows what it stands for; Ship has its own.
 */
export function PageSkeleton({ comments, overview }: { comments: boolean; overview: boolean }) {
  return (
    // `data-loading` is what a test waits on.
    <div data-loading="page" aria-hidden className="flex min-h-0 flex-1 animate-skeleton-in [contain:size]">
      <div className="flex min-w-0 flex-1 flex-col">
        <Panel title="Page" header={<PageHeader title={<SkeletonBar className="h-3.5 w-40" />} />} bodyClassName="px-12 pt-10 pb-24">
          {/* The page's reading column as DocumentView lays it out, its parts 16px apart. */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {/* The title, and the summary 4px under it: each bar on a line of the text's own size and room, so each is
                as tall as what replaces it (Ship's). */}
            <div className="flex flex-col gap-1">
              <div className="py-1 text-h1">
                <span className="inline-block w-2/3 align-middle">
                  <SkeletonBar className="h-6" />
                </span>
              </div>
              <div className="py-1 text-body-1">
                <span className="inline-block w-1/2 align-middle">
                  <SkeletonBar className="h-4" />
                </span>
              </div>
            </div>
            {/* The Topics row under them, 28px, where Ship's has its fields' pills: its word and its button. */}
            <div className="flex h-7 items-center gap-2">
              <SkeletonBar className="h-3.5 w-12" />
              <SkeletonBar className="h-3.5 w-24" />
            </div>
            {/* The text: three paragraphs, 8px apart as the editor's are. */}
            <div className="flex flex-col gap-2">
              <Line className="w-full" />
              <Line className="w-11/12" />
              <Line className="w-2/3" />
            </div>
          </div>
        </Panel>
      </div>
      {comments && (
        <>
          <Divider orientation="vertical" />
          <div className="flex flex-none flex-col">
            <Panel title="Comments" className="min-h-0 w-96 flex-1" bodyClassName="p-3">
              <SkeletonConversation />
            </Panel>
          </div>
        </>
      )}
      {overview && (
        <>
          <Divider orientation="vertical" />
          <div className="flex flex-none flex-col">
            <OverviewPanel />
          </div>
        </>
      )}
    </div>
  )
}

/** One line of the text: its box, 20px (a paragraph's line is 21px), with a bar in it the height of the letters. */
function Line({ className }: { className?: string }) {
  return (
    <div className="flex h-5 items-center">
      <SkeletonBar className={cn('h-3.5', className)} />
    </div>
  )
}
