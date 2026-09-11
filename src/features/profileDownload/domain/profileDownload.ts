export interface InstagramProfile {
  name: string
  url: string
  targetRoot: string
}

export interface ScrapedMedia {
  url: string
  type: 'image' | 'video'
}

export interface ScrapedPost {
  id: string
  media: ScrapedMedia[]
  caption: string
  profileName: string
}

export interface DownloadSession {
  id: string
  profile: InstagramProfile
  startedAt: string
}

const reservedInstagramPaths = new Set([
  'accounts',
  'direct',
  'explore',
  'p',
  'reel',
  'reels',
  'stories',
])

export type InstagramProfileValidation =
  | { valid: true, profileUrl: string, profileName: string }
  | { valid: false, reason: string }

export function createDownloadSession(profileUrl: string): DownloadSession {
  const profile = parseInstagramProfile(profileUrl)

  return {
    id: crypto.randomUUID(),
    profile,
    startedAt: new Date().toISOString(),
  }
}

export function parseInstagramProfile(profileUrl: string): InstagramProfile {
  const url = new URL(profileUrl)
  const [profileName] = url.pathname.split('/').filter(Boolean)

  if (!profileName)
    throw new Error('Instagram profile URL must include a profile name.')

  return {
    name: profileName,
    url: url.toString(),
    targetRoot: sanitizePathSegment(profileName),
  }
}

export function sanitizePathSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*]+/g, '_')
}

export function validateInstagramProfileUrl(value: string | undefined): InstagramProfileValidation {
  if (!value)
    return { valid: false, reason: 'Open a public Instagram profile first.' }

  let url: URL

  try {
    url = new URL(value)
  }
  catch {
    return { valid: false, reason: 'Active tab URL is not valid.' }
  }

  if (url.hostname !== 'www.instagram.com')
    return { valid: false, reason: 'Active tab must be on www.instagram.com.' }

  const segments = url.pathname.split('/').filter(Boolean)
  const [profileName] = segments

  if (!profileName || segments.length !== 1 || reservedInstagramPaths.has(profileName))
    return { valid: false, reason: 'Open an Instagram profile page, not a post, reel, story, or feed page.' }

  const profile = parseInstagramProfile(url.toString())

  return {
    valid: true,
    profileUrl: profile.url,
    profileName: profile.name,
  }
}
