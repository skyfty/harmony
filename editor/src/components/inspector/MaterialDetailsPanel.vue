<script setup lang="ts">
import { computed, reactive, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type {
  SceneMaterialProps,
  SceneMaterialSide,
  SceneMaterialTextureRef,
  SceneMaterialTextureSlot,
  SceneMaterialType,
} from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'
import * as THREE from 'three'

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

const props = defineProps<{
  nodeMaterialId: string | null
  visible: boolean
  disabled?: boolean
  anchor: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

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
const materialClasses: Record<string, any> = {
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  MeshNormalMaterial: THREE.MeshNormalMaterial,
  MeshLambertMaterial: THREE.MeshLambertMaterial,
  MeshMatcapMaterial: (THREE as any).MeshMatcapMaterial ?? THREE.MeshStandardMaterial,
  MeshPhongMaterial: THREE.MeshPhongMaterial,
  MeshToonMaterial: THREE.MeshToonMaterial,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
}

const MATERIAL_CLASS_OPTIONS = Object.keys(materialClasses) as SceneMaterialType[]

function resolveSceneMaterialTypeFromString(value: string | null | undefined): SceneMaterialType {
  if (!value) return 'MeshStandardMaterial'
  if (MATERIAL_CLASS_OPTIONS.includes(value as SceneMaterialType)) return value as SceneMaterialType
  // legacy value
  if (value === 'mesh-standard') return 'MeshStandardMaterial'
  return 'MeshStandardMaterial'
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

const nodeMaterials = computed(() => selectedNode.value?.materials ?? [])
const activeNodeMaterial = computed(() => {
  if (!props.nodeMaterialId) {
    return null
  }
  return nodeMaterials.value.find((entry) => entry.id === props.nodeMaterialId) ?? null
})

const panelRef = ref<HTMLElement | null>(null)
const baseColorMenuOpen = ref(false)
const emissiveColorMenuOpen = ref(false)

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

const selectedMaterialEntry = computed(() =>
  activeMaterialId.value ? materials.value.find((item) => item.id === activeMaterialId.value) ?? null : null,
)

const isShared = computed(() => !!selectedMaterialEntry.value)

const activeMaterialIndex = computed(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return -1
  }
  return nodeMaterials.value.findIndex((item) => item.id === entry.id)
})

const selectedMaterialType = ref<SceneMaterialType | null>(null)

const currentMaterialTitle = computed(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return '材质'
  }
  if (entry.materialId) {
    const shared = materials.value.find((item) => item.id === entry.materialId)
    return shared?.name ?? entry.name ?? '材质'
  }
  return entry.name ?? `材质 ${activeMaterialIndex.value + 1}`
})

const panelStyle = computed(() => {
  if (!props.anchor) {
    return {}
  }
  return {
    top: `${props.anchor.top + 70}px`,
    left: `${props.anchor.left}px`,
    borderRadius: '7px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(18, 22, 28, 0.72)',
    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.35)',
  }
})

watch(
  () => props.visible,
  (visible) => {
    if (visible && !activeNodeMaterial.value) {
      emit('close')
      return
    }
    if (!visible) {
      baseColorMenuOpen.value = false
      emissiveColorMenuOpen.value = false
    }
  },
)

watchEffect(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    baseColorMenuOpen.value = false
    emissiveColorMenuOpen.value = false
    activeMaterialId.value = null
    applyPropsToForm(DEFAULT_PROPS, { name: '', description: '' })
    selectedMaterialType.value = null
    return
  }
  const shared = entry.materialId ? materials.value.find((material) => material.id === entry.materialId) ?? null : null
  activeMaterialId.value = shared?.id ?? null
  const metadata = shared
    ? { name: shared.name, description: shared.description ?? '' }
    : { name: entry.name ?? '', description: '' }
  applyPropsToForm(shared ?? entry, metadata)
  // set selectedMaterialType from shared or node entry
  const type = shared?.type ?? entry.type ?? null
  selectedMaterialType.value = resolveSceneMaterialTypeFromString(type)
})

function handleClose() {
  emit('close')
}

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

function commitMaterialProps(update: Partial<SceneMaterialProps>) {
  if (!activeNodeMaterial.value || !selectedNodeId.value) {
    return
  }
  if (isShared.value && selectedMaterialEntry.value) {
    sceneStore.updateMaterialDefinition(selectedMaterialEntry.value.id, update)
    return
  }
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, activeNodeMaterial.value.id, update)
}

function commitMaterialMetadata(update: { name?: string; description?: string }) {
  if (!activeNodeMaterial.value || !selectedNodeId.value) {
    return
  }
  if (isShared.value && selectedMaterialEntry.value) {
    sceneStore.updateMaterialDefinition(selectedMaterialEntry.value.id, update)
    return
  }
  if (update.name !== undefined) {
    sceneStore.updateNodeMaterialMetadata(selectedNodeId.value, activeNodeMaterial.value.id, {
      name: update.name,
    })
  }
}

function handleHexColorChange(field: 'color' | 'emissive', value: string) {
  const normalized = normalizeHexColor(value, materialForm[field])
  materialForm[field] = normalized
  if (field === 'color') {
    commitMaterialProps({ color: normalized })
  } else {
    commitMaterialProps({ emissive: normalized })
  }
}

function handleColorPickerInput(field: 'color' | 'emissive', value: string | null) {
  if (typeof value !== 'string') {
    return
  }
  handleHexColorChange(field, value)
}

function handleSideChange(value: SceneMaterialSide) {
  materialForm.side = value
  commitMaterialProps({ side: value })
}

function handleSliderChange(field: SliderField, value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return
  }
  const config = SLIDER_CONFIG[field] as SliderConfigEntry
  const min: number = Number(config.min ?? 0)
  const max: number = Number(config.max ?? min)
  const rawValue = materialForm[field]
  const fallbackValue: number = typeof rawValue === 'number' ? rawValue : min
  const clamped = clampNumber(value, min, max, fallbackValue)
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
  if (!isTextureDrag(event)) {
    return
  }
  event.preventDefault()
  draggingSlot.value = slot
}

function handleTextureDragOver(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  draggingSlot.value = slot
}

function handleTextureDragLeave(slot: SceneMaterialTextureSlot, event: DragEvent) {
  if (!isTextureDrag(event)) {
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
  if (!isTextureDrag(event)) {
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
  assignTexture(slot, null)
}

function handleMaterialClassChange(value: string | null) {
  if (!activeNodeMaterial.value) {
    return
  }
  const newType = resolveSceneMaterialTypeFromString(value ?? undefined)
  selectedMaterialType.value = newType

  if (isShared.value && selectedMaterialEntry.value) {
    sceneStore.updateMaterialDefinition(selectedMaterialEntry.value.id, { type: newType })
    return
  }

  if (!selectedNodeId.value) {
    return
  }

  sceneStore.updateNodeMaterialType(selectedNodeId.value, activeNodeMaterial.value.id, newType)
}

function handleNameChange(value: string) {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return
  }
  const trimmed = value.trim()
  materialForm.name = trimmed
  if (isShared.value) {
    const shared = selectedMaterialEntry.value
    if (!shared) {
      return
    }
    if (trimmed && trimmed !== shared.name) {
      commitMaterialMetadata({ name: trimmed })
    }
    return
  }
  if (!selectedNodeId.value) {
    return
  }
  const current = entry.name ?? ''
  if (!trimmed && current) {
    commitMaterialMetadata({ name: undefined })
    return
  }
  if (trimmed && trimmed !== current) {
    commitMaterialMetadata({ name: trimmed })
  }
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
  if (isShared.value && selectedMaterialEntry.value) {
    const update: Partial<SceneMaterialProps> & { name?: string; description?: string } = {
      ...payload.props,
    }
    if (payload.name !== undefined) {
      update.name = payload.name
    }
    if (payload.description !== undefined) {
      update.description = payload.description
    }
    sceneStore.updateMaterialDefinition(selectedMaterialEntry.value.id, update)
    return
  }
  if (!selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, activeNodeMaterial.value.id, payload.props)
  if (payload.name !== undefined) {
    sceneStore.updateNodeMaterialMetadata(selectedNodeId.value, activeNodeMaterial.value.id, {
      name: payload.name,
    })
  }
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
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

</script>

<template>
  <Teleport to="body">
    <transition name="material-details-panel">
      <div
        v-if="visible && anchor && activeNodeMaterial"
        ref="panelRef"
        class="material-details-panel"
        :style="panelStyle"
      >
        <v-toolbar density="compact" class="panel-toolbar" height="40px">
          <div class="toolbar-text">
            <div class="material-title">{{ currentMaterialTitle }}</div>
          </div>
          <v-spacer />
          <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleClose" />
        </v-toolbar>
        <v-divider />
        <div class="panel-content">
          <div class="panel-content-inner">


          <div class="material-metadata">
            <v-text-field
              label=""
              density="compact"
              variant="solo"
              hide-details
              :model-value="materialForm.name"
              @update:model-value="handleNameChange"
            />
 
            <v-select
              label="材质类型"
              density="compact"
              variant="solo"
              hide-details
              :items="MATERIAL_CLASS_OPTIONS"
              :model-value="selectedMaterialType"
              @update:model-value="(value) => handleMaterialClassChange(value)"
            />

          </div>

          <div class="material-properties">
            <div class="material-color">
              <label class="material-label">颜色</label>
              <div class="color-input">
                <v-text-field
                  :model-value="materialForm.color"
                  density="compact"
                  variant="solo"
                  hide-details
                  @update:model-value="(value) => handleHexColorChange('color', value ?? materialForm.color)"
                />
                <v-menu
                  v-model="baseColorMenuOpen"
                  :close-on-content-click="false"
                  transition="scale-transition"
                  location="bottom start"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      class="color-swatch"
                      type="button"
                      v-bind="menuProps"
                      :style="{ backgroundColor: materialForm.color }"
                    >
                      <span class="sr-only">选择颜色</span>
                    </button>
                  </template>
                  <div class="color-picker">
                    <v-color-picker
                      :model-value="materialForm.color"
                      mode="hex"
                      :modes="['hex']"
                      hide-inputs
                      @update:model-value="(value) => handleColorPickerInput('color', value)"
                    />
                  </div>
                </v-menu>
              </div>
            </div>
            <div class="material-color">
              <label class="material-label">自发光</label>
              <div class="color-input">
                <v-text-field
                  :model-value="materialForm.emissive"
                  density="compact"
                  variant="solo"
                  hide-details
                  @update:model-value="(value) => handleHexColorChange('emissive', value ?? materialForm.emissive)"
                />
                <v-menu
                  v-model="emissiveColorMenuOpen"
                  :close-on-content-click="false"
                  transition="scale-transition"
                  location="bottom start"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      class="color-swatch"
                      type="button"
                      v-bind="menuProps"
                      :style="{ backgroundColor: materialForm.emissive }"
                    >
                      <span class="sr-only">选择自发光颜色</span>
                    </button>
                  </template>
                  <div class="color-picker">
                    <v-color-picker
                      :model-value="materialForm.emissive"
                      mode="hex"
                      :modes="['hex']"
                      hide-inputs
                      @update:model-value="(value) => handleColorPickerInput('emissive', value)"
                    />
                  </div>
                </v-menu>
              </div>
            </div>
            <v-select
              class="side-select"
              label="面向"
              density="compact"
              variant="solo"
              hide-details
              :items="SIDE_OPTIONS"
              item-value="value"
              item-title="label"
              :model-value="materialForm.side"
              @update:model-value="handleSideChange"
            />
          </div>

          <div class="material-sliders">
            <div
              v-for="field in SLIDER_FIELDS"
              :key="field"
              class="slider-row"
            >
              <div class="slider-row__header">
                <span class="slider-label">{{ field }}</span>
                <span class="slider-value">{{ formatSliderValue(field) }}</span>
              </div>
              <v-number-input
                :model-value="materialForm[field] as number"
                :min="SLIDER_CONFIG[field].min"
                :max="SLIDER_CONFIG[field].max"
                :step="SLIDER_CONFIG[field].step"
                density="compact"
                hide-details
                 control-variant="split"
                variant="solo"
                size="small"
                @update:model-value="(value) => handleSliderChange(field, value)"
              />
            </div>
          </div>

          <div class="texture-section">
            <div class="texture-header">
              <span class="material-label">贴图</span>
    
            </div>
            <div class="texture-grid">
              <div
                v-for="slot in TEXTURE_SLOTS"
                :key="slot"
                class="texture-tile"
                :class="{ 'is-active-drop': draggingSlot === slot }"
                @dragenter="(event) => handleTextureDragEnter(slot, event)"
                @dragover="(event) => handleTextureDragOver(slot, event)"
                @dragleave="(event) => handleTextureDragLeave(slot, event)"
                @drop="(event) => handleTextureDrop(slot, event)"
              >
                <div class="texture-title">{{ TEXTURE_LABELS[slot] }}</div>
                <div class="texture-name">{{ resolveTextureName(slot) }}</div>
                <div class="texture-tile__footer">
                  <v-chip size="x-small" variant="tonal">{{ formTextures[slot]?.assetId ?? '空' }}</v-chip>
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    :disabled="!formTextures[slot]"
                    @click.stop="handleTextureRemove(slot)"
                  />
                </div>
              </div>
            </div>
          </div>

          <input
            ref="importInputRef"
            type="file"
            accept="application/json"
            style="display: none"
            @change="handleImportFileChange"
          />
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.material-details-panel-enter-active,
.material-details-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.material-details-panel-enter-from,
.material-details-panel-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}

.material-details-panel {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  width: 300px;
  max-height: calc(100% - 400px);
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  z-index: 24;
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  
}



.panel-content-inner {
  display: flex;
    padding: 16px;
border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    background-color: rgb(var(--v-theme-surface));
  margin: 4px;
  flex-direction: column;
  gap: 12px;
}

.material-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}

.material-hint {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.6);
}

.material-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.material-assignment {
  display: flex;
  align-items: center;
  gap: 8px;
}

.material-metadata {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.material-properties {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.material-color {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.material-label {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.65);
}

.color-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 0;
  display: inline-block;
  background: transparent;
}

.color-swatch:focus-visible {
  outline: 2px solid rgba(107, 152, 255, 0.8);
  outline-offset: 2px;
}

.color-picker {
  padding: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.material-boolean-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.material-sliders {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slider-row__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.65);
}

.slider-label {
  text-transform: uppercase;
}

.slider-value {
  font-variant-numeric: tabular-nums;
}

.texture-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.texture-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.texture-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.texture-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}

.texture-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  min-height: 110px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(12, 16, 22, 0.45);
  transition: border-color 0.12s ease, background 0.12s ease;
}

.texture-tile.is-active-drop {
  border-color: rgba(107, 152, 255, 0.8);
  background: rgba(56, 86, 160, 0.35);
}

.texture-title {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.texture-name {
  flex: 1;
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.72);
  word-break: break-all;
}

.texture-tile__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
