import type { DownloadItem } from '../domain/download'

export interface CreatedDownloadUrl {
  value: string
  revoke?: () => void
}

export function createDownloadUrl(item: DownloadItem): CreatedDownloadUrl {
  if (item.source.type === 'remote-url') {
    return {
      value: item.source.value,
    }
  }

  const blobUrl = createBlobUrl(item.source.value, item.source.mimeType)

  if (blobUrl)
    return blobUrl

  return {
    value: `data:${item.source.mimeType},${encodeURIComponent(item.source.value)}`,
  }
}

export function createBlobUrl(value: BlobPart, mimeType: string): CreatedDownloadUrl | null {
  if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function')
    return null

  const objectUrl = URL.createObjectURL(new Blob([value], { type: mimeType }))

  return {
    value: objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
  }
}
