import type { DownloadBatch, DownloadBatchResult, DownloadTraceEntry, ScrapeFailure } from '../domain/download'
import { downloadItem } from './downloadItem'

export async function downloadBatch(batch: DownloadBatch): Promise<DownloadBatchResult> {
  let downloadedFileCount = 0
  let failure: ScrapeFailure | null = null
  const trace: DownloadTraceEntry[] = []

  for (const item of batch.items) {
    try {
      trace.push({ level: 'info', message: `Starting individual download: ${item.path}.`, details: `source=${item.source.type}` })
      await downloadItem(item, trace)
      downloadedFileCount += 1
      trace.push({ level: 'info', message: `Individual download completed: ${item.path}.` })
    }
    catch (error) {
      console.error('Download failed', item.path, error)
      trace.push({ level: 'error', message: `Individual download failed: ${item.path}.`, details: error instanceof Error ? error.message : 'Unknown error.' })

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
    trace,
  }
}
