import type { ScrapedMedia } from '../domain/profileDownload'

export interface PostDetails {
  caption: string
  media: ScrapedMedia[]
}

interface PostPageData {
  caption?: string
}

const graphQlDocId = '27128499623469141'

export async function fetchInstagramPostDetails(shortcode: string): Promise<PostDetails> {
  let details: PostDetails = { caption: '', media: [] }
  try {
    details = await fetchDetailsViaGraphQl(shortcode)
  }
  catch {
  }

  if (details.media.length === 0) {
    try {
      const pageDetails = await fetchDetailsViaPostPage(shortcode)
      if (!details.caption)
        details.caption = pageDetails.caption
      if (pageDetails.media.length > 0)
        details.media = pageDetails.media
    }
    catch {
    }
  }

  return details
}

async function fetchDetailsViaGraphQl(shortcode: string): Promise<PostDetails> {
  const variables = JSON.stringify({
    shortcode,
    __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
  })

  const body = new URLSearchParams({
    doc_id: graphQlDocId,
    variables,
  })

  const response = await fetch(
    `https://www.instagram.com/graphql/query`,
    {
      credentials: 'include',
      headers: {
        ...createInstagramHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      body,
      referrer: window.location.href,
      referrerPolicy: 'strict-origin-when-cross-origin',
    },
  )

  if (!response.ok)
    throw new Error(`GraphQL query failed with status ${response.status}.`)

  const json = await response.json()
  const item = json.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0]

  if (!item)
    throw new Error('No media found in new GraphQL response.')

  const date = extractDateFromItem(item)
  if (!date) {
    const keys = Object.keys(item).join(', ')
    throw new Error(`MISSING_DATE_KEYS: ${keys} | TYPE_TAKEN_AT: ${typeof item.taken_at} | VAL: ${item.taken_at}`)
  }
  return {
    caption: extractCaptionFromItem(item),
    media: extractMediaFromItem(item),
    date,
  }
}

function extractDateFromItem(item: any): string | undefined {
  if (item.taken_at) {
    const num = Number(item.taken_at)
    if (!Number.isNaN(num))
      return formatTimestampToDateString(new Date(num * 1000))
  }
  if (item.device_timestamp) {
    const num = Number(item.device_timestamp)
    if (!Number.isNaN(num))
      return formatTimestampToDateString(new Date(num / 1000))
  }
  return undefined
}

function extractCaptionFromItem(item: any): string {
  const captionText = item.caption?.text
  if (typeof captionText === 'string')
    return sanitizeCaption(captionText)

  // Fallback to legacy structure if needed
  const edges = item.edge_media_to_caption?.edges
  if (edges?.length) {
    const text = edges[0]?.node?.text
    if (text)
      return sanitizeCaption(text)
  }

  return ''
}

function extractMediaFromItem(item: any): ScrapedMedia[] {
  const children = Array.isArray(item.carousel_media)
    ? item.carousel_media
    : Array.isArray(item.edge_sidecar_to_children?.edges)
      ? item.edge_sidecar_to_children.edges.map((e: any) => e.node)
      : [item]

  const mediaNodes: ScrapedMedia[] = []

  // If it's a single image, return empty array so scraper falls back to DOM grid image
  // (which is higher quality). If it's a single video, we must extract the video URL.
  if (children.length === 1 && children[0].media_type !== 2 && children[0].is_video !== true) {
    return []
  }

  for (const child of children) {
    const isVideo = child.is_video === true || child.media_type === 2

    if (isVideo) {
      const videos = child.video_versions ?? []
      const video = videos.slice().sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0]

      const url = video?.url || child.video_url
      if (url) {
        mediaNodes.push({ url, type: 'video' })
      }
    }
    else {
      const images = child.image_versions2?.candidates ?? []
      const image = images.slice().sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0]

      const url = image?.url || child.display_url
      if (url) {
        mediaNodes.push({ url, type: 'image' })
      }
    }
  }

  return mediaNodes
}

async function fetchDetailsViaPostPage(shortcode: string): Promise<PostDetails> {
  const response = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
    credentials: 'include',
    headers: createInstagramHeaders(),
    method: 'GET',
    referrer: window.location.href,
    referrerPolicy: 'strict-origin-when-cross-origin',
  })

  if (!response.ok)
    throw new Error(`Post page fetch failed with status ${response.status}.`)

  const html = await response.text()
  const caption = extractCaptionFromJsonLd(html) || extractCaptionFromMetaTags(html)

  const media: ScrapedMedia[] = []

  const document = parseHtmlDocument(html)
  const videoUrl = document.querySelector('meta[property="og:video"]')?.getAttribute('content')

  if (videoUrl) {
    media.push({ url: videoUrl, type: 'video' })
  }

  return { caption, media }
}

function extractCaptionFromJsonLd(html: string): string {
  const document = parseHtmlDocument(html)
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '') as PostPageData | PostPageData[]
      const items = Array.isArray(data) ? data : [data]

      for (const item of items) {
        if (typeof item.caption === 'string')
          return sanitizeCaption(item.caption)
      }
    }
    catch {
    }
  }

  return ''
}

function extractCaptionFromMetaTags(html: string): string {
  const document = parseHtmlDocument(html)
  const content = document.querySelector('meta[property="og:description"]')?.getAttribute('content')

  return sanitizeCaption(content)
}

function normalizeCaption(value: string | null | undefined): string {
  if (!value)
    return ''

  return decodeHtmlEntities(value).trim()
}

function sanitizeCaption(value: string | null | undefined): string {
  const caption = normalizeCaption(value)

  if (!caption)
    return ''

  const quotedCaptionMatch = caption.match(/^\d[\d,.\s]*likes?,\s+\d[\d,.\s]*comments?\s+-\s+(?:\S.*?|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]):\s*"([\s\S]+)"\.?$/i)

  if (quotedCaptionMatch)
    return quotedCaptionMatch[1].trim()

  return caption
}

function decodeHtmlEntities(value: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function createInstagramHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
  }
  const csrfToken = getCookieValue('csrftoken')
  const claim = sessionStorage.getItem('www-claim-v2')

  if (csrfToken)
    headers['x-csrftoken'] = csrfToken

  if (claim)
    headers['x-ig-www-claim'] = claim

  return headers
}

function getCookieValue(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1]
}
