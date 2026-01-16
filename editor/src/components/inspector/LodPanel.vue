<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import AssetDialog from '@/components/common/AssetDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneNodeComponentState } from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import { LOD_COMPONENT_TYPE, type LodComponentProps, clampLodComponentProps } from '@schema/components'

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode, selectedNodeId, draggingAssetId } = storeToRefs(sceneStore)


const lodComponent = computed(() => {
  const component = selectedNode.value?.components?.[LOD_COMPONENT_TYPE]
  if (!component) {
    return null
  }
  return component as SceneNodeComponentState<LodComponentProps>
})

const componentEnabled = computed(() => lodComponent.value?.enabled !== false)
function handleToggleComponent() {
  const component = lodComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = lodComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

const isSyncingFromScene = ref(false)
const localEnableCulling = ref(true)
const localLevels = ref<LodComponentProps['levels']>([])

const modelAssetDialogVisible = ref(false)
const modelAssetDialogSelectedId = ref('')
const modelAssetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const modelAssetDialogLevelIndex = ref<number | null>(null)
const isPreparingModelSelection = ref(false)

watch(
  lodComponent,
  (component) => {
    isSyncingFromScene.value = true
    try {
      if (!component) {
        localEnableCulling.value = true
        localLevels.value = []
        return
      }
      const props = clampLodComponentProps(component.props)
      localEnableCulling.value = props.enableCulling
      localLevels.value = props.levels.map((level) => ({ ...level }))
    } finally {
      nextTick(() => {
        isSyncingFromScene.value = false
      })
    }
  },
  { immediate: true, deep: true },
)

watch(modelAssetDialogVisible, (open) => {
  if (open) {
    return
  }
  modelAssetDialogAnchor.value = null
  modelAssetDialogSelectedId.value = ''
  modelAssetDialogLevelIndex.value = null
})

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

function resolveAsset(assetId?: string | null): ProjectAsset | null {
  if (!assetId) {
    return null
  }
  return sceneStore.getAsset(assetId) ?? null
}

function resolveAssetPreviewStyle(asset: ProjectAsset | null): Record<string, string> {
  if (!asset) {
    return {
      background:
        'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))',
    }
  }
  if (asset.thumbnail?.trim()) {
    return { backgroundImage: `url(${asset.thumbnail})` }
  }
  if (asset.previewColor) {
    return { backgroundColor: asset.previewColor }
  }
  return {
    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02))',
  }
}

function pushPropsToStore(): void {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const component = lodComponent.value
  if (!nodeId || !component) {
    return
  }
  const nextProps = clampLodComponentProps({
    enableCulling: localEnableCulling.value,
    levels: localLevels.value,
  })
  localEnableCulling.value = nextProps.enableCulling
  localLevels.value = nextProps.levels.map((level) => ({ ...level }))
  sceneStore.updateNodeComponentProps(nodeId, component.id, nextProps as unknown as Record<string, unknown>)
}

function updateEnableCulling(value: boolean): void {
  localEnableCulling.value = value
  pushPropsToStore()
}

function updateLevelDistance(levelIndex: number, value: unknown): void {
  const nextValue = Number(value)
  const distance = Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0
  const nextLevels = localLevels.value.map((level) => ({ ...level }))
  if (!nextLevels[levelIndex]) {
    return
  }
  nextLevels[levelIndex].distance = distance
  localLevels.value = nextLevels
  pushPropsToStore()
}

function handleDistanceKeydown(event: KeyboardEvent): void {
  if (event.key === '-') {
    event.preventDefault()
  }
}

function assignModelAsset(levelIndex: number, assetId: string | null | undefined): void {
  const nextLevels = localLevels.value.map((level) => ({ ...level }))
  if (!nextLevels[levelIndex]) {
    return
  }
  nextLevels[levelIndex].modelAssetId = assetId ?? null
  localLevels.value = nextLevels
  pushPropsToStore()
}

function openModelAssetDialog(levelIndex: number, event?: MouseEvent): void {
  modelAssetDialogLevelIndex.value = levelIndex
  modelAssetDialogSelectedId.value = localLevels.value[levelIndex]?.modelAssetId ?? ''
  modelAssetDialogAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  modelAssetDialogVisible.value = true
}

async function ensureModelAssetCached(asset: ProjectAsset): Promise<boolean> {
  if (!asset?.id) {
    return false
  }
  if (assetCacheStore.hasCache(asset.id)) {
    return true
  }

  try {
    await assetCacheStore.loadFromIndexedDb(asset.id)
  } catch (error) {
    console.warn('Failed to load asset from IndexedDB', asset.id, error)
  }

  if (assetCacheStore.hasCache(asset.id)) {
    return true
  }

  if (!asset.downloadUrl && !asset.description) {
    return false
  }

  await assetCacheStore.downloaProjectAsset(asset)
  return assetCacheStore.hasCache(asset.id)
}

async function handleModelAssetDialogUpdate(asset: ProjectAsset | null): Promise<void> {
  const index = modelAssetDialogLevelIndex.value
  if (index == null) {
    modelAssetDialogVisible.value = false
    return
  }
  if (!asset) {
    assignModelAsset(index, null)
    modelAssetDialogVisible.value = false
    return
  }
  if (asset.type !== 'model' && asset.type !== 'mesh') {
    console.warn('Selected asset is not a model/mesh')
    return
  }

  if (isPreparingModelSelection.value) {
    return
  }

  isPreparingModelSelection.value = true
  try {
    const cached = await ensureModelAssetCached(asset)
    if (!cached) {
      console.warn('Selected model asset is not cached and cannot be downloaded', asset.id)
      return
    }
    assignModelAsset(index, asset.id)
    modelAssetDialogVisible.value = false
  } catch (error) {
    console.warn('Failed to download selected model asset', asset.id, error)
  } finally {
    isPreparingModelSelection.value = false
  }
}

function handleModelAssetDialogCancel(): void {
  modelAssetDialogVisible.value = false
}

async function handleSavePreset(): Promise<void> {
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

async function handleDropPreset(event: DragEvent): Promise<void> {
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
      modelStyle: resolveAssetPreviewStyle(model),
      isDefaultModel: !level.modelAssetId,
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
        <v-menu
          v-if="lodComponent"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div class="lod-section" :class="{ 'is-disabled': !componentEnabled }">
        <div class="lod-row">
          <v-switch
            class="lod-frustum-switch"
            density="compact"
            hide-details
            :model-value="localEnableCulling"
            :disabled="!componentEnabled"
            @update:modelValue="(v) => updateEnableCulling(Boolean(v))"
          />
          <span class="lod-label">Frustum Culling</span>
        </div>

        <div v-for="summary in levelSummaries" :key="summary.index" class="lod-level">
          <div class="lod-level-header">
            <div class="lod-level-title">LOD {{ summary.index }}</div>
            <div class="lod-level-meta">≥ {{ Math.round(summary.distance) }}m</div>
          </div>

          <div class="lod-level-row">
            <div class="lod-model-wrap">
              <button
                type="button"
                class="lod-model-button"
                :title="summary.modelLabel"
                :disabled="!componentEnabled"
                @click="openModelAssetDialog(summary.index, $event)"
                @keydown.enter.prevent="openModelAssetDialog(summary.index)"
                @keydown.space.prevent="openModelAssetDialog(summary.index)"
              >
                <div
                  class="lod-model-thumb"
                  :class="{ 'lod-model-thumb--empty': summary.isDefaultModel }"
                  :style="summary.modelStyle"
                />
              </button>

              <v-btn
                v-if="!summary.isDefaultModel"
                class="lod-clear-button"
                icon="mdi-close"
                size="x-small"
                variant="text"
                title="Clear model override"
                :disabled="!componentEnabled"
                @click.stop="assignModelAsset(summary.index, null)"
              />
            </div>

            <div class="lod-distance-col">
              <div class="lod-model-name" :title="summary.modelLabel">{{ summary.modelLabel }}</div>
              <v-text-field
                class="lod-distance"
                label="Distance"
                type="number"
                density="compact"
                variant="underlined"
                suffix="m"
                :min="0"
                :model-value="summary.distance"
                :disabled="!componentEnabled"
                @keydown="handleDistanceKeydown"
                @update:modelValue="(v) => updateLevelDistance(summary.index, v)"
              />
            </div>
          </div>
        </div>
      </div>

      <AssetDialog
        v-model="modelAssetDialogVisible"
        v-model:assetId="modelAssetDialogSelectedId"
        assetType="model,mesh"
        title="Select Model Asset"
        :anchor="modelAssetDialogAnchor"
        :disabled="!componentEnabled"
        @update:asset="handleModelAssetDialogUpdate"
        @cancel="handleModelAssetDialogCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.lod-panel-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
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

.lod-frustum-switch {
  align-self: center;
}

.lod-row :deep(.v-input) {
  margin-top: 0;
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

.lod-level-row {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
}

.lod-model-wrap {
  position: relative;
  width: 60px;
  height: 60px;
  flex: 0 0 60px;
}

.lod-model-button {
  width: 60px;
  height: 60px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.lod-clear-button {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: unset;
}

.lod-model-button:focus-visible {
  outline: 2px solid rgba(110, 231, 183, 0.8);
  outline-offset: 2px;
}

.lod-model-thumb {
  width: 100%;
  height: 100%;
  border-radius: 7px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  aspect-ratio: 1 / 1;
}

.lod-model-thumb--empty {
  opacity: 0.75;
}

.lod-distance-col {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
}

.lod-model-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lod-distance {
  flex: 1;
}
</style>
