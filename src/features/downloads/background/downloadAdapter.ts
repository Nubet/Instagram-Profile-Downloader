import type JSZip from 'jszip'
import type { DownloadTraceEntry } from '../domain/download'
import { chromeDownloadAdapter } from './chromeDownloadAdapter'
import { firefoxDownloadAdapter } from './firefoxDownloadAdapter'

export interface DownloadAdapter {
  downloadText: (value: string, filename: string, mimeType: string, trace?: DownloadTraceEntry[]) => Promise<void>
  downloadArchive: (zip: JSZip, filename: string, trace?: DownloadTraceEntry[]) => Promise<void>
}

// Vite replaces this flag per target; see docs/download-adapters.md.
const isFirefoxBuild = typeof __IS_FIREFOX__ !== 'undefined' && __IS_FIREFOX__

export const downloadAdapter: DownloadAdapter = isFirefoxBuild
  ? firefoxDownloadAdapter
  : chromeDownloadAdapter
