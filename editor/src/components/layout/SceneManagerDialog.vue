<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

interface SceneSummaryItem {
  id: string
  name: string
  thumbnail?: string | null
  createdAt: string
  updatedAt: string
}

const props = defineProps<{
  modelValue: boolean
  scenes: SceneSummaryItem[]
  currentSceneId: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', sceneId: string): void
  (event: 'delete', sceneId: string): void
  (event: 'rename', payload: { id: string; name: string }): void
  (event: 'request-new'): void
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
const selectedSceneId = ref<string | null>(null)

watch(dialogOpen, (open) => {
  if (!open) {
    deleteDialogOpen.value = false
    editingSceneId.value = null
    selectedSceneId.value = null
  }
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      selectedSceneId.value = props.currentSceneId ?? props.scenes[0]?.id ?? null
    }
  },
  { immediate: true },
)

watch(
  () => props.scenes,
  (scenes) => {
    if (!scenes.length) {
      selectedSceneId.value = null
      return
    }
    if (!selectedSceneId.value || !scenes.some((scene) => scene.id === selectedSceneId.value)) {
      selectedSceneId.value = props.currentSceneId ?? scenes[0]?.id ?? null
    }
  },
  { deep: true },
)

function openCreateDialog() {
  emit('request-new')
}

function requestDelete(scene: SceneSummaryItem) {
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

function handleListSelect(sceneId: string) {
  editingSceneId.value = null
  selectedSceneId.value = sceneId
}

function confirmSelection() {
  if (!selectedSceneId.value) return
  emit('select', selectedSceneId.value)
  emit('update:modelValue', false)
}

function startRename(scene: SceneSummaryItem) {
  editingSceneId.value = scene.id
  editingSceneName.value = scene.name
  nextTick(() => {
    const input = document.getElementById(`scene-rename-${scene.id}`) as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}

function resetRenameState() {
  editingSceneId.value = null
  editingSceneName.value = ''
}

function commitRename() {
  if (!editingSceneId.value) return
  const target = props.scenes.find((scene) => scene.id === editingSceneId.value)
  if (!target) {
    resetRenameState()
    return
  }
  const trimmed = editingSceneName.value.trim()
  if (!trimmed.length) {
    editingSceneName.value = target.name
    resetRenameState()
    return
  }
  if (trimmed !== target.name) {
    emit('rename', { id: target.id, name: trimmed })
  }
  resetRenameState()
}

function handleRenameKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    const target = props.scenes.find((scene) => scene.id === editingSceneId.value)
    if (target) {
      editingSceneName.value = target.name
    }
    resetRenameState()
  }
}

const hasScenes = computed(() => props.scenes.length > 0)

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
  <v-dialog v-model="dialogOpen" width="880" max-width="960">
    <v-card class="scene-manager-card" elevation="8">
      <v-card-title class="scene-manager-header">
        <span>Manage Scenes</span>
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          density="comfortable"
          prepend-icon="mdi-plus"
          @click.stop="openCreateDialog"
        >
          New Scene
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="scene-manager-body">
        <div class="scene-content" v-if="hasScenes">
          <div class="scene-list-panel">
            <div class="scene-list-scroll">
              <v-list class="scene-list" lines="one" density="comfortable">
              <v-list-item
                v-for="scene in scenes"
                :key="scene.id"
                class="scene-list-item"
                :class="{
                  'is-active': scene.id === selectedSceneId,
                  'is-current': scene.id === currentSceneId,
                }"
                @click="handleListSelect(scene.id)"
              >
                <div class="scene-info" @dblclick.stop="startRename(scene)">
                  <div v-if="editingSceneId === scene.id" class="scene-name-edit">
                    <v-text-field
                      :id="`scene-rename-${scene.id}`"
                      v-model="editingSceneName"
                      variant="solo"
                      density="comfortable"
                      hide-details
                      single-line
                      autofocus
                      @keydown="handleRenameKeydown"
                      @blur="commitRename"
                    />
                  </div>
                  <div v-else class="scene-text">
                    <div class="scene-name">{{ scene.name }}</div>
                    <div class="scene-meta">Updated {{ formatDateTime(scene.updatedAt) }}</div>
                  </div>
                </div>
                <template #append>
                  <v-btn
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
          <div class="scene-preview-panel">
            <div v-if="previewScene" class="scene-preview-card">
              <div class="scene-preview-header">
                <span class="preview-title">{{ previewScene.name }}</span>
                <span v-if="previewScene.id === currentSceneId" class="preview-badge">当前</span>
              </div>
              <div class="scene-preview-meta">
                <div class="scene-preview-meta-label">Created</div>
                <div class="scene-preview-meta-value">{{ formatDateTime(previewScene.createdAt) }}</div>
                <div class="scene-preview-meta-label">Last updated</div>
                <div class="scene-preview-meta-value">{{ formatDateTime(previewScene.updatedAt) }}</div>
              </div>
              <div class="scene-preview-media">
                <v-img
                  v-if="previewScene.thumbnail"
                  :src="previewScene.thumbnail"
                  contain
                  class="scene-preview-image"
                />
                <div v-else class="scene-preview-placeholder">
                  <v-icon size="72">mdi-image-outline</v-icon>
                    <p>No thumbnail available</p>
                </div>
              </div>
            </div>
            <div v-else class="scene-preview-empty">
              <v-icon size="48">mdi-cube-outline</v-icon>
                <p>Please select a scene on the left to view its thumbnail.</p>
            </div>
          </div>
        </div>
        <template v-else>
          <div class="empty-state">
            <v-icon size="40" color="primary">mdi-folder-outline</v-icon>
            <p>No scenes yet. Click "New Scene" to create a new project.</p>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="scene-manager-actions">

        <v-spacer />
        <v-btn variant="text" color="primary" @click="dialogOpen = false">Close</v-btn>
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
  min-height: 540px;
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
  gap: 16px;
  height: 100%;
}

.scene-list-panel {
  width: 260px;
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
  padding-right: 4px;
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
}

.scene-list-item {
  border-radius: 10px;
  transition: background-color 0.18s ease, border-color 0.18s ease;
  border: 1px solid transparent;
  margin-bottom: 6px;
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

.scene-name-edit {
  width: 100%;
}

.scene-name-edit :deep(.v-field__input) {
  padding-block: 6px;
  font-weight: 500;
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

.scene-name-edit :deep(.v-field__input) {
  padding-block: 6px;
  font-weight: 500;
}

.scene-preview-panel {
  flex: 1;
  min-width: 0;
  background: rgba(15, 17, 22, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.scene-preview-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(520px, 100%);
  height: 420px;
  margin: 0 auto;
  flex: none;
}

.scene-preview-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  font-size: 0.85rem;
  color: rgba(233, 236, 241, 0.75);
}

.scene-preview-meta-label {
  opacity: 0.7;
}

.scene-preview-meta-value {
  font-weight: 500;
}

.scene-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.96);
}

.preview-badge {
  font-size: 0.75rem;
  color: rgba(129, 212, 250, 0.95);
  border: 1px solid rgba(129, 212, 250, 0.4);
  border-radius: 999px;
  padding: 2px 10px;
  letter-spacing: 0.06em;
}

.scene-preview-media {
  flex: 1;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-height: 100%;
  min-height: 0;
}

.scene-preview-media :deep(img) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.scene-preview-image {
  width: 100%;
  height: 100%;
}

.scene-preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(233, 236, 241, 0.68);
}

.scene-preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(233, 236, 241, 0.65);
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
