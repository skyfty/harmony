<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type {
  SceneMaterialProps,
  SceneMaterialSide,
  SceneMaterialTextureRef,
  SceneMaterialTextureSlot,
} from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'

type TextureMapState = Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>

interface MaterialFormState extends Omit<SceneMaterialProps, 'textures'> {
  name: string
  description: string
  textures: TextureMapState
}

const SLIDER_FIELDS = ['opacity', 'metalness', 'roughness', 'emissiveIntensity', 'aoStrength', 'envMapIntensity'] as const
type SliderField = (typeof SLIDER_FIELDS)[number]
type SliderConfigEntry = {
  min: number
  max: number
  step: number
  decimals: number
}

const props = defineProps<{ disabled?: boolean }>()

const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'metalness', 'roughness', 'ao', 'emissive']
const TEXTURE_LABELS: Record<SceneMaterialTextureSlot, string> = {
  albedo: 'Albedo',
  normal: 'Normal',
  metalness: 'Metalness',
  roughness: 'Roughness',
  ao: 'Ambient Occlusion',
  emissive: 'Emissive',
}
const SIDE_OPTIONS: Array<{ value: SceneMaterialSide; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'double', label: 'Double' },
]
const SLIDER_CONFIG: Record<SliderField, SliderConfigEntry> = {
  opacity: { min: 0, max: 1, step: 0.05, decimals: 2 },
  metalness: { min: 0, max: 1, step: 0.01, decimals: 2 },
  roughness: { min: 0, max: 1, step: 0.01, decimals: 2 },
  emissiveIntensity: { min: 0, max: 10, step: 0.1, decimals: 2 },
  aoStrength: { min: 0, max: 2, step: 0.05, decimals: 2 },
  envMapIntensity: { min: 0, max: 10, step: 0.1, decimals: 2 },
}

function createEmptyTextureMap(): TextureMapState {
  const map = {} as TextureMapState
  TEXTURE_SLOTS.forEach((slot) => {
    map[slot] = null
  })
  return map
}

const DEFAULT_PROPS: SceneMaterialProps = {
  color: '#ffffff',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.5,
  roughness: 0.5,
  emissive: '#000000',
  emissiveIntensity: 0,
  aoStrength: 1,
  envMapIntensity: 1,
  textures: createEmptyTextureMap(),
}

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { selectedNode, selectedNodeId, materials } = storeToRefs(sceneStore)

const assignmentMode = ref<'shared' | 'local'>('local')
const activeMaterialId = ref<string | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)
const draggingSlot = ref<SceneMaterialTextureSlot | null>(null)

const formTextures = reactive<TextureMapState>(createEmptyTextureMap())
const materialForm = reactive<MaterialFormState>({
  name: '',
  description: '',
  color: DEFAULT_PROPS.color,
  transparent: DEFAULT_PROPS.transparent,
  opacity: DEFAULT_PROPS.opacity,
  side: DEFAULT_PROPS.side as SceneMaterialSide,
  wireframe: DEFAULT_PROPS.wireframe,
  metalness: DEFAULT_PROPS.metalness,
  roughness: DEFAULT_PROPS.roughness,
  emissive: DEFAULT_PROPS.emissive,
  emissiveIntensity: DEFAULT_PROPS.emissiveIntensity,
  aoStrength: DEFAULT_PROPS.aoStrength,
  envMapIntensity: DEFAULT_PROPS.envMapIntensity,
  textures: formTextures,
})

const materialOptions = computed(() =>
  materials.value.map((material) => ({
    title: material.name,
    value: material.id,
    subtitle: material.description ?? '',
  })),
)

const selectedMaterialEntry = computed(() =>
  assignmentMode.value === 'shared' && activeMaterialId.value
    ? materials.value.find((material) => material.id === activeMaterialId.value) ?? null
    : null,
)

const hasMaterialTarget = computed(() => !!selectedNode.value?.material)
const panelDisabled = computed(() => props.disabled || !hasMaterialTarget.value)
const isShared = computed(() => assignmentMode.value === 'shared')
const canDuplicateMaterial = computed(() => isShared.value && !!activeMaterialId.value && !panelDisabled.value)
const canDeleteMaterial = computed(
  () => isShared.value && materials.value.length > 1 && !!activeMaterialId.value && !panelDisabled.value,
)
const canMakeLocal = computed(() => isShared.value && !panelDisabled.value)
const assignmentHint = computed(() =>
  isShared.value
    ? '已链接共享材质，修改会影响所有使用该材质的网格。'
    : '当前为本地覆盖，修改仅作用于此网格。',
)

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
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

function applyPropsToForm(
  props: SceneMaterialProps,
  metadata?: { name?: string | null; description?: string | null },
) {
  materialForm.color = normalizeHexColor(props.color, DEFAULT_PROPS.color)
  materialForm.transparent = !!props.transparent
  materialForm.opacity = clampNumber(props.opacity ?? DEFAULT_PROPS.opacity, 0, 1, DEFAULT_PROPS.opacity)
  materialForm.side = (props.side ?? DEFAULT_PROPS.side) as SceneMaterialSide
  materialForm.wireframe = !!props.wireframe
  materialForm.metalness = clampNumber(props.metalness ?? DEFAULT_PROPS.metalness, 0, 1, DEFAULT_PROPS.metalness)
  materialForm.roughness = clampNumber(props.roughness ?? DEFAULT_PROPS.roughness, 0, 1, DEFAULT_PROPS.roughness)
  materialForm.emissive = normalizeHexColor(props.emissive, DEFAULT_PROPS.emissive)
  materialForm.emissiveIntensity = clampNumber(
    props.emissiveIntensity ?? DEFAULT_PROPS.emissiveIntensity,
    SLIDER_CONFIG.emissiveIntensity.min,
    SLIDER_CONFIG.emissiveIntensity.max,
    DEFAULT_PROPS.emissiveIntensity,
  )
  materialForm.aoStrength = clampNumber(
    props.aoStrength ?? DEFAULT_PROPS.aoStrength,
    SLIDER_CONFIG.aoStrength.min,
    SLIDER_CONFIG.aoStrength.max,
    DEFAULT_PROPS.aoStrength,
  )
  materialForm.envMapIntensity = clampNumber(
    props.envMapIntensity ?? DEFAULT_PROPS.envMapIntensity,
    SLIDER_CONFIG.envMapIntensity.min,
    SLIDER_CONFIG.envMapIntensity.max,
    DEFAULT_PROPS.envMapIntensity,
  )
  TEXTURE_SLOTS.forEach((slot) => {
    const ref = props.textures?.[slot] ?? null
    formTextures[slot] = ref ? { assetId: ref.assetId, name: ref.name } : null
  })
  if (metadata) {
    materialForm.name = metadata.name?.trim() ?? ''
    materialForm.description = metadata.description?.trim() ?? ''
  } else {
    materialForm.name = ''
    materialForm.description = ''
  }
}

function resetForm() {
  applyPropsToForm(DEFAULT_PROPS, { name: '', description: '' })
}

watchEffect(() => {
  const nodeMaterial = selectedNode.value?.material ?? null
  if (!nodeMaterial) {
    assignmentMode.value = 'local'
    activeMaterialId.value = null
    resetForm()
    return
  }

  const linked = nodeMaterial.materialId
    ? materials.value.find((material) => material.id === nodeMaterial.materialId) ?? null
    : null

  const nextMode: 'shared' | 'local' = linked ? 'shared' : 'local'
  if (assignmentMode.value !== nextMode) {
    assignmentMode.value = nextMode
  }

  const nextActive = linked?.id ?? null
  if (activeMaterialId.value !== nextActive) {
    activeMaterialId.value = nextActive
  }

  const sourceProps = linked ?? nodeMaterial
  applyPropsToForm(sourceProps, linked ? { name: linked.name, description: linked.description } : undefined)
})

function commitMaterialProps(update: Partial<SceneMaterialProps>) {
  if (panelDisabled.value) {
    return
  }
  if (isShared.value) {
    if (!activeMaterialId.value) {
      return
    }
    sceneStore.updateMaterialDefinition(activeMaterialId.value, update)
    return
  }
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.updateNodeMaterial(selectedNodeId.value, {
    ...update,
    materialId: null,
  })
}

function commitMaterialMetadata(update: { name?: string; description?: string }) {
  if (panelDisabled.value || !isShared.value || !activeMaterialId.value) {
    return
  }
  sceneStore.updateMaterialDefinition(activeMaterialId.value, update)
}

function handleMaterialSelection(value: string | null) {
  if (!selectedNodeId.value || panelDisabled.value) {
    return
  }
  if (typeof value === 'string' && value.trim().length) {
    sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: value })
    return
  }
  sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: null })
}

function handleClearMaterial() {
  if (!selectedNodeId.value || panelDisabled.value) {
    return
  }
  sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: null })
}

function handleCreateMaterial() {
  if (panelDisabled.value) {
    return
  }
  const created = sceneStore.createMaterial()
  if (selectedNodeId.value && created) {
    sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: created.id })
  }
}

function handleDuplicateMaterial() {
  if (!canDuplicateMaterial.value || !activeMaterialId.value || !selectedNodeId.value) {
    return
  }
  const duplicated = sceneStore.duplicateMaterial(activeMaterialId.value)
  if (duplicated) {
    sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: duplicated.id })
  }
}

function handleDeleteMaterial() {
  if (!canDeleteMaterial.value || !activeMaterialId.value) {
    return
  }
  if (!window.confirm('删除该材质？此操作会影响所有引用它的网格。')) {
    return
  }
  sceneStore.deleteMaterial(activeMaterialId.value)
}

function makeLocalCopy() {
  if (!canMakeLocal.value || !selectedNodeId.value) {
    return
  }
  sceneStore.updateNodeMaterial(selectedNodeId.value, { materialId: null })
}

function handleHexColorChange(field: 'color' | 'emissive', event: Event) {
  if (panelDisabled.value) {
    return
  }
  const value = normalizeHexColor((event.target as HTMLInputElement).value, materialForm[field])
  materialForm[field] = value
  if (field === 'color') {
    commitMaterialProps({ color: value })
  } else {
    commitMaterialProps({ emissive: value })
  }
}

function handleBooleanChange(field: 'transparent' | 'wireframe', value: unknown) {
  if (panelDisabled.value) {
    return
  }
  const boolValue = Boolean(value)
  materialForm[field] = boolValue
  commitMaterialProps({ [field]: boolValue } as Partial<SceneMaterialProps>)
  if (field === 'transparent' && !boolValue && materialForm.opacity < 1) {
    materialForm.opacity = 1
    commitMaterialProps({ opacity: 1 })
  }
}

function handleSideChange(value: SceneMaterialSide) {
  if (panelDisabled.value) {
    return
  }
  materialForm.side = value
  commitMaterialProps({ side: value })
}

function handleSliderChange(field: SliderField, value: number | number[]) {
  if (panelDisabled.value) {
    return
  }
  const numericCandidate = Array.isArray(value) ? value[0] : value
  if (typeof numericCandidate !== 'number' || !Number.isFinite(numericCandidate)) {
    return
  }
  const numeric = numericCandidate
  const config = SLIDER_CONFIG[field] as SliderConfigEntry
  const min: number = Number(config.min ?? 0)
  const max: number = Number(config.max ?? min)
  const rawValue = materialForm[field]
  const fallbackValue: number = typeof rawValue === 'number' ? rawValue : min
  const clamped = clampNumber(numeric, min, max, fallbackValue)
  materialForm[field] = clamped as never
  commitMaterialProps({ [field]: clamped } as Partial<SceneMaterialProps>)
}

function formatSliderValue(field: SliderField): string {
  const config = SLIDER_CONFIG[field] as SliderConfigEntry
  return (materialForm[field] as number).toFixed(config.decimals)
}

function resolveTextureName(slot: SceneMaterialTextureSlot): string {
  const ref = formTextures[slot]
  if (!ref) {
    return '未指定'
  }
  const asset = sceneStore.getAsset(ref.assetId)
  return asset?.name ?? ref.name ?? ref.assetId
}

function parseDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse drag payload', error)
      }
    }
  }
  if (sceneStore.draggingAssetId) {
    return { assetId: sceneStore.draggingAssetId }
  }
  return null
}

function ensureImageAsset(assetId: string): ProjectAsset | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset) {
    return null
  }
  if (asset.type !== 'image') {
    return null
  }
  return asset
}

function isTextureDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureImageAsset(payload.assetId)
}

function handleTextureDragEnter(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event) || panelDisabled.value) {
    return
  }
  event.preventDefault()
  draggingSlot.value = slot
}

function handleTextureDragOver(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event) || panelDisabled.value) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  draggingSlot.value = slot
}

function handleTextureDragLeave(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event) || panelDisabled.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  if (draggingSlot.value === slot) {
    draggingSlot.value = null
  }
}

function assignTexture(slot: SceneMaterialTextureSlot, ref: SceneMaterialTextureRef | null) {
  formTextures[slot] = ref ? { assetId: ref.assetId, name: ref.name } : null
  commitMaterialProps({ textures: { [slot]: ref } })
}

function handleTextureDrop(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event) || panelDisabled.value) {
    return
  }
  const payload = parseDragPayload(event)
  if (!payload) {
    return
  }
  const asset = ensureImageAsset(payload.assetId)
  if (!asset) {
    console.warn('拖拽的资源不是图片，无法分配到材质贴图')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  draggingSlot.value = null
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache texture asset', error)
  })
  assignTexture(slot, { assetId: asset.id, name: asset.name })
}

function handleTextureRemove(slot: SceneMaterialTextureSlot) {
  if (panelDisabled.value) {
    return
  }
  assignTexture(slot, null)
}

function handleNameChange(value: string) {
  if (!isShared.value) {
    return
  }
  const trimmed = value.trim()
  materialForm.name = trimmed
  if (selectedMaterialEntry.value && trimmed && trimmed !== selectedMaterialEntry.value.name) {
    commitMaterialMetadata({ name: trimmed })
  }
}

function handleDescriptionChange(value: string) {
  if (!isShared.value) {
    return
  }
  materialForm.description = value
  commitMaterialMetadata({ description: value })
}

function triggerImport() {
  if (panelDisabled.value) {
    return
  }
  importInputRef.value?.click()
}

function sanitizeImportedMaterial(
  data: unknown,
): { props: SceneMaterialProps; name?: string; description?: string } | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const payload = (data as Record<string, unknown>).props
  const source =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : (data as Record<string, unknown>)

  const texturesInput =
    source.textures && typeof source.textures === 'object'
      ? (source.textures as Record<string, unknown>)
      : {}
  const textures = createEmptyTextureMap()
  TEXTURE_SLOTS.forEach((slot) => {
    const entry = texturesInput[slot]
    if (!entry || typeof entry !== 'object') {
      textures[slot] = null
      return
    }
    const ref = entry as Record<string, unknown>
    if (typeof ref.assetId === 'string' && ref.assetId.trim().length) {
      textures[slot] = {
        assetId: ref.assetId,
        name: typeof ref.name === 'string' ? ref.name : undefined,
      }
    } else {
      textures[slot] = null
    }
  })

  const props: SceneMaterialProps = {
    color: normalizeHexColor(source.color, DEFAULT_PROPS.color),
    transparent: typeof source.transparent === 'boolean' ? source.transparent : DEFAULT_PROPS.transparent,
    opacity: clampNumber(Number(source.opacity ?? DEFAULT_PROPS.opacity), 0, 1, DEFAULT_PROPS.opacity),
    side: (typeof source.side === 'string' && ['front', 'back', 'double'].includes(source.side)
      ? source.side
      : DEFAULT_PROPS.side) as SceneMaterialSide,
    wireframe: typeof source.wireframe === 'boolean' ? source.wireframe : DEFAULT_PROPS.wireframe,
    metalness: clampNumber(Number(source.metalness ?? DEFAULT_PROPS.metalness), 0, 1, DEFAULT_PROPS.metalness),
    roughness: clampNumber(Number(source.roughness ?? DEFAULT_PROPS.roughness), 0, 1, DEFAULT_PROPS.roughness),
    emissive: normalizeHexColor(source.emissive, DEFAULT_PROPS.emissive),
    emissiveIntensity: clampNumber(
      Number(source.emissiveIntensity ?? DEFAULT_PROPS.emissiveIntensity),
      SLIDER_CONFIG.emissiveIntensity.min,
      SLIDER_CONFIG.emissiveIntensity.max,
      DEFAULT_PROPS.emissiveIntensity,
    ),
    aoStrength: clampNumber(
      Number(source.aoStrength ?? DEFAULT_PROPS.aoStrength),
      SLIDER_CONFIG.aoStrength.min,
      SLIDER_CONFIG.aoStrength.max,
      DEFAULT_PROPS.aoStrength,
    ),
    envMapIntensity: clampNumber(
      Number(source.envMapIntensity ?? DEFAULT_PROPS.envMapIntensity),
      SLIDER_CONFIG.envMapIntensity.min,
      SLIDER_CONFIG.envMapIntensity.max,
      DEFAULT_PROPS.envMapIntensity,
    ),
    textures,
  }

  const rawName = (data as Record<string, unknown>).name
  const rawDescription = (data as Record<string, unknown>).description
  const name = typeof rawName === 'string' ? rawName : undefined
  const description = typeof rawDescription === 'string' ? rawDescription : undefined

  return { props, name, description }
}

function applyImportedMaterialPayload(payload: {
  props: SceneMaterialProps
  name?: string
  description?: string
}) {
  applyPropsToForm(payload.props, {
    name: payload.name ?? materialForm.name,
    description: payload.description ?? materialForm.description,
  })
  if (isShared.value) {
    if (activeMaterialId.value) {
      const update: Partial<SceneMaterialProps> & { name?: string; description?: string } = {
        ...payload.props,
      }
      if (payload.name !== undefined) {
        update.name = payload.name
      }
      if (payload.description !== undefined) {
        update.description = payload.description
      }
      sceneStore.updateMaterialDefinition(activeMaterialId.value, update)
    }
    return
  }
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.updateNodeMaterial(selectedNodeId.value, {
    ...payload.props,
    materialId: null,
  })
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || panelDisabled.value) {
    return
  }
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as unknown
    const sanitized = sanitizeImportedMaterial(parsed)
    if (!sanitized) {
      throw new Error('Invalid material file')
    }
    applyImportedMaterialPayload(sanitized)
  } catch (error) {
    console.warn('Failed to import material', error)
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function handleExportMaterial() {
  if (!hasMaterialTarget.value || panelDisabled.value) {
    return
  }
  const target = (isShared.value ? selectedMaterialEntry.value : selectedNode.value?.material) || null
  if (!target) {
    return
  }
  const textures: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>> = {}
  TEXTURE_SLOTS.forEach((slot) => {
    const ref = target.textures?.[slot] ?? null
    textures[slot] = ref ? { assetId: ref.assetId, name: ref.name } : null
  })
  const baseName = isShared.value
    ? materialForm.name || selectedMaterialEntry.value?.name || 'Material'
    : selectedNode.value?.name || 'Material'
  const payload = {
    version: 1,
    type: isShared.value ? 'shared' : 'local',
    name: baseName,
    description: isShared.value ? materialForm.description : undefined,
    props: {
      color: target.color,
      transparent: target.transparent,
      opacity: target.opacity,
      side: target.side,
      wireframe: target.wireframe,
      metalness: target.metalness,
      roughness: target.roughness,
      emissive: target.emissive,
      emissiveIntensity: target.emissiveIntensity,
      aoStrength: target.aoStrength,
      envMapIntensity: target.envMapIntensity,
      textures,
    },
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const filename = `${slugify(baseName || 'material') || 'material'}-material.json`
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}
</script>
<template>

<v-expansion-panel title="Material">
      <v-expansion-panel-text>

  <section class="material-panel">
    <header class="material-panel__header">
      <h3 class="material-panel__title">材质</h3>
      <div class="material-panel__actions">
        <v-btn
          density="comfortable"
          variant="outlined"
          color="primary"
          :disabled="panelDisabled"
          @click="handleCreateMaterial"
        >
          新建
        </v-btn>
        <v-btn
          density="comfortable"
          color="primary"
          :disabled="!canDuplicateMaterial"
          @click="handleDuplicateMaterial"
        >
          复制
        </v-btn>
        <v-btn
          density="comfortable"
          color="error"
          variant="text"
          :disabled="!canDeleteMaterial"
          @click="handleDeleteMaterial"
        >
          删除
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="panelDisabled"
      type="info"
      density="compact"
      variant="outlined"
      class="material-panel__alert"
    >
      请选择一个支持材质的节点。
    </v-alert>

    <template v-else>
      <v-btn-toggle
        v-model="assignmentMode"
        mandatory
        density="comfortable"
        class="material-panel__toggle"
        :disabled="panelDisabled"
      >
        <v-btn value="local">本地覆盖</v-btn>
        <v-btn value="shared">共享材质</v-btn>
      </v-btn-toggle>

      <p class="material-panel__hint">{{ assignmentHint }}</p>

      <template v-if="isShared">
        <v-select
          v-model="activeMaterialId"
          :items="materialOptions"
          item-title="title"
          item-value="value"
          label="选择共享材质"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          class="material-panel__field"
          :disabled="panelDisabled"
          @update:model-value="handleMaterialSelection"
        />

        <div class="material-panel__meta" v-if="selectedMaterialEntry">
          <v-text-field
            v-model="materialForm.name"
            label="名称"
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="material-panel__field"
            :disabled="panelDisabled"
            @change="handleNameChange(materialForm.name)"
          />
          <v-textarea
            v-model="materialForm.description"
            label="描述"
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            rows="3"
            class="material-panel__field"
            :disabled="panelDisabled"
            @change="handleDescriptionChange(materialForm.description)"
          />
        </div>

        <v-btn
          v-if="selectedMaterialEntry"
          density="comfortable"
          variant="text"
          class="material-panel__make-local"
          :disabled="!canMakeLocal"
          @click="makeLocalCopy"
        >
          复制为本地材质
        </v-btn>
      </template>

      <template v-else>
        <v-alert type="info" density="compact" variant="tonal" class="material-panel__local-alert">
          当前为本地材质覆盖，不会影响其他网格。
        </v-alert>
        <v-btn
          density="comfortable"
          variant="text"
          class="material-panel__clear"
          :disabled="panelDisabled"
          @click="handleClearMaterial"
        >
          清除材质链接
        </v-btn>
      </template>

      <section class="material-panel__section">
        <h4 class="material-panel__section-title">基本属性</h4>
        <div class="material-panel__color-row">
          <div class="material-panel__color-field">
            <label class="material-panel__color-label">Base Color</label>
            <input
              class="material-panel__color-input"
              type="color"
              :value="materialForm.color"
              :disabled="panelDisabled"
              @input="handleHexColorChange('color', $event)"
            />
            <input
              class="material-panel__hex-input"
              type="text"
              :value="materialForm.color"
              :disabled="panelDisabled"
              @change="handleHexColorChange('color', $event)"
            />
          </div>
          <v-switch
            v-model="materialForm.transparent"
            density="compact"
            inset
            label="透明"
            color="primary"
            hide-details
            :disabled="panelDisabled"
            @update:model-value="handleBooleanChange('transparent', $event)"
          />
          <v-switch
            v-model="materialForm.wireframe"
            density="compact"
            inset
            label="线框"
            color="primary"
            hide-details
            :disabled="panelDisabled"
            @update:model-value="handleBooleanChange('wireframe', $event)"
          />
        </div>
        <div class="material-panel__slider">
          <label>不透明度 {{ formatSliderValue('opacity') }}</label>
          <v-slider
            :model-value="materialForm.opacity"
            :min="SLIDER_CONFIG.opacity.min"
            :max="SLIDER_CONFIG.opacity.max"
            :step="SLIDER_CONFIG.opacity.step"
            thumb-label
            :disabled="!materialForm.transparent || panelDisabled"
            @update:model-value="handleSliderChange('opacity', $event)"
          />
        </div>
        <v-select
          class="material-panel__field"
          label="渲染面"
          :items="SIDE_OPTIONS"
          item-title="label"
          item-value="value"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :model-value="materialForm.side"
          :disabled="panelDisabled"
          @update:model-value="handleSideChange"
        />
      </section>

      <section class="material-panel__section">
        <h4 class="material-panel__section-title">PBR 参数</h4>
        <div class="material-panel__slider">
          <label>金属度 {{ formatSliderValue('metalness') }}</label>
          <v-slider
            :model-value="materialForm.metalness"
            :min="SLIDER_CONFIG.metalness.min"
            :max="SLIDER_CONFIG.metalness.max"
            :step="SLIDER_CONFIG.metalness.step"
            thumb-label
            :disabled="panelDisabled"
            @update:model-value="handleSliderChange('metalness', $event)"
          />
        </div>
        <div class="material-panel__slider">
          <label>粗糙度 {{ formatSliderValue('roughness') }}</label>
          <v-slider
            :model-value="materialForm.roughness"
            :min="SLIDER_CONFIG.roughness.min"
            :max="SLIDER_CONFIG.roughness.max"
            :step="SLIDER_CONFIG.roughness.step"
            thumb-label
            :disabled="panelDisabled"
            @update:model-value="handleSliderChange('roughness', $event)"
          />
        </div>
        <div class="material-panel__emissive">
          <div class="material-panel__color-field">
            <label class="material-panel__color-label">Emissive</label>
            <input
              class="material-panel__color-input"
              type="color"
              :value="materialForm.emissive"
              :disabled="panelDisabled"
              @input="handleHexColorChange('emissive', $event)"
            />
            <input
              class="material-panel__hex-input"
              type="text"
              :value="materialForm.emissive"
              :disabled="panelDisabled"
              @change="handleHexColorChange('emissive', $event)"
            />
          </div>
          <div class="material-panel__slider">
            <label>自发光强度 {{ formatSliderValue('emissiveIntensity') }}</label>
            <v-slider
              :model-value="materialForm.emissiveIntensity"
              :min="SLIDER_CONFIG.emissiveIntensity.min"
              :max="SLIDER_CONFIG.emissiveIntensity.max"
              :step="SLIDER_CONFIG.emissiveIntensity.step"
              thumb-label
              :disabled="panelDisabled"
              @update:model-value="handleSliderChange('emissiveIntensity', $event)"
            />
          </div>
        </div>
        <div class="material-panel__slider">
          <label>AO 强度 {{ formatSliderValue('aoStrength') }}</label>
          <v-slider
            :model-value="materialForm.aoStrength"
            :min="SLIDER_CONFIG.aoStrength.min"
            :max="SLIDER_CONFIG.aoStrength.max"
            :step="SLIDER_CONFIG.aoStrength.step"
            thumb-label
            :disabled="panelDisabled"
            @update:model-value="handleSliderChange('aoStrength', $event)"
          />
        </div>
        <div class="material-panel__slider">
          <label>环境贴图强度 {{ formatSliderValue('envMapIntensity') }}</label>
          <v-slider
            :model-value="materialForm.envMapIntensity"
            :min="SLIDER_CONFIG.envMapIntensity.min"
            :max="SLIDER_CONFIG.envMapIntensity.max"
            :step="SLIDER_CONFIG.envMapIntensity.step"
            thumb-label
            :disabled="panelDisabled"
            @update:model-value="handleSliderChange('envMapIntensity', $event)"
          />
        </div>
      </section>

      <section class="material-panel__section">
        <h4 class="material-panel__section-title">贴图</h4>
        <div class="material-panel__texture-grid">
          <article
            v-for="slot in TEXTURE_SLOTS"
            :key="slot"
            class="texture-card"
            :class="{ 'texture-card--dragging': draggingSlot === slot }"
            @dragenter.prevent="handleTextureDragEnter(slot, $event)"
            @dragover.prevent="handleTextureDragOver(slot, $event)"
            @dragleave="handleTextureDragLeave(slot, $event)"
            @drop.prevent="handleTextureDrop(slot, $event)"
          >
            <header class="texture-card__header">
              <h5>{{ TEXTURE_LABELS[slot] }}</h5>
              <div class="texture-card__buttons">
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  :disabled="panelDisabled"
                  @click.stop="handleTextureDrop(slot, $event as unknown as DragEvent)"
                >
                  <v-icon icon="mdi-upload" size="16" />
                </v-btn>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="!formTextures[slot] || panelDisabled"
                  @click.stop="handleTextureRemove(slot)"
                >
                  <v-icon icon="mdi-delete-outline" size="16" />
                </v-btn>
              </div>
            </header>

            <div class="texture-card__body">
              <p class="texture-card__name">{{ resolveTextureName(slot) }}</p>
              <p class="texture-card__hint">拖拽图片资源到此处</p>
            </div>
          </article>
        </div>
      </section>

      <section class="material-panel__section material-panel__section--inline">
        <v-btn
          density="comfortable"
          variant="outlined"
          color="primary"
          :disabled="panelDisabled"
          @click="triggerImport"
        >
          导入材质
        </v-btn>
        <v-btn
          density="comfortable"
          color="primary"
          :disabled="panelDisabled"
          @click="handleExportMaterial"
        >
          导出材质
        </v-btn>
        <input ref="importInputRef" type="file" accept="application/json" class="material-panel__file" @change="handleImportFileChange" />
      </section>
    </template>
  </section>
      </v-expansion-panel-text>
</v-expansion-panel>  


</template>
<style scoped>
.material-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.material-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.material-panel__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.material-panel__actions {
  display: flex;
  gap: 8px;
}

.material-panel__alert {
  margin-top: 8px;
}

.material-panel__toggle {
  width: 100%;
}

.material-panel__hint {
  margin: 4px 0 12px;
  color: rgba(0, 0, 0, 0.6);
  font-size: 13px;
}

.material-panel__meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.material-panel__field {
  width: 100%;
}

.material-panel__make-local,
.material-panel__clear {
  align-self: flex-start;
}

.material-panel__section {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.material-panel__section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.material-panel__color-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.material-panel__color-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.material-panel__color-label {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}

.material-panel__color-input {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
}

.material-panel__hex-input {
  width: 92px;
  padding: 4px 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  font-family: monospace;
  text-transform: uppercase;
}

.material-panel__slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.material-panel__emissive {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  align-items: start;
}

.material-panel__texture-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.texture-card {
  border: 1px dashed rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
  min-height: 120px;
}

.texture-card--dragging {
  border-color: #1976d2;
  background-color: rgba(25, 118, 210, 0.08);
}

.texture-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.texture-card__buttons {
  display: flex;
  gap: 4px;
}

.texture-card__name {
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.texture-card__hint {
  margin: 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.material-panel__section--inline {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.material-panel__file {
  display: none;
}

.material-panel__local-alert {
  margin-top: 8px;
}
</style>
