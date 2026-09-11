import type { InstagramProfile, ScrapedPost } from '~/features/profileDownload/domain/profileDownload'

export interface DownloadBatch {
  sessionId: string
  profile: InstagramProfile
  posts: ScrapedPost[]
  items: DownloadItem[]
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
