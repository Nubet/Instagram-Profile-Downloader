import type { DownloadItem } from '../domain/download'

export interface DownloadItemContent {
  value: ArrayBuffer | string
  sizeBytes: number
}

const textEncoder = new TextEncoder()

export async function fetchDownloadItemContent(item: DownloadItem): Promise<DownloadItemContent> {
  if (item.source.type === 'text') {
    return {
      value: item.source.value,
      sizeBytes: textEncoder.encode(item.source.value).byteLength,
    }
  }

  const response = await fetch(item.source.value)

  if (!response.ok)
    throw new Error(`HTTP ${response.status} while fetching ${item.path}.`)

  const value = await response.arrayBuffer()

  return {
    value,
    sizeBytes: value.byteLength,
  }
}
