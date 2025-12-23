<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import type { SceneNodeComponentState } from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import {
  LOD_COMPONENT_TYPE,
  type LodComponentProps,
  clampLodComponentProps,
} from '@schema/components'

type ProjectAsset = ReturnType<typeof useSceneStore>['getAsset'] extends (id: string) => infer R ? R : never

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)

const lodComponent = computed(() => {
  const component = selectedNode.value?.components?.[LOD_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<LodComponentProps>
})

const isSyncingFromScene = ref(false)
const localEnableCulling = ref(true)
const localLevels = ref<LodComponentProps['levels']>([])

watch(
  lodComponent,
  (component) => {
    isSyncingFromScene.value = true
    const props = clampLodComponentProps(component?.props ?? null)
    localEnableCulling.value = props.enableCulling
    localLevels.value = props.levels.map((level) => ({ ...level }))
    nextTick(() => {
      isSyncingFromScene.value = false
    })
  },
  { immediate: true },
)

function serializeAssetDragPayload(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: string }
    if (parsed?.assetId) {
      return parsed.assetId
    }
  } catch (error) {
    console.warn('Unable to parse asset drag payload', error)
  }
  return null
}

function resolveDragAssetId(event: DragEvent): string | null {
  if (event.dataTransfer) {
    const payload = serializeAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      return payload
    }
  }
  return draggingAssetId.value ?? null
}

function applyPropsPatch(patch: Partial<LodComponentProps>) {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = lodComponent.value
  if (!nodeId || !component) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patch)
}

function updateEnableCulling(value: boolean) {
  localEnableCulling.value = value
  applyPropsPatch({ enableCulling: value })
}

function updateLevelDistance(index: number, raw: unknown) {
  if (isSyncingFromScene.value) {
    return
  }
  const next = localLevels.value.map((level) => ({ ...level }))
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || index < 0 || index >= next.length || !next[index]) {
    return
  }
  next[index].distance = Math.max(0, value)
  localLevels.value = next
  applyPropsPatch({ levels: next })
}

function assignModelAsset(index: number, assetId: string | null) {
  const next = localLevels.value.map((level) => ({ ...level }))
  if (index < 0 || index >= next.length || !next[index]) {
    return
  }
  next[index].modelAssetId = assetId
  localLevels.value = next
  applyPropsPatch({ levels: next })
}

function resolveAsset(assetId: string | null | undefined): ProjectAsset | null {
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId)
}

function handleDropModel(index: number, event: DragEvent) {
  event.preventDefault()
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return
  }
  const asset = sceneStore.getAsset(assetId)
  if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
    return
  }
  assignModelAsset(index, assetId)
}

async function handleSavePreset() {
  const node = selectedNode.value
  const component = lodComponent.value
  if (!node || !component) {
    return
  }
  const name = `${node.name ?? 'Node'} LOD`
  const props = clampLodComponentProps({
    enableCulling: localEnableCulling.value,
    levels: localLevels.value,
  })
  await sceneStore.saveLodPreset({ name, props, select: true })
}

async function handleDropPreset(event: DragEvent) {
  event.preventDefault()
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    return
  }
  try {
    await sceneStore.applyLodPresetToNode(nodeId, assetId)
  } catch (error) {
    console.warn('Failed to apply LOD preset', error)
  }
}

const levelSummaries = computed(() => {
  return localLevels.value.map((level, index) => {
    const model = resolveAsset(level.modelAssetId)
    return {
      index,
      distance: level.distance,
      modelLabel: model ? model.name : 'Default model',
    }
  })
})
</script>

<template>
  <v-expansion-panel value="lod">
    <v-expansion-panel-title>
      <div
        class="lod-panel-header"
        @dragenter.prevent
        @dragover.prevent
        @drop="handleDropPreset"
      >
        <span class="lod-panel-title">LOD</span>
        <v-spacer />
        <v-btn
          icon="mdi-content-save"
          size="small"
          variant="text"
          title="Save"
          @click.stop="handleSavePreset"
        />
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="lod-section">
        <div class="lod-row">
          <span class="lod-label">Frustum Culling</span>
          <v-switch
            density="compact"
            inset
            :model-value="localEnableCulling"
            @update:modelValue="(v) => updateEnableCulling(Boolean(v))"
          />
        </div>

        <div v-for="summary in levelSummaries" :key="summary.index" class="lod-level">
          <div class="lod-level-header">
            <div class="lod-level-title">LOD {{ summary.index }}</div>
            <div class="lod-level-meta">≥ {{ Math.round(summary.distance) }}m</div>
          </div>

          <v-text-field
            label="Distance (m)"
            type="number"
            density="compact"
            variant="outlined"
            :model-value="summary.distance"
            @update:modelValue="(v) => updateLevelDistance(summary.index, v)"
          />

          <div class="lod-asset-grid">
            <div
              class="lod-asset-drop"
              @dragenter.prevent
              @dragover.prevent
              @drop="(e) => handleDropModel(summary.index, e)"
            >
              <div class="lod-asset-title">Model</div>
              <div class="lod-asset-value">{{ summary.modelLabel }}</div>
              <v-btn
                v-if="localLevels[summary.index]?.modelAssetId"
                size="x-small"
                variant="text"
                @click="assignModelAsset(summary.index, null)"
              >
                Clear
              </v-btn>
            </div>
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.lod-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.lod-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.lod-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lod-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.lod-label {
  font-size: 0.85rem;
  opacity: 0.85;
}

.lod-level {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.75rem;
}

.lod-level-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.lod-level-title {
  font-weight: 600;
}

.lod-level-meta {
  font-size: 0.78rem;
  opacity: 0.75;
}

.lod-asset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.lod-asset-drop {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.6rem;
}

.lod-asset-title {
  font-size: 0.75rem;
  opacity: 0.75;
}

.lod-asset-value {
  font-size: 0.85rem;
  font-weight: 600;
  min-height: 1.1rem;
}
</style>
