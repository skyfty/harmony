<script setup lang="ts">
import { computed, reactive, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  normalizeSceneMaterialType,
  type SceneMaterialProps,
  type SceneMaterialSide,
  type SceneMaterialTextureRef,
  type SceneMaterialTextureSlot,
  type SceneMaterialType,
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
// const materialClasses: Record<SceneMaterialType, any> = MATERIAL_CLASS_NAMES.reduce((map, className) => {
//   if (className === 'MeshMatcapMaterial') {
//     map[className] = (THREE as Record<string, any>).MeshMatcapMaterial ?? THREE.MeshStandardMaterial
//     return map
//   }
//   const candidate = (THREE as Record<string, any>)[className]
//   map[className] = typeof candidate === 'function' ? candidate : THREE.MeshStandardMaterial
//   return map
// }, {} as Record<SceneMaterialType, any>)

// const materialClassOptions = computed(() => Object.keys(materialClasses) as SceneMaterialType[])
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
const canSaveMaterial = computed(() =>
  !!selectedNodeId.value &&
  !!activeNodeMaterial.value &&
  !isShared.value &&
  !props.disabled,
)

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
  selectedMaterialType.value = normalizeSceneMaterialType(type)
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

function handleSaveMaterial() {
  if (!canSaveMaterial.value || !selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  const normalizedName = materialForm.name.trim()
  const normalizedDescription = materialForm.description.trim()
  const result = sceneStore.saveNodeMaterialAsShared(selectedNodeId.value, activeNodeMaterial.value.id, {
    name: normalizedName.length ? normalizedName : undefined,
    description: normalizedDescription.length ? normalizedDescription : undefined,
  })
  if (result) {
    activeMaterialId.value = result.id
  }
}

function handleSideChange(value: SceneMaterialSide) {
  materialForm.side = value
  commitMaterialProps({ side: value })
}

function handleSliderChange(field: SliderField, value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return
  }
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return
  }
  const config = SLIDER_CONFIG[field] as SliderConfigEntry
  const min: number = Number(config.min ?? 0)
  const max: number = Number(config.max ?? min)
  const rawValue = materialForm[field]
  const fallbackValue: number = typeof rawValue === 'number' ? rawValue : min
  const clamped = clampNumber(numericValue, min, max, fallbackValue)
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

function resolveTexturePreviewStyle(slot: SceneMaterialTextureSlot): Record<string, string> {
  const ref = formTextures[slot]
  const fallbackColor = 'rgba(233, 236, 241, 0.08)'
  if (!ref) {
    return {
      backgroundColor: fallbackColor,
    }
  }
  const asset = sceneStore.getAsset(ref.assetId)
  if (asset?.thumbnail && asset.thumbnail.trim().length) {
    return {
      backgroundImage: `url(${asset.thumbnail})`,
      backgroundColor: asset.previewColor?.trim().length ? asset.previewColor : fallbackColor,
    }
  }
  if (asset?.previewColor && asset.previewColor.trim().length) {
    return {
      backgroundColor: asset.previewColor,
    }
  }
  return {
    backgroundColor: fallbackColor,
  }
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
  if (asset.type !== 'image' && asset.type !== 'texture') {
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

// function handleMaterialClassChange(value: string | null) {
//   if (!activeNodeMaterial.value) {
//     return
//   }
//   const newType = normalizeSceneMaterialType(value ?? undefined)
//   selectedMaterialType.value = newType

//   if (isShared.value && selectedMaterialEntry.value) {
//     sceneStore.updateMaterialDefinition(selectedMaterialEntry.value.id, { type: newType })
//     return
//   }

//   if (!selectedNodeId.value) {
//     return
//   }

//   sceneStore.updateNodeMaterialType(selectedNodeId.value, activeNodeMaterial.value.id, newType)
// }

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
          <v-btn
            class="toolbar-save"
            variant="text"
            size="small"
            :disabled="!canSaveMaterial"
            title="保存材质为共享资源"
            @click="handleSaveMaterial"
          >
            <v-icon size="16px">mdi-content-save</v-icon>
          </v-btn>
          <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleClose" />
        </v-toolbar>
        <v-divider />
        <div class="panel-content">
          <div class="panel-content-inner">


          <div class="material-metadata">
            <v-text-field
              label=""
              variant="solo"
              density="compact"
              
              hide-details
              :model-value="materialForm.name"
              @update:model-value="handleNameChange"
            />

            <!-- <v-select
              label="材质类型"
              density="compact"
              variant="solo"
              hide-details
              :items="materialClassOptions"
              :model-value="selectedMaterialType"
              @update:model-value="handleMaterialClassChange"
            /> -->

          </div>

          <div class="material-properties">
            <div class="material-color">
              <div class="color-input">
                <v-text-field
                label="Color"
                class="slider-input"
                  :model-value="materialForm.color"
                  density="compact"
              variant="underlined"
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
              <div class="color-input">
                <v-text-field
                class="slider-input"
                label="自发光"
                  :model-value="materialForm.emissive"
                  density="compact"
                  variant="underlined"
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
              transition="null"
              hide-details
              :items="SIDE_OPTIONS"
              item-value="value"
              item-title="label"
              variant="underlined"
              :model-value="materialForm.side"
              @update:model-value="handleSideChange"
            />

            <div
              v-for="field in SLIDER_FIELDS"
              :key="field"
              class="slider-row"
            >
              <v-text-field
                class="slider-input"
                :label="field"
                :model-value="formatSliderValue(field)"
                :min="SLIDER_CONFIG[field].min"
                :max="SLIDER_CONFIG[field].max"
                :step="SLIDER_CONFIG[field].step"
                type="number"
                density="compact"
                hide-details
                variant="underlined"
                inputmode="decimal"
                @update:model-value="(value) => handleSliderChange(field, value)"
              />
            </div>
          </div>

          <div class="texture-section">
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
                <div
                  class="texture-thumb"
                  :class="{ 'texture-thumb--empty': !formTextures[slot] }"
                  :style="resolveTexturePreviewStyle(slot)"
                >
                  <v-icon v-if="!formTextures[slot]" size="20" color="rgba(233, 236, 241, 0.4)">mdi-image-off</v-icon>
                </div>
                <div class="texture-info">
                  <div class="texture-name">{{ resolveTextureName(slot) }}</div>
                  <div class="texture-slot-label">{{ TEXTURE_LABELS[slot] }}</div>
                </div>
                <v-btn
                  class="texture-remove"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :disabled="!formTextures[slot]"
                  title="移除贴图"
                  @click.stop="handleTextureRemove(slot)"
                />
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

.toolbar-save {
  color: rgba(233, 236, 241, 0.82);
  font-weight: 500;
  text-transform: none;
}

.toolbar-save:disabled {
  color: rgba(233, 236, 241, 0.32) !important;
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
  gap: 22px;
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
  gap: 5px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.texture-tile {
  position: relative;
  display: grid;
  grid-template-columns: 30px 1fr auto;
  grid-template-rows: repeat(2, auto);
  column-gap: 10px;
  row-gap: 1px;
  align-items: center;
  padding: 3px;
  min-height: 32px;
  border-radius: 4px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(12, 16, 22, 0.45);
  transition: border-color 0.12s ease, background 0.12s ease;
}

.texture-tile.is-active-drop {
  border-color: rgba(107, 152, 255, 0.8);
  background: rgba(56, 86, 160, 0.35);
}

.texture-thumb {
  grid-row: 1 / span 2;
  grid-column: 1;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background-color: rgba(233, 236, 241, 0.08);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.texture-thumb--empty {
  border-style: dashed;
}

.texture-info {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.texture-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.9);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.texture-slot-label {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.texture-remove {
  grid-column: 3;
  grid-row: 1;
  align-self: start;
  color: rgba(233, 236, 241, 0.7);
}

.texture-remove:disabled {
  color: rgba(233, 236, 241, 0.25) !important;
}

.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}
.menu-dropdown {
  background: rgba(18, 21, 26, 0.95);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  padding: 6px;
}

.menu-submenu {
  padding: 6px;
}

.menu-list-item {
  color: rgba(244, 247, 255, 0.9);
  font-size: 0.9rem;
  padding: 0px 18px;
  border-radius: 8px;
  transition: background-color 0.18s ease;
  min-width: 160px;
  min-height: 28px;
  
}
</style>
