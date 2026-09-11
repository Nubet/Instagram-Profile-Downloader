export interface DelayRange {
  min: number
  max: number
}

export interface ProfileScrapeSettings {
  scrollDelayRange: DelayRange
  cooldownDelayRange: DelayRange
  cooldownBatchSize: number
  downloadImages: boolean
  downloadVideos: boolean
  downloadCaptions: boolean
}

export const profileScrapePolicy = {
  scrollDelayRange: { min: 2000, max: 5500 },
  cooldownDelayRange: { min: 60000, max: 120000 },
  maxAttemptsWithoutNewPosts: 3,
  cooldownBatchSize: 30,
  hydrationAttempts: 5,
  hydrationDelayMs: 800,
  postScrollSettleDelayMs: 1200,
  captionRequestDelayMs: 300,
  debugLogLimit: 120,
  enableEndOfProfileRetries: false,
} as const

export const defaultProfileScrapeSettings: ProfileScrapeSettings = {
  scrollDelayRange: { ...profileScrapePolicy.scrollDelayRange },
  cooldownDelayRange: { ...profileScrapePolicy.cooldownDelayRange },
  cooldownBatchSize: profileScrapePolicy.cooldownBatchSize,
  downloadImages: true,
  downloadVideos: true,
  downloadCaptions: true,
}

export const profileScrapeSettingsStorageKey = 'profileScrapeSettings'

export function resolveProfileScrapeSettings(settings?: Partial<ProfileScrapeSettings>): ProfileScrapeSettings {
  const scrollMin = normalizePositiveInteger(settings?.scrollDelayRange?.min, defaultProfileScrapeSettings.scrollDelayRange.min)
  const scrollMax = normalizePositiveInteger(settings?.scrollDelayRange?.max, defaultProfileScrapeSettings.scrollDelayRange.max)
  const cooldownMin = normalizePositiveInteger(settings?.cooldownDelayRange?.min, defaultProfileScrapeSettings.cooldownDelayRange.min)
  const cooldownMax = normalizePositiveInteger(settings?.cooldownDelayRange?.max, defaultProfileScrapeSettings.cooldownDelayRange.max)

  return {
    scrollDelayRange: {
      min: Math.min(scrollMin, scrollMax),
      max: Math.max(scrollMin, scrollMax),
    },
    cooldownDelayRange: {
      min: Math.min(cooldownMin, cooldownMax),
      max: Math.max(cooldownMin, cooldownMax),
    },
    cooldownBatchSize: normalizePositiveInteger(settings?.cooldownBatchSize, defaultProfileScrapeSettings.cooldownBatchSize),
    downloadImages: settings?.downloadImages ?? defaultProfileScrapeSettings.downloadImages,
    downloadVideos: settings?.downloadVideos ?? defaultProfileScrapeSettings.downloadVideos,
    downloadCaptions: settings?.downloadCaptions ?? defaultProfileScrapeSettings.downloadCaptions,
  }
}

export function getRandomDelay(minMs: number, maxMs: number, random = Math.random): number {
  if (maxMs < minMs)
    throw new Error('maxMs must be greater than or equal to minMs.')

  const range = maxMs - minMs

  return minMs + Math.round(random() * range)
}

export function shouldApplyBatchCooldown(discoveredPostCount: number, previousCooldownPostCount: number, batchSize: number): boolean {
  if (batchSize <= 0)
    return false

  const currentBatchCount = Math.floor(discoveredPostCount / batchSize)
  const previousBatchCount = Math.floor(previousCooldownPostCount / batchSize)

  return currentBatchCount > previousBatchCount
}

export function hasReachedProfileEnd(attemptsWithoutNewPosts: number, maxAttemptsWithoutNewPosts: number): boolean {
  return attemptsWithoutNewPosts >= maxAttemptsWithoutNewPosts
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    return fallback

  return value
}
