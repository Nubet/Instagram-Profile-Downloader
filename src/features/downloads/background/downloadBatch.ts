import type { DownloadBatch, DownloadBatchResult, ScrapeFailure } from '../domain/download'
import { downloadItem } from './downloadItem'

export async function downloadBatch(batch: DownloadBatch): Promise<DownloadBatchResult> {
  let downloadedFileCount = 0
  let failure: ScrapeFailure | null = null

  for (const item of batch.items) {
    try {
      await downloadItem(item)
      downloadedFileCount += 1
    }
    catch (error) {
      console.error('Download failed', item.path, error)

      if (!failure) {
        failure = {
          sessionId: batch.sessionId,
          postId: item.postId,
          itemId: item.id,
          message: error instanceof Error ? error.message : `Failed to download ${item.path}.`,
        }
      }
    }
  }

  return {
    downloadedFileCount,
    failure,
  }
}
