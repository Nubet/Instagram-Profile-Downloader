<script setup lang="ts">
import { sendMessage } from 'webext-bridge/popup'
import PopupIcon from './PopupIcon.vue'
import PopupLogo from './PopupLogo.vue'
import { selectScrapedPosts } from '~/features/profileDownload/application/selectScrapedPosts'
import type { DownloadPostSelection } from '~/features/profileDownload/application/selectScrapedPosts'
import { extensionMessage } from '~/features/profileDownload/contracts/messages'
import { validateInstagramProfileUrl } from '~/features/profileDownload/domain/profileDownload'
import type { ScrapedPost } from '~/features/profileDownload/domain/profileDownload'
import {
  defaultProfileScrapeSettings,
  profileScrapeSettingsStorageKey,
  resolveProfileScrapeSettings,
} from '~/features/profileDownload/domain/scrapePolicy'
import type { ProfileScrapeSettings } from '~/features/profileDownload/domain/scrapePolicy'
import {
  createIdleProgress,
  isActiveScrapePhase,
} from '~/features/profileDownload/presentation/scrapeState'
import type { ScrapeDebugEntry, ScrapeProgress } from '~/features/profileDownload/presentation/scrapeState'

const progress = ref(createIdleProgress('Checking active tab.'))
const posts = ref<ScrapedPost[]>([])
const debugLog = ref<ScrapeDebugEntry[]>([])
const activeTabId = ref<number | null>(null)
const isBusy = ref(false)
const isSettingsOpen = ref(false)
const selectionMode = ref<'all' | 'range' | 'manual'>('all')
const rangeStart = ref('1')
const rangeEnd = ref('')
const manuallySelectedPostIds = ref<string[]>([])
const scrapeSettings = ref(createScrapeSettingsDraft())
let statusPollTimer: number | null = null

const hasActiveSession = computed(() => {
  return !!progress.value.sessionId && isActiveScrapePhase(progress.value.phase)
})

const hasFetchedPosts = computed(() => posts.value.length > 0)

const canShowSelectionPanel = computed(() => {
  return hasFetchedPosts.value && !hasActiveSession.value
})

const scrapeSettingsError = computed(() => getScrapeSettingsValidationError(scrapeSettings.value))

const actionLabel = computed(() => {
  if (isBusy.value)
    return hasActiveSession.value ? 'Stopping fetch...' : 'Fetching posts...'

  if (hasActiveSession.value)
    return 'Stop fetch'

  return hasFetchedPosts.value ? 'Fetch fresh snapshot' : 'Fetch all posts'
})

const hasProgressCounts = computed(() => {
  return progress.value.discoveredPostCount > 0 || progress.value.queuedFileCount > 0 || progress.value.downloadedFileCount > 0
})

const visibleDebugLog = computed(() => {
  return [...debugLog.value].reverse().slice(0, 12)
})

const manualSelectionSet = computed(() => new Set(manuallySelectedPostIds.value))

const rangeSelectionError = computed(() => {
  if (selectionMode.value !== 'range')
    return null

  const start = Number.parseInt(rangeStart.value, 10)
  const end = Number.parseInt(rangeEnd.value, 10)

  if (!Number.isInteger(start) || !Number.isInteger(end))
    return 'Enter whole numbers for the range.'

  if (start < 1 || end < 1)
    return 'Range starts at post 1.'

  if (start > end)
    return 'Range start cannot be greater than range end.'

  if (end > posts.value.length)
    return `This profile snapshot has ${posts.value.length} post${posts.value.length === 1 ? '' : 's'}.`

  return null
})

const activeSelection = computed<DownloadPostSelection>(() => {
  if (selectionMode.value === 'manual') {
    return {
      type: 'ids',
      postIds: [...manuallySelectedPostIds.value],
    }
  }

  if (selectionMode.value === 'range') {
    return {
      type: 'range',
      startIndex: Number.parseInt(rangeStart.value, 10),
      endIndex: Number.parseInt(rangeEnd.value, 10),
    }
  }

  return { type: 'all' }
})

const selectedPosts = computed(() => {
  if (selectionMode.value === 'range' && rangeSelectionError.value)
    return []

  return selectScrapedPosts(posts.value, activeSelection.value)
})

const selectedPostCount = computed(() => selectedPosts.value.length)

const downloadSelectionLabel = computed(() => {
  if (selectionMode.value === 'all')
    return 'Download all'

  return `Download ${selectedPostCount.value} post${selectedPostCount.value === 1 ? '' : 's'}`
})

const canDownloadSelection = computed(() => {
  if (isBusy.value || hasActiveSession.value || !progress.value.sessionId || !hasFetchedPosts.value)
    return false

  if (selectionMode.value === 'range' && !!rangeSelectionError.value)
    return false

  return selectedPostCount.value > 0
})

watch(() => posts.value.map(post => post.id).join(','), () => {
  resetSelectionState(posts.value)
})

async function refreshPopupState() {
  if (!hasActiveSession.value)
    isBusy.value = true

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    activeTabId.value = tab?.id ?? null

    const validation = validateInstagramProfileUrl(tab?.url)

    if (!tab?.id || !validation.valid) {
      progress.value = createIdleProgress(validation.reason)
      posts.value = []
      debugLog.value = []
      return
    }

    const response = await sendMessage(
      extensionMessage.getScrapeStatus,
      { tabId: tab.id },
      { context: 'content-script', tabId: tab.id },
    )

    applyScrapeState(response.progress, response.debugLog, response.posts, validation.profileName)
  }
  catch (error) {
    progress.value = {
      ...createIdleProgress(),
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Could not load the tab status.',
    }
    posts.value = []
    debugLog.value = []
  }
  finally {
    isBusy.value = false
  }
}

async function pollActiveSession() {
  if (!activeTabId.value || !hasActiveSession.value)
    return

  try {
    const response = await sendMessage(
      extensionMessage.getScrapeStatus,
      { tabId: activeTabId.value },
      { context: 'content-script', tabId: activeTabId.value },
    )

    applyScrapeState(response.progress, response.debugLog, response.posts, progress.value.profileName)
  }
  catch {
  }
}

async function handleAction() {
  if (!activeTabId.value) {
    progress.value = createIdleProgress('Open a public Instagram profile first.')
    posts.value = []
    debugLog.value = []
    return
  }

  if (hasActiveSession.value) {
    await stopProfileDownload(activeTabId.value, progress.value)
    return
  }

  await startProfileDownload(activeTabId.value)
}

async function startProfileDownload(tabId: number) {
  isBusy.value = true
  progress.value = {
    ...progress.value,
    phase: 'validating-tab',
    message: 'Fetching every post from the profile.',
  }

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const validation = validateInstagramProfileUrl(tab?.url)

    if (!tab?.id || tab.id !== tabId || !validation.valid) {
      progress.value = createIdleProgress(validation.valid ? 'Open a public Instagram profile first.' : validation.reason)
      posts.value = []
      debugLog.value = []
      return
    }

    const response = await sendMessage(
      extensionMessage.startProfileDownload,
      {
        profileUrl: validation.profileUrl,
        settings: createScrapeSettingsDraft(scrapeSettings.value),
      },
      { context: 'content-script', tabId },
    )

    applyScrapeState(response.progress, response.debugLog, response.posts, validation.profileName)
  }
  catch (error) {
    progress.value = {
      ...createIdleProgress(),
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Could not start the profile fetch.',
    }
    posts.value = []
    debugLog.value = []
  }
  finally {
    isBusy.value = false
  }
}

async function stopProfileDownload(tabId: number, currentProgress: ScrapeProgress) {
  if (!currentProgress.sessionId)
    return

  isBusy.value = true

  try {
    const response = await sendMessage(
      extensionMessage.stopProfileDownload,
      { sessionId: currentProgress.sessionId },
      { context: 'content-script', tabId },
    )

    applyScrapeState(response.progress, response.debugLog, response.posts, currentProgress.profileName)
  }
  catch (error) {
    progress.value = {
      ...currentProgress,
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Could not stop the content script.',
    }
  }
  finally {
    isBusy.value = false
  }
}

async function downloadSelectedPosts() {
  if (!activeTabId.value || !progress.value.sessionId || !canDownloadSelection.value)
    return

  isBusy.value = true
  const selection = toMessageSelection(activeSelection.value)

  try {
    const response = await sendMessage(
      extensionMessage.downloadSelectedPosts,
      {
        sessionId: progress.value.sessionId,
        selection,
      },
      { context: 'content-script', tabId: activeTabId.value },
    )

    applyScrapeState(response.progress, response.debugLog, response.posts, progress.value.profileName)
  }
  catch (error) {
    progress.value = {
      ...progress.value,
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Could not save the selected posts.',
    }
  }
  finally {
    isBusy.value = false
  }
}

function normalizeProgress(currentProgress: ScrapeProgress, profileName: string | null): ScrapeProgress {
  if (currentProgress.phase !== 'idle')
    return currentProgress

  return {
    ...currentProgress,
    profileName,
    message: profileName ? `Ready to fetch @${profileName}.` : 'Ready to start.',
  }
}

function applyScrapeState(currentProgress: ScrapeProgress, currentDebugLog: ScrapeDebugEntry[], currentPosts: ScrapedPost[], profileName: string | null) {
  progress.value = normalizeProgress(currentProgress, profileName)
  debugLog.value = currentDebugLog
  posts.value = currentPosts
}

function toMessageSelection(selection: DownloadPostSelection): DownloadPostSelection {
  switch (selection.type) {
    case 'all':
      return selection

    case 'range':
      return {
        type: 'range',
        startIndex: selection.startIndex,
        endIndex: selection.endIndex,
      }

    case 'ids':
      return {
        type: 'ids',
        postIds: [...selection.postIds],
      }
  }
}

function resetSelectionState(currentPosts: ScrapedPost[]) {
  selectionMode.value = 'all'
  rangeStart.value = currentPosts.length > 0 ? '1' : ''
  rangeEnd.value = currentPosts.length > 0 ? String(currentPosts.length) : ''
  manuallySelectedPostIds.value = []
}

function setSelectionMode(mode: 'all' | 'range' | 'manual') {
  selectionMode.value = mode

  if (mode === 'range' && posts.value.length > 0 && !rangeEnd.value) {
    rangeStart.value = '1'
    rangeEnd.value = String(posts.value.length)
  }

  if (mode === 'manual' && manuallySelectedPostIds.value.length === 0)
    manuallySelectedPostIds.value = posts.value.slice(0, Math.min(posts.value.length, 12)).map(post => post.id)
}

function toggleManualPost(postId: string) {
  manuallySelectedPostIds.value = manualSelectionSet.value.has(postId)
    ? manuallySelectedPostIds.value.filter(id => id !== postId)
    : [...manuallySelectedPostIds.value, postId]
}

function selectAllManualPosts() {
  manuallySelectedPostIds.value = posts.value.map(post => post.id)
}

function clearManualSelection() {
  manuallySelectedPostIds.value = []
}

function formatCaptionPreview(caption: string) {
  const normalized = caption.replace(/\s+/g, ' ').trim()

  if (!normalized)
    return 'No caption fetched.'

  return normalized.length > 88 ? `${normalized.slice(0, 85)}...` : normalized
}

function createScrapeSettingsDraft(settings: Partial<ProfileScrapeSettings> = defaultProfileScrapeSettings): ProfileScrapeSettings {
  const resolved = resolveProfileScrapeSettings(settings)

  return {
    scrollDelayRange: { ...resolved.scrollDelayRange },
    cooldownDelayRange: { ...resolved.cooldownDelayRange },
    cooldownBatchSize: resolved.cooldownBatchSize,
  }
}

async function loadScrapeSettings() {
  const storedSettings = await browser.storage.local.get(profileScrapeSettingsStorageKey)
  scrapeSettings.value = createScrapeSettingsDraft(storedSettings[profileScrapeSettingsStorageKey] as Partial<ProfileScrapeSettings> | undefined)
}

async function saveScrapeSettings() {
  if (scrapeSettingsError.value)
    return

  const normalizedSettings = createScrapeSettingsDraft(scrapeSettings.value)
  scrapeSettings.value = normalizedSettings
  await browser.storage.local.set({ [profileScrapeSettingsStorageKey]: normalizedSettings })
}

async function resetScrapeSettings() {
  scrapeSettings.value = createScrapeSettingsDraft()
  await saveScrapeSettings()
}

function getScrapeSettingsValidationError(settings: ProfileScrapeSettings): string | null {
  if (!isPositiveInteger(settings.cooldownBatchSize))
    return 'Cooldown batch size must be a whole number greater than 0.'

  if (!isPositiveInteger(settings.cooldownDelayRange.min) || !isPositiveInteger(settings.cooldownDelayRange.max))
    return 'Cooldown values must be whole numbers greater than 0.'

  if (settings.cooldownDelayRange.min > settings.cooldownDelayRange.max)
    return 'Cooldown min cannot be greater than cooldown max.'

  if (!isPositiveInteger(settings.scrollDelayRange.min) || !isPositiveInteger(settings.scrollDelayRange.max))
    return 'Scroll values must be whole numbers greater than 0.'

  if (settings.scrollDelayRange.min > settings.scrollDelayRange.max)
    return 'Scroll min cannot be greater than scroll max.'

  return null
}

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0
}

onMounted(async () => {
  await loadScrapeSettings()
  await refreshPopupState()

  statusPollTimer = window.setInterval(() => {
    void pollActiveSession()
  }, 2000)
})

onBeforeUnmount(() => {
  if (statusPollTimer !== null)
    window.clearInterval(statusPollTimer)
})
</script>

<template>
  <main class="w-[400px] bg-[#fbfbfd] text-[#1d1d1f] font-sans antialiased overflow-hidden select-none">
    <header class="px-5 py-4 flex items-center bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 shrink-0">
          <PopupLogo />
        </div>
        <h1 class="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">
          InstaBulk
        </h1>
      </div>

      <button
        class="ml-auto h-9 w-9 rounded-[11px] border border-[#e5e5ea] bg-white/80 text-[#86868b] transition-all hover:border-[#d1d1d6] hover:text-[#1d1d1f] hover:bg-white"
        :class="isSettingsOpen ? 'text-[#007aff] border-[#007aff]/20 bg-[#007aff]/[0.04]' : ''"
        aria-label="Toggle settings"
        @click="isSettingsOpen = !isSettingsOpen"
      >
        <PopupIcon name="settings" class="mx-auto block text-[16px]" />
      </button>

      <div class="absolute bottom-0 left-0 w-full h-[1px] bg-[#e5e5ea]">
        <div v-if="isBusy || hasActiveSession" class="h-full bg-[#007aff] w-full origin-left animate-progress" />
      </div>
    </header>

    <div class="p-5 space-y-5">
      <section v-if="isSettingsOpen" class="rounded-[16px] border border-[#e5e5ea] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)] space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
              Fetch Settings
            </h2>
            <p class="mt-1 text-[12px] leading-snug text-[#86868b]">
              Lower values speed up large profile fetches.
            </p>
          </div>
          <button class="text-[12px] font-semibold text-[#007aff] transition-opacity hover:opacity-80" @click="resetScrapeSettings">
            Reset
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#86868b]">Cooldown every posts</label>
            <input v-model.number="scrapeSettings.cooldownBatchSize" type="number" min="1" class="w-full rounded-[10px] border border-transparent bg-[#f2f2f7] px-3 py-2.5 text-[14px] font-medium text-[#1d1d1f] outline-none transition-all focus:border-[#007aff] focus:bg-white focus:ring-4 focus:ring-[#007aff]/10">
          </div>

          <div>
            <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#86868b]">Cooldown min ms</label>
            <input v-model.number="scrapeSettings.cooldownDelayRange.min" type="number" min="1" step="100" class="w-full rounded-[10px] border border-transparent bg-[#f2f2f7] px-3 py-2.5 text-[14px] font-medium text-[#1d1d1f] outline-none transition-all focus:border-[#007aff] focus:bg-white focus:ring-4 focus:ring-[#007aff]/10">
          </div>

          <div>
            <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#86868b]">Cooldown max ms</label>
            <input v-model.number="scrapeSettings.cooldownDelayRange.max" type="number" min="1" step="100" class="w-full rounded-[10px] border border-transparent bg-[#f2f2f7] px-3 py-2.5 text-[14px] font-medium text-[#1d1d1f] outline-none transition-all focus:border-[#007aff] focus:bg-white focus:ring-4 focus:ring-[#007aff]/10">
          </div>

          <div>
            <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#86868b]">Scroll min ms</label>
            <input v-model.number="scrapeSettings.scrollDelayRange.min" type="number" min="1" step="100" class="w-full rounded-[10px] border border-transparent bg-[#f2f2f7] px-3 py-2.5 text-[14px] font-medium text-[#1d1d1f] outline-none transition-all focus:border-[#007aff] focus:bg-white focus:ring-4 focus:ring-[#007aff]/10">
          </div>

          <div>
            <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#86868b]">Scroll max ms</label>
            <input v-model.number="scrapeSettings.scrollDelayRange.max" type="number" min="1" step="100" class="w-full rounded-[10px] border border-transparent bg-[#f2f2f7] px-3 py-2.5 text-[14px] font-medium text-[#1d1d1f] outline-none transition-all focus:border-[#007aff] focus:bg-white focus:ring-4 focus:ring-[#007aff]/10">
          </div>
        </div>

        <p class="text-[12px] leading-snug" :class="scrapeSettingsError ? 'text-[#ff3b30] font-medium' : 'text-[#86868b]'">
          {{ scrapeSettingsError ?? 'Settings are stored locally and used for the next fetch.' }}
        </p>

        <button class="btn w-full rounded-[12px] bg-[#1d1d1f] px-4 py-3 text-[14px] font-semibold text-white transition-all hover:bg-black disabled:cursor-not-allowed disabled:bg-[#c7c7cc]" :disabled="!!scrapeSettingsError" @click="saveScrapeSettings">
          Save Settings
        </button>
      </section>

      <section
        class="rounded-[16px] bg-white border p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)] relative overflow-hidden transition-all duration-300"
        :class="(isBusy || hasActiveSession) ? 'border-[#007aff]/30 shadow-[0_4px_12px_rgba(0,122,255,0.08)]' : 'border-[#e5e5ea]'"
      >
        <div v-if="isBusy || hasActiveSession" class="absolute inset-0 bg-gradient-to-r from-transparent via-[#007aff]/[0.03] to-transparent animate-shimmer" />

        <div class="relative">
          <div class="flex justify-between items-center mb-1.5">
            <h2
              class="text-[11px] font-semibold uppercase tracking-wider transition-colors duration-300"
              :class="(isBusy || hasActiveSession) ? 'text-[#007aff]' : 'text-[#86868b]'"
            >
              Status
            </h2>
            <div class="transition-opacity duration-300" :class="(isBusy || hasActiveSession) ? 'opacity-100' : 'opacity-0'">
              <PopupIcon name="loader" class="text-[14px] text-[#007aff]" />
            </div>
          </div>
          <p
            class="text-[14px] leading-relaxed transition-colors duration-300"
            :class="(isBusy || hasActiveSession) ? 'text-[#1d1d1f] font-medium' : 'text-[#1d1d1f]'"
          >
            {{ progress.message }}
          </p>

          <div v-if="hasProgressCounts" class="mt-4 pt-4 border-t border-[#f2f2f7] grid grid-cols-3 gap-2 divide-x divide-[#f2f2f7]">
            <div class="text-center">
              <p class="text-[22px] font-medium tracking-tight text-[#1d1d1f] transition-all duration-300" :class="hasActiveSession ? 'text-[#007aff]' : ''">
                {{ progress.discoveredPostCount }}
              </p>
              <p class="text-[10px] font-semibold text-[#86868b] uppercase tracking-widest mt-0.5">
                Found
              </p>
            </div>
            <div class="text-center">
              <p class="text-[22px] font-medium tracking-tight text-[#1d1d1f] transition-all duration-300" :class="hasActiveSession ? 'text-[#007aff]' : ''">
                {{ progress.queuedFileCount }}
              </p>
              <p class="text-[10px] font-semibold text-[#86868b] uppercase tracking-widest mt-0.5">
                Queued
              </p>
            </div>
            <div class="text-center">
              <p class="text-[22px] font-medium tracking-tight text-[#1d1d1f] transition-all duration-300" :class="hasActiveSession ? 'text-[#007aff]' : ''">
                {{ progress.downloadedFileCount }}
              </p>
              <p class="text-[10px] font-semibold text-[#86868b] uppercase tracking-widest mt-0.5">
                Saved
              </p>
            </div>
          </div>
        </div>
      </section>

      <button
        class="btn w-full rounded-[14px] px-4 py-3.5 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all duration-300"
        :class="hasActiveSession ? 'bg-[#fff0f0] text-[#ff3b30] hover:bg-[#ffe5e5] border border-[#ff3b30]/10 shadow-sm' : 'btn-primary'"
        :disabled="isBusy && !hasActiveSession"
        @click="handleAction"
      >
        <PopupIcon v-if="isBusy" name="loader" class="text-[18px]" />
        <PopupIcon v-else-if="hasActiveSession" name="stop" class="text-[14px]" />
        {{ actionLabel }}
      </button>

      <section v-if="canShowSelectionPanel" class="space-y-4">
        <div class="flex items-end justify-between px-1">
          <h2 class="text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
            Select Posts
          </h2>
          <span class="text-[13px] font-medium text-[#86868b]">{{ selectedPostCount }} selected</span>
        </div>

        <div class="flex p-[3px] bg-[#efeff4] rounded-[10px]">
          <button
            v-for="mode in ['all', 'range', 'manual']" :key="mode"
            class="flex-1 py-1.5 text-[13px] font-medium rounded-[7px] transition-all capitalize"
            :class="selectionMode === mode ? 'bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_1px_rgba(0,0,0,0.06)]' : 'text-[#86868b] hover:text-[#1d1d1f]'"
            @click="setSelectionMode(mode as any)"
          >
            {{ mode }}
          </button>
        </div>

        <div v-if="selectionMode === 'range'" class="rounded-[16px] bg-white border border-[#e5e5ea] p-4 shadow-[0_2px_8px_rgba(0,0,0,0.02)] space-y-3">
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <label class="block text-[11px] font-semibold text-[#86868b] uppercase tracking-wider mb-1.5">Start</label>
              <input v-model="rangeStart" type="number" min="1" :max="posts.length" class="w-full bg-[#f2f2f7] rounded-[10px] px-3 py-2.5 text-[15px] text-[#1d1d1f] font-medium border border-transparent focus:bg-white focus:border-[#007aff] focus:ring-4 focus:ring-[#007aff]/10 outline-none transition-all">
            </div>
            <div class="flex-1">
              <label class="block text-[11px] font-semibold text-[#86868b] uppercase tracking-wider mb-1.5">End</label>
              <input v-model="rangeEnd" type="number" min="1" :max="posts.length" class="w-full bg-[#f2f2f7] rounded-[10px] px-3 py-2.5 text-[15px] text-[#1d1d1f] font-medium border border-transparent focus:bg-white focus:border-[#007aff] focus:ring-4 focus:ring-[#007aff]/10 outline-none transition-all">
            </div>
          </div>
          <p class="text-[12px] leading-snug" :class="rangeSelectionError ? 'text-[#ff3b30] font-medium' : 'text-[#86868b]'">
            {{ rangeSelectionError ?? 'Use profile order. Post 1 is the newest visible post.' }}
          </p>
        </div>

        <div v-if="selectionMode === 'manual'" class="space-y-3">
          <div class="flex justify-between items-center px-1">
            <span class="text-[12px] font-medium text-[#86868b]">Select individual posts</span>
            <div class="flex gap-4">
              <button class="text-[13px] font-semibold text-[#007aff] hover:opacity-80 transition-opacity" @click="selectAllManualPosts">
                Select All
              </button>
              <button class="text-[13px] font-semibold text-[#007aff] hover:opacity-80 transition-opacity" @click="clearManualSelection">
                Clear
              </button>
            </div>
          </div>

          <div class="max-h-[280px] overflow-y-auto overflow-x-hidden custom-scrollbar bg-white rounded-[14px] border border-[#e5e5ea] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div class="divide-y divide-[#e5e5ea]">
              <button
                v-for="(post, index) in posts"
                :key="post.id"
                class="w-full flex items-center gap-3.5 p-3 transition-colors hover:bg-[#f2f2f7]/60 text-left group"
                @click="toggleManualPost(post.id)"
              >
                <div class="flex-shrink-0">
                  <div
                    class="w-[22px] h-[22px] rounded-full border transition-all flex items-center justify-center shadow-sm"
                    :class="manualSelectionSet.has(post.id) ? 'bg-[#007aff] border-[#007aff]' : 'border-[#c7c7cc] bg-white group-hover:border-[#a1a1a6]'"
                  >
                    <PopupIcon v-if="manualSelectionSet.has(post.id)" name="check" class="text-white text-[14px]" />
                  </div>
                </div>

                <div class="w-11 h-11 rounded-[6px] overflow-hidden flex-shrink-0 bg-[#f2f2f7] border border-black/5">
                  <img :src="post.imageUrl" class="w-full h-full object-cover">
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="text-[14px] font-medium text-[#1d1d1f]">Post {{ index + 1 }}</span>
                    <span class="text-[10px] font-medium text-[#86868b] font-mono tracking-tight">{{ post.id }}</span>
                  </div>
                  <p class="text-[12px] text-[#86868b] truncate mt-0.5">
                    {{ formatCaptionPreview(post.caption) }}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div class="flex gap-2.5 mt-2">
          <button
            v-if="selectionMode !== 'all'"
            class="btn rounded-[14px] px-4 py-3.5 text-[14px] font-semibold bg-[#f2f2f7] text-[#1d1d1f] hover:bg-[#e5e5ea] flex-shrink-0"
            :disabled="isBusy || hasActiveSession || !progress.sessionId || !hasFetchedPosts"
            @click="selectionMode = 'all'; downloadSelectedPosts()"
          >
            Download All
          </button>
          <button
            class="btn flex-1 rounded-[14px] px-4 py-3.5 text-[15px] font-semibold text-white bg-gradient-to-r from-[#fa7e1e] via-[#d62976] to-[#962fbf] shadow-[0_4px_14px_rgba(214,41,118,0.25)] hover:shadow-[0_6px_20px_rgba(214,41,118,0.35)] hover:-translate-y-[1px] flex justify-center items-center gap-2 relative overflow-hidden group"
            :disabled="!canDownloadSelection || isBusy"
            @click="downloadSelectedPosts"
          >
            <div v-if="isBusy" class="absolute inset-0 bg-white/20 animate-shimmer" />
            <PopupIcon v-if="isBusy" name="loader" class="relative z-10 text-[18px]" />
            <PopupIcon v-else name="download" class="relative z-10 text-[18px] transition-transform group-hover:-translate-y-[1px]" />
            <span class="relative z-10">{{ downloadSelectionLabel }}</span>
          </button>
        </div>
      </section>

      <details class="group mt-4 [&_summary::-webkit-details-marker]:hidden">
        <summary class="flex justify-between items-center cursor-pointer list-none text-[12px] font-semibold uppercase tracking-wider text-[#86868b] hover:text-[#1d1d1f] transition-colors py-2 px-1">
          <span>Session Log</span>
          <PopupIcon name="chevron-down" class="text-[16px] transform transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div class="mt-2 bg-[#f2f2f7] rounded-[12px] p-3 text-[11px] font-mono text-[#86868b] max-h-[160px] overflow-y-auto custom-scrollbar border border-black/5 shadow-inner">
          <p v-if="visibleDebugLog.length === 0" class="text-center py-4 text-[#a1a1a6]">
            No logs yet.
          </p>
          <div v-for="entry in visibleDebugLog" :key="entry.id" class="mb-2 last:mb-0">
            <span class="text-[#1d1d1f] font-semibold">[{{ entry.level }}]</span>
            <span class="ml-1">{{ entry.message }}</span>
          </div>
        </div>
      </details>
    </div>
  </main>
</template>
