import browser from 'webextension-polyfill'
import type { DownloadItem, DownloadTraceEntry } from '../domain/download'
import { createDownloadUrl } from './createDownloadUrl'
import { downloadAdapter } from './downloadAdapter'

export async function downloadItem(item: DownloadItem, trace?: DownloadTraceEntry[]): Promise<void> {
  if (item.source.type === 'text') {
    await downloadAdapter.downloadText(item.source.value, item.path, item.source.mimeType, trace)
    return
  }

  // Remote media works through downloads.download in both browsers.
  const downloadUrl = createDownloadUrl(item)

  try {
    await browser.downloads.download({
      url: downloadUrl.value,
      filename: item.path,
      saveAs: false,
      conflictAction: 'overwrite',
    })
    trace?.push({ level: 'info', message: `Browser download accepted: ${item.path}.` })
  }
  finally {
    downloadUrl.revoke?.()
  }
}
