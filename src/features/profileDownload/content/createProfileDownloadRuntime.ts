import { sendMessage } from 'webext-bridge/content-script'
import { buildDownloadBatch } from '../application/buildDownloadBatch'
import { selectScrapedPosts } from '../application/selectScrapedPosts'
import { startDownloadSession } from '../application/startDownloadSession'
import { extensionMessage } from '../contracts/messages'
import {
  defaultProfileScrapeSettings,
  getRandomDelay,
  hasReachedProfileEnd,
  profileScrapePolicy,
  resolveProfileScrapeSettings,
  shouldApplyBatchCooldown,
} from '../domain/scrapePolicy'
import type { DownloadSession, ScrapedPost } from '../domain/profileDownload'
import type { ProfileScrapeSettings } from '../domain/scrapePolicy'
import { extractProfilePostsFromDocument } from '../infrastructure/extractProfilePostsFromDocument'
import { fetchInstagramPostDetails } from '../infrastructure/fetchInstagramPostDetails'
import {
  createIdleProgress,
  createScrapeDebugEntry,
  getCompletedScrapeProgress,
  getFailedScrapeProgress,
  getReadyToDownloadProgress,
  getSavedProgress,
  getSavingProgress,
  getScrapeLoopProgress,
  getStoppedScrapeProgress,
  isActiveScrapePhase,
} from '../presentation/scrapeState'
import type { ScrapeDebugEntry, ScrapeProgress } from '../presentation/scrapeState'
import type {
  DownloadSelectedPostsRequest,
  DownloadSelectedPostsResponse,
  GetScrapeStatusResponse,
  QueueDownloadBatchResponse,
  StartProfileDownloadRequest,
  StartProfileDownloadResponse,
  StopProfileDownloadRequest,
  StopProfileDownloadResponse,
} from '../contracts/messages'

export interface ProfileDownloadRuntime {
  getScrapeStatus: () => GetScrapeStatusResponse
  startProfileDownload: (request: StartProfileDownloadRequest) => Promise<StartProfileDownloadResponse>
  stopProfileDownload: (request: StopProfileDownloadRequest) => StopProfileDownloadResponse
  downloadSelectedPosts: (request: DownloadSelectedPostsRequest) => Promise<DownloadSelectedPostsResponse>
}

export function createProfileDownloadRuntime(): ProfileDownloadRuntime {
  let activeSession: DownloadSession | null = null
  let progress: ScrapeProgress = createIdleProgress('Open a public Instagram profile first.')
  let scrapedPosts: ScrapedPost[] = []
  let collectedPosts: ScrapedPost[] = []
  let seenPostIds = new Set<string>()
  let isStopRequested = false
  let lastCooldownPostCount = 0
  let activeRunId = 0
  let debugLog: ScrapeDebugEntry[] = []
  let activeSettings: ProfileScrapeSettings = defaultProfileScrapeSettings

  function getScrapeStatus(): GetScrapeStatusResponse {
    return { progress, debugLog, posts: collectedPosts }
  }

  async function startProfileDownload(request: StartProfileDownloadRequest): Promise<StartProfileDownloadResponse> {
    const response = startDownloadSession(activeSession, progress, request.profileUrl)

    activeSession = response.session
    progress = response.progress

    if (!response.accepted || !activeSession) {
      if (!response.accepted)
        addDebugLog('warn', 'session', 'Rejected start request because another session is already active.')

      return { ...response, debugLog, posts: collectedPosts }
    }

    activeRunId += 1
    const runId = activeRunId
    isStopRequested = false
    activeSettings = resolveProfileScrapeSettings(request.settings)
    seenPostIds = new Set()
    debugLog = []
    lastCooldownPostCount = 0
    scrapedPosts = []
    collectedPosts = []

    addDebugLog('info', 'session', `Started scrape session for @${activeSession.profile.name}.`, `url=${activeSession.profile.url}`)
    const foundInitialPosts = await scanVisiblePosts(activeSession, 'Initial DOM scan before scroll.')

    progress = getScrapeLoopProgress(
      activeSession,
      scrapedPosts.length,
      'scraping',
      foundInitialPosts
        ? `Found ${scrapedPosts.length} post${scrapedPosts.length === 1 ? '' : 's'}. Continuing scan.`
        : 'Scanning the profile grid.',
    )

    void runProfileScrape(activeSession, runId)

    return {
      ...response,
      debugLog,
      posts: collectedPosts,
      progress,
    }
  }

  function stopProfileDownload(request: StopProfileDownloadRequest): StopProfileDownloadResponse {
    const accepted = activeSession?.id === request.sessionId

    if (accepted)
      isStopRequested = true

    addDebugLog(
      accepted ? 'info' : 'warn',
      'session',
      accepted ? 'Stop requested for active session.' : 'Stop requested for a non-active session.',
      accepted ? `sessionId=${request.sessionId}` : undefined,
    )

    progress = accepted
      ? {
          ...progress,
          phase: 'stopped',
          message: 'Stopping download.',
        }
      : {
          ...progress,
          message: 'No matching session to stop.',
        }

    return {
      accepted,
      debugLog,
      posts: collectedPosts,
      progress,
    }
  }

  async function downloadSelectedPosts(request: DownloadSelectedPostsRequest): Promise<DownloadSelectedPostsResponse> {
    if (!activeSession || activeSession.id !== request.sessionId) {
      return {
        accepted: false,
        progress: {
          ...progress,
          message: 'Refresh the popup and fetch the profile again before saving posts.',
        },
        debugLog,
        posts: collectedPosts,
        queuedItemCount: 0,
        downloadedFileCount: 0,
        failure: null,
      }
    }

    if (isActiveScrapePhase(progress.phase)) {
      return {
        accepted: false,
        progress: {
          ...progress,
          message: 'Wait for the profile scan to finish before saving posts.',
        },
        debugLog,
        posts: collectedPosts,
        queuedItemCount: 0,
        downloadedFileCount: 0,
        failure: null,
      }
    }

    const selectedPosts = selectScrapedPosts(collectedPosts, request.selection)
    const batch = buildDownloadBatch(activeSession, selectedPosts)
    progress = getSavingProgress(activeSession, collectedPosts.length, batch.items.length)
    addDebugLog('info', 'downloads', 'Queued selected posts for saving.', `selectedPosts=${selectedPosts.length}, files=${batch.items.length}`)

    const response = await sendMessage(
      extensionMessage.queueDownloadBatch,
      { batch } as unknown as never,
      { context: 'background' } as never,
    ) as unknown as QueueDownloadBatchResponse

    if (response.failure)
      addDebugLog('warn', 'downloads', 'Selected download completed with a warning.', response.failure.message)
    else
      addDebugLog('info', 'downloads', 'Selected download finished successfully.', `downloadedFiles=${response.downloadedFileCount}`)

    progress = getSavedProgress(
      activeSession,
      collectedPosts.length,
      response.queuedItemCount,
      response.downloadedFileCount,
      response.failure?.message,
    )

    if (!response.failure && batch.items.length === 0)
      progress = getReadyToDownloadProgress(activeSession, collectedPosts.length)

    return {
      accepted: true,
      progress,
      debugLog,
      posts: collectedPosts,
      queuedItemCount: response.queuedItemCount,
      downloadedFileCount: response.downloadedFileCount,
      failure: response.failure,
    }
  }

  async function runProfileScrape(session: DownloadSession, runId: number) {
    let attemptsWithoutNewPosts = 0

    try {
      await waitForInitialProfileContent(session, runId)

      while (isCurrentRun(session.id, runId)) {
        if (isStopRequested)
          break

        if (hasReachedProfileEnd(attemptsWithoutNewPosts, profileScrapePolicy.maxAttemptsWithoutNewPosts)) {
          await finalizeScrapedPosts(session, runId)
          cleanupSession(session.id, runId)
          return
        }

        const scrollDelay = getRandomDelay(activeSettings.scrollDelayRange.min, activeSettings.scrollDelayRange.max)
        addDebugLog('info', 'session', 'Waiting before next scroll.', `delayMs=${scrollDelay}`)
        await wait(scrollDelay)

        if (!isCurrentRun(session.id, runId) || isStopRequested)
          break

        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
        addDebugLog('info', 'session', 'Scrolled to the current bottom of the profile page.', `scrollHeight=${document.documentElement.scrollHeight}`)
        await wait(profileScrapePolicy.postScrollSettleDelayMs)

        if (!isCurrentRun(session.id, runId) || isStopRequested)
          break

        if (await scanVisiblePosts(session, `Post-scroll scan ${attemptsWithoutNewPosts + 1}.`)) {
          attemptsWithoutNewPosts = 0
          progress = getScrapeLoopProgress(session, scrapedPosts.length, 'scraping', `Found ${scrapedPosts.length} post${scrapedPosts.length === 1 ? '' : 's'}. Continuing scan.`)
        }
        else {
          if (!profileScrapePolicy.enableEndOfProfileRetries) {
            addDebugLog('info', 'session', 'No new posts found and end-of-profile retries are disabled. Finalizing fetched posts.')
            await finalizeScrapedPosts(session, runId)
            cleanupSession(session.id, runId)
            return
          }

          attemptsWithoutNewPosts += 1
          progress = getScrapeLoopProgress(session, scrapedPosts.length, 'scraping', `No new posts found. Retry ${attemptsWithoutNewPosts}/${profileScrapePolicy.maxAttemptsWithoutNewPosts}.`)
        }

        if (shouldApplyBatchCooldown(scrapedPosts.length, lastCooldownPostCount, activeSettings.cooldownBatchSize)) {
          lastCooldownPostCount = scrapedPosts.length
          const cooldownDelay = getRandomDelay(activeSettings.cooldownDelayRange.min, activeSettings.cooldownDelayRange.max)
          progress = getScrapeLoopProgress(session, scrapedPosts.length, 'cooldown', `Cooling down after ${scrapedPosts.length} posts.`)
          addDebugLog('info', 'session', 'Applying cooldown after batch threshold.', `delayMs=${cooldownDelay}, posts=${scrapedPosts.length}`)
          await wait(cooldownDelay)
        }
      }

      if (isStopRequested) {
        addDebugLog('info', 'session', 'Stopped session before save phase.')
        progress = getStoppedScrapeProgress(session, scrapedPosts.length)
        cleanupSession(session.id, runId)
        return
      }

      if (isCurrentRun(session.id, runId))
        await finalizeScrapedPosts(session, runId)

      cleanupSession(session.id, runId)
    }
    catch (error) {
      addDebugLog('error', 'session', 'Scrape session failed.', error instanceof Error ? error.message : 'Unknown scrape error.')
      progress = getFailedScrapeProgress(session, scrapedPosts.length, error instanceof Error ? error.message : 'Profile scraping failed.')
      cleanupSession(session.id, runId)
    }
  }

  async function finalizeScrapedPosts(session: DownloadSession, runId: number) {
    scrapedPosts = await enrichPostsWithAuthoredCaptions(scrapedPosts, session, runId)

    if (!isCurrentRun(session.id, runId))
      return

    collectedPosts = scrapedPosts
    progress = getReadyToDownloadProgress(session, collectedPosts.length)
    addDebugLog('info', 'downloads', 'Fetched posts are ready for selection in the popup.', `posts=${collectedPosts.length}`)

    if (collectedPosts.length === 0)
      progress = getCompletedScrapeProgress(session, collectedPosts.length)
  }

  async function enrichPostsWithAuthoredCaptions(posts: ScrapedPost[], session: DownloadSession, runId: number): Promise<ScrapedPost[]> {
    if (posts.length === 0)
      return posts

    addDebugLog('info', 'extractor', `Fetching authored captions for ${posts.length} post${posts.length === 1 ? '' : 's'}.`)

    const enrichedPosts: ScrapedPost[] = []

    for (const post of posts) {
      if (!isCurrentRun(session.id, runId) || isStopRequested)
        return posts

      try {
        const details = await fetchInstagramPostDetails(post.id)
        const updatedMedia = details.media.length > 0 ? details.media : post.media

        enrichedPosts.push({ ...post, caption: details.caption, media: updatedMedia })
        addDebugLog(
          details.caption || details.media.length > 0 ? 'info' : 'warn',
          'extractor',
          details.caption || details.media.length > 0 ? `Details fetched for ${post.id}.` : `No details for ${post.id}.`,
        )
      }
      catch (error) {
        enrichedPosts.push({ ...post, caption: '' })
        addDebugLog('warn', 'extractor', `Details fetch failed for ${post.id}.`, error instanceof Error ? error.message : 'Unknown fetch error.')
      }

      await wait(profileScrapePolicy.captionRequestDelayMs)
    }

    return enrichedPosts
  }

  async function waitForInitialProfileContent(session: DownloadSession, runId: number) {
    for (let attempt = 1; attempt <= profileScrapePolicy.hydrationAttempts; attempt += 1) {
      if (!isCurrentRun(session.id, runId) || isStopRequested)
        return

      const foundNewPosts = await scanVisiblePosts(session, `Hydration scan ${attempt}/${profileScrapePolicy.hydrationAttempts} before scrolling.`)

      if (foundNewPosts || scrapedPosts.length > 0)
        return

      progress = getScrapeLoopProgress(session, scrapedPosts.length, 'scraping', 'Waiting for profile posts to render.')
      await wait(profileScrapePolicy.hydrationDelayMs)
    }

    addDebugLog('warn', 'extractor', 'Initial hydration scans did not find any visible profile posts.')
  }

  async function scanVisiblePosts(session: DownloadSession, reason: string) {
    const extraction = extractProfilePostsFromDocument(document, session.profile.name, seenPostIds)
    seenPostIds = extraction.seenPostIds

    addDebugLog(
      extraction.posts.length > 0 ? 'info' : 'warn',
      'extractor',
      reason,
      [
        `selector=${extraction.diagnostics.selector}`,
        `anchors=${extraction.diagnostics.anchorCount}`,
        `duplicates=${extraction.diagnostics.duplicatePostCount}`,
        `missingMedia=${extraction.diagnostics.missingMediaCount}`,
        `missingSource=${extraction.diagnostics.missingSourceCount}`,
        `newPosts=${extraction.diagnostics.addedPostCount}`,
        `anchorSamples=${extraction.diagnostics.sampleAnchorPaths.join(', ') || 'none'}`,
        `samples=${extraction.diagnostics.samplePostPaths.join(', ') || 'none'}`,
      ].join(' | '),
    )

    if (extraction.posts.length === 0)
      return false

    scrapedPosts = [...scrapedPosts, ...extraction.posts]
    progress = getScrapeLoopProgress(session, scrapedPosts.length, 'scraping', `Found ${scrapedPosts.length} post${scrapedPosts.length === 1 ? '' : 's'}. Continuing scan.`)
    return true
  }

  function isCurrentRun(sessionId: string, runId: number) {
    return activeSession?.id === sessionId && activeRunId === runId
  }

  function cleanupSession(sessionId: string, runId: number) {
    if (!isCurrentRun(sessionId, runId))
      return

    scrapedPosts = []
    seenPostIds = new Set()
    isStopRequested = false
    lastCooldownPostCount = 0
    activeSettings = defaultProfileScrapeSettings
  }

  function addDebugLog(level: ScrapeDebugEntry['level'], scope: ScrapeDebugEntry['scope'], message: string, details?: string) {
    debugLog = [...debugLog, createScrapeDebugEntry(level, scope, message, details)].slice(-profileScrapePolicy.debugLogLimit)
  }

  function wait(delayMs: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, delayMs))
  }

  return {
    getScrapeStatus,
    startProfileDownload,
    stopProfileDownload,
    downloadSelectedPosts,
  }
}
