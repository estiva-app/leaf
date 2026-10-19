import type { Imeta } from '@estiva-app/protocol'
import { AttachmentCard } from '@estiva-app/ui'
import { blobObjectUrl } from '../relay/blobs'

/**
 * A comment's files under its words, in the order they were attached: the
 * package's AttachmentCard, as Ship's `Attachments` and Peek draw them. A
 * picture is its thumbnail and opens full screen; anything else is a row that
 * downloads. The bytes are fetched as the reader (`blobObjectUrl`), so a file
 * they cannot read draws as the card that says so. What is here is a mapping,
 * not a shape.
 */
export function CommentFiles({ files }: { files: readonly Imeta[] }) {
  if (files.length === 0) return null
  return (
    <div data-comment-files="" className="flex flex-wrap items-start gap-1.5 pt-1">
      {files.map((file, i) => {
        const isImage = file.m.startsWith('image/')
        const name = file.filename ?? file.alt ?? (isImage ? 'attachment' : 'file')
        return (
          <AttachmentCard
            // Content addressed, so the hash keys it; one file attached twice is the same blob, hence the index.
            key={`${file.x}_${i}`}
            data-attachment={isImage ? 'image' : 'file'}
            name={name}
            // Never empty: an empty alt says a picture somebody chose to post is decoration.
            alt={isImage ? (file.alt ?? name) : undefined}
            size={file.size}
            contentType={file.m}
            // The relay's thumbnail in the column; the original only when it is opened.
            remoteSrc={isImage ? (file.thumb ?? file.url) : file.url}
            remoteFullSrc={isImage ? file.url : undefined}
            fetchImage={blobObjectUrl}
            download
          />
        )
      })}
    </div>
  )
}
