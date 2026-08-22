import type { DownloadSession, ScrapedPost } from '../domain/profileDownload'
import type { ProfileScrapeSettings } from '../domain/scrapePolicy'
import type { ScrapeDebugEntry, ScrapeProgress } from '../presentation/scrapeState'
import type { DownloadPostSelection } from '../application/selectScrapedPosts'
import type { DownloadBatch, ScrapeFailure } from '~/features/downloads/domain/download'

export const extensionMessage = {
  getScrapeStatus: 'scrape/get-status',
  startProfileDownload: 'scrape/start-profile-download',
  stopProfileDownload: 'scrape/stop-profile-download',
  downloadSelectedPosts: 'downloads/download-selected-posts',
  queueDownloadBatch: 'downloads/queue-batch',
} as const

export interface GetScrapeStatusResponse {
  progress: ScrapeProgress
  debugLog: ScrapeDebugEntry[]
  posts: ScrapedPost[]
}

export interface StartProfileDownloadRequest {
  profileUrl: string
  settings?: Partial<ProfileScrapeSettings>
}

export interface StartProfileDownloadResponse {
  accepted: boolean
  session: DownloadSession | null
  progress: ScrapeProgress
  debugLog: ScrapeDebugEntry[]
  posts: ScrapedPost[]
}

export interface StopProfileDownloadRequest {
  sessionId: string
}

export interface StopProfileDownloadResponse {
  accepted: boolean
  progress: ScrapeProgress
  debugLog: ScrapeDebugEntry[]
  posts: ScrapedPost[]
}

export interface DownloadSelectedPostsRequest {
  sessionId: string
  selection: DownloadPostSelection
}

export interface DownloadSelectedPostsResponse {
  accepted: boolean
  progress: ScrapeProgress
  debugLog: ScrapeDebugEntry[]
  posts: ScrapedPost[]
  queuedItemCount: number
  downloadedFileCount: number
  failure: ScrapeFailure | null
}

export interface QueueDownloadBatchRequest {
  batch: DownloadBatch
}

export interface QueueDownloadBatchResponse {
  accepted: boolean
  queuedItemCount: number
  downloadedFileCount: number
  failure: ScrapeFailure | null
}
