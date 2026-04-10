<template>
  <div class="lod-preview">
    <v-skeleton-loader
      v-if="previewState.loading"
      type="image"
      class="lod-preview__skeleton"
    />
    <ModelPreview
      v-else-if="previewState.file"
      ref="modelPreviewRef"
      :file="previewState.file"
      :background="background"
      class="lod-preview__renderer"
      @dimensions="(payload) => emit('dimensions', payload)"
    />
    <div v-else class="lod-preview__fallback">
      <v-icon size="40" color="white">mdi-cube-outline</v-icon>
      <div class="lod-preview__fallback-text">{{ previewState.error ?? '暂无预览' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import ModelPreview from '@/components/common/ModelPreview.vue'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useSceneStore } from '@/stores/sceneStore'
import { resolveLodPreviewModelFile } from '@/utils/lodPreview'

const props = defineProps<{
  asset: ProjectAsset
  background?: string
}>()

const emit = defineEmits<{
  (e: 'dimensions', payload: { length: number; width: number; height: number }): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const modelPreviewRef = ref<InstanceType<typeof ModelPreview> | null>(null)

const previewState = reactive({
  loading: false,
  file: null as File | null,
  error: null as string | null,
})

let loadToken = 0

async function preparePreview(): Promise<void> {
  const token = ++loadToken
  previewState.loading = true
  previewState.file = null
  previewState.error = null

  try {
    const resolved = await resolveLodPreviewModelFile(sceneStore, assetCacheStore, props.asset)
    if (token !== loadToken) {
      return
    }
    previewState.file = resolved.file
  } catch (error) {
    if (token !== loadToken) {
      return
    }
    previewState.error = (error as Error).message ?? 'LOD 预览失败'
  } finally {
    if (token === loadToken) {
      previewState.loading = false
    }
  }
}

watch(
  () => [props.asset.id, props.asset.name, props.asset.downloadUrl, props.asset.thumbnail],
  () => {
    void preparePreview()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadToken += 1
})

async function waitForPreviewReady(timeoutMs = 4000): Promise<boolean> {
  if (previewState.file && modelPreviewRef.value) {
    return true
  }
  if (typeof performance === 'undefined') {
    return Boolean(modelPreviewRef.value)
  }
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (previewState.file && modelPreviewRef.value) {
      return true
    }
  }
  return false
}

async function captureSnapshot(): Promise<HTMLCanvasElement | null> {
  const ready = await waitForPreviewReady()
  if (!ready) {
    return null
  }
  return (await modelPreviewRef.value?.captureSnapshot?.()) ?? null
}

defineExpose({
  captureSnapshot,
})
</script>

<style scoped>
.lod-preview {
  width: 100%;
  height: 100%;
}

.lod-preview__renderer,
.lod-preview__fallback,
.lod-preview__skeleton {
  width: 100%;
  height: 100%;
}

.lod-preview__fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(18, 22, 28, 0.9);
}

.lod-preview__fallback-text {
  font-size: 0.9rem;
  text-align: center;
}
</style>