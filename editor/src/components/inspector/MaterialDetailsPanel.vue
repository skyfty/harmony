<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import {
  DEFAULT_SCENE_MATERIAL_ID,
  type SceneMaterialProps,
  type SceneMaterialSide,
  type SceneMaterialTextureRef,
  type SceneMaterialTextureSettings,
  cloneTextureSettings,
  createTextureSettings,
} from '@/types/material'
import TexturePanel from './TexturePanel.vue'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import {type SceneMaterialType, type SceneMaterialTextureSlot} from '@harmony/schema'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

type TextureMapState = Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>

interface MaterialFormState extends Omit<SceneMaterialProps, 'textures'> {
  name: string
  description: string
  textures: TextureMapState
}

const SLIDER_FIELDS = ['opacity', 'metalness', 'roughness', 'emissiveIntensity', 'aoStrength', 'envMapIntensity'] as const

const COMMON_SLIDER_FIELDS: readonly SliderField[] = ['opacity', 'metalness', 'roughness']

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

const TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'metalness', 'roughness', 'ao', 'emissive', 'displacement']
const COMMON_TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'roughness']
const MATERIAL_FLAG_OPTIONS = [
  { value: 'transparent', label: 'Transparent' },
  { value: 'wireframe', label: 'Wireframe' },
] as const

type MaterialFlagOption = (typeof MATERIAL_FLAG_OPTIONS)[number]['value']
const TEXTURE_LABELS: Record<SceneMaterialTextureSlot, string> = {
  albedo: 'Albedo',
  normal: 'Normal',
  metalness: 'Metalness',
  roughness: 'Roughness',
  ao: 'Ambient Occlusion',
  emissive: 'Emissive',
  displacement: 'Displacement',
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

function cloneTextureFormRef(ref: SceneMaterialTextureRef | null): SceneMaterialTextureRef | null {
  if (!ref) {
    return null
  }
  return {
    assetId: ref.assetId,
    name: ref.name,
    settings: cloneTextureSettings(ref.settings),
  }
}

const DEFAULT_PROPS: SceneMaterialProps = {
  color: '#ffffff',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.1,
  roughness: 1.0,
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
const hasPendingChanges = ref(false)
const originalSharedMaterialId = ref<string | null>(null)
const saveSharedDialogVisible = ref(false)
const defaultMaterialId = computed(() => (
  materials.value.some((material) => material.id === DEFAULT_SCENE_MATERIAL_ID)
    ? DEFAULT_SCENE_MATERIAL_ID
    : null
))
const lastSyncedMaterialId = ref<string | null>(null)
const showAllProperties = ref(false)

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

const texturePanelExpanded = reactive<Record<SceneMaterialTextureSlot, boolean>>(
  TEXTURE_SLOTS.reduce((acc, slot) => {
    acc[slot] = false
    return acc
  }, {} as Record<SceneMaterialTextureSlot, boolean>),
)

const assetDialogVisible = ref(false)
const assetDialogSlot = ref<SceneMaterialTextureSlot | null>(null)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const TEXTURE_ASSET_TYPE = 'texture,image,hdri' as const

const assetDialogTitle = computed(() => {
  const slot = assetDialogSlot.value
  if (!slot) {
    return '选择贴图资产'
  }
  return `选择 ${TEXTURE_LABELS[slot]} 贴图`
})

const activeMaterialIndex = computed(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return -1
  }
  return nodeMaterials.value.findIndex((item) => item.id === entry.id)
})

const selectedMaterialType = ref<SceneMaterialType | null>(null)
const isUiDisabled = computed(() => !!props.disabled)
const canSaveMaterial = computed(() =>
  !!selectedNodeId.value &&
  !!activeNodeMaterial.value &&
  !isUiDisabled.value &&
  hasPendingChanges.value,
)

const visibleSliderFields = computed<SliderField[]>(() =>
  showAllProperties.value ? [...SLIDER_FIELDS] : [...COMMON_SLIDER_FIELDS],
)

const visibleTextureSlots = computed<SceneMaterialTextureSlot[]>(() =>
  showAllProperties.value ? [...TEXTURE_SLOTS] : [...COMMON_TEXTURE_SLOTS],
)

const materialFlagSelection = computed<MaterialFlagOption[]>({
  get() {
    const selection: MaterialFlagOption[] = []
    if (materialForm.transparent) {
      selection.push('transparent')
    }
    if (materialForm.wireframe) {
      selection.push('wireframe')
    }
    return selection
  },
  set(values) {
    const next = new Set(values)
    const nextTransparent = next.has('transparent')
    const nextWireframe = next.has('wireframe')
    if (materialForm.transparent !== nextTransparent) {
      materialForm.transparent = nextTransparent
      commitMaterialProps({ transparent: nextTransparent })
    }
    if (materialForm.wireframe !== nextWireframe) {
      materialForm.wireframe = nextWireframe
      commitMaterialProps({ wireframe: nextWireframe })
    }
  },
})

const currentMaterialTitle = computed(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return 'Material'
  }
  if (entry.materialId) {
    const shared = materials.value.find((item) => item.id === entry.materialId)
    return shared?.name ?? entry.name ?? 'Material'
  }
  return entry.name ?? `Material ${activeMaterialIndex.value + 1}`
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
    if (!visible) {
      baseColorMenuOpen.value = false
      emissiveColorMenuOpen.value = false
      saveSharedDialogVisible.value = false
      showAllProperties.value = false
      resetTexturePanelExpansion()
    }
  },
)

watch(assetDialogVisible, (open) => {
  if (!open) {
    assetDialogSlot.value = null
    assetDialogSelectedId.value = ''
    assetDialogAnchor.value = null
  }
})

watch(
  () => activeNodeMaterial.value,
  (entry) => {
    if (!entry) {
      baseColorMenuOpen.value = false
      emissiveColorMenuOpen.value = false
      activeMaterialId.value = null
      originalSharedMaterialId.value = null
      lastSyncedMaterialId.value = null
      selectedMaterialType.value = null
      resetDirtyState()
      saveSharedDialogVisible.value = false
      showAllProperties.value = false
      resetTexturePanelExpansion()
      applyPropsToForm(DEFAULT_PROPS, { name: '', description: '' })
      return
    }
    const isNewSelection = entry.id !== lastSyncedMaterialId.value
    const shared = entry.materialId ? materials.value.find((material) => material.id === entry.materialId) ?? null : null
    activeMaterialId.value = shared?.id ?? null
    const metadata = shared
      ? { name: shared.name, description: shared.description ?? '' }
      : { name: entry.name ?? '', description: '' }
    applyPropsToForm(shared ?? entry, metadata)
    const type = shared?.type ?? entry.type ?? null
    selectedMaterialType.value = type
    if (isNewSelection) {
      originalSharedMaterialId.value = shared?.id ?? null
      resetDirtyState()
      saveSharedDialogVisible.value = false
      showAllProperties.value = false
      resetTexturePanelExpansion()
    }
    lastSyncedMaterialId.value = entry.id
  },
  { immediate: true },
)

function handleClose() {
  emit('close')
}

function resetDirtyState() {
  hasPendingChanges.value = false
}

function resetTexturePanelExpansion() {
  TEXTURE_SLOTS.forEach((slot) => {
    texturePanelExpanded[slot] = false
  })
}

function markMaterialDirty() {
  hasPendingChanges.value = true
}

function ensureEditableMaterial(): boolean {
  if (!activeNodeMaterial.value || !selectedNodeId.value) {
    return false
  }
  const defaultId = defaultMaterialId.value
  if (defaultId && activeNodeMaterial.value.materialId === defaultId) {
    const detached = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, null)
    if (detached) {
      originalSharedMaterialId.value = null
      activeMaterialId.value = null
      return true
    }
    return false
  }
  if (!activeNodeMaterial.value.materialId) {
    return true
  }
  if (!originalSharedMaterialId.value) {
    originalSharedMaterialId.value = activeNodeMaterial.value.materialId
  }
  const detached = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, null)
  return detached
}

function buildMaterialPropsFromForm(): SceneMaterialProps {
  const textures = createEmptyTextureMap()
  TEXTURE_SLOTS.forEach((slot) => {
    const ref = formTextures[slot]
    textures[slot] = ref
      ? { assetId: ref.assetId, name: ref.name, settings: cloneTextureSettings(ref.settings) }
      : null
  })
  const toNumber = (value: unknown, fallback: number): number => {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
  }
  return {
    color: materialForm.color,
    transparent: materialForm.transparent,
    opacity: toNumber(materialForm.opacity, DEFAULT_PROPS.opacity),
    side: materialForm.side,
    wireframe: materialForm.wireframe,
    metalness: toNumber(materialForm.metalness, DEFAULT_PROPS.metalness),
    roughness: toNumber(materialForm.roughness, DEFAULT_PROPS.roughness),
    emissive: materialForm.emissive,
    emissiveIntensity: toNumber(materialForm.emissiveIntensity, DEFAULT_PROPS.emissiveIntensity),
    aoStrength: toNumber(materialForm.aoStrength, DEFAULT_PROPS.aoStrength),
    envMapIntensity: toNumber(materialForm.envMapIntensity, DEFAULT_PROPS.envMapIntensity),
    textures,
  }
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
  return tryNormalizeHexColor(value) ?? fallback
}

function tryNormalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return null
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
    formTextures[slot] = cloneTextureFormRef(ref)
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
  if (!ensureEditableMaterial()) {
    return
  }
  const nodeEntry = activeNodeMaterial.value
  if (!nodeEntry) {
    return
  }
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, nodeEntry.id, update)
  markMaterialDirty()
}

function commitMaterialMetadata(update: { name?: string }) {
  if (!activeNodeMaterial.value || !selectedNodeId.value) {
    return
  }
  if (!ensureEditableMaterial()) {
    return
  }
  const nodeEntry = activeNodeMaterial.value
  if (!nodeEntry) {
    return
  }
  if (update.name !== undefined) {
    sceneStore.updateNodeMaterialMetadata(selectedNodeId.value, nodeEntry.id, {
      name: update.name,
    })
    markMaterialDirty()
  }
}

function handleHexColorChange(field: 'color' | 'emissive', value: string | null) {
  const nextValue = typeof value === 'string' ? value : ''
  materialForm[field] = nextValue
  const normalized = tryNormalizeHexColor(nextValue)
  if (!normalized) {
    return
  }
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
  if (originalSharedMaterialId.value) {
    saveSharedDialogVisible.value = true
    return
  }
  saveCurrentMaterialAsShared()
}

function saveCurrentMaterialAsShared() {
  if (!selectedNodeId.value || !activeNodeMaterial.value) {
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
    originalSharedMaterialId.value = result.id
    resetDirtyState()
  }
}

function handleConfirmSaveShared() {
  if (!originalSharedMaterialId.value) {
    saveSharedDialogVisible.value = false
    return
  }
  const props = buildMaterialPropsFromForm()
  const normalizedName = materialForm.name.trim()
  const normalizedDescription = materialForm.description.trim()
  const updated = sceneStore.updateMaterialDefinition(originalSharedMaterialId.value, {
    ...props,
    name: normalizedName.length ? normalizedName : undefined,
    description: normalizedDescription.length ? normalizedDescription : undefined,
    type: selectedMaterialType.value ?? undefined,
  })
  if (!updated) {
    saveSharedDialogVisible.value = false
    return
  }
  if (selectedNodeId.value && activeNodeMaterial.value) {
    sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, originalSharedMaterialId.value)
    activeMaterialId.value = originalSharedMaterialId.value
  }
  saveSharedDialogVisible.value = false
  resetDirtyState()
}

function handleDetachSharedMaterial() {
  saveSharedDialogVisible.value = false
  originalSharedMaterialId.value = null
  activeMaterialId.value = null
  resetDirtyState()
}

function handleCancelSharedDialog() {
  saveSharedDialogVisible.value = false
}

function handleSideChange(value: SceneMaterialSide) {
  materialForm.side = value
  commitMaterialProps({ side: value })
}

function toggleShowAllProperties() {
  showAllProperties.value = !showAllProperties.value
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
    return 'Not specified'
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
  const thumbnailUrl = assetCacheStore.resolveAssetThumbnail({ asset, assetId: ref.assetId })
  if (thumbnailUrl) {
    const backgroundColor = asset?.previewColor?.trim().length ? asset.previewColor : fallbackColor
    return {
      backgroundImage: `url(${thumbnailUrl})`,
      backgroundColor,
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
  if (asset.type !== 'image' && asset.type !== 'texture' && asset.type !== 'hdri') {
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
  formTextures[slot] = cloneTextureFormRef(ref)
  const payload = ref
    ? { assetId: ref.assetId, name: ref.name, settings: cloneTextureSettings(ref.settings) }
    : null
  commitMaterialProps({ textures: { [slot]: payload } })
}

function ensureTextureAssetCached(asset: ProjectAsset) {
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache texture asset', error)
  })
}

function handleTextureThumbClick(slot: SceneMaterialTextureSlot, event?: MouseEvent) {
  if (isUiDisabled.value) {
    return
  }
  if (event) {
    assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  } else {
    assetDialogAnchor.value = null
  }
  assetDialogSlot.value = slot
  assetDialogSelectedId.value = formTextures[slot]?.assetId ?? ''
  assetDialogVisible.value = true
}

function applyTextureAsset(slot: SceneMaterialTextureSlot, asset: ProjectAsset) {
  const current = formTextures[slot]
  const nextSettings = current?.settings ? cloneTextureSettings(current.settings) : createTextureSettings()
  assignTexture(slot, { assetId: asset.id, name: asset.name, settings: nextSettings })
  ensureTextureAssetCached(asset)
}


function handleTextureUpdate(asset: ProjectAsset | null) {
  const slot = assetDialogSlot.value
  assetDialogSelectedId.value = asset?.id ?? ''
  if (!asset || !slot) {
    if (slot) {
      assignTexture(slot, null)
    }
    assetDialogVisible.value = false
    return
  }
  applyTextureAsset(slot, asset)
  assetDialogVisible.value = false
}

function handleTextureAssetCancel() {
  assetDialogVisible.value = false
  assetDialogAnchor.value = null
}

function toggleTexturePanel(slot: SceneMaterialTextureSlot) {
  texturePanelExpanded[slot] = !texturePanelExpanded[slot]
}

function handleTexturePanelChange(slot: SceneMaterialTextureSlot, ref: SceneMaterialTextureRef | null) {
  if (!ref) {
    return
  }
  assignTexture(slot, ref)
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
    console.warn('Dragged asset is not an image and cannot be used as a material texture')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  draggingSlot.value = null
  ensureTextureAssetCached(asset)
  assignTexture(slot, { assetId: asset.id, name: asset.name, settings: createTextureSettings() })
}

function handleTextureRemove(slot: SceneMaterialTextureSlot) {
  assignTexture(slot, null)
}

function handleNameChange(value: string) {
  const entry = activeNodeMaterial.value
  if (!entry) {
    return
  }
  const trimmed = value.trim()
  materialForm.name = trimmed
  const current = entry.name ?? ''
  if (!trimmed && current) {
    commitMaterialMetadata({ name: '' })
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
      const settings = typeof ref.settings === 'object' && ref.settings
        ? createTextureSettings(ref.settings as Partial<SceneMaterialTextureSettings>)
        : undefined
      textures[slot] = {
        assetId: ref.assetId,
        name: typeof ref.name === 'string' ? ref.name : undefined,
        settings,
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
  if (!selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  if (!ensureEditableMaterial()) {
    return
  }
  const nodeEntry = activeNodeMaterial.value
  if (!nodeEntry) {
    return
  }
  sceneStore.updateNodeMaterialProps(selectedNodeId.value, nodeEntry.id, payload.props)
  if (payload.name !== undefined) {
    sceneStore.updateNodeMaterialMetadata(selectedNodeId.value, nodeEntry.id, {
      name: payload.name,
    })
  }
  markMaterialDirty()
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
        v-if="visible && anchor"
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
            title="Save material as shared"
            @click="handleSaveMaterial"
          >
            <v-icon size="16px">mdi-content-save</v-icon>
          </v-btn>
          <v-btn
            class="toolbar-more"
            variant="text"
            size="small"
            :title="showAllProperties ? 'Hide less-used properties' : 'Show more properties'"
            :icon="showAllProperties ? 'mdi-unfold-less-horizontal' : 'mdi-unfold-more-horizontal'"
            @click="toggleShowAllProperties"
          />
          <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleClose" />
        </v-toolbar>
        <v-divider />
        <div class="panel-content">
          <div v-if="activeNodeMaterial" class="panel-content-inner">
            <div class="material-metadata">
              <v-text-field
                label=""
                variant="solo"
                density="compact"
                hide-details
                :model-value="materialForm.name"
                @update:model-value="handleNameChange"
              />
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
                      @update:model-value="(value) => handleHexColorChange('color', value ?? '')"
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
                        <span class="sr-only">Choose color</span>
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
                    label="Emissive"
                    :model-value="materialForm.emissive"
                    density="compact"
                    variant="underlined"
                    hide-details
                    @update:model-value="(value) => handleHexColorChange('emissive', value ?? '')"
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
                        <span class="sr-only">Choose emissive color</span>
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
                label="Side"
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

              <v-select
                v-if="showAllProperties"
                v-model="materialFlagSelection"
                class="material-flag-select"
                label="Render Options"
                density="compact"
                variant="underlined"
                hide-details
                multiple
                :items="MATERIAL_FLAG_OPTIONS"
                item-title="label"
                item-value="value"
              />

              <div
                v-for="field in visibleSliderFields"
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
                  v-for="slot in visibleTextureSlots"
                  :key="slot"
                  class="texture-item"
                >
                  <div
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
                      role="button"
                      @click="handleTextureThumbClick(slot, $event)"
                    >
                      <v-icon v-if="!formTextures[slot]" size="20" color="rgba(233, 236, 241, 0.4)">mdi-image-off</v-icon>
                    </div>
                    <div class="texture-info">
                      <div class="texture-name">{{ resolveTextureName(slot) }}</div>
                      <div class="texture-slot-label">{{ TEXTURE_LABELS[slot] }}</div>
                    </div>
                    <div class="texture-actions">
                      <v-btn
                        class="texture-remove"
                        icon="mdi-close"
                        size="x-small"
                        variant="text"
                        :disabled="!formTextures[slot]"
                        title="Remove texture"
                        @click.stop="handleTextureRemove(slot)"
                      />
                      <v-btn
                        class="texture-toggle"
                        size="x-small"
                        variant="text"
                        :icon="texturePanelExpanded[slot] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                        :title="texturePanelExpanded[slot] ? 'Hide texture settings' : 'Show texture settings'"
                        @click.stop="toggleTexturePanel(slot)"
                      />
                    </div>
                  </div>
                  <TexturePanel
                    v-if="texturePanelExpanded[slot]"
                    class="texture-panel-wrapper"
                    :model-value="formTextures[slot]"
                    :disabled="isUiDisabled || !formTextures[slot]"
                    @update:model-value="(value) => handleTexturePanelChange(slot, value)"
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
            <v-dialog v-model="saveSharedDialogVisible" max-width="420">
              <v-card>
                <v-card-title class="text-h6">Update Shared Material</v-card-title>
                <v-card-text>
                  Choosing "Update Shared" will overwrite the shared material and synchronize it across all referencing objects; choosing "Detach" will keep only the current object's material as a separate instance.
                </v-card-text>
                <v-card-actions>
                  <v-btn variant="text" @click="handleCancelSharedDialog">Cancel</v-btn>
                  <v-spacer />
                  <v-btn variant="text" @click="handleDetachSharedMaterial">Detach</v-btn>
                  <v-btn color="primary" variant="tonal" @click="handleConfirmSaveShared">Update Shared</v-btn>
                </v-card-actions>
              </v-card>
            </v-dialog>
            <AssetPickerDialog
              v-model="assetDialogVisible"
              :asset-id="assetDialogSelectedId"
              :asset-type="TEXTURE_ASSET_TYPE"
              :title="assetDialogTitle"
              :anchor="assetDialogAnchor"
              confirm-text="选择"
              cancel-text="取消"
              @update:asset="handleTextureUpdate"
              @cancel="handleTextureAssetCancel"
            />
          </div>
          <div v-else class="panel-empty-state">
            <div class="empty-message">该节点没有材质信息</div>
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

.toolbar-more {
  color: rgba(233, 236, 241, 0.82);
  font-weight: 500;
  text-transform: none;
  min-width: unset;
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

.material-flag-select {
  max-width: 100%;
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

.texture-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.texture-panel-wrapper {
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(12, 16, 22, 0.55);
  padding: 8px;
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
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.texture-thumb--empty {
  border-style: dashed;
}

.texture-thumb:hover {
  border-color: rgba(77, 208, 225, 0.75);
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.35);
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
.v-field-label {
  font-size: 0.82rem;
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

.panel-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: rgba(233, 236, 241, 0.7);
}

.empty-message {
  font-size: 0.85rem;
  line-height: 1.4;
}
</style>
