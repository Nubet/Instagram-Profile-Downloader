import type { InstagramProfile, ScrapedPost } from '~/features/profileDownload/domain/profileDownload'

export interface DownloadBatch {
  sessionId: string
  profile: InstagramProfile
  posts: ScrapedPost[]
  items: DownloadItem[]
}

export type DownloadDeliveryMode = 'individual-files' | 'zip-archive'

export interface ZipArchiveOptions {
  maxArchiveBytes: number
  maxArchiveItems: number
}

export const defaultZipArchiveOptions: ZipArchiveOptions = {
  maxArchiveBytes: 400 * 1024 * 1024,
  maxArchiveItems: 500,
}

export interface DownloadBatchResult {
  downloadedFileCount: number
  failure: ScrapeFailure | null
  archiveCount?: number
  failedItemCount?: number
}

export interface DownloadItem {
  id: string
  postId: string
  kind: 'image' | 'video' | 'caption'
  path: string
  source: DownloadSource
}

export type DownloadSource =
  | {
    type: 'remote-url'
    value: string
  }
  | {
    type: 'text'
    value: string
    mimeType: 'text/plain;charset=utf-8'
  }

export interface ScrapeFailure {
  sessionId: string
  postId: string | null
  itemId: string | null
  message: string
}
