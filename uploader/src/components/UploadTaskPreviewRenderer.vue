<template>
  <div>
    {task.preview.kind}
    <ModelPreview
      v-if="task.preview.kind === 'model'"
      :file="task.file"
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

interface Props {
  task: UploadTask
}

defineProps<Props>()
</script>
