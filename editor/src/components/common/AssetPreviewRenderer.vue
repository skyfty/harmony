<template>
  <div class="upload-preview">
    <div class="upload-preview__stage">
      <v-skeleton-loader
        v-if="previewState.loading"
        type="image"
        class="upload-preview__skeleton"
      />
      <ModelPreview
        v-else-if="showModelPreview"
        :file="previewState.file"
        class="upload-preview__renderer"
        @dimensions="(payload) => emit('dimensions', payload)"
      />
      <HDRPreview
        v-else-if="showHdrPreview"
        :file="previewState.file"
        :src="previewState.imageUrl"
        class="upload-preview__renderer"
      />
      <v-img
        v-else-if="previewState.imageUrl"
        :src="previewState.imageUrl"
        class="upload-preview__image"
        cover
      />
      <div
        v-else
        class="upload-preview__fallback"
        :style="{ backgroundColor: fallbackColor }"
      >
        <v-icon size="40" color="white">{{ fallbackIcon }}</v-icon>
        <div class="upload-preview__fallback-text">{{ previewState.error ?? '暂无预览' }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import ModelPreview from '@/components/common/ModelPreview.vue'
import HDRPreview from '@/components/common/HDRPreview.vue'

const props = defineProps<{
  asset: ProjectAsset
  primaryColor?: string | null
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
  (e: 'image-meta', payload: { width: number; height: number }): void
}>()

const assetCacheStore = useAssetCacheStore()

const previewState = reactive({
  loading: false,
  error: null as string | null,
  file: null as File | null,
  imageUrl: null as string | null,
})

const requiresFileTypes = new Set(['model', 'prefab', 'mesh', 'hdri'])
let objectUrl: string | null = null
let loadToken = 0
const metaProbes = new Set<HTMLImageElement>()

const showModelPreview = computed(() => Boolean(previewState.file) && ['model', 'prefab', 'mesh'].includes(props.asset.type))
const showHdrPreview = computed(() => Boolean(previewState.file) && props.asset.type === 'hdri')

const fallbackColor = computed(() => {
  const candidates = [props.primaryColor, props.asset.color, props.asset.previewColor]
  const color = candidates.find((value) => typeof value === 'string' && value.trim().length)
  return color ?? '#263238'
})

const fallbackIcon = computed(() => {
  switch (props.asset.type) {
    case 'model':
    case 'mesh':
    case 'prefab':
      return 'mdi-cube-outline'
    case 'image':
    case 'texture':
      return 'mdi-image-outline'
    case 'hdri':
      return 'mdi-weather-night'
    default:
      return 'mdi-file-outline'
  }
})

function cleanupObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

function resetPreviewState(): void {
  cleanupObjectUrl()
  previewState.file = null
  previewState.imageUrl = null
  previewState.error = null
}

async function ensureAssetFile(): Promise<File | null> {
  const asset = props.asset
  let file = assetCacheStore.createFileFromCache(asset.id)
  if (file) {
    return file
  }
  const restored = await assetCacheStore.loadFromIndexedDb(asset.id)
  if (restored) {
    file = assetCacheStore.createFileFromCache(asset.id)
    if (file) {
      return file
    }
  }
  try {
    await assetCacheStore.downloaProjectAsset(asset)
  } catch (error) {
    throw new Error((error as Error).message ?? '资源未缓存且无法下载')
  }
  file = assetCacheStore.createFileFromCache(asset.id)
  if (file) {
    return file
  }
  throw new Error('资源文件未缓存')
}

function probeImageMeta(url: string): void {
  const image = new Image()
  metaProbes.add(image)
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    if (props.asset.type === 'image' || props.asset.type === 'texture') {
      emit('image-meta', {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      })
    }
    metaProbes.delete(image)
  }
  image.onerror = () => {
    metaProbes.delete(image)
  }
  image.src = url
}

async function preparePreview(): Promise<void> {
  const token = ++loadToken
  resetPreviewState()
  const type = props.asset.type
  if (!type) {
    previewState.error = '未知资源类型'
    return
  }

  if (requiresFileTypes.has(type)) {
    previewState.loading = true
    try {
      const file = await ensureAssetFile()
      if (token !== loadToken) {
        return
      }
      previewState.file = file
      if (type === 'hdri' && file) {
        objectUrl = URL.createObjectURL(file)
        previewState.imageUrl = objectUrl
      }
    } catch (error) {
      previewState.error = (error as Error).message ?? '预览生成失败'
    } finally {
      if (token === loadToken) {
        previewState.loading = false
      }
    }
    return
  }

  const thumbnail = assetCacheStore.resolveAssetThumbnail({ asset: props.asset })
  if (thumbnail) {
    previewState.imageUrl = thumbnail
    probeImageMeta(thumbnail)
    return
  }

  try {
    const file = await ensureAssetFile()
    if (token !== loadToken) {
      return
    }
    if (file) {
      objectUrl = URL.createObjectURL(file)
      previewState.imageUrl = objectUrl
      probeImageMeta(objectUrl)
      return
    }
  } catch (error) {
    previewState.error = (error as Error).message ?? '预览生成失败'
    return
  }
  previewState.error = previewState.error ?? '暂无可用预览'
}

watch(
  () => [props.asset.id, props.asset.type, props.asset.thumbnail, props.asset.downloadUrl],
  () => {
    void preparePreview()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cleanupObjectUrl()
  metaProbes.forEach((img) => {
    img.onload = null
    img.onerror = null
  })
  metaProbes.clear()
})
</script>

<style scoped>
.upload-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.upload-preview__stage {
  flex: 1 1 auto;
  min-height: 320px;
  border-radius: 16px;
  background: rgba(18, 22, 28, 0.9);
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: stretch;
}

.upload-preview__renderer,
.upload-preview__image,
.upload-preview__fallback {
  width: 100%;
  height: 100%;
}

.upload-preview__image :deep(img) {
  object-fit: contain;
  background: rgba(0, 0, 0, 0.2);
}

.upload-preview__fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.upload-preview__fallback-text {
  font-size: 0.9rem;
  text-align: center;
}

.upload-preview__skeleton {
  width: 100%;
  height: 100%;
}

.upload-preview__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-preview__title {
  font-weight: 600;
  color: #e0e8f0;
}

.upload-preview__meta {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  gap: 4px;
}
</style>
