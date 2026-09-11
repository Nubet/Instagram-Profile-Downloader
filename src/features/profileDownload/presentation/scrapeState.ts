import type { DownloadSession } from '../domain/profileDownload'

export interface ScrapeDebugEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  scope: 'session' | 'extractor' | 'downloads'
  message: string
  details?: string
}

export type ScrapePhase =
  | 'idle'
  | 'validating-tab'
  | 'starting'
  | 'scraping'
  | 'cooldown'
  | 'ready'
  | 'saving'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'paused'

export interface ScrapeProgress {
  sessionId: string | null
  profileName: string | null
  phase: ScrapePhase
  discoveredPostCount: number
  queuedFileCount: number
  downloadedFileCount: number
  message: string
}

const activePhases: ScrapePhase[] = ['starting', 'scraping', 'cooldown', 'saving', 'paused']

let nextDebugEntryId = 0

export function createIdleProgress(message = 'Ready to start.'): ScrapeProgress {
  return {
    sessionId: null,
    profileName: null,
    phase: 'idle',
    discoveredPostCount: 0,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message,
  }
}

export function createSessionProgress(session: DownloadSession, message = `Download started for @${session.profile.name}.`): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'starting',
    discoveredPostCount: 0,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message,
  }
}

export function getScrapeLoopProgress(session: DownloadSession, discoveredPostCount: number, phase: 'scraping' | 'cooldown', message: string): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase,
    discoveredPostCount,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message,
  }
}

export function getSavingProgress(session: DownloadSession, discoveredPostCount: number, queuedFileCount: number): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'saving',
    discoveredPostCount,
    queuedFileCount,
    downloadedFileCount: 0,
    message: `Saving ${queuedFileCount} file${queuedFileCount === 1 ? '' : 's'}.`,
  }
}

export function getReadyToDownloadProgress(session: DownloadSession, discoveredPostCount: number): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'ready',
    discoveredPostCount,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message: discoveredPostCount > 0
      ? `Fetched ${discoveredPostCount} post${discoveredPostCount === 1 ? '' : 's'}. Choose what to save.`
      : 'No posts found on the profile.',
  }
}

export function getSavedProgress(
  session: DownloadSession,
  discoveredPostCount: number,
  queuedFileCount: number,
  downloadedFileCount: number,
  warningMessage?: string,
): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'completed',
    discoveredPostCount,
    queuedFileCount,
    downloadedFileCount,
    message: warningMessage
      ? `Saved ${downloadedFileCount} of ${queuedFileCount} files. ${warningMessage}`
      : `Saved ${downloadedFileCount} of ${queuedFileCount} files.`,
  }
}

export function getStoppedScrapeProgress(session: DownloadSession, discoveredPostCount: number): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'stopped',
    discoveredPostCount,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message: `Stopped after ${discoveredPostCount} post${discoveredPostCount === 1 ? '' : 's'}.`,
  }
}

export function getCompletedScrapeProgress(session: DownloadSession, discoveredPostCount: number): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'completed',
    discoveredPostCount,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message: discoveredPostCount > 0
      ? `Found ${discoveredPostCount} post${discoveredPostCount === 1 ? '' : 's'} on the profile.`
      : 'No posts found on the profile.',
  }
}

export function getFailedScrapeProgress(session: DownloadSession, discoveredPostCount: number, message: string): ScrapeProgress {
  return {
    sessionId: session.id,
    profileName: session.profile.name,
    phase: 'failed',
    discoveredPostCount,
    queuedFileCount: 0,
    downloadedFileCount: 0,
    message,
  }
}

export function isActiveScrapePhase(phase: ScrapePhase): boolean {
  return activePhases.includes(phase)
}

export function createScrapeDebugEntry(
  level: ScrapeDebugEntry['level'],
  scope: ScrapeDebugEntry['scope'],
  message: string,
  details?: string,
): ScrapeDebugEntry {
  nextDebugEntryId += 1

  return {
    id: `debug-${nextDebugEntryId}`,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    details,
  }
}
