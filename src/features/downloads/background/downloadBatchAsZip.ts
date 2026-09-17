import JSZip from 'jszip'
import type { DownloadBatch, DownloadBatchResult, DownloadItem, DownloadTraceEntry, ScrapeFailure, ZipArchiveOptions } from '../domain/download'
import { defaultZipArchiveOptions } from '../domain/download'
import { downloadAdapter } from './downloadAdapter'
import { fetchDownloadItemContent } from './fetchDownloadItemContent'

interface ZipManifestItem {
  id: string
  postId: string
  kind: DownloadItem['kind']
  path: string
  sourceType: DownloadItem['source']['type']
}

interface ZipPartState {
  zip: JSZip
  items: ZipManifestItem[]
  errors: string[]
  sizeBytes: number
}

export async function downloadBatchAsZip(
  batch: DownloadBatch,
  options: ZipArchiveOptions = defaultZipArchiveOptions,
): Promise<DownloadBatchResult> {
  let part = createZipPartState()
  let archiveCount = 0
  let downloadedFileCount = 0
  let failedItemCount = 0
  let firstFailure: ScrapeFailure | null = null
  const trace: DownloadTraceEntry[] = []

  for (const item of batch.items) {
    try {
      const content = await fetchDownloadItemContent(item)

      if (shouldStartNextArchive(part, content.sizeBytes, options)) {
        archiveCount += 1
        await finalizeZipPart(batch, part, archiveCount, trace)
        part = createZipPartState()
      }

      part.zip.file(normalizeZipPath(item.path), content.value)
      part.items.push(toManifestItem(item))
      part.sizeBytes += content.sizeBytes
      downloadedFileCount += 1
    }
    catch (error) {
      failedItemCount += 1
      const message = error instanceof Error ? error.message : `Failed to add ${item.path} to ZIP.`
      part.errors.push(`${item.path}: ${message}`)
      firstFailure ??= {
        sessionId: batch.sessionId,
        postId: item.postId,
        itemId: item.id,
        message,
      }
    }
  }

  if (part.items.length > 0 || part.errors.length > 0) {
    archiveCount += 1
    await finalizeZipPart(batch, part, archiveCount, trace)
  }

  return {
    downloadedFileCount,
    failure: firstFailure,
    trace,
    archiveCount,
    failedItemCount,
  }
}

function createZipPartState(): ZipPartState {
  return {
    zip: new JSZip(),
    items: [],
    errors: [],
    sizeBytes: 0,
  }
}

function shouldStartNextArchive(part: ZipPartState, nextItemBytes: number, options: ZipArchiveOptions): boolean {
  if (part.items.length === 0)
    return false

  return part.items.length >= options.maxArchiveItems || part.sizeBytes + nextItemBytes > options.maxArchiveBytes
}

async function finalizeZipPart(batch: DownloadBatch, part: ZipPartState, archiveIndex: number, trace: DownloadTraceEntry[]) {
  part.zip.file('_manifest.json', JSON.stringify({
    profile: batch.profile.name,
    sessionId: batch.sessionId,
    archivePart: archiveIndex,
    createdAt: new Date().toISOString(),
    items: part.items,
  }, null, 2))

  if (part.errors.length > 0)
    part.zip.file('_errors.txt', `Failed files:\n${part.errors.map(error => `- ${error}`).join('\n')}`)

  const filename = createArchiveFilename(batch.profile.targetRoot, archiveIndex)
  await downloadAdapter.downloadArchive(part.zip, filename, trace)
}

function toManifestItem(item: DownloadItem): ZipManifestItem {
  return {
    id: item.id,
    postId: item.postId,
    kind: item.kind,
    path: normalizeZipPath(item.path),
    sourceType: item.source.type,
  }
}

function normalizeZipPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/')
}

function createArchiveFilename(profileRoot: string, archiveIndex: number): string {
  const date = new Date().toISOString().slice(0, 10)
  const part = String(archiveIndex).padStart(3, '0')

  return `${profileRoot}_${date}_part-${part}.zip`
}
