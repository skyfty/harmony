<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import type { SwitchControlNodeBehaviorParams } from '@schema/core'
import { STEER_TARGET_TYPES } from '@schema/components'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'

const props = defineProps<{
  modelValue: SwitchControlNodeBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SwitchControlNodeBehaviorParams): void
}>()

const sceneStore = useSceneStore()
const assetDialogVisible = ref(false)
const assetPickerAnchor = ref<{ x: number; y: number } | null>(null)

const params = computed<SwitchControlNodeBehaviorParams>(() => ({
  targetType: props.modelValue?.targetType ?? 'vehicle',
  prefabAssetId: props.modelValue?.prefabAssetId ?? null,
}))

const selectedPrefabAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.prefabAssetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const prefabAssetLabel = computed(() => selectedPrefabAsset.value?.name?.trim() || params.value.prefabAssetId || '')

function emitUpdate(patch: Partial<SwitchControlNodeBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function updateTargetType(value: unknown): void {
  const targetType = STEER_TARGET_TYPES.includes(value as typeof STEER_TARGET_TYPES[number])
    ? value as typeof STEER_TARGET_TYPES[number]
    : 'vehicle'
  emitUpdate({ targetType })
}

function openAssetPicker(event: MouseEvent) {
  assetPickerAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function handlePrefabSelected(asset: ProjectAsset | null) {
  assetDialogVisible.value = false
  emitUpdate({ prefabAssetId: asset?.id ?? null })
}

function clearPrefabAsset() {
  emitUpdate({ prefabAssetId: null })
}
</script>

<template>
  <div class="switch-control-node-params">
    <v-select
      label="Target Type"
      density="compact"
      variant="underlined"
      hide-details
      :items="STEER_TARGET_TYPES.map((value) => ({ title: value, value }))"
      :model-value="params.targetType"
      @update:model-value="updateTargetType"
    />

    <div class="switch-control-node-params__asset-row">
      <v-text-field
        :model-value="prefabAssetLabel"
        label="Fallback Prefab"
        density="compact"
        variant="underlined"
        hide-details
        readonly
        placeholder="Select a prefab asset"
        @click="openAssetPicker($event as MouseEvent)"
      />
      <v-btn
        size="small"
        variant="text"
        :disabled="!params.prefabAssetId"
        @click="clearPrefabAsset"
      >
        Clear
      </v-btn>
    </div>

    <AssetPickerDialog
      v-model="assetDialogVisible"
      :asset-id="params.prefabAssetId ?? ''"
      asset-type="prefab"
      :exact-type-match="true"
      title="Select Fallback Prefab"
      :anchor="assetPickerAnchor"
      @update:asset="handlePrefabSelected"
    />
  </div>
</template>

<style scoped>
.switch-control-node-params {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.switch-control-node-params__asset-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}
</style>
