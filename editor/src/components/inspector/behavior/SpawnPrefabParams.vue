<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import type { RuntimePrefabInitializationMode, RuntimePrefabPlacementAlignment, SpawnPrefabBehaviorParams, Vector3Like } from '@schema'
import { useSceneStore } from '@/stores/sceneStore'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import NodePicker from '@/components/common/NodePicker.vue'

const props = defineProps<{
  modelValue: SpawnPrefabBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: SpawnPrefabBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const pickerRef = ref<{ cancelPicking: () => void } | null>(null)
const assetDialogVisible = ref(false)
const assetPickerAnchor = ref<{ x: number; y: number } | null>(null)

const initializationModeItems: Array<{ title: string; value: RuntimePrefabInitializationMode }> = [
  { title: 'Full Runtime', value: 'full' },
  { title: 'Render Only', value: 'render-only' },
]

const placementAlignmentItems: Array<{ title: string; value: RuntimePrefabPlacementAlignment }> = [
  { title: 'Use Prefab Origin', value: 'origin' },
  { title: 'Place Bottom On Anchor', value: 'bottom-to-anchor' },
  { title: 'Place On Surface', value: 'place-on-surface' },
  { title: 'Place Center On Anchor', value: 'center-to-anchor' },
  { title: 'Custom Offset', value: 'custom-offset' },
]

function normalizeOffset(value: Vector3Like | null | undefined): Vector3Like | null {
  if (!value) {
    return null
  }
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  }
}

const params = computed<SpawnPrefabBehaviorParams>(() => ({
  assetId: props.modelValue?.assetId ?? null,
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  initializationMode: props.modelValue?.initializationMode === 'render-only' ? 'render-only' : 'full',
  placement: {
    alignment: props.modelValue?.placement?.alignment === 'bottom-to-anchor' || props.modelValue?.placement?.alignment === 'center-to-anchor' || props.modelValue?.placement?.alignment === 'place-on-surface' || props.modelValue?.placement?.alignment === 'custom-offset'
      ? props.modelValue.placement.alignment
      : 'origin',
    offset: normalizeOffset(props.modelValue?.placement?.offset),
  },
}))

const placementOffset = computed<Vector3Like>(() => params.value.placement.offset ?? { x: 0, y: 0, z: 0 })

const selectedAsset = computed<ProjectAsset | null>(() => {
  const assetId = params.value.assetId?.trim()
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
})

const assetLabel = computed(() => {
  const asset = selectedAsset.value
  if (asset?.name?.trim()) {
    return asset.name.trim()
  }
  return params.value.assetId ?? ''
})

function emitUpdate(patch: Partial<SpawnPrefabBehaviorParams>) {
  emit('update:modelValue', {
    ...params.value,
    ...patch,
  })
}

function handlePickStateChange(active: boolean) {
  emit('pick-state-change', active)
}

function updateTarget(nodeId: string | null) {
  emitUpdate({ targetNodeId: nodeId })
}

function updateInitializationMode(value: RuntimePrefabInitializationMode | null | undefined) {
  emitUpdate({ initializationMode: value === 'render-only' ? 'render-only' : 'full' })
}

function updatePlacementAlignment(value: RuntimePrefabPlacementAlignment | null | undefined) {
  const alignment: RuntimePrefabPlacementAlignment = value === 'bottom-to-anchor' || value === 'center-to-anchor' || value === 'place-on-surface' || value === 'custom-offset'
    ? value
    : 'origin'
  emitUpdate({
    placement: {
      ...params.value.placement,
      alignment,
    },
  })
}

function updatePlacementOffset(axis: 'x' | 'y' | 'z', value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value)
  emitUpdate({
    placement: {
      ...params.value.placement,
      offset: {
        ...placementOffset.value,
        [axis]: Number.isFinite(numeric) ? numeric : 0,
      },
    },
  })
}

function openAssetPicker(event: MouseEvent) {
  assetPickerAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function handleAssetSelected(asset: ProjectAsset | null) {
  assetDialogVisible.value = false
  emitUpdate({ assetId: asset?.id ?? null })
}

function clearAsset() {
  emitUpdate({ assetId: null })
}

function cancelPicking() {
  pickerRef.value?.cancelPicking()
}

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  cancelPicking()
})
</script>

<template>
  <div class="spawn-prefab-params">
    <div class="spawn-prefab-params__asset-row">
      <v-text-field
        :model-value="assetLabel"
        label="Prefab Asset"
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
        :disabled="!params.assetId"
        @click="clearAsset"
      >
        Clear
      </v-btn>
    </div>

    <NodePicker
      ref="pickerRef"
      :model-value="params.targetNodeId"
      pick-hint="Select the spawn anchor node"
      placeholder="Self node"
      selection-hint="Leave empty to use the behavior owner node as the spawn anchor."
      @update:modelValue="updateTarget"
      @pick-state-change="handlePickStateChange"
    />

    <v-select
      :model-value="params.initializationMode"
      :items="initializationModeItems"
      item-title="title"
      item-value="value"
      label="Initialization Mode"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updateInitializationMode($event as RuntimePrefabInitializationMode)"
    />

    <v-select
      :model-value="params.placement.alignment"
      :items="placementAlignmentItems"
      item-title="title"
      item-value="value"
      label="Placement Alignment"
      density="compact"
      variant="underlined"
      hide-details
      @update:model-value="updatePlacementAlignment($event as RuntimePrefabPlacementAlignment)"
    />

    <div class="spawn-prefab-params__offset-row">
      <v-text-field
        :model-value="placementOffset.x"
        label="Offset X"
        type="number"
        density="compact"
        variant="underlined"
        hide-details
        @update:model-value="updatePlacementOffset('x', $event)"
      />
      <v-text-field
        :model-value="placementOffset.y"
        label="Offset Y"
        type="number"
        density="compact"
        variant="underlined"
        hide-details
        @update:model-value="updatePlacementOffset('y', $event)"
      />
      <v-text-field
        :model-value="placementOffset.z"
        label="Offset Z"
        type="number"
        density="compact"
        variant="underlined"
        hide-details
        @update:model-value="updatePlacementOffset('z', $event)"
      />
    </div>

    <AssetPickerDialog
      v-model="assetDialogVisible"
      :asset-id="params.assetId ?? ''"
      asset-type="prefab"
      title="Select Prefab"
      :anchor="assetPickerAnchor"
      @update:asset="handleAssetSelected"
    />
  </div>
</template>

<style scoped>
.spawn-prefab-params {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.spawn-prefab-params__asset-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.spawn-prefab-params__offset-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
</style>
