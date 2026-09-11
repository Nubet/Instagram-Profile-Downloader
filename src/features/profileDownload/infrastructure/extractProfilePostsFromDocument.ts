import type { ScrapedPost } from '../domain/profileDownload'

const postPathSegments = new Set(['p', 'reel', 'tv'])
const preferredPostAnchorSelector = [
  'main a[href*="/p/"]',
  'main a[href*="/reel/"]',
  'main a[href*="/tv/"]',
].join(', ')
const fallbackPostAnchorSelector = [
  'a[href*="/p/"]',
  'a[href*="/reel/"]',
  'a[href*="/tv/"]',
].join(', ')

export interface ExtractProfilePostsDiagnostics {
  anchorCount: number
  postLinkCount: number
  duplicatePostCount: number
  missingMediaCount: number
  missingSourceCount: number
  addedPostCount: number
  selector: 'main' | 'document'
  sampleAnchorPaths: string[]
  samplePostPaths: string[]
}

export interface ExtractProfilePostsResult {
  posts: ScrapedPost[]
  seenPostIds: Set<string>
  diagnostics: ExtractProfilePostsDiagnostics
}

export function extractProfilePostsFromDocument(document: Document, profileName: string, existingSeenPostIds: Iterable<string> = []): ExtractProfilePostsResult {
  const seenPostIds = new Set(existingSeenPostIds)
  const posts: ScrapedPost[] = []
  const candidateAnchors = getCandidateAnchors(document)
  let duplicatePostCount = 0
  let missingMediaCount = 0
  let missingSourceCount = 0
  const sampleAnchorPaths: string[] = []
  const samplePostPaths: string[] = []

  for (const anchor of candidateAnchors.anchors) {
    if (sampleAnchorPaths.length < 5)
      sampleAnchorPaths.push(getNormalizedPath(anchor.getAttribute('href')))

    const postId = getPostIdFromHref(anchor.getAttribute('href'))

    if (!postId)
      continue

    if (samplePostPaths.length < 5)
      samplePostPaths.push(getNormalizedPath(anchor.getAttribute('href')))

    if (seenPostIds.has(postId)) {
      duplicatePostCount += 1
      continue
    }

    const media = getAnchorMedia(anchor)

    if (!media) {
      missingMediaCount += 1
      continue
    }

    const imageUrl = getImageUrl(media)

    if (!imageUrl) {
      missingSourceCount += 1
      continue
    }

    seenPostIds.add(postId)
    posts.push({
      id: postId,
      media: [{ url: imageUrl, type: media instanceof HTMLVideoElement ? 'video' : 'image' }],
      caption: '',
      profileName,
    })
  }

  return {
    diagnostics: {
      anchorCount: candidateAnchors.anchors.length,
      postLinkCount: candidateAnchors.anchors.length,
      duplicatePostCount,
      missingMediaCount,
      missingSourceCount,
      addedPostCount: posts.length,
      selector: candidateAnchors.selector,
      sampleAnchorPaths,
      samplePostPaths,
    },
    posts,
    seenPostIds,
  }
}

function getCandidateAnchors(document: Document) {
  const preferredAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(preferredPostAnchorSelector))

  if (preferredAnchors.length > 0) {
    return {
      anchors: dedupeAnchors(preferredAnchors),
      selector: 'main' as const,
    }
  }

  return {
    anchors: dedupeAnchors(Array.from(document.querySelectorAll<HTMLAnchorElement>(fallbackPostAnchorSelector))),
    selector: 'document' as const,
  }
}

function dedupeAnchors(anchors: HTMLAnchorElement[]) {
  const seenPaths = new Set<string>()
  const uniqueAnchors: HTMLAnchorElement[] = []

  for (const anchor of anchors) {
    const normalizedPath = getNormalizedPath(anchor.getAttribute('href'))

    if (seenPaths.has(normalizedPath))
      continue

    seenPaths.add(normalizedPath)
    uniqueAnchors.push(anchor)
  }

  return uniqueAnchors
}

function getPostIdFromHref(href: string | null): string | null {
  if (!href)
    return null

  const url = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.instagram.com')
  const pathSegments = url.pathname.split('/').filter(Boolean)
  const postTypeIndex = pathSegments.findIndex(segment => postPathSegments.has(segment))

  if (postTypeIndex === -1)
    return null

  const postId = pathSegments[postTypeIndex + 1]

  return postId || null
}

function getNormalizedPath(href: string | null) {
  if (!href)
    return ''

  const url = href.startsWith('http') ? new URL(href) : new URL(href, 'https://www.instagram.com')

  return url.pathname.replace(/\/+$/, '') || '/'
}

function getAnchorMedia(anchor: HTMLAnchorElement): HTMLImageElement | HTMLVideoElement | null {
  return anchor.querySelector('img, video')
}

function getImageUrl(media: HTMLImageElement | HTMLVideoElement): string | null {
  if (media instanceof HTMLVideoElement) {
    const poster = media.poster.trim()

    return poster || null
  }

  const src = media.currentSrc || media.src || media.getAttribute('src') || getFirstSrcSetUrl(media.getAttribute('srcset'))

  if (!src)
    return null

  return src.trim() || null
}

function getFirstSrcSetUrl(srcset: string | null): string | null {
  if (!srcset)
    return null

  const [firstCandidate] = srcset.split(',')

  return firstCandidate?.trim().split(/\s+/)[0] || null
}
