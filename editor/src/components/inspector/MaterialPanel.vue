<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import MaterialAssetList, {
  type MaterialAssetListItem,
} from '@/components/inspector/MaterialAssetList.vue'
import { resolveImportedModelMaterialSeed, useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  cloneTextureSettings,
  createTextureSettings,
  DEFAULT_SCENE_MATERIAL_TYPE,
  type SceneNodeMaterial,
} from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'
import { renderMaterialThumbnailDataUrl } from '@/utils/materialAsset'
import type { SceneMaterialType, SceneNode } from '@schema/core'
import { isLightweightImportNode } from '@schema/core'

type MaterialAsset = ProjectAsset & { type: 'material' }
type TextureAsset = ProjectAsset & { type: 'image' | 'texture' }

const props = defineProps<{
  disabled?: boolean
  activeNodeMaterialId?: string | null
}>()

const emit = defineEmits<{
  (event: 'update:active-node-material-id', id: string | null): void
  (event: 'open-details', id: string): void
  (event: 'close-details'): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const isLightweightNode = computed(() => isLightweightImportNode(selectedNode.value))
const isImportedModelOverrideNode = computed(() => Boolean(
  selectedNode.value
  && selectedNode.value.nodeType === 'Group'
  && typeof selectedNode.value.sourceAssetId === 'string'
  && selectedNode.value.sourceAssetId.trim().length > 0
  && !selectedNode.value.dynamicMesh,
))
/**
 * Expanded lightweight child nodes and whole-model import roots share the same
 * override rules: an empty material list means the node keeps rendering with
 * the material the asset itself carries.
 */
const isImportedModelMaterialNode = computed(() => isLightweightNode.value || isImportedModelOverrideNode.value)
const nodeMaterials = computed(() => selectedNode.value?.materials ?? [])
const inheritsMaterial = computed(() => isImportedModelMaterialNode.value && nodeMaterials.value.length === 0)

/**
 * Material type the model itself renders with. Unlit tiles (`MeshBasicMaterial`
 * from `KHR_materials_unlit`) turn dark when overridden with a lit material, so
 * the panel surfaces the inherited type explicitly.
 */
const inheritedMaterialTypeLabel = computed(() => {
  if (!inheritsMaterial.value) {
    return ''
  }
  const type = resolveImportedModelMaterialSeed(selectedNode.value)?.type ?? DEFAULT_SCENE_MATERIAL_TYPE
  if (type === 'MeshBasicMaterial') {
    return '（模型使用无光照材质 MeshBasicMaterial，覆盖成标准材质会依赖场景光照）'
  }
  return `（模型材质 ${type}）`
})

const inheritedOverrideLabel = computed(() => {
  if (!inheritsMaterial.value || !selectedNodeId.value) {
    return ''
  }
  let currentId: string | null = sceneStore.getParentNodeId(selectedNodeId.value)
  let guard = 0
  while (currentId && guard < 1024) {
    guard += 1
    const current: SceneNode | null = sceneStore.getNodeById(currentId)
    if (!current) {
      break
    }
    if (Array.isArray(current.materials) && current.materials.length) {
      return isLightweightImportNode(current)
        ? `父级子节点「${current.name}」的材质覆盖`
        : `根节点「${current.name}」的默认材质覆盖`
    }
    if (!isLightweightImportNode(current)) {
      break
    }
    currentId = sceneStore.getParentNodeId(current.id)
  }
  return '源模型自带材质'
})
void inheritedMaterialTypeLabel
void inheritedOverrideLabel
const internalActiveId = ref<string | null>(props.activeNodeMaterialId ?? null)
const materialPreviewThumbnails = ref<Record<string, string>>({})
const groundDefaultPreviewThumbnail = ref<string | null>(null)
let groundDefaultPreviewToken = 0

const DEFAULT_MATERIAL_COLOR = '#ffffff'
const MATERIAL_CREATE_OPTIONS: Array<{ value: SceneMaterialType; label: string; description: string }> = [
  { value: 'MeshStandardMaterial', label: '标准材质槽', description: 'PBR 标准材质' },
  { value: 'MeshPhongMaterial', label: 'Phong 材质槽', description: '高光材质' },
  { value: 'MeshBasicMaterial', label: '基础材质槽', description: '不受光照影响' },
  { value: 'MeshLambertMaterial', label: 'Lambert 材质槽', description: '漫反射材质' },
  { value: 'MeshMatcapMaterial', label: 'MatCap 材质槽', description: '基于材质球贴图' },
  { value: 'MeshToonMaterial', label: 'Toon 材质槽', description: '卡通着色材质' },
  { value: 'MeshPhysicalMaterial', label: 'Physical 材质槽', description: '更完整的物理材质' },
  { value: 'MeshNormalMaterial', label: '法线材质槽', description: '按法线显示颜色' },
]
const GROUND_DEFAULT_MATERIAL_PROPS = {
  color: '#707070',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.1,
  roughness: 0.8,
  emissive: '#000000',
  emissiveIntensity: 0,
  aoStrength: 1,
  envMapIntensity: 1,
  textures: {
    albedo: null,
    normal: null,
    metalness: null,
    roughness: null,
    ao: null,
    emissive: null,
    displacement: null,
  },
} as const

watch(
  () => props.activeNodeMaterialId,
  (value: string | null | undefined) => {
    internalActiveId.value = value ?? null
  },
)

const canAddMaterialSlot = computed(() =>
  !!selectedNodeId.value
  && !props.disabled
  // Expanded lightweight import children remain single-override nodes; whole
  // imported-model roots may add slots to define device-specific alternatives.
  && (!isLightweightNode.value || nodeMaterials.value.length === 0),
)
const canDeleteMaterialSlot = computed(() => !!selectedNodeId.value && !!internalActiveId.value && !props.disabled)

watch(
  nodeMaterials,
  (list: SceneNodeMaterial[]) => {
    if (!list.length) {
      if (internalActiveId.value !== null) {
        internalActiveId.value = null
        emit('update:active-node-material-id', null)
        emit('close-details')
      }
      return
    }
    if (internalActiveId.value && !list.some((entry) => entry.id === internalActiveId.value)) {
      internalActiveId.value = null
      emit('update:active-node-material-id', null)
      emit('close-details')
    }
    const activeIds = new Set(list.map((entry) => entry.id))
    const nextThumbnails: Record<string, string> = {}
    ;(Object.entries(materialPreviewThumbnails.value) as Array<[string, string]>).forEach(([slotId, thumbnail]) => {
      if (activeIds.has(slotId)) {
        nextThumbnails[slotId] = thumbnail
      }
    })
    materialPreviewThumbnails.value = nextThumbnails
  },
  { immediate: true },
)

watch(
  () => selectedNode.value?.dynamicMesh?.type,
  (type) => {
    if (type !== 'Ground') {
      groundDefaultPreviewThumbnail.value = null
      return
    }
    const token = ++groundDefaultPreviewToken
    void (async () => {
      const thumbnail = await renderMaterialThumbnailDataUrl({
        material: {
          name: 'Ground Material',
          type: 'MeshStandardMaterial',
          ...GROUND_DEFAULT_MATERIAL_PROPS,
        },
        width: 50,
        height: 50,
      })
      if (token === groundDefaultPreviewToken) {
        groundDefaultPreviewThumbnail.value = thumbnail
      }
    })()
  },
  { immediate: true },
)

const materialListEntries = computed<MaterialAssetListItem[]>(() =>
  nodeMaterials.value.map((entry: SceneNodeMaterial, index: number) => {
    const thumbnail = getMaterialPreviewThumbnail(entry)
    const color = normalizeHexColor(entry.color, DEFAULT_MATERIAL_COLOR)
    return {
      id: entry.id,
      title: entry.name ?? `材质 ${index + 1}`,
      color,
      thumbnail,
    }
  }),
)

function handleOpenDetails(id: string) {
  internalActiveId.value = id
  emit('update:active-node-material-id', id)
  emit('open-details', id)
}

function setActiveSlot(id: string) {
  internalActiveId.value = id
  emit('update:active-node-material-id', id)
}

function resolveMaterialAssetThumbnail(assetId: string | null | undefined): string | null {
  const normalizedId = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalizedId) {
    return null
  }
  const asset = sceneStore.getAsset(normalizedId)
  const thumbnail = typeof asset?.thumbnail === 'string' ? asset.thumbnail.trim() : ''
  return thumbnail || null
}

function getMaterialPreviewThumbnail(entry: SceneNodeMaterial): string | null {
  const isGroundDefaultSlot =
    selectedNode.value?.dynamicMesh?.type === 'Ground'
    && (entry.name === 'Ground Material' || entry.name === 'Ground Sculpted Material')
  if (isGroundDefaultSlot) {
    return groundDefaultPreviewThumbnail.value
  }
  if (typeof entry.thumbnail === 'string' && entry.thumbnail.trim().length) {
    return entry.thumbnail.trim()
  }
  const localThumbnail = materialPreviewThumbnails.value[entry.id]
  if (typeof localThumbnail === 'string' && localThumbnail.trim().length) {
    return localThumbnail.trim()
  }
  const asset = sceneStore.getAsset(entry.id)
  const assetThumbnail = assetCacheStore.resolveAssetThumbnail({ asset, assetId: entry.id })
  if (typeof assetThumbnail === 'string' && assetThumbnail.trim().length) {
    return assetThumbnail.trim()
  }
  return null
}

function setMaterialPreviewThumbnail(slotId: string, thumbnail: string | null | undefined) {
  const normalized = typeof thumbnail === 'string' ? thumbnail.trim() : ''
  if (!normalized) {
    clearMaterialPreviewThumbnail(slotId)
    return
  }
  materialPreviewThumbnails.value = {
    ...materialPreviewThumbnails.value,
    [slotId]: normalized,
  }
}

function clearMaterialPreviewThumbnail(slotId: string) {
  if (!(slotId in materialPreviewThumbnails.value)) {
    return
  }
  const next = { ...materialPreviewThumbnails.value }
  delete next[slotId]
  materialPreviewThumbnails.value = next
}

/**
 * Creates a material slot for the selected node.
 *
 * Picking a material type from the `+` menu is an explicit request for that
 * type. Dropping a texture or a material preset is likewise an instruction to
 * stop inheriting, so the slot is created lazily by `ensurePrimaryMaterialSlot`
 * (seeded from the material the imported model currently renders with) instead
 * of requiring a separate "覆盖材质" button.
 */
function handleAddMaterialSlot(type?: SceneMaterialType) {
  if (!canAddMaterialSlot.value || !selectedNodeId.value || !type) {
    return
  }
  const created = sceneStore.addNodeMaterial(selectedNodeId.value, { type }) as SceneNodeMaterial | null
  if (!created) {
    return
  }
  setActiveSlot(created.id)
  emit('open-details', created.id)
}

/**
 * Primary material slot of the selected node, created on demand.
 *
 * An empty material list means the node inherits (asset material, or the whole
 * model override of an import root); the first edit therefore has to create the
 * slot before writing into it. For imported model nodes the store seeds the new
 * slot from the material the model already renders with.
 */
function ensurePrimaryMaterialSlot(): SceneNodeMaterial | null {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return null
  }
  const existing = nodeMaterials.value[0] ?? null
  if (existing) {
    return existing
  }
  return sceneStore.addNodeMaterial(nodeId) as SceneNodeMaterial | null
}

function handleRequestDeleteSlot() {
  if (!canDeleteMaterialSlot.value) {
    return
  }
  if (!selectedNodeId.value || !internalActiveId.value) {
    return
  }
  const targetId = internalActiveId.value
  const removed = sceneStore.removeNodeMaterial(selectedNodeId.value, targetId)
  if (!removed) {
    return
  }
  clearMaterialPreviewThumbnail(targetId)
  internalActiveId.value = null
  emit('update:active-node-material-id', null)
  emit('close-details')
}

function isMaterialAsset(asset: ProjectAsset): asset is MaterialAsset {
  return asset.type === 'material'
}

function isTextureAsset(asset: ProjectAsset): asset is TextureAsset {
  return asset.type === 'image' || asset.type === 'texture'
}

function ensureMaterialAssetRegistered(asset: ProjectAsset): ProjectAsset {
  try {
    return sceneStore.ensureSceneAssetRegistered(asset, {
      source: asset.source ?? { type: 'url' },
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn('Failed to register selected material asset', asset.id, error)
    return asset
  }
}

function ensureEditableNodeMaterial(slotId: string): SceneNodeMaterial | null {
  if (!selectedNodeId.value) {
    return null
  }
  return nodeMaterials.value.find((item: SceneNodeMaterial) => item.id === slotId) ?? null
}

function applyAlbedoTexture(slotId: string, asset: TextureAsset): boolean {
  const editable = ensureEditableNodeMaterial(slotId)
  if (!editable || !selectedNodeId.value) {
    return false
  }
  const settings = editable.textures?.albedo?.settings
    ? cloneTextureSettings(editable.textures.albedo.settings)
    : createTextureSettings()
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, slotId, {
    textures: {
      albedo: {
        assetId: asset.id,
        name: asset.name,
        settings,
      },
    },
  })
  void assetCacheStore.downloadProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache texture asset', error)
  })
  return true
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hexValue = match[1] ?? ''
  if (hexValue.length === 3) {
    const [r, g, b] = hexValue.split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return `#${hexValue.toLowerCase()}`
}

async function handleApplyAsset(payload: { id: string; asset: ProjectAsset | null }) {
  const { id: slotId, asset } = payload
  if (!selectedNodeId.value || !slotId) {
    return
  }
  if (!asset) {
    const reset = await sceneStore.resetNodeMaterialSlotToDefault(selectedNodeId.value, slotId)
    if (reset) {
      setMaterialPreviewThumbnail(slotId, reset.thumbnail ?? groundDefaultPreviewThumbnail.value ?? null)
      setActiveSlot(slotId)
      emit('open-details', slotId)
    }
    return
  }
  const materialAsset = isMaterialAsset(asset) ? asset : null
  const textureAsset = isTextureAsset(asset) ? (asset as TextureAsset) : null
  if (!materialAsset && !textureAsset) {
    return
  }
  if (materialAsset) {
    const registeredAsset = ensureMaterialAssetRegistered(materialAsset)
    const applied = await sceneStore.applyMaterialAssetToNodeMaterialSlot(
      selectedNodeId.value,
      slotId,
      registeredAsset.id,
    )
    if (applied) {
      setMaterialPreviewThumbnail(
        slotId,
        applied.thumbnail ?? resolveMaterialAssetThumbnail(registeredAsset.id) ?? registeredAsset.thumbnail,
      )
      setActiveSlot(slotId)
      emit('open-details', slotId)
    }
    return
  }
  if (textureAsset) {
    const applied = applyAlbedoTexture(slotId, textureAsset)
    if (applied) {
      clearMaterialPreviewThumbnail(slotId)
      setActiveSlot(slotId)
      emit('open-details', slotId)
    }
  }
}

async function handleApplyListAsset(asset: ProjectAsset) {
  if (props.disabled || !selectedNodeId.value) {
    return
  }
  const nodeId = selectedNodeId.value
  const targetSlot = ensurePrimaryMaterialSlot()
  if (!targetSlot) {
    return
  }
  if (isMaterialAsset(asset)) {
    const materialDefinition = await sceneStore.ensureMaterialAssetDefinitionLoaded(asset.id)
    if (!materialDefinition) {
      return
    }
    const assigned = await sceneStore.applyMaterialAssetToNodeMaterialSlot(
      nodeId,
      targetSlot.id,
      asset.id,
    )
    if (assigned) {
      setMaterialPreviewThumbnail(targetSlot.id, assigned.thumbnail ?? resolveMaterialAssetThumbnail(asset.id) ?? asset.thumbnail)
      setActiveSlot(targetSlot.id)
      emit('open-details', targetSlot.id)
    }
    return
  }
  if (isTextureAsset(asset) && applyAlbedoTexture(targetSlot.id, asset)) {
    clearMaterialPreviewThumbnail(targetSlot.id)
    setActiveSlot(targetSlot.id)
    emit('open-details', targetSlot.id)
  }
}

</script>

<template>
  <v-expansion-panel value="material">
    <v-expansion-panel-title>
      <span class="material-panel-title__label">Material</span>
      <v-spacer />
      <v-menu location="bottom end" :close-on-content-click="true">
        <template #activator="{ props: menuProps }">
          <v-btn
            icon="mdi-plus"
            size="small"
            variant="text"
            :disabled="!canAddMaterialSlot"
            v-bind="menuProps"
          />
        </template>
        <v-list density="compact" min-width="240" class="material-create-menu">
          <v-list-subheader>
            {{ isImportedModelMaterialNode ? '新建材质覆盖' : '新建材质槽' }}
          </v-list-subheader>
          <v-list-item
            v-for="option in MATERIAL_CREATE_OPTIONS"
            :key="option.value"
            @click="handleAddMaterialSlot(option.value)"
          >
            <v-list-item-title>{{ option.label }}</v-list-item-title>
            <v-list-item-subtitle>{{ option.description }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn
        icon="mdi-minus"
        size="small"
        variant="text"
        :disabled="!canDeleteMaterialSlot"
        @click.stop="handleRequestDeleteSlot"
      />
    </v-expansion-panel-title>
    <v-expansion-panel-text>


      <MaterialAssetList
        v-model="internalActiveId"
        :items="materialListEntries"
        :disabled="props.disabled"
        allow-list-drop
        @open-details="handleOpenDetails"
        @apply-asset="handleApplyAsset"
        @apply-list-asset="handleApplyListAsset"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
}

.material-panel__inherit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 52px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(16, 20, 26, 0.35);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.material-panel__inherit.is-drag-over {
  border-color: rgba(90, 148, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(90, 148, 255, 0.18);
}

.material-panel__inherit-title {
  font-size: 0.75rem;
  line-height: 1.35;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.88);
}

.material-panel__inherit-label {
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgba(233, 236, 241, 0.72);
}

.material-panel__list {
  width: 100%;
  min-height: 36px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.material-panel__list.is-drag-over .material-list {
  border-color: rgba(90, 148, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(90, 148, 255, 0.18);
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

.material-list :deep(.v-list-item.is-drag-target) {
  border: 1px dashed rgba(90, 148, 255, 0.6);
  background: rgba(252, 10, 131, 0.18);
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

.material-sphere {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-right: 8px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow: 
    inset -3px -3px 6px rgba(0, 0, 0, 0.3),
    inset 3px 3px 6px rgba(255, 255, 255, 0.3);
  position: relative;
  cursor: pointer;
}

.material-sphere--thumbnail {
  box-shadow:
    inset -2px -2px 5px rgba(0, 0, 0, 0.24),
    inset 2px 2px 5px rgba(0, 0, 0, 0.08);
}

.material-sphere--thumbnail::before {
  display: none;
}

.material-sphere::before {
  content: '';
  position: absolute;
  top: 15%;
  left: 25%;
  width: 35%;
  height: 35%;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.5), transparent);
}

.material-color-control {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.material-color-control.is-disabled {
  pointer-events: none;
  opacity: 0.6;
}

</style>
