import type { DownloadSession, ScrapedPost } from '../domain/profileDownload'
import type { ProfileScrapeSettings } from '../domain/scrapePolicy'
import type { DownloadBatch, DownloadItem } from '~/features/downloads/domain/download'

export function buildDownloadBatch(session: DownloadSession, posts: ScrapedPost[], settings: ProfileScrapeSettings): DownloadBatch {
  return {
    sessionId: session.id,
    profile: session.profile,
    posts,
    items: posts.flatMap(post => createDownloadItems(session, post, settings)),
  }
}

function createDownloadItems(session: DownloadSession, post: ScrapedPost, settings: ProfileScrapeSettings): DownloadItem[] {
  const basePath = `${session.profile.targetRoot}/${post.id}`
  const items: DownloadItem[] = []

  post.media.forEach((mediaItem, index) => {
    if (mediaItem.type === 'image' && !settings.downloadImages)
      return
    if (mediaItem.type === 'video' && !settings.downloadVideos)
      return

    const suffix = post.media.length > 1 ? `_${index + 1}` : ''
    const ext = mediaItem.type === 'video' ? 'mp4' : 'jpg'

    items.push({
      id: `${post.id}:media:${index}`,
      postId: post.id,
      kind: mediaItem.type,
      path: `${basePath}/${mediaItem.type}${suffix}.${ext}`,
      source: {
        type: 'remote-url',
        value: mediaItem.url,
      },
    })
  })

  const caption = post.caption.trim()

  if (settings.downloadCaptions && caption) {
    items.push({
      id: `${post.id}:caption`,
      postId: post.id,
      kind: 'caption',
      path: `${basePath}/caption.txt`,
      source: {
        type: 'text',
        value: caption,
        mimeType: 'text/plain;charset=utf-8',
      },
    })
  }

  return items
}
