<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { LoadSceneBehaviorParams, Project, ProjectSceneMeta } from '@harmony/schema'
import { useProjectsStore } from '@/stores/projectsStore'
import ProjectSceneSelect from '@/components/common/ProjectSceneSelect.vue'

const props = defineProps<{
  modelValue: LoadSceneBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: LoadSceneBehaviorParams): void
}>()

const projectsStore = useProjectsStore()

const project = ref<Project | null>(null)
const loading = ref(false)

const params = computed<LoadSceneBehaviorParams>(() => ({
  scene: props.modelValue?.scene ?? '',
  pushToStack: props.modelValue?.pushToStack ?? true,
}))

const scenes = computed<ProjectSceneMeta[]>(() => project.value?.scenes ?? [])

const selectedScene = computed<ProjectSceneMeta | null>(() => {
  const id = params.value.scene
  if (!id) {
    return null
  }
  return scenes.value.find((scene) => scene.id === id) ?? null
})

const selectionLabel = computed(() => {
  if (selectedScene.value) {
    return selectedScene.value.name?.trim() || selectedScene.value.id
  }
  return params.value.scene || ''
})

const pickerOpen = ref(false)
const pickerAnchor = ref<{ x: number; y: number } | null>(null)

async function refreshProject() {
  const projectId = projectsStore.activeProjectId
  if (!projectId) {
    project.value = null
    return
  }
  loading.value = true
  try {
    project.value = await projectsStore.loadProjectDocument(projectId)
  } finally {
    loading.value = false
  }
}

function updateScene(sceneId: string) {
  emit('update:modelValue', {
    scene: sceneId,
    pushToStack: params.value.pushToStack,
  })
}

function updatePushToStack(pushToStack: boolean) {
  emit('update:modelValue', {
    scene: params.value.scene,
    pushToStack,
  })
}

function clearSelection() {
  updateScene('')
}

function openPicker(event: MouseEvent) {
  pickerAnchor.value = { x: event.clientX, y: event.clientY }
  pickerOpen.value = true
}

function handleSceneSelect(scene: ProjectSceneMeta) {
  updateScene(scene.id)
}

watch(
  () => [projectsStore.activeProjectId, projectsStore.workspaceRevision],
  () => {
    void refreshProject()
  },
  { immediate: true },
)

onMounted(() => {
  void refreshProject()
})
</script>

<template>
  <div class="load-scene-params">
    <div class="load-scene-params__row">
      <v-text-field
        :model-value="selectionLabel"
        label="Scene"
        density="compact"
        variant="underlined"
        hide-details
        readonly
        :loading="loading"
        placeholder="Select a scene"
        @click="openPicker($event)"
      />
      <v-btn
        class="load-scene-params__button"
        icon="mdi-folder-open-outline"
        size="small"
        variant="text"
        :disabled="!projectsStore.activeProjectId"
        @click="openPicker($event)"
      />
      <v-btn
        v-if="params.scene"
        class="load-scene-params__button"
        icon="mdi-close"
        size="small"
        variant="text"
        @click="clearSelection"
      />
    </div>

    <ProjectSceneSelect
      v-model="pickerOpen"
      :anchor="pickerAnchor"
      :scenes="scenes"
      :selected-scene-id="params.scene"
      title="选择场景"
      @select="handleSceneSelect"
    />

    <v-switch
      :model-value="params.pushToStack"
      label="入栈"
      density="compact"
      hide-details
      color="primary"
      @update:model-value="updatePushToStack(Boolean($event))"
    />

    <div v-if="!projectsStore.activeProjectId" class="load-scene-params__hint">
      需要先打开工程才能选择场景。
    </div>
  </div>
</template>

<style scoped>
.load-scene-params {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.load-scene-params__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.load-scene-params__button {
  margin-top: 6px;
}

.load-scene-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
