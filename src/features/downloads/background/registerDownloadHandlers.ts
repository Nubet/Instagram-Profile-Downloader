import { onMessage } from 'webext-bridge/background'
import { downloadBatch } from './downloadBatch'
import { downloadBatchAsZip } from './downloadBatchAsZip'
import { extensionMessage } from '~/features/profileDownload/contracts/messages'
import type { QueueDownloadBatchRequest } from '~/features/profileDownload/contracts/messages'

export function registerDownloadHandlers() {
  onMessage(extensionMessage.queueDownloadBatch, async ({ data }) => {
    const request = data as unknown as QueueDownloadBatchRequest
    const deliveryMode = request.deliveryMode ?? 'individual-files'
    const result = deliveryMode === 'zip-archive'
      ? await downloadBatchAsZip(request.batch)
      : await downloadBatch(request.batch)

    return {
      accepted: true,
      queuedItemCount: request.batch.items.length,
      downloadedFileCount: result.downloadedFileCount,
      archiveCount: result.archiveCount,
      failedItemCount: result.failedItemCount,
      failure: result.failure,
      trace: result.trace,
    }
  })
}
