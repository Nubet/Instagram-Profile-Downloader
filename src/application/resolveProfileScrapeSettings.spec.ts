import { describe, expect, it } from 'vitest'
import {
  defaultProfileScrapeSettings,
  resolveProfileScrapeSettings,
} from '~/features/profileDownload/domain/scrapePolicy'

describe('resolveProfileScrapeSettings', () => {
  it('keeps valid custom settings', () => {
    expect(resolveProfileScrapeSettings({
      scrollDelayRange: { min: 500, max: 900 },
      cooldownDelayRange: { min: 3000, max: 7000 },
      cooldownBatchSize: 12,
    })).toEqual({
      scrollDelayRange: { min: 500, max: 900 },
      cooldownDelayRange: { min: 3000, max: 7000 },
      cooldownBatchSize: 12,
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(resolveProfileScrapeSettings({
      scrollDelayRange: { min: 0, max: Number.NaN },
      cooldownDelayRange: { min: -1, max: 0 },
      cooldownBatchSize: 0,
    })).toEqual(defaultProfileScrapeSettings)
  })

  it('normalizes reversed delay ranges', () => {
    expect(resolveProfileScrapeSettings({
      scrollDelayRange: { min: 1800, max: 600 },
      cooldownDelayRange: { min: 12000, max: 4000 },
      cooldownBatchSize: 20,
    })).toEqual({
      scrollDelayRange: { min: 600, max: 1800 },
      cooldownDelayRange: { min: 4000, max: 12000 },
      cooldownBatchSize: 20,
    })
  })
})
