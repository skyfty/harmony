<template>
  <div class="preview-renderer">
    <div v-if="task.preview.kind === 'model'" class="preview-renderer__model">
      <ModelPreview
        :file="task.file"
        :task-id="task.id"
        class="preview-renderer__model-canvas"
        @dimensions="onModelDimensions"
      />
    </div>
    <div v-else-if="task.preview.kind === 'image' && task.preview.url" class="preview-renderer__image">
      <v-img
        :src="task.preview.url"
        contain
        width="100%"
        height="100%"
        class="preview-renderer__image-content elevation-1"
      />
    </div>
    <div v-else-if="task.preview.kind === 'text' && task.preview.text" class="preview-renderer__text elevation-1">
      <pre class="preview-renderer__text-content">{{ task.preview.text }}</pre>
    </div>
    <div v-else class="preview-renderer__empty elevation-1">
      <v-icon size="40" color="primary">mdi-file-outline</v-icon>
      <div class="preview-renderer__empty-hint">该资源类型暂无预览，仍可上传</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ModelPreview from './ModelPreview.vue'
import type { UploadTask } from '@/stores/upload'
import { useUploadStore } from '@/stores/upload'
import { onMounted, watch } from 'vue'

interface Props {
  task: UploadTask
}

const props = defineProps<Props>()
const uploadStore = useUploadStore()

function onModelDimensions(payload: { length: number; width: number; height: number }): void {
  const { length, width, height } = payload
  uploadStore.updateModelDimensions(props.task.id, { length, width, height })
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

async function computeImageMetadata(url: string): Promise<void> {
  // Load image
  const img = new Image()
  img.src = url
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
  })
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height

  // Compute average color on a downscaled canvas for performance
  let color: string | undefined
  try {
    const maxDim = 64
    const scale = Math.min(1, maxDim / Math.max(width, height))
    const dw = Math.max(1, Math.round(width * scale))
    const dh = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(img, 0, 0, dw, dh)
      const data = ctx.getImageData(0, 0, dw, dh).data as Uint8ClampedArray
      let r = 0, g = 0, b = 0, count = 0
      for (let i = 0; i + 3 < data.length; i += 4) {
        const a = data[i + 3] ?? 0
        if (a === 0) continue
        r += data[i] ?? 0
        g += data[i + 1] ?? 0
        b += data[i + 2] ?? 0
        count += 1
      }
      if (count > 0) {
        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)
        color = rgbToHex(r, g, b)
      }
    }
  } catch (e) {
    // ignore color calculation errors
  }

  uploadStore.updateImageMetadata(props.task.id, { width, height, color })
}

function maybeExtractImageMeta(): void {
  if (props.task.preview.kind === 'image' && props.task.preview.url) {
    computeImageMetadata(props.task.preview.url).catch(() => {})
  }
}

onMounted(() => {
  maybeExtractImageMeta()
})

watch(
  () => props.task.preview,
  () => {
    maybeExtractImageMeta()
  },
  { deep: true },
)
</script>

<style scoped>
.preview-renderer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 320px;
  gap: 12px;
}

.preview-renderer__model,
.preview-renderer__image,
.preview-renderer__text,
.preview-renderer__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--v-theme-surface);
  overflow: hidden;
}

.preview-renderer__model {
  background: #1e1e1e;
}

.preview-renderer__model :deep(.model-preview) {
  width: 100%;
  height: 100%;
}

.preview-renderer__image-content {
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.preview-renderer__image-content :deep(img) {
  object-fit: contain;
  max-width: 100%;
  max-height: 100%;
}

.preview-renderer__text {
  padding: 16px;
  align-items: flex-start;
  justify-content: flex-start;
}

.preview-renderer__text-content {
  margin: 0;
  width: 100%;
  max-height: 100%;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.95rem;
  line-height: 1.5;
}

.preview-renderer__empty {
  flex-direction: column;
  text-align: center;
  color: rgba(0, 0, 0, 0.7);
  gap: 12px;
}

.preview-renderer__empty-hint {
  font-size: 0.95rem;
}
</style>
