import { onMessage } from 'webext-bridge/content-script'
import { extensionMessage } from '../contracts/messages'
import type {
  DownloadSelectedPostsRequest,
  FinalizeProfileDownloadRequest,
  ResumeProfileDownloadRequest,
  StartProfileDownloadRequest,
  StopProfileDownloadRequest,
} from '../contracts/messages'
import { createProfileDownloadRuntime } from './createProfileDownloadRuntime'

export function registerProfileDownloadHandlers() {
  const runtime = createProfileDownloadRuntime()

  onMessage(extensionMessage.getScrapeStatus, () => {
    return runtime.getScrapeStatus()
  })

  onMessage(extensionMessage.startProfileDownload, async ({ data }) => {
    return runtime.startProfileDownload(data as unknown as StartProfileDownloadRequest)
  })

  onMessage(extensionMessage.stopProfileDownload, ({ data }) => {
    return runtime.stopProfileDownload(data as unknown as StopProfileDownloadRequest)
  })

  onMessage(extensionMessage.resumeProfileDownload, ({ data }) => {
    return runtime.resumeProfileDownload(data as unknown as ResumeProfileDownloadRequest)
  })

  onMessage(extensionMessage.finalizeProfileDownload, ({ data }) => {
    return runtime.finalizeProfileDownload(data as unknown as FinalizeProfileDownloadRequest)
  })

  onMessage(extensionMessage.downloadSelectedPosts, async ({ data }) => {
    return runtime.downloadSelectedPosts(data as unknown as DownloadSelectedPostsRequest)
  })
}
