import { describe, expect, it } from 'vitest'
import { buildDownloadBatch } from '~/features/profileDownload/application/buildDownloadBatch'
import type { DownloadSession, ScrapedPost } from '~/features/profileDownload/domain/profileDownload'

describe('buildDownloadBatch', () => {
  it('creates download items for image and caption files', () => {
    const session: DownloadSession = {
      id: 'session-1',
      startedAt: '2026-06-08T10:00:00.000Z',
      profile: {
        name: 'nubet',
        url: 'https://www.instagram.com/nubet/',
        targetRoot: 'nubet',
      },
    }

    const settings = {
      scrollDelayRange: { min: 1000, max: 2000 },
      cooldownDelayRange: { min: 1000, max: 2000 },
      cooldownBatchSize: 30,
      downloadImages: true,
      downloadVideos: true,
      downloadCaptions: true,
    }

    const posts: ScrapedPost[] = [
      {
        id: 'post-1',
        media: [{ url: 'https://cdn.example.com/post-1.jpg', type: 'image' }],
        caption: 'Caption text',
        profileName: 'nubet',
      },
    ]

    expect(buildDownloadBatch(session, posts, settings)).toEqual({
      sessionId: 'session-1',
      profile: session.profile,
      posts,
      items: [
        {
          id: 'post-1:media:0',
          postId: 'post-1',
          kind: 'image',
          path: 'nubet/post-1/image.jpg',
          source: {
            type: 'remote-url',
            value: 'https://cdn.example.com/post-1.jpg',
          },
        },
        {
          id: 'post-1:caption',
          postId: 'post-1',
          kind: 'caption',
          path: 'nubet/post-1/caption.txt',
          source: {
            type: 'text',
            value: 'Caption text',
            mimeType: 'text/plain;charset=utf-8',
          },
        },
      ],
    })
  })

  it('skips caption files when authored caption is empty', () => {
    const session: DownloadSession = {
      id: 'session-1',
      startedAt: '2026-06-08T10:00:00.000Z',
      profile: {
        name: 'nubet',
        url: 'https://www.instagram.com/nubet/',
        targetRoot: 'nubet',
      },
    }

    const settings = {
      scrollDelayRange: { min: 1000, max: 2000 },
      cooldownDelayRange: { min: 1000, max: 2000 },
      cooldownBatchSize: 30,
      downloadImages: true,
      downloadVideos: true,
      downloadCaptions: true,
    }

    const posts: ScrapedPost[] = [
      {
        id: 'post-1',
        media: [{ url: 'https://cdn.example.com/post-1.jpg', type: 'image' }],
        caption: '',
        profileName: 'nubet',
      },
    ]

    expect(buildDownloadBatch(session, posts, settings).items).toEqual([
      {
        id: 'post-1:media:0',
        postId: 'post-1',
        kind: 'image',
        path: 'nubet/post-1/image.jpg',
        source: {
          type: 'remote-url',
          value: 'https://cdn.example.com/post-1.jpg',
        },
      },
    ])
  })
})
