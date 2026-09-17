import type JSZip from 'jszip'
import browser from 'webextension-polyfill'
import type { DownloadTraceEntry } from '../domain/download'
import type { DownloadAdapter } from './downloadAdapter'
import { createBlobUrl } from './createDownloadUrl'

export const chromeDownloadAdapter = {
  async downloadText(value: string, filename: string, mimeType: string, trace?: DownloadTraceEntry[]) {
    // Chrome accepts extension-created Blob URLs and preserves relative paths.
    const downloadUrl = createBlobUrl(value, mimeType)
    const url = downloadUrl?.value ?? `data:${mimeType},${encodeURIComponent(value)}`

    try {
      await browser.downloads.download({ url, filename, saveAs: false, conflictAction: 'overwrite' })
      trace?.push({ level: 'info', message: `Chrome native download accepted: ${filename}.` })
    }
    finally {
      downloadUrl?.revoke?.()
    }
  },

  async downloadArchive(zip: JSZip, filename: string, trace?: DownloadTraceEntry[]) {
    // Keep the original Chrome path: Firefox rejects large data URLs.
    const base64 = await zip.generateAsync({ type: 'base64' })
    trace?.push({ level: 'info', message: `Opening Chrome ZIP download: ${filename}.`, details: `base64Length=${base64.length}` })
    await browser.downloads.download({
      url: `data:application/zip;base64,${base64}`,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    })
    trace?.push({ level: 'info', message: `Chrome ZIP download accepted: ${filename}.` })
  },
} satisfies DownloadAdapter
