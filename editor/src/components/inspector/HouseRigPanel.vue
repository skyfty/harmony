<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import MaterialAssetList, {
  type MaterialAssetListItem,
} from '@/components/inspector/MaterialAssetList.vue'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { MaterialDetailsTarget } from '@/types/material-details'
import {
  HOUSE_RIG_COMPONENT_TYPE,
  getLatestHouseRigScript,
  listHouseRigScripts,
  toHouseRigAssetDescriptor,
  type HouseRigComponentProps,
  type HouseRigDimensionKey,
  type HouseRigDimensions,
  type HouseRigPartBinding,
} from '@schema/houseRig'
import {
  clampHouseRigComponentProps,
  getHouseRigRuntimeSnapshot,
  subscribeHouseRigRuntime,
} from '@schema/components'
import { buildHouseRigPartMaterialViewMap } from '@/utils/houseRigMaterialRuntime'
import {
  cloneTextureSettings,
  createTextureSettings,
} from '@/types/material'

const panelProps = withDefaults(defineProps<{
  activeMaterialKey?: string | null
  disabled?: boolean
}>(), {
  activeMaterialKey: null,
  disabled: false,
})

const emit = defineEmits<{
  (event: 'update:activeMaterialKey', key: string | null): void
  (event: 'open-details', target: MaterialDetailsTarget): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const {
  selectedNode,
  selectedNodeId,
  sceneNodePropertyVersion,
} = storeToRefs(sceneStore)

const scriptOptions = listHouseRigScripts()
const scriptItems = scriptOptions.map((script) => ({
  ...script,
  title: `${script.label} (${script.version})`,
  value: `${script.id}@${script.version}`,
}))
let lastRefreshKey = ''
const activePartKey = computed<string | null>({
  get: () => panelProps.activeMaterialKey ?? null,
  set: (value) => emit('update:activeMaterialKey', value),
})
const runtimeRevision = ref(0)
let unsubscribeRuntimeSnapshot: (() => void) | null = null

watch(
  selectedNodeId,
  (nodeId) => {
    unsubscribeRuntimeSnapshot?.()
    unsubscribeRuntimeSnapshot = nodeId
      ? subscribeHouseRigRuntime(nodeId, () => {
          runtimeRevision.value += 1
        })
      : null
    runtimeRevision.value += 1
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unsubscribeRuntimeSnapshot?.()
})

const component = computed(() =>
  selectedNode.value?.components?.[HOUSE_RIG_COMPONENT_TYPE] as
    | { id: string; enabled: boolean; props: HouseRigComponentProps }
    | undefined,
)

const props = computed<HouseRigComponentProps | null>(() => {
  if (!component.value?.props) {
    return null
  }
  return clampHouseRigComponentProps(component.value.props, selectedNode.value)
})

const runtimeSnapshot = computed(() => {
  void runtimeRevision.value
  void sceneNodePropertyVersion.value
  const nodeId = selectedNodeId.value
  return nodeId ? getHouseRigRuntimeSnapshot(nodeId) : null
})

const partRows = computed<HouseRigPartBinding[]>(() => props.value?.parts ?? [])
const materialViews = computed(() => {
  void runtimeRevision.value
  void sceneNodePropertyVersion.value
  const nodeId = selectedNodeId.value
  const state = component.value
  if (!nodeId || !state) {
    return new Map()
  }
  return buildHouseRigPartMaterialViewMap(getRuntimeObject(nodeId), partRows.value)
})

const materialListItems = computed<MaterialAssetListItem[]>(() =>
  partRows.value.map((part) => {
    const view = materialViews.value.get(part.key)
    const material = view?.material
    const sourceAsset = material?.sourceMaterialAssetId
      ? sceneStore.getAsset(material.sourceMaterialAssetId)
      : null
    return {
      id: part.key,
      title: part.meshName || part.objectPath || part.key,
      subtitle: [
        view?.sourceLabel,
        part.role,
        part.side,
        part.layer,
      ].filter(Boolean).join(' · '),
      color: material?.color?.trim() || '#5f6672',
      thumbnail: material?.thumbnail ?? sourceAsset?.thumbnail ?? null,
    }
  }),
)

const currentScript = computed(() => {
  const state = props.value
  if (!state) {
    return null
  }
  return scriptOptions.find(
    (script) => script.id === state.scriptId && script.version === state.scriptVersion,
  ) ?? null
})

const selectedScriptValue = computed(() => {
  const state = props.value
  return state ? `${state.scriptId}@${state.scriptVersion}` : ''
})

const latestVersion = computed(() => {
  const state = props.value
  return state ? getLatestHouseRigScript(state.scriptId) : null
})

const canUpgradeScript = computed(() => Boolean(
  latestVersion.value
  && props.value
  && latestVersion.value.version !== props.value.scriptVersion,
))

const dimensionRows: Array<{
  key: HouseRigDimensionKey
  label: string
  axis: string
  color: string
}> = [
  { key: 'width', label: '宽度 Width', axis: 'X', color: '#ff5252' },
  { key: 'depth', label: '深度 Depth', axis: 'Z', color: '#448aff' },
  { key: 'wallHeight', label: '墙高 Wall Height', axis: 'Y', color: '#4caf50' },
]

const statusText = computed(() => {
  const snapshot = runtimeSnapshot.value
  if (!component.value) {
    return 'House Rig component is unavailable'
  }
  if (!snapshot) {
    return 'Waiting for the imported model runtime'
  }
  if (!snapshot.compatibility?.compatible) {
    return snapshot.compatibility?.issues[0] ?? 'Script is incompatible with this model'
  }
  return snapshot.warnings[0] ?? 'Rig is active and ready'
})

const statusSeverity = computed<'ready' | 'warning' | 'error'>(() => {
  const snapshot = runtimeSnapshot.value
  if (!snapshot) {
    return 'warning'
  }
  if (!snapshot.compatibility?.compatible) {
    return 'error'
  }
  return snapshot.warnings.length ? 'warning' : 'ready'
})

function scriptCompatibility(script: typeof scriptOptions[number]): {
  label: string
  color: string
} {
  const snapshot = runtimeSnapshot.value
  if (!snapshot) {
    return { label: '加载中', color: 'grey' }
  }
  const compatibility = script.getCompatibility(toHouseRigAssetDescriptor(snapshot.rest))
  if (!compatibility.compatible) {
    return { label: '不兼容', color: 'warning' }
  }
  return compatibility.issues.length
    ? { label: '可验证', color: 'info' }
    : { label: '兼容', color: 'success' }
}

function dimensionValue(key: HouseRigDimensionKey): number {
  const state = props.value
  if (!state) {
    return 0
  }
  const value = state.dimensions[key]
  if (value > 1e-4) {
    return value
  }
  return runtimeSnapshot.value?.rest.dimensions[key] ?? state.restDimensions[key] ?? 0
}

function dimensionLimit(
  key: HouseRigDimensionKey,
): { min: number; max: number | null; step: number } {
  const snapshot = runtimeSnapshot.value
  if (snapshot?.rest.limits?.[key]) {
    return snapshot.rest.limits[key]
  }
  const state = props.value
  const rest = state?.restDimensions?.[key] ?? 1
  return { min: rest * 0.35, max: null, step: 0.01 }
}

function updateDimension(key: HouseRigDimensionKey, value: number | string): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  if (!state || !selectedId || !Number.isFinite(Number(value))) {
    return
  }
  const limits = dimensionLimit(key)
  const aboveMinimum = Math.max(limits.min, Number(value))
  const nextValue = limits.max == null ? aboveMinimum : Math.min(limits.max, aboveMinimum)
  const nextDimensions: HouseRigDimensions = {
    ...props.value!.dimensions,
    [key]: nextValue,
  }
  sceneStore.updateNodeComponentProps(selectedId, state.id, { dimensions: nextDimensions })
}

function updateScript(scriptValue: string): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  const script = scriptOptions.find(
    (entry) => `${entry.id}@${entry.version}` === scriptValue,
  )
  if (!state || !selectedId || !script) {
    return
  }
  sceneStore.updateNodeComponentProps(selectedId, state.id, {
    scriptId: script.id,
    scriptVersion: script.version,
  })
}

function upgradeScript(): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  const latest = latestVersion.value
  if (!state || !selectedId || !latest) {
    return
  }
  sceneStore.updateNodeComponentProps(selectedId, state.id, {
    scriptId: latest.id,
    scriptVersion: latest.version,
  })
}

function resetDimensions(): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  if (!state || !selectedId) {
    return
  }
  sceneStore.updateNodeComponentProps(selectedId, state.id, {
    dimensions: { ...(runtimeSnapshot.value?.rest.dimensions ?? state.props.restDimensions) },
  })
}

function refreshBinding(): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  if (!state || !selectedId) {
    return
  }
  sceneStore.refreshHouseRigComponentBinding(selectedId, state.id)
}

function ensureMaterialAssetRegistered(asset: ProjectAsset): ProjectAsset {
  try {
    return sceneStore.ensureSceneAssetRegistered(asset, {
      source: asset.source ?? { type: 'url' },
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn('Failed to register selected House Rig material asset', asset.id, error)
    return asset
  }
}

function openPartDetails(partKey: string): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  if (!state || !selectedId) {
    return
  }
  activePartKey.value = partKey
  emit('open-details', {
    kind: 'houseRigPart',
    nodeId: selectedId,
    componentId: state.id,
    partKey,
  })
}

async function handleApplyAsset(payload: { id: string; asset: ProjectAsset | null }): Promise<void> {
  const state = component.value
  const selectedId = selectedNodeId.value
  const part = partRows.value.find((entry) => entry.key === payload.id)
  if (!state || !selectedId || !part) {
    return
  }
  if (!payload.asset) {
    if (sceneStore.clearHouseRigPartMaterial(selectedId, state.id, part.key)) {
      openPartDetails(part.key)
    }
    return
  }
  if (payload.asset.type === 'material') {
    const registered = ensureMaterialAssetRegistered(payload.asset)
    const applied = await sceneStore.applyMaterialAssetToHouseRigPart(
      selectedId,
      state.id,
      part.key,
      registered.id,
    )
    if (applied) {
      openPartDetails(part.key)
    }
    return
  }
  if (payload.asset.type === 'image' || payload.asset.type === 'texture') {
    const materialView = materialViews.value.get(part.key)
    const ref = {
      assetId: payload.asset.id,
      name: payload.asset.name,
      settings: materialView?.material.textures?.albedo?.settings
        ? cloneTextureSettings(materialView.material.textures.albedo.settings)
        : createTextureSettings(),
    }
    const applied = sceneStore.updateHouseRigPartMaterial(
      selectedId,
      state.id,
      part.key,
      {
        props: {
          textures: { albedo: ref },
          textureOverrides: ['albedo'],
        },
        seed: materialView?.material ?? null,
      },
    )
    if (applied) {
      void assetCacheStore.downloadProjectAsset(payload.asset).catch((error: unknown) => {
        console.warn('Failed to cache House Rig albedo texture', error)
      })
      openPartDetails(part.key)
    }
  }
}

function refreshLegacyBindingIfNeeded(): void {
  const state = component.value
  const selectedId = selectedNodeId.value
  if (!state || !selectedId) {
    return
  }
  const snapshot = runtimeSnapshot.value
  const normalized = props.value
  if (!snapshot || !normalized) {
    return
  }
  const needsRefresh =
    normalized.parts.length === 0
    || normalized.topologyHash !== snapshot.rest.topologyHash
    || normalized.assetId !== snapshot.rest.assetId
    || normalized.migratedFromPrototype === true
  const refreshKey = `${selectedId}:${state.id}:${snapshot.rest.topologyHash}:${normalized.parts.length}`
  if (needsRefresh && refreshKey !== lastRefreshKey) {
    lastRefreshKey = refreshKey
    sceneStore.refreshHouseRigComponentBinding(selectedId, state.id)
  }
}

watch(
  [
    selectedNodeId,
    () => component.value?.id,
    () => component.value?.props,
    () => sceneNodePropertyVersion.value,
    () => runtimeSnapshot.value?.rest.topologyHash,
  ],
  refreshLegacyBindingIfNeeded,
  { immediate: true },
)
</script>

<template>
  <v-expansion-panel v-if="component && props" value="houseRig">
    <v-expansion-panel-title>
      <v-icon size="18" color="primary" class="mr-2">mdi-home-edit-outline</v-icon>
      House Rig
      <v-spacer />
      <v-chip size="x-small" variant="tonal" :color="statusSeverity === 'ready' ? 'success' : statusSeverity">
        {{ statusSeverity === 'ready' ? 'Ready' : statusSeverity === 'warning' ? 'Check' : 'Invalid' }}
      </v-chip>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div class="house-rig-panel">
        <div class="section-row">
          <v-select
            :model-value="selectedScriptValue"
            :items="scriptItems"
            item-title="title"
            item-value="value"
            label="调整脚本"
            density="compact"
            variant="outlined"
            hide-details
            @update:modelValue="updateScript"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #append>
                  <v-chip
                    size="x-small"
                    variant="tonal"
                    :color="scriptCompatibility(item.raw).color"
                  >
                    {{ scriptCompatibility(item.raw).label }}
                  </v-chip>
                </template>
              </v-list-item>
            </template>
          </v-select>
          <v-btn
            v-if="canUpgradeScript"
            size="small"
            variant="tonal"
            color="primary"
            title="Upgrade to latest script version"
            @click="upgradeScript"
          >
            {{ latestVersion?.version }}
          </v-btn>
        </div>

        <div class="script-meta">
          <span>{{ props.scriptId }}@{{ props.scriptVersion }}</span>
          <span>{{ currentScript?.description ?? 'Unknown script version' }}</span>
        </div>

        <div class="status-line" :class="`is-${statusSeverity}`">
          <v-icon size="16">
            {{ statusSeverity === 'ready' ? 'mdi-check-circle' : statusSeverity === 'warning' ? 'mdi-alert-circle-outline' : 'mdi-close-circle' }}
          </v-icon>
          <span>{{ statusText }}</span>
        </div>

        <div class="dimensions">
          <div v-for="row in dimensionRows" :key="row.key" class="dimension-row">
            <div class="axis-chip" :style="{ color: row.color, borderColor: row.color }">
              {{ row.axis }}
            </div>
            <v-text-field
              :model-value="dimensionValue(row.key)"
              :label="row.label"
              :min="dimensionLimit(row.key).min"
              :max="dimensionLimit(row.key).max ?? undefined"
              :step="dimensionLimit(row.key).step"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              suffix="m"
              @change="updateDimension(row.key, $event)"
            />
          </div>
          <div class="dimension-actions">
            <v-btn size="small" variant="text" prepend-icon="mdi-restore" @click="resetDimensions">
              恢复尺寸
            </v-btn>
            <v-btn
              v-if="!partRows.length"
              size="small"
              variant="text"
              prepend-icon="mdi-refresh"
              @click="refreshBinding"
            >
              重新识别部件
            </v-btn>
          </div>
        </div>

        <v-divider />

        <div class="parts-heading">
          <span>部件材质</span>
          <span class="parts-count">{{ partRows.length }}</span>
        </div>

        <MaterialAssetList
          v-if="partRows.length"
          v-model="activePartKey"
          :items="materialListItems"
          :disabled="panelProps.disabled"
          @open-details="openPartDetails"
          @apply-asset="handleApplyAsset"
        />
        <div v-else class="empty-parts">
          模型加载完成后会自动识别子网格；也可以点击“重新识别部件”。
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.house-rig-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-row :deep(.v-input) {
  flex: 1;
}

.script-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
  color: rgba(233, 236, 241, 0.6);
  font-size: 0.72rem;
}

.status-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.35;
  background: rgba(255, 255, 255, 0.035);
}

.status-line.is-ready {
  color: #81c784;
}

.status-line.is-warning {
  color: #ffb74d;
}

.status-line.is-error {
  color: #ef9a9a;
}

.dimensions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dimension-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
}

.axis-chip {
  width: 24px;
  height: 24px;
  border: 1px solid;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  font-weight: 700;
}

.dimension-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.parts-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.parts-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 10px;
  text-align: center;
  color: rgba(233, 236, 241, 0.75);
  background: rgba(255, 255, 255, 0.07);
  font-size: 0.68rem;
}

.part-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.part-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 36px;
  align-items: center;
  gap: 8px;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.025);
  transition: border-color 120ms ease, background-color 120ms ease;
}

.part-row.is-drag-over {
  border-color: rgba(110, 231, 183, 0.8);
  background: rgba(110, 231, 183, 0.08);
}

.part-swatch {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.part-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.part-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 600;
}

.part-role,
.material-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(233, 236, 241, 0.58);
  font-size: 0.68rem;
}

.material-name {
  color: rgba(233, 236, 241, 0.78);
}

.empty-parts {
  padding: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: rgba(233, 236, 241, 0.6);
  font-size: 0.75rem;
  line-height: 1.45;
}
</style>
