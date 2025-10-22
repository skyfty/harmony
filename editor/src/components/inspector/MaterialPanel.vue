<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeMaterial } from '@/types/material'

const props = defineProps<{
  disabled?: boolean
  activeNodeMaterialId?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:active-node-material-id', id: string | null): void
  (event: 'open-details', id: string): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, materials } = storeToRefs(sceneStore)

const nodeMaterials = computed(() => selectedNode.value?.materials ?? [])
const internalActiveId = ref<string | null>(props.activeNodeMaterialId ?? null)
const deleteDialogVisible = ref(false)

watch(
  () => props.activeNodeMaterialId,
  (value) => {
    internalActiveId.value = value ?? null
  },
)

watch(
  nodeMaterials,
  (list) => {
    if (!list.length) {
      if (internalActiveId.value !== null) {
        internalActiveId.value = null
        emit('update:active-node-material-id', null)
      }
      return
    }
    if (internalActiveId.value && !list.some((entry) => entry.id === internalActiveId.value)) {
      internalActiveId.value = null
      emit('update:active-node-material-id', null)
    }
  },
  { immediate: true },
)

const canAddMaterialSlot = computed(() => !!selectedNodeId.value && !props.disabled)
const canDeleteMaterialSlot = computed(
  () => !!selectedNodeId.value && !!internalActiveId.value && !props.disabled,
)

const materialListEntries = computed(() =>
  nodeMaterials.value.map((entry, index) => {
    const shared = entry.materialId ? materials.value.find((item) => item.id === entry.materialId) ?? null : null
    return {
      id: entry.id,
      title: shared?.name ?? entry.name ?? `材质 ${index + 1}`,
      subtitle: shared ? '共享材质' : '本地材质',
      shared: Boolean(shared),
      index,
    }
  }),
)

function handleSelect(id: string) {
  internalActiveId.value = id
  emit('update:active-node-material-id', id)
  emit('open-details', id)
}

function handleAddMaterialSlot() {
  if (!canAddMaterialSlot.value || !selectedNodeId.value) {
    return
  }
  const created = sceneStore.addNodeMaterial(selectedNodeId.value) as SceneNodeMaterial | null
  if (!created) {
    return
  }
  internalActiveId.value = created.id
  emit('update:active-node-material-id', created.id)
  emit('open-details', created.id)
}

function handleRequestDeleteSlot() {
  if (!canDeleteMaterialSlot.value) {
    return
  }
  deleteDialogVisible.value = true
}

function handleCancelDeleteSlot() {
  deleteDialogVisible.value = false
}

async function handleConfirmDeleteSlot() {
  if (!selectedNodeId.value || !internalActiveId.value) {
    deleteDialogVisible.value = false
    return
  }
  const targetId = internalActiveId.value
  const removed = sceneStore.removeNodeMaterial(selectedNodeId.value, targetId)
  deleteDialogVisible.value = false
  if (!removed) {
    return
  }
  await nextTick()
  if (nodeMaterials.value.length) {
    const nextEntry = nodeMaterials.value[0]
    if (nextEntry) {
      handleSelect(nextEntry.id)
    }
  } else {
    internalActiveId.value = null
    emit('update:active-node-material-id', null)
  }
}
</script>

<template>
  <v-expansion-panel value="material">
    <v-expansion-panel-title class="material-panel-title">
      <span class="material-panel-title__label">Material</span>
      <div class="material-panel-title__actions">
        <v-btn
          icon="mdi-plus"
          size="small"
          variant="text"
          :disabled="!canAddMaterialSlot"
          @click.stop="handleAddMaterialSlot"
        />
        <v-btn
          icon="mdi-minus"
          size="small"
          variant="text"
          :disabled="!canDeleteMaterialSlot"
          @click.stop="handleRequestDeleteSlot"
        />
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="material-panel">
        <div class="material-panel__list">
          <v-list density="compact" nav class="material-list">
            <v-list-item
              v-for="entry in materialListEntries"
              :key="entry.id"
              :value="entry.id"
              :active="entry.id === internalActiveId"
              :class="{ 'is-active': entry.id === internalActiveId }"
              @click="handleSelect(entry.id)"
            >
              <v-list-item-title>{{ entry.title }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </div>

      </div>
      <v-dialog v-model="deleteDialogVisible" max-width="360">
        <v-card>
          <v-card-title class="text-h6">删除材质槽</v-card-title>
          <v-card-text>确认删除当前选中的材质项？此操作无法撤销。</v-card-text>
          <v-card-actions class="dialog-actions">
            <v-btn variant="text" @click="handleCancelDeleteSlot">取消</v-btn>
            <v-btn color="error" variant="tonal" @click="handleConfirmDeleteSlot">删除</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
  min-height: 100px;
}

.material-panel__list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.material-panel-title {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.material-panel-title__label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.82);
}

.material-panel-title__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.material-list {
  background: rgba(16, 20, 26, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  overflow: hidden;
}

.material-list :deep(.v-list-item.is-active) {
  background: rgba(90, 148, 255, 0.14);
}

.placeholder-title {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.88);
}

.placeholder-text {
  margin: 0;
}

.placeholder-hint {
  margin: 0;
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.55);
}

.v-list-item--density-compact.v-list-item--one-line {
  min-height: 0px;
}

.v-list-item {
    padding: 4px 4px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
