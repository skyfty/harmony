<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
</script>

<template>
  <v-expansion-panel title="Material">
    <v-expansion-panel-text>
      <div class="material-panel">
        <div class="material-panel__list">
          <div class="list-header">
            <span>材质槽</span>
            <v-btn
              icon="mdi-plus"
              size="small"
              variant="text"
              :disabled="!canAddMaterialSlot"
              @click="handleAddMaterialSlot"
            />
          </div>
          <v-list density="compact" nav class="material-list">
            <v-list-item
              v-for="entry in materialListEntries"
              :key="entry.id"
              :value="entry.id"
              :active="entry.id === internalActiveId"
              :class="{ 'is-active': entry.id === internalActiveId }"
              @click="handleSelect(entry.id)"
            >
              <template #prepend>
                <v-chip
                  size="x-small"
                  :color="entry.shared ? 'primary' : 'grey-darken-2'"
                  :variant="entry.shared ? 'elevated' : 'flat'"
                >
                  {{ entry.shared ? '共享' : '本地' }}
                </v-chip>
              </template>
              <v-list-item-title>{{ entry.title }}</v-list-item-title>
              <v-list-item-subtitle>槽位 {{ entry.index + 1 }} · {{ entry.subtitle }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </div>

        <div class="material-panel__placeholder">
          <div class="placeholder-title">材质详情</div>
          <p class="placeholder-text">点击左侧材质槽以在面板左侧查看并编辑详细属性。</p>
          <p class="placeholder-hint">可使用新增按钮创建材质槽。</p>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
  min-height: 220px;
}

.material-panel__list {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.76);
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

.material-panel__placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(12, 16, 22, 0.35);
  color: rgba(233, 236, 241, 0.72);
  font-size: 0.82rem;
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
</style>
