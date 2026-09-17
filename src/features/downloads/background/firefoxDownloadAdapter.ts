import browser from 'webextension-polyfill'
import type JSZip from 'jszip'
import type { DownloadTraceEntry } from '../domain/download'
import type { DownloadAdapter } from './downloadAdapter'

interface DownloadRequest {
  type: 'download-file'
  id: string
  filename: string
  mimeType: string
  value: BlobPart
}

interface DownloadReadyMessage {
  type: 'download-ready'
  id: string
}

interface DownloadCompleteMessage {
  type: 'download-complete'
  id: string
}

interface DownloadErrorMessage {
  type: 'download-error'
  id: string
  message: string
}

const requests = new Map<string, {
  request: DownloadRequest
  tabId?: number
  resolve: () => void
  reject: (error: unknown) => void
  trace: DownloadTraceEntry[]
}>()

// Firefox cannot pass extension-created blob/data URLs to downloads.download.
browser.runtime.onMessage.addListener((message) => {
  if (isDownloadReadyMessage(message)) {
    const pending = requests.get(message.id)
    if (!pending)
      return

    pending.trace.push({ level: 'info', message: 'Firefox download page sent download-ready.' })
    return Promise.resolve(pending.request)
  }

  if (isDownloadCompleteMessage(message)) {
    const pending = requests.get(message.id)
    if (!pending)
      return

    const tabId = pending.tabId
    requests.delete(message.id)
    pending.trace.push({ level: 'info', message: 'Firefox download page sent download-complete.' })
    pending.resolve()
    if (tabId !== undefined)
      void browser.tabs.remove(tabId)
  }

  if (isDownloadErrorMessage(message)) {
    const pending = requests.get(message.id)
    if (!pending)
      return

    requests.delete(message.id)
    pending.trace.push({ level: 'error', message: 'Firefox download page failed.', details: message.message })
    pending.reject(new Error(message.message))
    if (pending.tabId !== undefined)
      void browser.tabs.remove(pending.tabId)
  }
})

export const firefoxDownloadAdapter = {
  async downloadText(value: string, filename: string, mimeType: string, trace?: DownloadTraceEntry[]) {
    await downloadBlob(value, filename, mimeType, trace)
  },

  async downloadArchive(zip: JSZip, filename: string, trace?: DownloadTraceEntry[]) {
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
    trace?.push({ level: 'info', message: `Opening Firefox ZIP download: ${filename}.`, details: `bytes=${blob.size}` })
    await downloadBlob(blob, filename, 'application/zip', trace)
  },
} satisfies DownloadAdapter

async function downloadBlob(value: BlobPart, filename: string, mimeType = 'application/octet-stream', trace: DownloadTraceEntry[] = []): Promise<void> {
  const id = crypto.randomUUID()
  const request: DownloadRequest = {
    type: 'download-file',
    id,
    filename,
    mimeType,
    value,
  }

  await new Promise<void>((resolve, reject) => {
    // The Blob must be created and clicked inside an extension page in Firefox
    requests.set(id, { request, resolve, reject, trace })
    trace.push({ level: 'info', message: 'Creating Firefox download tab.', details: `id=${id}` })

    void browser.tabs.create({
      url: browser.runtime.getURL(`dist/downloads/index.html?id=${encodeURIComponent(id)}`),
      active: false,
    }).then((tab) => {
      if (tab.id === undefined) {
        requests.delete(id)
        trace.push({ level: 'error', message: 'Firefox download tab was created without a tab id.' })
        reject(new Error('Firefox download page could not be opened.'))
        return
      }

      const pending = requests.get(id)
      if (pending)
        pending.tabId = tab.id
    }).catch((error) => {
      requests.delete(id)
      trace.push({ level: 'error', message: 'Could not create Firefox download tab.', details: error instanceof Error ? error.message : 'Unknown error.' })
      reject(error)
    })
  })
}

function isDownloadReadyMessage(message: unknown): message is DownloadReadyMessage {
  return isMessageWithType(message, 'download-ready')
}

function isDownloadCompleteMessage(message: unknown): message is DownloadCompleteMessage {
  return isMessageWithType(message, 'download-complete')
}

function isDownloadErrorMessage(message: unknown): message is DownloadErrorMessage {
  return isMessageWithType(message, 'download-error') && 'message' in message && typeof message.message === 'string'
}

function isMessageWithType<T extends string>(message: unknown, type: T): message is { type: T, id: string } {
  return typeof message === 'object'
    && message !== null
    && 'type' in message
    && message.type === type
    && 'id' in message
    && typeof message.id === 'string'
}
