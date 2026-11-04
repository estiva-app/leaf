import type { Imeta } from '@estiva-app/protocol'
import { AttachmentCard } from '@estiva-app/ui'
import { blobObjectUrl } from '../relay/blobs'

/**
 * One file as the package's card, in a comment (the kit card's `files`, which lays them out under the words, in the
 * order they were attached, as Ship's and Peek's) or in a page's text (115c8229). A picture is its thumbnail and opens
 * full screen; anything else is a row that downloads. The bytes are fetched as the reader (`blobObjectUrl`), so a file
 * they cannot read draws as the card that says so.
 *
 * `download` is off in a page's text, as in Ship's description editor: that
 * editor saves when it loses focus and the Download button takes it. A picture
 * still opens full size there.
 */
export function FileCard({ file, download = true }: { file: Imeta; download?: boolean }) {
  // A block in a page's text is whatever its writer stored: a missing type is no type, not a crash.
  const type = file.m ?? ''
  const isImage = type.startsWith('image/')
  const name = file.filename ?? file.alt ?? (isImage ? 'attachment' : 'file')
  return (
    <AttachmentCard
      data-attachment={isImage ? 'image' : 'file'}
      name={name}
      // Never empty: an empty alt says a picture somebody chose to post is decoration.
      alt={isImage ? (file.alt ?? name) : undefined}
      size={file.size}
      contentType={type}
      // The relay's thumbnail in the column; the original only when it is opened. Another file is fetched to open, as in Ship.
      remoteSrc={isImage ? (file.thumb ?? file.url) : download ? file.url : undefined}
      remoteFullSrc={isImage ? file.url : undefined}
      fetchImage={blobObjectUrl}
      download={download}
    />
  )
}
