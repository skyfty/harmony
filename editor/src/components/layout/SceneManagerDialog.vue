<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useProjectsStore } from '@/stores/projectsStore'
import type { SceneSummary } from '@/types/scene-summary'

const props = defineProps<{
  modelValue: boolean
  scenes: SceneSummary[]
  currentSceneId: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', sceneId: string): void
  (event: 'delete', sceneId: string): void
  (event: 'rename', payload: { id: string; name: string }): void
  (event: 'request-new'): void
  (event: 'import-scenes'): void
  (event: 'export-scenes', sceneIds: string[]): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const deleteDialogOpen = ref(false)
const pendingDeleteId = ref<string | null>(null)
const pendingDeleteName = ref('')
const editingSceneId = ref<string | null>(null)
const editingSceneName = ref('')
const renameErrorMessage = ref('')
const renameFieldRef = ref<any>(null)
const selectedSceneId = ref<string | null>(null)
const selectedSceneIds = ref<string[]>([])
const projectsStore = useProjectsStore()
const projectDefaultSceneId = ref<string | null>(null)

const availableSceneIdSet = computed(() => new Set(props.scenes.map((scene) => scene.id)))
const sortedScenes = computed(() => {
  // Sort by creation time ascending (earliest created first)
  return [...props.scenes].sort((a, b) => {
    const ta = Number(new Date(a.createdAt)) || 0
    const tb = Number(new Date(b.createdAt)) || 0
    return ta - tb
  })
})

function normalizeSelection(ids: string[]): string[] {
  if (!ids.length) {
    return []
  }
  const set = availableSceneIdSet.value
  const seen = new Set<string>()
  const normalized: string[] = []
  ids.forEach((id) => {
    if (set.has(id) && !seen.has(id)) {
      normalized.push(id)
      seen.add(id)
    }
  })
  return normalized
}

function applySelection(ids: string[]) {
  if (!props.scenes.length) {
    selectedSceneIds.value = []
    selectedSceneId.value = null
    return
  }
  const normalized = normalizeSelection(ids)
  if (!normalized.length) {
    const fallback = props.currentSceneId ?? props.scenes[0]?.id ?? null
    selectedSceneIds.value = fallback ? [fallback] : []
    selectedSceneId.value = fallback
    return
  }
  selectedSceneIds.value = normalized
  selectedSceneId.value = normalized[normalized.length - 1] ?? null
}

watch(dialogOpen, (open) => {
  if (!open) {
    deleteDialogOpen.value = false
    cancelRename()
    selectedSceneId.value = null
    selectedSceneIds.value = []
  }
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      const initial = props.currentSceneId ?? sortedScenes.value[0]?.id ?? null
      applySelection(initial ? [initial] : [])
      // load current project's default scene id
      const activeProjectId = projectsStore.activeProjectId
      if (activeProjectId) {
        void projectsStore.loadProjectDocument(activeProjectId).then((doc) => {
          projectDefaultSceneId.value = doc?.lastEditedSceneId ?? null
        })
      } else {
        projectDefaultSceneId.value = null
      }
    }
  },
  { immediate: true },
)

watch(
  () => props.scenes,
  (scenes) => {
    if (!scenes.length) {
      selectedSceneId.value = null
      selectedSceneIds.value = []
      return
    }
    const nextSelection = normalizeSelection(selectedSceneIds.value)
    if (!nextSelection.length) {
      const fallback = props.currentSceneId ?? sortedScenes.value[0]?.id ?? null
      applySelection(fallback ? [fallback] : [])
      return
    }
    selectedSceneIds.value = nextSelection
    if (!selectedSceneId.value || !nextSelection.includes(selectedSceneId.value)) {
      selectedSceneId.value = nextSelection[nextSelection.length - 1] ?? null
    }
  },
  { deep: true },
)

function openCreateDialog() {
  emit('request-new')
}

function requestDelete(scene: SceneSummary) {
  pendingDeleteId.value = scene.id
  pendingDeleteName.value = scene.name
  deleteDialogOpen.value = true
}

function confirmDelete() {
  if (pendingDeleteId.value) {
    emit('delete', pendingDeleteId.value)
  }
  deleteDialogOpen.value = false
  pendingDeleteId.value = null
  pendingDeleteName.value = ''
}

function cancelDelete() {
  deleteDialogOpen.value = false
  pendingDeleteId.value = null
  pendingDeleteName.value = ''
}

function confirmSelection() {
  if (!selectedSceneId.value) return
  emit('select', selectedSceneId.value)
  emit('update:modelValue', false)
}

const hasScenes = computed(() => props.scenes.length > 0)

const selectedSceneIdsSet = computed(() => new Set(selectedSceneIds.value))

function handleListClick(sceneId: string, event: MouseEvent | KeyboardEvent) {
  cancelRename()
  const multi = event.ctrlKey || event.metaKey
  if (!multi) {
    applySelection([sceneId])
    return
  }
  const set = new Set(selectedSceneIds.value)
  if (set.has(sceneId)) {
    set.delete(sceneId)
  } else {
    set.add(sceneId)
  }
  const next = Array.from(set)
  if (!next.length) {
    applySelection([sceneId])
    return
  }
  applySelection(next)
}

function startRename(scene: SceneSummary) {
  // Multi-select: only allow renaming the current highlighted item.
  if (scene.id !== selectedSceneId.value) return
  editingSceneId.value = scene.id
  editingSceneName.value = scene.name
  renameErrorMessage.value = ''
  void nextTick(() => {
    try {
      const refVal: any = renameFieldRef.value
      if (refVal) {
        if (typeof refVal.focus === 'function') {
          refVal.focus()
        }
        // Try to find the native input element inside the Vuetify component
        const inputEl: HTMLInputElement | null =
          (refVal.$el && refVal.$el.querySelector && refVal.$el.querySelector('input')) ||
          (refVal.$refs && (refVal.$refs.input as HTMLInputElement)) ||
          null
        if (inputEl) {
          const len = inputEl.value ? inputEl.value.length : 0
          inputEl.setSelectionRange(len, len)
          inputEl.focus()
        }
      }
    } catch {
      // ignore focus failures
    }
  })
}

function cancelRename() {
  editingSceneId.value = null
  editingSceneName.value = ''
  renameErrorMessage.value = ''
}

function resolveUniqueSceneName(rawName: string, sceneId: string): string | null {
  const base = rawName.trim()
  if (!base) return null

  const existingNames = new Set(
    props.scenes
      .filter((scene) => scene.id !== sceneId)
      .map((scene) => scene.name.trim())
      .filter(Boolean),
  )

  if (!existingNames.has(base)) {
    return base
  }

  let suffix = 2
  while (existingNames.has(`${base} (${suffix})`)) {
    suffix += 1
  }
  return `${base} (${suffix})`
}

function commitRename(scene: SceneSummary) {
  if (editingSceneId.value !== scene.id) return

  const resolved = resolveUniqueSceneName(editingSceneName.value, scene.id)
  if (!resolved) {
    renameErrorMessage.value = 'Scene name is required.'
    void nextTick(() => {
      try {
        renameFieldRef.value?.focus?.()
      } catch {
        // ignore focus failures
      }
    })
    return
  }

  renameErrorMessage.value = ''

  // No-op rename: just exit edit mode.
  if (resolved === scene.name) {
    cancelRename()
    return
  }

  emit('rename', { id: scene.id, name: resolved })
  cancelRename()
}

async function setProjectDefaultScene(sceneId: string) {
  const projectId = projectsStore.activeProjectId
  if (!projectId) return
  try {
    await projectsStore.setLastEditedScene(projectId, sceneId)
    projectDefaultSceneId.value = sceneId
  } catch (err) {
    console.warn('[SceneManagerDialog] Failed to set default scene', err)
  }
}

const previewScene = computed(() => {
  if (!selectedSceneId.value) return null
  return props.scenes.find((scene) => scene.id === selectedSceneId.value) ?? null
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(value: string) {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return '—'
  }
  return dateFormatter.format(timestamp)
}

</script>

<template>
  <v-dialog v-model="dialogOpen" width="760" max-width="880">
    <v-card class="scene-manager-card" elevation="8">
      <v-card-title class="scene-manager-header">
        <span>Manage Scenes</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          color="primary"
          density="comfortable"
          @click="dialogOpen = false"
          aria-label="Close"
        />
      </v-card-title>
      <v-divider />
      <v-card-text class="scene-manager-body">
        <div class="scene-content" v-if="hasScenes">
          <div class="scene-list-panel">
            <div class="scene-list-scroll">
              <v-list class="scene-list" lines="one" density="comfortable">
              <v-list-item
                v-for="scene in sortedScenes"
                :key="scene.id"
                class="scene-list-item"
                :class="{
                  'is-active': scene.id === selectedSceneId,
                  'is-current': scene.id === currentSceneId,
                  'is-selected': selectedSceneIdsSet.has(scene.id),
                }"
                @click="handleListClick(scene.id, $event)"
              >
                <div class="scene-info">

                  <div class="scene-text">
                    <div style="display:flex;align-items:center;width:100%;gap:8px;">
                      <v-icon
                        class="default-toggle"
                        color="primary"
                        size="20"
                        @click.stop="setProjectDefaultScene(scene.id)"
                        :title="projectDefaultSceneId === scene.id ? '默认启动场景' : '设为默认启动场景'"
                      >
                        {{ projectDefaultSceneId === scene.id ? 'mdi-star' : 'mdi-star-outline' }}
                      </v-icon>
                      <div style="flex:1;min-width:0;">
                        <div v-if="editingSceneId !== scene.id" class="scene-name">{{ scene.name }}</div>
                        <v-text-field
                          v-else
                          ref="renameFieldRef"
                          v-model="editingSceneName"
                          class="scene-rename-field"
                          density="compact"
                          variant="underlined"
                          hide-details="auto"
                          :error-messages="renameErrorMessage"
                          @click.stop
                          @keydown.enter.prevent="commitRename(scene)"
                          @keydown.esc.prevent="cancelRename"
                          @blur="commitRename(scene)"
                        />
                        <div class="scene-meta">Updated {{ formatDateTime(scene.updatedAt) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <template #append>
                    <v-btn
                      class="rename-button"
                      icon="mdi-pencil-outline"
                      color="primary"
                      variant="text"
                      density="comfortable"
                      :disabled="scene.id !== selectedSceneId || editingSceneId === scene.id"
                      :title="scene.id === selectedSceneId ? 'Rename scene' : 'Select this scene to rename'"
                      @click.stop="startRename(scene)"
                    />
                    <v-btn
                      class="delete-button"
                      icon="mdi-delete-outline"
                      color="error"
                      variant="text"
                      density="comfortable"
                      @click.stop="requestDelete(scene)"
                    />
                </template>
              </v-list-item>
              </v-list>
            </div>
          </div>
          <!-- scene-preview-panel removed: list now takes the full dialog width -->
        </div>
        <template v-else>
          <div class="empty-state">
            <v-icon size="40" color="primary">mdi-folder-outline</v-icon>
            <p>No scenes yet. Click "New Scene" to create a new project.</p>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="scene-manager-actions">
        <div class="actions-left">
          <v-btn
            color="primary"
            variant="flat"
            density="comfortable"
            prepend-icon="mdi-plus"
            @click.stop="openCreateDialog"
          >
            New Scene
          </v-btn>
        </div>
        <v-spacer />
        <v-btn color="primary" variant="flat" :disabled="!previewScene" @click="confirmSelection">
          Open
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="deleteDialogOpen" max-width="380">
      <v-card>
        <v-card-title class="text-error">Delete Scene</v-card-title>
        <v-card-text>
            Are you sure you want to delete the scene "{{ pendingDeleteName }}"? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelDelete">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<style scoped>
.scene-manager-card {
  background: rgba(18, 21, 26, 0.96);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 460px;
}

.scene-manager-header {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.scene-manager-body {
  max-height: 520px;
  padding: 12px 0;
}

.scene-content {
  display: flex;
  gap: 8px;
  height: 100%;
}

.scene-list-panel {
  width: 100%;
  max-width: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.scene-list-scroll {
  flex: 1;
  min-height: 0;
  max-height: 500px;
  overflow-y: auto;
  padding-right: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(129, 212, 250, 0.5) transparent;
}

.scene-list-scroll::-webkit-scrollbar {
  width: 6px;
}

.scene-list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.scene-list-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(129, 212, 250, 0.35);
  border-radius: 999px;
}

.scene-list {
  background: transparent;
  flex: 1;
  min-height: 0;
  max-height: 100%;
  width: 100%;
}

.scene-list-item {
  border-radius: 10px;
  transition: background-color 0.18s ease, border-color 0.18s ease;
  border: 1px solid transparent;
  margin-bottom: 6px;
  display: flex;
  position: relative;
  padding-right: 104px;
  width: 100%;
  box-sizing: border-box;
}

.scene-list-item:last-of-type {
  margin-bottom: 0;
}

.scene-list-item:hover {
  background-color: rgba(77, 208, 225, 0.12);
  border-color: rgba(77, 208, 225, 0.3);
}

.scene-list-item.is-active {
  background-color: rgba(129, 212, 250, 0.14);
  border-color: rgba(129, 212, 250, 0.45);
}

.scene-list-item.is-selected:not(.is-active) {
  background-color: rgba(129, 212, 250, 0.08);
  border-color: rgba(129, 212, 250, 0.3);
}

.scene-list-item.is-current::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 8px;
  bottom: 8px;
  width: 4px;
  border-radius: 999px;
  background: rgba(129, 212, 250, 0.7);
}

.scene-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 4px;
  min-height: 48px;
}

.scene-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.scene-name {
  font-weight: 500;
  color: rgba(233, 236, 241, 0.94);
}

.scene-meta {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.6);
  letter-spacing: 0.01em;
}

.scene-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
}

.scene-info {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 36px;
}

.scene-name {
  font-weight: 500;
  color: rgba(233, 236, 241, 0.94);
}


.scene-manager-actions {
  padding-inline: 16px;
  padding-bottom: 12px;
  gap: 8px;
}

.actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-button {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.rename-button {
  position: absolute;
  right: 52px;
  top: 50%;
  transform: translateY(-50%);
}

.scene-rename-field {
  max-width: 420px;
}

.default-toggle {
  cursor: pointer;
  user-select: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
}

.empty-state {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: rgba(233, 236, 241, 0.72);
  text-align: center;
}
</style>
