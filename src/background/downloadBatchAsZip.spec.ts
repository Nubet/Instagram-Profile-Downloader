import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBatchAsZip } from '~/features/downloads/background/downloadBatchAsZip'
import type { DownloadBatch } from '~/features/downloads/domain/download'

const downloadArchive = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('~/features/downloads/background/downloadAdapter', () => ({
  downloadAdapter: {
    downloadArchive,
  },
}))

describe('downloadBatchAsZip', () => {
  beforeEach(() => {
    downloadArchive.mockClear()
    vi.restoreAllMocks()

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:${blob.size}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('splits archives by item count', async () => {
    const result = await downloadBatchAsZip(createBatch([
      createCaptionItem('post-1', 'Caption 1'),
      createCaptionItem('post-2', 'Caption 2'),
    ]), {
      maxArchiveBytes: 1024 * 1024,
      maxArchiveItems: 1,
    })

    expect(result).toMatchObject({
      downloadedFileCount: 2,
      archiveCount: 2,
      failedItemCount: 0,
      failure: null,
    })
    expect(downloadArchive).toHaveBeenCalledTimes(2)
    const calls = downloadArchive.mock.calls as unknown[][]
    expect(calls[0]?.[1]).toMatch(/^nubet_\d{4}-\d{2}-\d{2}_part-001\.zip$/)
    expect(calls[1]?.[1]).toMatch(/^nubet_\d{4}-\d{2}-\d{2}_part-002\.zip$/)
    expect(calls[0]?.[2]).toEqual(expect.any(Array))
    expect(calls[1]?.[2]).toEqual(expect.any(Array))
  })

  it('keeps packing when a remote item fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))

    const result = await downloadBatchAsZip(createBatch([
      createRemoteImageItem('post-1'),
      createCaptionItem('post-2', 'Caption 2'),
    ]))

    expect(result).toMatchObject({
      downloadedFileCount: 1,
      archiveCount: 1,
      failedItemCount: 1,
    })
    expect(result.failure?.postId).toBe('post-1')
    expect(downloadArchive).toHaveBeenCalledTimes(1)
  })
})

function createBatch(items: DownloadBatch['items']): DownloadBatch {
  return {
    sessionId: 'session-1',
    profile: {
      name: 'nubet',
      url: 'https://www.instagram.com/nubet/',
      targetRoot: 'nubet',
    },
    posts: [],
    items,
  }
}

function createCaptionItem(postId: string, value: string): DownloadBatch['items'][number] {
  return {
    id: `${postId}:caption`,
    postId,
    kind: 'caption',
    path: `nubet/${postId}/caption.txt`,
    source: {
      type: 'text',
      value,
      mimeType: 'text/plain;charset=utf-8',
    },
  }
}

function createRemoteImageItem(postId: string): DownloadBatch['items'][number] {
  return {
    id: `${postId}:media:0`,
    postId,
    kind: 'image',
    path: `nubet/${postId}/image.jpg`,
    source: {
      type: 'remote-url',
      value: `https://cdn.example.com/${postId}.jpg`,
    },
  }
}
