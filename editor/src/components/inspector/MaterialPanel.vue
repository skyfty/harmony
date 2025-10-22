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
  SceneNodeMaterial,
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

const nodeMaterials = computed(() => selectedNode.value?.materials ?? [])
const activeNodeMaterialId = ref<string | null>(null)
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

const activeNodeMaterial = computed(() => {
  if (!nodeMaterials.value.length) {
    return null
  }
  if (activeNodeMaterialId.value) {
    const match = nodeMaterials.value.find((entry) => entry.id === activeNodeMaterialId.value)
    if (match) {
      return match
    }
  }
  return nodeMaterials.value[0] ?? null
})

const selectedMaterialEntry = computed(() =>
  activeMaterialId.value ? materials.value.find((material) => material.id === activeMaterialId.value) ?? null : null,
)

const isShared = computed(() => !!selectedMaterialEntry.value)

const activeMaterialIndex = computed(() => {
  if (!activeNodeMaterial.value) {
    return -1
  }
  return nodeMaterials.value.findIndex((entry) => entry.id === activeNodeMaterial.value?.id)
})

const materialOptions = computed(() =>
  materials.value.map((material) => ({
    title: material.name,
    value: material.id,
    subtitle: material.description ?? '',
  })),
)

const materialListEntries = computed(() =>
  nodeMaterials.value.map((entry, index) => {
    const shared = entry.materialId ? materials.value.find((material) => material.id === entry.materialId) ?? null : null
    return {
      id: entry.id,
      displayName: shared?.name ?? entry.name ?? `材质 ${index + 1}`,
      subtitle: shared ? '共享材质' : '本地材质',
      shared: Boolean(shared),
      index,
    }
  }),
)

const currentMaterialTitle = computed(() => {
  const activeId = activeNodeMaterial.value?.id ?? null
  if (!activeId) {
    return '材质'
  }
  const entry = materialListEntries.value.find((item) => item.id === activeId)
  return entry?.displayName ?? `材质 ${activeMaterialIndex.value + 1}`
})

const canAddMaterialSlot = computed(() => !!selectedNodeId.value && !props.disabled)
const panelDisabled = computed(() => props.disabled || !selectedNodeId.value || !activeNodeMaterial.value)
const canDuplicateMaterial = computed(() => isShared.value && !!activeMaterialId.value && !panelDisabled.value)
const canDeleteMaterial = computed(
  () => isShared.value && materials.value.length > 1 && !!activeMaterialId.value && !panelDisabled.value,
)
const canMakeLocal = computed(() => isShared.value && !panelDisabled.value)

const assignmentHint = computed(() => {
  if (!activeNodeMaterial.value) {
    return '请选择材质槽以查看属性。'
  }
  return isShared.value
    ? '已链接共享材质，修改会影响所有使用该材质的网格。'
    : '当前为本地覆盖，修改仅作用于此网格。'
})

watch(
  () => nodeMaterials.value.map((material) => material.id).join('::'),
  (signature) => {
    if (!signature.length) {
      activeNodeMaterialId.value = null
      activeMaterialId.value = null
      resetForm()
      return
    }
    const ids = signature.split('::').filter(Boolean)
    if (!ids.length) {
      activeNodeMaterialId.value = null
      activeMaterialId.value = null
      resetForm()
      return
    }
    if (!activeNodeMaterialId.value || !ids.includes(activeNodeMaterialId.value)) {
      activeNodeMaterialId.value = ids[0] ?? null
    }
  },
  { immediate: true },
)

watchEffect(() => {
  const entry = activeNodeMaterial.value
  if (!entry) {
    activeMaterialId.value = null
    resetForm()
    return
  }
  const shared = entry.materialId ? materials.value.find((material) => material.id === entry.materialId) ?? null : null
  activeMaterialId.value = shared?.id ?? null
  const metadata = shared
    ? { name: shared.name, description: shared.description ?? '' }
    : { name: entry.name ?? '', description: '' }
  applyPropsToForm(shared ?? entry, metadata)
})

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

function commitMaterialProps(update: Partial<SceneMaterialProps>) {
  if (panelDisabled.value || !activeNodeMaterial.value || !selectedNodeId.value) {
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

function setActiveNodeMaterial(id: string) {
  if (activeNodeMaterialId.value === id) {
    return
  }
  activeNodeMaterialId.value = id
}

function handleAddMaterialSlot() {
  if (!canAddMaterialSlot.value || !selectedNodeId.value) {
    return
  }
  const created = sceneStore.addNodeMaterial(selectedNodeId.value) as SceneNodeMaterial | null
  if (created) {
    activeNodeMaterialId.value = created.id
  }
}

function handleMaterialSelection(value: string | null) {
  if (!selectedNodeId.value || !activeNodeMaterial.value || panelDisabled.value) {
    return
  }
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const targetId = trimmed.length ? trimmed : null
  const applied = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, targetId)
  if (applied) {
    activeMaterialId.value = targetId
  }
}

function handleClearMaterial() {
  makeLocalCopy()
}

function handleCreateMaterial() {
  if (panelDisabled.value || !selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  const created = sceneStore.createMaterial()
  if (created) {
    const linked = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, created.id)
    if (linked) {
      activeMaterialId.value = created.id
    }
  }
}

function handleDuplicateMaterial() {
  if (!canDuplicateMaterial.value || !activeMaterialId.value || !selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  const duplicated = sceneStore.duplicateMaterial(activeMaterialId.value)
  if (duplicated) {
    const linked = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, duplicated.id)
    if (linked) {
      activeMaterialId.value = duplicated.id
    }
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
  if (!canMakeLocal.value || !selectedNodeId.value || !activeNodeMaterial.value) {
    return
  }
  const converted = sceneStore.assignNodeMaterial(selectedNodeId.value, activeNodeMaterial.value.id, null)
  if (converted) {
    activeMaterialId.value = null
  }
}

function handleHexColorChange(field: 'color' | 'emissive', value: string) {
  if (panelDisabled.value) {
    return
  }
  const normalized = normalizeHexColor(value, materialForm[field])
  materialForm[field] = normalized
  if (field === 'color') {
    commitMaterialProps({ color: normalized })
  } else {
    commitMaterialProps({ emissive: normalized })
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
  const config = SLIDER_CONFIG[field] as SliderConfigEntry
  const min: number = Number(config.min ?? 0)
  const max: number = Number(config.max ?? min)
  const rawValue = materialForm[field]
  const fallbackValue: number = typeof rawValue === 'number' ? rawValue : min
  const clamped = clampNumber(numericCandidate, min, max, fallbackValue)
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
  if (!activeNodeMaterial.value) {
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
  const current = activeNodeMaterial.value.name ?? ''
  if (!trimmed && current) {
    commitMaterialMetadata({ name: undefined })
    return
  }
  if (trimmed && trimmed !== current) {
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
  if (!activeNodeMaterial.value || panelDisabled.value) {
    return
  }
  const target = (isShared.value ? selectedMaterialEntry.value : activeNodeMaterial.value) || null
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
    : materialForm.name || activeNodeMaterial.value.name || `Material ${activeMaterialIndex.value + 1}`
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
      <div class="material-panel">
        <div class="material-panel__list">
          <div class="list-header">
            <span>材质槽</span>
            <v-btn
              icon="mdi-plus"
              size="small"
              variant="text"
              :disabled="!canAddMaterialSlot"
              @click="handleAddMaterialSlot"
            />
          </div>
          <v-list density="compact" nav class="material-list">
            <v-list-item
              v-for="entry in materialListEntries"
              :key="entry.id"
              :value="entry.id"
              :active="entry.id === activeNodeMaterial?.id"
              :class="{ 'is-active': entry.id === activeNodeMaterial?.id }"
              @click="setActiveNodeMaterial(entry.id)"
            >
              <template #prepend>
                <v-chip
                  size="x-small"
                  :color="entry.shared ? 'primary' : 'grey-darken-2'"
                  :variant="entry.shared ? 'elevated' : 'flat'"
                >
                  {{ entry.shared ? '共享' : '本地' }}
                </v-chip>
              </template>
              <v-list-item-title>{{ entry.displayName }}</v-list-item-title>
              <v-list-item-subtitle>槽位 {{ entry.index + 1 }} · {{ entry.subtitle }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </div>

        <div class="material-panel__details" v-if="activeNodeMaterial">
          <div class="material-section-header">
            <div>
              <div class="material-title">{{ currentMaterialTitle }}</div>
              <div class="material-hint">{{ assignmentHint }}</div>
            </div>
            <div class="material-actions">
              <v-btn
                icon="mdi-file-plus"
                size="small"
                variant="text"
                :disabled="panelDisabled"
                @click="handleCreateMaterial"
              />
              <v-btn
                icon="mdi-content-copy"
                size="small"
                variant="text"
                :disabled="!canDuplicateMaterial"
                @click="handleDuplicateMaterial"
              />
              <v-btn
                icon="mdi-delete"
                size="small"
                variant="text"
                :disabled="!canDeleteMaterial"
                @click="handleDeleteMaterial"
              />
            </div>
          </div>

          <v-divider class="my-2" />

          <div class="material-assignment">
            <v-select
              :model-value="activeMaterialId"
              :items="materialOptions"
              label="共享材质"
              clearable
              hide-details
              density="compact"
              variant="solo"
              :disabled="panelDisabled"
              @update:model-value="handleMaterialSelection"
              @click:clear="handleClearMaterial"
            />
            <v-btn
              variant="tonal"
              size="small"
              :disabled="!canMakeLocal"
              @click="makeLocalCopy"
            >
              断开链接
            </v-btn>
          </div>

          <div class="material-metadata">
            <v-text-field
              label="名称"
              density="compact"
              variant="solo"
              hide-details
              :disabled="panelDisabled"
              :model-value="materialForm.name"
              @update:model-value="handleNameChange"
            />
            <v-text-field
              v-if="isShared"
              label="描述"
              density="compact"
              variant="solo"
              hide-details
              :disabled="panelDisabled"
              :model-value="materialForm.description"
              @update:model-value="handleDescriptionChange"
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
                  :disabled="panelDisabled"
                  @update:model-value="(value) => handleHexColorChange('color', value ?? materialForm.color)"
                />
                <span class="color-swatch" :style="{ backgroundColor: materialForm.color }" />
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
                  :disabled="panelDisabled"
                  @update:model-value="(value) => handleHexColorChange('emissive', value ?? materialForm.emissive)"
                />
                <span class="color-swatch" :style="{ backgroundColor: materialForm.emissive }" />
              </div>
            </div>
            <div class="material-boolean-row">
              <v-switch
                hide-details
                density="compact"
                label="透明"
                color="primary"
                :disabled="panelDisabled"
                :model-value="materialForm.transparent"
                @update:model-value="(value) => handleBooleanChange('transparent', value)"
              />
              <v-switch
                hide-details
                density="compact"
                label="线框"
                color="primary"
                :disabled="panelDisabled"
                :model-value="materialForm.wireframe"
                @update:model-value="(value) => handleBooleanChange('wireframe', value)"
              />
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
              :disabled="panelDisabled"
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
              <v-slider
                :model-value="materialForm[field] as number"
                :min="SLIDER_CONFIG[field].min"
                :max="SLIDER_CONFIG[field].max"
                :step="SLIDER_CONFIG[field].step"
                density="compact"
                :disabled="panelDisabled"
                @update:model-value="(value) => handleSliderChange(field, value)"
              />
            </div>
          </div>

          <div class="texture-section">
            <div class="texture-header">
              <span class="material-label">贴图</span>
              <div class="texture-actions">
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="panelDisabled"
                  @click="triggerImport"
                >
                  导入
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="panelDisabled"
                  @click="handleExportMaterial"
                >
                  导出
                </v-btn>
              </div>
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
                    :disabled="panelDisabled || !formTextures[slot]"
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

        <div v-else class="material-empty">
          该对象没有可编辑的材质槽。
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.material-panel {
  display: flex;
  gap: 12px;
  min-height: 260px;
}

.material-panel__list {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.76);
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

.material-panel__details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.material-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.material-title {
  font-size: 0.95rem;
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
  gap: 4px;
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
}

.material-boolean-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.side-select {
  max-width: 200px;
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

.material-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  color: rgba(233, 236, 241, 0.55);
  min-height: 200px;
}
</style>
