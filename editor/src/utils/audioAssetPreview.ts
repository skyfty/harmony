import { computed, ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

const activeAssetId = ref<string | null>(null)
const loadingAssetId = ref<string | null>(null)
const errorAssetId = ref<string | null>(null)
const errorMessage = ref<string | null>(null)

let activeAudio: HTMLAudioElement | null = null

function clearError() {
  errorAssetId.value = null
  errorMessage.value = null
}

function clearActiveAudio(resetTime = true) {
  if (!activeAudio) {
    activeAssetId.value = null
    return
  }
  activeAudio.pause()
  activeAudio.onended = null
  activeAudio.onerror = null
  if (resetTime) {
    activeAudio.currentTime = 0
  }
  activeAudio = null
  activeAssetId.value = null
}

async function resolveAudioPreviewUrl(asset: ProjectAsset): Promise<string | null> {
  const assetCacheStore = useAssetCacheStore()
  const entry = await assetCacheStore.ensureAssetEntry(asset.id, { asset })
  if (entry?.blobUrl) {
    return entry.blobUrl
  }
  const fallbackUrl = typeof asset.downloadUrl === 'string' ? asset.downloadUrl.trim() : ''
  return fallbackUrl.length ? fallbackUrl : null
}

export function isAudioAsset(asset: Pick<ProjectAsset, 'type'> | null | undefined): boolean {
  return asset?.type === 'audio'
}

export function useAudioAssetPreview() {
  const playingAssetId = computed(() => activeAssetId.value)
  const pendingAssetId = computed(() => loadingAssetId.value)
  const failedAssetId = computed(() => errorAssetId.value)
  const failedMessage = computed(() => errorMessage.value)

  async function toggleAssetPreview(asset: ProjectAsset): Promise<void> {
    if (!isAudioAsset(asset)) {
      return
    }

    clearError()
    if (activeAssetId.value === asset.id && activeAudio) {
      clearActiveAudio()
      return
    }

    loadingAssetId.value = asset.id
    try {
      const previewUrl = await resolveAudioPreviewUrl(asset)
      if (!previewUrl) {
        throw new Error('No playable audio source found')
      }

      clearActiveAudio(false)
      const audio = new Audio(previewUrl)
      audio.preload = 'auto'
      audio.onended = () => {
        if (activeAudio === audio) {
          clearActiveAudio()
        }
      }
      audio.onerror = () => {
        if (activeAudio === audio) {
          errorAssetId.value = asset.id
          errorMessage.value = 'Audio preview failed'
          clearActiveAudio(false)
        }
      }

      activeAudio = audio
      activeAssetId.value = asset.id
      await audio.play()
    } catch (error) {
      errorAssetId.value = asset.id
      errorMessage.value = (error as Error)?.message ?? 'Audio preview failed'
      clearActiveAudio(false)
      console.warn('Failed to preview audio asset', asset.id, error)
    } finally {
      if (loadingAssetId.value === asset.id) {
        loadingAssetId.value = null
      }
    }
  }

  function stopPreview(): void {
    clearError()
    loadingAssetId.value = null
    clearActiveAudio()
  }

  return {
    playingAssetId,
    pendingAssetId,
    failedAssetId,
    failedMessage,
    toggleAssetPreview,
    stopPreview,
  }
}