<template>
  <div>
    <ModelPreview
      v-if="task.preview.kind === 'model'"
      :file="task.file"
      @dimensions="onModelDimensions"
    />
    <v-img
      v-else-if="task.preview.kind === 'image' && task.preview.url"
      :src="task.preview.url"
      aspect-ratio="1.6"
      cover
      class="rounded-lg elevation-1"
    />
    <v-sheet
      v-else-if="task.preview.kind === 'text' && task.preview.text"
      class="pa-4 rounded-lg elevation-1"
      color="surface"
    >
      <pre class="text-body-2 mb-0" style="white-space: pre-wrap">
        {{ task.preview.text }}
      </pre>
    </v-sheet>
    <v-sheet v-else class="pa-6 text-center rounded-lg" color="surface">
      <v-icon size="40" color="primary">mdi-file-outline</v-icon>
      <div class="mt-2 text-body-2">该资源类型暂无预览，仍可上传</div>
    </v-sheet>
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
