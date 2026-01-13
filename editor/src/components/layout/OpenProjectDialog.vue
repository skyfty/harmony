<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProjectSummary } from '@/types/project-summary'

const props = defineProps<{ modelValue: boolean; projects: ProjectSummary[] }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'open', payload: { projectId: string }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.projects
  return props.projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) query.value = ''
  },
  { immediate: true },
)

function handleOpen(id: string) {
  emit('open', { projectId: id })
  dialogOpen.value = false
}
</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="720">
    <v-card>
      <v-card-title class="text-h6">Open Project</v-card-title>
      <v-card-text>
        <v-text-field v-model="query" label="Search" variant="outlined" density="comfortable" clearable />
        <v-list class="mt-2" density="comfortable">
          <v-list-item v-for="p in filtered" :key="p.id" @click="handleOpen(p.id)">
            <v-list-item-title>{{ p.name }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ p.sceneCount }} scenes · {{ p.id }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn size="small" variant="text" @click.stop="handleOpen(p.id)">打开</v-btn>
            </template>
          </v-list-item>
          <v-list-item v-if="!filtered.length">
            <v-list-item-title>没有找到工程</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialogOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
