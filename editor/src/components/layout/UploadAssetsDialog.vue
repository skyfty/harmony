<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { getLastExtensionFromFilenameOrUrl, isSkyCubeArchiveExtension } from '@schema/assetTypeConversion'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useAuthStore } from '@/stores/authStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ResourceCategory } from '@/types/resource-category'
import CategoryPathSelector from '@/components/common/CategoryPathSelector.vue'
import AssetPreviewRenderer from '@/components/common/AssetPreviewRenderer.vue'
import { buildCategoryPathString } from '@/utils/categoryPath'
import {
  createAssetTag,
  fetchAssetTags,
  generateAssetTagSuggestions,
  mapServerAssetToProjectAsset,
  fetchResourceCategories,
  uploadAssetBundleToServer,
} from '@/api/resourceAssets'
import { ensureAuthenticatedForResourceUpload } from '@/utils/uploadGuard'
import { buildAssetBundle } from '@/utils/assetBundle'
import {
  generateAssetThumbnail,
  ASSET_THUMBNAIL_HEIGHT,
  ASSET_THUMBNAIL_WIDTH,
  createThumbnailFromCanvas,
} from '@/utils/assetThumbnail'
import { dataUrlToBlob, extractExtension } from '@/utils/blob'
import { detectAssetPreviewPresetKind } from '@/utils/assetPreviewPreset'
import {
  collectConfigAssetDependencyIds,
  isConfigAssetExtension,
  resolveConfigAssetReferenceId,
} from '@/utils/assetDependencySubset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

const TYPE_COLOR_FALLBACK: Record<ProjectAsset['type'], string> = {
  model: '#26c6da',
  mesh: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  hdri: '#009688',
  material: '#ffb74d',
  prefab: '#7986cb',
  lod: '#7986cb',
  video: '#ff7043',
  file: '#546e7a',
  behavior: '#607d8b',
}

const scatterPresetOptions = Object.entries(terrainScatterPresets).map(([value, preset]) => ({
  value: value as TerrainScatterCategory,
  label: preset.label,
  icon: preset.icon,
}))

const props = defineProps<{
  modelValue: boolean
  assets: ProjectAsset[]
  tagOptions?: TagOption[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'uploaded', payload: { successCount: number; replacementMap: Record<string, string> }): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const authStore = useAuthStore()

// Dialog open state
const internalOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

// Types used locally
export type TagOption = {
  value: string
  label: string
  id?: string
  name: string
}

type UploadAssetEntry = {
  assetId: string
  asset: ProjectAsset
  name: string
  description: string
  categoryId: string | null
  categoryPathLabel: string
  
  color: string
  colorHexInput: string
  dimensionLength: number | null
  dimensionWidth: number | null
  dimensionHeight: number | null
  imageWidth: number | null
  imageHeight: number | null
  thumbnailFile: File | null
  thumbnailPreviewUrl: string | null
  thumbnailCapturedAt: number | null
  status: 'pending' | 'uploading' | 'success' | 'error'
  error: string | null
  uploadedAssetId: string | null
  aiLastSignature: string | null
  tagValues: string[]
  aiSuggestedTags: string[]
  aiError: string | null
  aiLoading: boolean
  hasPendingChanges: boolean
  terrainScatterPreset: TerrainScatterCategory | null
  localSaveStatus: 'idle' | 'saving' | 'success' | 'error'
  localSaveError: string | null
  uploadedServerAsset: ProjectAsset | null
  replacedWithServerAsset: boolean
}

type UploadedReplacementCandidate = {
  localAssetId: string
  remoteAsset: ProjectAsset
  file: File
}

type DimensionKey = 'dimensionLength' | 'dimensionWidth' | 'dimensionHeight'
type ImageDimensionKey = 'imageWidth' | 'imageHeight'

// Local state for dialog
const uploadEntries = ref<UploadAssetEntry[]>([])
// NOTE: These are non-reactive on purpose. Writing reactive state from template ref callbacks
// can cause render feedback loops and severe input lag when editing fields.
const previewRefs = new Map<string, InstanceType<typeof AssetPreviewRenderer>>()
const thumbnailInputRefs = new Map<string, HTMLInputElement>()
const activeEntryId = ref<string | null>(null)
const activeEntry = computed<UploadAssetEntry | null>(() => {
  if (!uploadEntries.value.length) {
    return null
  }
  if (activeEntryId.value) {
    const found = uploadEntries.value.find((entry) => entry.assetId === activeEntryId.value)
    if (found) {
      return found
    }
  }
  return uploadEntries.value[0] ?? null
})
const uploadSubmitting = ref(false)
const localSaveSubmitting = ref(false)
const uploadError = ref<string | null>(null)
const operationNotice = ref<string | null>(null)
const serverTags = ref<TagOption[]>([])
const serverTagsLoaded = ref(false)
const serverTagsLoading = ref(false)
const serverTagsError = ref<string | null>(null)
const closeGuardDialogOpen = ref(false)
const replacementPromptOpen = ref(false)
const replacementApplying = ref(false)
const pendingReplacementCandidates = ref<UploadedReplacementCandidate[]>([])

const resourceCategories = ref<ResourceCategory[]>([])
const resourceCategoriesLoaded = ref(false)
const resourceCategoriesLoading = ref(false)
const resourceCategoriesError = ref<string | null>(null)

// Series handling temporarily disabled

const categoryIndex = computed(() => {
  const map = new Map<string, ResourceCategory>()
  const traverse = (nodes: ResourceCategory[]) => {
    nodes.forEach((node) => {
      if (!node || typeof node.id !== 'string') {
        return
      }
      map.set(node.id, node)
      if (Array.isArray(node.children) && node.children.length) {
        traverse(node.children)
      }
    })
  }
  traverse(resourceCategories.value ?? [])
  return map
})

const uploadTagOptions = computed<TagOption[]>(() => {
  const map = new Map<string, TagOption>()
  props.tagOptions?.forEach((option) => {
    if (option?.value && !map.has(option.value)) {
      map.set(option.value, option)
    }
  })
  serverTags.value.forEach((option) => {
    if (!map.has(option.value)) map.set(option.value, option)
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
})

const canUploadAll = computed(
  () => authStore.canResourceWrite && uploadEntries.value.some((entry) => !entry.replacedWithServerAsset) && !uploadSubmitting.value && !replacementApplying.value,
)
const canReadResource = computed(() => authStore.hasPermission('resource:read'))
const canUseRemoteCategorySelector = computed(() => canReadResource.value && !resourceCategoriesError.value)
const tagAccessHint = computed(() => {
  if (canReadResource.value) return ''
  if (!authStore.isAuthenticated) {
    return 'Tags can still be edited locally. Log in with resource:read to load server tag suggestions.'
  }
  return '当前账号缺少 resource:read。标签仍可本地编辑，但不会加载服务器标签列表。'
})
const categoryAccessHint = computed(() => {
  if (canUseRemoteCategorySelector.value) {
    return ''
  }
  if (!authStore.isAuthenticated) {
    return 'Category selector is unavailable while logged out. You can still edit Category Path manually for local metadata.'
  }
  if (!canReadResource.value) {
    return '当前账号缺少 resource:read。可继续使用 Category Path 手动输入并保存到本地元数据。'
  }
  if (resourceCategoriesError.value) {
    return `Category list unavailable: ${resourceCategoriesError.value}`
  }
  return ''
})
const canUploadCurrent = computed(() => {
  if (!authStore.canResourceWrite) return false
  const entry = activeEntry.value
  if (!entry) return false
  if (uploadSubmitting.value || replacementApplying.value) return false
  return !entry.replacedWithServerAsset && entry.status !== 'uploading'
})
const canSaveCurrent = computed(() => {
  const entry = activeEntry.value
  if (!entry) return false
  if (uploadSubmitting.value || localSaveSubmitting.value || replacementApplying.value) return false
  return !entry.replacedWithServerAsset && entry.status !== 'uploading'
})
const canSaveAll = computed(() => {
  if (uploadSubmitting.value || localSaveSubmitting.value || replacementApplying.value) return false
  return uploadEntries.value.some((entry) => !entry.replacedWithServerAsset && entry.status !== 'uploading')
})
const hasUploadingEntries = computed(() => uploadEntries.value.some((entry) => entry.status === 'uploading'))
const hasSavingEntries = computed(() => localSaveSubmitting.value || uploadEntries.value.some((entry) => entry.localSaveStatus === 'saving'))
const hasDirtyEntries = computed(() => uploadEntries.value.some((entry) => entry.hasPendingChanges && !entry.replacedWithServerAsset))
const shouldConfirmClose = computed(() => hasUploadingEntries.value || hasSavingEntries.value || hasDirtyEntries.value)
const closeGuardMessage = computed(() => {
  if (hasUploadingEntries.value) {
    return 'Some assets are still uploading. Closing now may interrupt the process. Continue?'
  }
  if (hasSavingEntries.value) {
    return 'Some assets are still saving locally. Closing now may interrupt the process. Continue?'
  }
  if (hasDirtyEntries.value) {
    return 'Some assets have unsaved metadata changes. Close without saving?'
  }
  return ''
})
const replacementPromptMessage = computed(() => {
  const count = pendingReplacementCandidates.value.length
  if (count <= 0) {
    return ''
  }
  if (count === 1) {
    return 'The asset was uploaded successfully. Replace the current local asset reference with the server asset now?'
  }
  return `${count} assets were uploaded successfully. Replace the current local asset references with the server assets now?`
})

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#([0-9a-fA-F]{6})$/.test(prefixed) ? `#${prefixed.slice(1).toLowerCase()}` : null
}

function formatHexInputDisplay(value: string | null | undefined): string {
  const normalized = normalizeHexColor(value)
  return normalized ? normalized.toUpperCase() : ''
}

function handleEntryScatterPresetChange(
  entry: UploadAssetEntry,
  value: TerrainScatterCategory | string | null,
): void {
  const normalized = typeof value === 'string' && value.trim().length ? (value as TerrainScatterCategory) : null
  entry.terrainScatterPreset = normalized
  markEntryDirty(entry)
}

function handleEntryNameChange(entry: UploadAssetEntry, value: string | null): void {
  entry.name = (value ?? '').toString()
  markEntryDirty(entry)
}

function handleEntryDescriptionChange(entry: UploadAssetEntry, value: string | null): void {
  entry.description = (value ?? '').toString()
  markEntryDirty(entry)
}



function handleEntryTagsChange(entry: UploadAssetEntry, value: string[] | string | null): void {
  if (Array.isArray(value)) {
    entry.tagValues = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0)
  } else if (typeof value === 'string') {
    entry.tagValues = value.trim().length ? [value] : []
  } else {
    entry.tagValues = []
  }
  markEntryDirty(entry)
}

function handleEntryCategoryPathLabelChange(entry: UploadAssetEntry, value: string | null): void {
  entry.categoryPathLabel = (value ?? '').toString()
  const matchedCategory = findCategoryById(entry.categoryId)
  const matchedLabel = buildCategoryLabel(matchedCategory)
  if (!matchedLabel || matchedLabel !== entry.categoryPathLabel) {
    entry.categoryId = null
  }
  markEntryDirty(entry)
}

function formatInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : ''
}

function setEntryImageDimension(entry: UploadAssetEntry, key: ImageDimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  entry[key] = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
  markEntryDirty(entry)
}

function computeSizeCategory(length: number | null, width: number | null, height: number | null): string | null {
  const values = [length, width, height]
    .filter((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
  if (!values.length) return null
  const max = Math.max(...values)
  if (max < 0.1) return 'Tiny'
  if (max < 0.5) return 'Small'
  if (max < 1) return 'Normal'
  if (max < 3) return 'Medium'
  if (max < 10) return 'Large'
  if (max < 30) return 'Huge'
  return 'Gigantic'
}

function entrySizeCategory(entry: UploadAssetEntry): string | null {
  return computeSizeCategory(entry.dimensionLength, entry.dimensionWidth, entry.dimensionHeight)
}

function createTagOption(id: string, name: string): TagOption {
  const label = name && name.trim().length ? name.trim() : id
  return { value: id, label, id, name: label }
}

function buildAiSignature(entry: UploadAssetEntry): string {
  const name = entry.name?.trim().toLowerCase() ?? ''
  const description = entry.description?.trim().toLowerCase() ?? ''
  return `${entry.assetId}::${entry.asset.type}::${name}::${description}`
}

function buildExtraHints(entry: UploadAssetEntry): string[] {
  const hints: string[] = []
  const color = normalizeHexColor(entry.color) ?? normalizeHexColor(entry.asset.color ?? null)
  if (color) hints.push(`Primary color ${color}`)
  if (['model', 'prefab', 'lod'].includes(entry.asset.type)) {
    const parts: string[] = []
    if (typeof entry.dimensionLength === 'number' && Number.isFinite(entry.dimensionLength) && entry.dimensionLength > 0) parts.push(`Length ${entry.dimensionLength.toFixed(2)} m`)
    if (typeof entry.dimensionWidth === 'number' && Number.isFinite(entry.dimensionWidth) && entry.dimensionWidth > 0) parts.push(`Width ${entry.dimensionWidth.toFixed(2)} m`)
    if (typeof entry.dimensionHeight === 'number' && Number.isFinite(entry.dimensionHeight) && entry.dimensionHeight > 0) parts.push(`Height ${entry.dimensionHeight.toFixed(2)} m`)
    if (parts.length) hints.push(`Model dimensions ${parts.join(', ')}`)
    const sizeCategory = entrySizeCategory(entry)
    if (sizeCategory) hints.push(`Size category ${sizeCategory}`)
    const modelStats = resolveEntryModelStats(entry)
    if (modelStats) {
      hints.push(`Model stats ${formatCount(modelStats.vertexCount)} vertices, ${formatCount(modelStats.faceCount)} faces, ${formatCount(modelStats.meshCount)} meshes`)
    }
  }
  if (entry.asset.type === 'image') {
    const parts: string[] = []
    if (typeof entry.imageWidth === 'number' && Number.isFinite(entry.imageWidth) && entry.imageWidth > 0) parts.push(`Width ${Math.round(entry.imageWidth)} px`)
    if (typeof entry.imageHeight === 'number' && Number.isFinite(entry.imageHeight) && entry.imageHeight > 0) parts.push(`Height ${Math.round(entry.imageHeight)} px`)
    if (parts.length) hints.push(`Image size ${parts.join(', ')}`)
  }
  return hints
}

function resolveEntryModelStats(entry: UploadAssetEntry): { vertexCount: number; faceCount: number; meshCount: number } | null {
  const candidate = entry.asset.metadata?.modelStats
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const vertexCount = Number((candidate as { vertexCount?: unknown }).vertexCount)
  const faceCount = Number((candidate as { faceCount?: unknown }).faceCount)
  const meshCount = Number((candidate as { meshCount?: unknown }).meshCount)
  if (!Number.isFinite(vertexCount) || !Number.isFinite(faceCount) || !Number.isFinite(meshCount)) {
    return null
  }
  return {
    vertexCount: Math.max(0, Math.round(vertexCount)),
    faceCount: Math.max(0, Math.round(faceCount)),
    meshCount: Math.max(0, Math.round(meshCount)),
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

function hasEntryMetaOverlay(entry: UploadAssetEntry): boolean {
  if (isModelAsset(entry.asset)) return !!resolveEntryModelStats(entry)
  if (entry.asset.type === 'image' || entry.asset.type === 'texture') {
    return !!(entry.imageWidth || entry.imageHeight)
  }
  return false
}

function integrateSuggestedTags(entry: UploadAssetEntry, tags: string[]): number {
  if (!tags.length) return 0
  const existing = new Set(
    entry.tagValues
      .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
      .filter((value) => value.length > 0),
  )
  const optionMap = new Map<string, string>()
  uploadTagOptions.value.forEach((option) => {
    optionMap.set(option.label.trim().toLowerCase(), option.value)
  })
  const appended: string[] = []
  tags.forEach((tag) => {
    const trimmed = typeof tag === 'string' ? tag.trim() : ''
    if (!trimmed) return
    const normalized = trimmed.toLowerCase()
    if (existing.has(normalized)) return
    const optionValue = optionMap.get(normalized)
    appended.push(optionValue ?? trimmed)
    existing.add(normalized)
  })
  if (!appended.length) return 0
  entry.tagValues = [...entry.tagValues, ...appended]
  markEntryDirty(entry)
  return appended.length
}

function markEntryDirty(entry: UploadAssetEntry | null): void {
  if (!entry) return
  entry.hasPendingChanges = true
  entry.localSaveStatus = 'idle'
  entry.localSaveError = null
  entry.uploadedServerAsset = null
  entry.uploadedAssetId = null
  entry.replacedWithServerAsset = false
  if (entry.status === 'error') {
    entry.error = null
  }
  if (entry.status !== 'uploading') {
    entry.status = 'pending'
  }
}

function createUploadEntry(asset: ProjectAsset): UploadAssetEntry {
  const normalizedColor = normalizeHexColor(asset.color ?? null)
  const initialCategoryId = typeof asset.categoryId === 'string' ? asset.categoryId : null
  const initialSegments = Array.isArray(asset.categoryPath)
    ? asset.categoryPath
        .map((item) => (item?.name ?? '').trim())
        .filter((segment) => segment.length > 0)
    : []
  const initialCategoryLabel =
    asset.categoryPathString ?? (initialSegments.length ? buildCategoryPathString(initialSegments) : '')
  const tagCandidates = new Set<string>()
  if (Array.isArray(asset.tagIds)) {
    asset.tagIds.forEach((id) => {
      const trimmed = typeof id === 'string' ? id.trim() : ''
      if (trimmed.length) {
        tagCandidates.add(trimmed)
      }
    })
  }
  if (Array.isArray(asset.tags)) {
    asset.tags.forEach((tag) => {
      const trimmed = typeof tag === 'string' ? tag.trim() : ''
      if (trimmed.length) {
        tagCandidates.add(trimmed)
      }
    })
  }
  return {
    assetId: asset.id,
    asset,
    name: asset.name,
    description: asset.description ?? '',
    categoryId: initialCategoryId,
    categoryPathLabel: initialCategoryLabel ?? '',
    color: normalizedColor ?? '',
    colorHexInput: formatHexInputDisplay(normalizedColor),
    dimensionLength: typeof asset.dimensionLength === 'number' ? asset.dimensionLength : null,
    dimensionWidth: typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : null,
    dimensionHeight: typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : null,
    imageWidth: typeof asset.imageWidth === 'number' ? asset.imageWidth : null,
    imageHeight: typeof asset.imageHeight === 'number' ? asset.imageHeight : null,
    thumbnailFile: null,
    thumbnailPreviewUrl: null,
    thumbnailCapturedAt: null,
    status: 'pending',
    error: null,
    uploadedAssetId: null,
    aiLastSignature: null,
    tagValues: Array.from(tagCandidates.values()),
    aiSuggestedTags: [],
    aiError: null,
    aiLoading: false,
    hasPendingChanges: false,
    terrainScatterPreset: asset.terrainScatterPreset ?? null,
    localSaveStatus: 'idle',
    localSaveError: null,
    uploadedServerAsset: null,
    replacedWithServerAsset: false,
  }
}

function revokeObjectUrlIfNeeded(url: string | null | undefined): void {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

function normalizeTagValueList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  values.forEach((value) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed.length) {
      return
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    normalized.push(trimmed)
  })
  return normalized
}

function parseCategoryPathSegments(label: string | null | undefined): string[] {
  if (typeof label !== 'string') {
    return []
  }
  return label
    .split(/[\\/>]|\s+->\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function slugifyCategorySegment(segment: string): string {
  const slug = segment.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return slug.replace(/^-+|-+$/g, '') || 'segment'
}

function buildEntryCategoryMetadata(entry: UploadAssetEntry): {
  categoryId: string | null
  categoryPath: { id: string; name: string }[]
  categoryPathString: string
  categoryPathSegments: string[]
} {
  const selectedCategory = findCategoryById(entry.categoryId)
  if (selectedCategory) {
    const categoryPath = Array.isArray(selectedCategory.path) && selectedCategory.path.length
      ? selectedCategory.path
          .filter((item): item is { id: string; name: string } => !!item && typeof item.id === 'string' && typeof item.name === 'string')
      : [{ id: selectedCategory.id, name: selectedCategory.name }]
    return {
      categoryId: selectedCategory.id,
      categoryPath,
      categoryPathString: buildCategoryPathString(categoryPath.map((item) => item.name)),
      categoryPathSegments: categoryPath.map((item) => item.name),
    }
  }

  const categoryPathSegments = parseCategoryPathSegments(entry.categoryPathLabel)
  return {
    categoryId: null,
    categoryPath: categoryPathSegments.map((segment, index) => ({
      id: `local-category:${index}:${slugifyCategorySegment(segment)}`,
      name: segment,
    })),
    categoryPathString: categoryPathSegments.length ? buildCategoryPathString(categoryPathSegments) : '',
    categoryPathSegments,
  }
}


function buildLocalTagMetadata(entry: UploadAssetEntry): { tags: string[]; tagIds: string[] } {
  const normalizedValues = normalizeTagValueList(entry.tagValues)
  const optionById = new Map(uploadTagOptions.value.map((option) => [option.value, option] as const))
  const optionByName = new Map(uploadTagOptions.value.map((option) => [option.name.trim().toLowerCase(), option] as const))
  const tags: string[] = []
  const tagIds: string[] = []

  normalizedValues.forEach((value) => {
    const byId = optionById.get(value)
    if (byId) {
      tags.push(byId.name)
      tagIds.push(byId.value)
      return
    }
    const byName = optionByName.get(value.toLowerCase())
    if (byName) {
      tags.push(byName.name)
      tagIds.push(byName.value)
      return
    }
    tags.push(value)
  })

  return { tags, tagIds }
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read thumbnail data'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to read thumbnail data'))
    }
    reader.readAsDataURL(blob)
  })
}

function resolvePersistedThumbnailUrl(entry: UploadAssetEntry, asset: ProjectAsset): string | null {
  if (entry.thumbnailFile) {
    return null
  }
  const candidate = typeof asset.thumbnail === 'string' ? asset.thumbnail.trim() : ''
  if (candidate.length && !candidate.startsWith('blob:')) {
    return candidate
  }
  if ((asset.type === 'image' || asset.type === 'texture' || asset.type === 'hdri') && typeof asset.downloadUrl === 'string') {
    const downloadUrl = asset.downloadUrl.trim()
    if (downloadUrl.length && !downloadUrl.startsWith('blob:')) {
      return downloadUrl
    }
  }
  return null
}

async function createFileFromPersistedThumbnailUrl(
  url: string,
  options: { fallbackName: string },
): Promise<File | null> {
  const candidate = url.trim()
  if (!candidate.length) {
    return null
  }

  if (candidate.startsWith('data:')) {
    const blob = dataUrlToBlob(candidate)
    const extension = extractExtension(`thumbnail.${blob.type.split('/')[1] ?? 'png'}`) ?? 'png'
    return new File([blob], `${options.fallbackName}-thumbnail.${extension}`, {
      type: blob.type || 'image/png',
    })
  }

  try {
    const response = await fetch(candidate, { credentials: 'include' })
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    const mimeSubtype = blob.type.split('/')[1] ?? ''
    const extension = extractExtension(`thumbnail.${mimeSubtype}`) ?? extractExtension(candidate) ?? 'png'
    return new File([blob], `${options.fallbackName}-thumbnail.${extension}`, {
      type: blob.type || 'image/png',
    })
  } catch {
    return null
  }
}

function createThumbnailFileForBundle(prepared: PreparedEntryMetadata): File | null {
  if (prepared.thumbnailFile) {
    return prepared.thumbnailFile
  }
  if (!prepared.thumbnailUrl || !prepared.thumbnailUrl.startsWith('data:')) {
    return null
  }
  const blob = dataUrlToBlob(prepared.thumbnailUrl)
  const extension = extractExtension(`thumbnail.${blob.type.split('/')[1] ?? 'png'}`) ?? 'png'
  return new File([blob], `${prepared.name || prepared.asset.name}-thumbnail.${extension}`, {
    type: blob.type || 'image/png',
  })
}

function shouldRewriteBundleReferences(asset: ProjectAsset, file: File): boolean {
  const extension = (asset.extension ?? extractExtension(file.name) ?? '').trim().toLowerCase()
  return isConfigAssetExtension(extension)
}

async function collectDependencyAssetIdsFromFile(file: File): Promise<string[]> {
  const extension = (extractExtension(file.name) ?? '').toLowerCase()
  if (!isConfigAssetExtension(extension)) {
    return []
  }
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as unknown
    return collectConfigAssetDependencyIds(parsed)
  } catch {
    return []
  }
}

async function resolveBundleDependencies(
  primaryAsset: ProjectAsset,
  primaryFile: File,
): Promise<Array<{ asset: ProjectAsset; file: File; rewriteTarget?: boolean }>> {
  const resolveDependencyAsset = (reference: string): ProjectAsset | null => {
    const resolvedAssetId = resolveConfigAssetReferenceId(reference, {
      assetRegistry: sceneStore.assetRegistry,
      hasAssetId: (assetId: string) => Boolean(sceneStore.getAsset(assetId)),
    })
    if (!resolvedAssetId) {
      return null
    }
    return sceneStore.getAsset(resolvedAssetId)
  }

  const queue = await collectDependencyAssetIdsFromFile(primaryFile)
  const visited = new Set<string>()
  const dependencies: Array<{ asset: ProjectAsset; file: File; rewriteTarget?: boolean }> = []

  while (queue.length) {
    const nextId = (queue.shift() ?? '').trim()
    if (!nextId || nextId === primaryAsset.id || visited.has(nextId)) {
      continue
    }
    visited.add(nextId)
    const asset = resolveDependencyAsset(nextId)
    if (!asset) {
      continue
    }
    let file: File
    try {
      file = await createUploadFileFromCache(asset)
    } catch {
      continue
    }

    dependencies.push({
      asset,
      file,
      rewriteTarget: shouldRewriteBundleReferences(asset, file),
    })

    const nestedIds = await collectDependencyAssetIdsFromFile(file)
    nestedIds.forEach((id) => {
      const trimmed = id.trim()
      if (trimmed && !visited.has(trimmed)) {
        queue.push(trimmed)
      }
    })
  }

  return dependencies
}

type PreparedEntryMetadata = {
  asset: ProjectAsset
  file: File | null
  thumbnailFile: File | null
  thumbnailUrl: string | null
  thumbnailSource: 'manual' | 'generated' | 'persisted' | 'none'
  thumbnailGenerationHint: 'model-default-placeholder' | 'auto-generated' | null
  name: string
  description: string
  categoryId: string | null
  categoryPath: { id: string; name: string }[]
  categoryPathString: string
  categoryPathSegments: string[]
  color: string | null
  previewColor: string
  dimensionLength: number | null
  dimensionWidth: number | null
  dimensionHeight: number | null
  imageWidth: number | null
  imageHeight: number | null
  sizeCategory: string | null
  tags: string[]
  tagIds: string[]
  terrainScatterPreset: TerrainScatterCategory | null
}

async function buildPreparedEntryMetadata(
  entry: UploadAssetEntry,
  options: { includeSourceFile?: boolean; ensureThumbnail?: boolean } = {},
): Promise<PreparedEntryMetadata> {
  const asset = sceneStore.getAsset(entry.assetId) ?? entry.asset
  if (!asset) {
    throw new Error('Asset not found')
  }

  const name = entry.name.trim().length ? entry.name.trim() : asset.name
  const description = entry.description.trim()
  const category = buildEntryCategoryMetadata(entry)
  const color = normalizeHexColor(entry.color)
  const previewColor = color ?? asset.previewColor ?? TYPE_COLOR_FALLBACK[asset.type] ?? '#455A64'
  const dimensionLength = typeof entry.dimensionLength === 'number' && Number.isFinite(entry.dimensionLength) ? entry.dimensionLength : null
  const dimensionWidth = typeof entry.dimensionWidth === 'number' && Number.isFinite(entry.dimensionWidth) ? entry.dimensionWidth : null
  const dimensionHeight = typeof entry.dimensionHeight === 'number' && Number.isFinite(entry.dimensionHeight) ? entry.dimensionHeight : null
  const imageWidth = typeof entry.imageWidth === 'number' && Number.isFinite(entry.imageWidth) ? Math.round(entry.imageWidth) : null
  const imageHeight = typeof entry.imageHeight === 'number' && Number.isFinite(entry.imageHeight) ? Math.round(entry.imageHeight) : null
  const sizeCategory = computeSizeCategory(dimensionLength, dimensionWidth, dimensionHeight)
  const { tags, tagIds } = buildLocalTagMetadata(entry)

  let file: File | null = null
  const shouldLoadSourceFile = options.includeSourceFile || (options.ensureThumbnail && !entry.thumbnailFile && !resolvePersistedThumbnailUrl(entry, asset))
  if (shouldLoadSourceFile) {
    file = await createUploadFileFromCache(asset)
  }

  let thumbnailFile = entry.thumbnailFile
  let thumbnailSource: PreparedEntryMetadata['thumbnailSource'] = thumbnailFile ? 'manual' : 'none'
  let thumbnailGenerationHint: PreparedEntryMetadata['thumbnailGenerationHint'] = null
  const persistedThumbnailUrl = thumbnailFile ? null : resolvePersistedThumbnailUrl(entry, asset)
  if (!thumbnailFile && persistedThumbnailUrl) {
    const persistedThumbnailFile = await createFileFromPersistedThumbnailUrl(persistedThumbnailUrl, {
      fallbackName: name || asset.name,
    })
    if (persistedThumbnailFile) {
      thumbnailFile = persistedThumbnailFile
      thumbnailSource = 'persisted'
    }
  }

  if (!thumbnailFile && !persistedThumbnailUrl && options.ensureThumbnail && file) {
    const thumbnailAsset: ProjectAsset = {
      ...asset,
      color: color ?? asset.color,
      previewColor,
    }
    thumbnailFile = await generateAssetThumbnail({
      asset: thumbnailAsset,
      file,
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
    thumbnailSource = 'generated'
    thumbnailGenerationHint = ['model', 'mesh', 'prefab', 'lod'].includes(thumbnailAsset.type) ? 'model-default-placeholder' : 'auto-generated'
  }

  const thumbnailUrl = thumbnailFile ? await readBlobAsDataUrl(thumbnailFile) : persistedThumbnailUrl

  return {
    asset,
    file,
    thumbnailFile,
    thumbnailUrl,
    thumbnailSource,
    thumbnailGenerationHint,
    name,
    description,
    categoryId: category.categoryId,
    categoryPath: category.categoryPath,
    categoryPathString: category.categoryPathString,
    categoryPathSegments: category.categoryPathSegments,
    color,
    previewColor,
    dimensionLength,
    dimensionWidth,
    dimensionHeight,
    imageWidth,
    imageHeight,
    sizeCategory,
    tags,
    tagIds,
    terrainScatterPreset: entry.terrainScatterPreset ?? null,
  }
}

function syncEntryFromAsset(entry: UploadAssetEntry, asset: ProjectAsset): void {
  entry.asset = asset
  entry.name = asset.name
  entry.description = asset.description ?? ''
  entry.categoryId = typeof asset.categoryId === 'string' ? asset.categoryId : null
  entry.categoryPathLabel = asset.categoryPathString ?? entry.categoryPathLabel
  entry.color = normalizeHexColor(asset.color ?? null) ?? ''
  entry.colorHexInput = formatHexInputDisplay(asset.color ?? null)
  entry.dimensionLength = typeof asset.dimensionLength === 'number' ? asset.dimensionLength : null
  entry.dimensionWidth = typeof asset.dimensionWidth === 'number' ? asset.dimensionWidth : null
  entry.dimensionHeight = typeof asset.dimensionHeight === 'number' ? asset.dimensionHeight : null
  entry.imageWidth = typeof asset.imageWidth === 'number' ? asset.imageWidth : null
  entry.imageHeight = typeof asset.imageHeight === 'number' ? asset.imageHeight : null
  entry.terrainScatterPreset = asset.terrainScatterPreset ?? null
}

async function saveEntryLocally(entry: UploadAssetEntry): Promise<void> {
  entry.localSaveStatus = 'saving'
  entry.localSaveError = null
  try {
    const prepared = await buildPreparedEntryMetadata(entry, { ensureThumbnail: true })
    const updated = sceneStore.updateProjectAssetMetadata(entry.assetId, {
      name: prepared.name,
      description: prepared.description || undefined,
      categoryId: prepared.categoryId ?? undefined,
      categoryPath: prepared.categoryPath.length ? prepared.categoryPath : undefined,
      categoryPathString: prepared.categoryPathString || undefined,
      color: prepared.color ?? null,
      previewColor: prepared.previewColor,
      dimensionLength: prepared.dimensionLength,
      dimensionWidth: prepared.dimensionWidth,
      dimensionHeight: prepared.dimensionHeight,
      sizeCategory: prepared.sizeCategory ?? null,
      imageWidth: prepared.imageWidth,
      imageHeight: prepared.imageHeight,
      thumbnail: prepared.thumbnailUrl,
      tags: prepared.tags.length ? prepared.tags : undefined,
      tagIds: prepared.tagIds.length ? prepared.tagIds : undefined,
      terrainScatterPreset: prepared.terrainScatterPreset,
    })
    if (!updated) {
      throw new Error('Failed to update local asset metadata')
    }
    syncEntryFromAsset(entry, updated)
    entry.hasPendingChanges = false
    entry.localSaveStatus = 'success'
    operationNotice.value = `Saved local metadata for ${prepared.name}.`
  } catch (error) {
    entry.localSaveStatus = 'error'
    entry.localSaveError = (error as Error).message ?? 'Failed to save local asset metadata'
    throw error
  }
}

async function submitLocalSave(options: { entries?: UploadAssetEntry[] } = {}): Promise<void> {
  if (localSaveSubmitting.value) {
    return
  }
  const targetEntries = (options.entries ?? uploadEntries.value).filter((entry) => entry && !entry.replacedWithServerAsset)
  if (!targetEntries.length) {
    return
  }
  localSaveSubmitting.value = true
  uploadError.value = null
  operationNotice.value = null
  let savedCount = 0
  const failedEntries: string[] = []
  for (const entry of targetEntries) {
    try {
      await saveEntryLocally(entry)
      savedCount += 1
    } catch (_error) {
      failedEntries.push(entry.name?.trim() || entry.asset.name || entry.assetId)
    }
  }
  if (savedCount > 0) {
    operationNotice.value = savedCount === 1
      ? 'Saved local asset metadata.'
      : `Saved local metadata for ${savedCount} assets.`
  }
  if (failedEntries.length > 0) {
    const preview = failedEntries.slice(0, 2).join(', ')
    const suffix = failedEntries.length > 2 ? ` and ${failedEntries.length - 2} more` : ''
    uploadError.value = `Failed to save ${failedEntries.length} asset(s): ${preview}${suffix}`
  }
  localSaveSubmitting.value = false
}

function handleSaveCurrent(): void {
  if (!activeEntry.value) {
    return
  }
  void submitLocalSave({ entries: [activeEntry.value] })
}

function handleSaveAll(): void {
  void submitLocalSave()
}

async function requestAiTagsForEntry(entry: UploadAssetEntry, options: { auto?: boolean } = {}): Promise<void> {
  if (!entry || entry.aiLoading) return
  const preferredName = entry.name?.trim().length ? entry.name.trim() : entry.asset.name
  const description = entry.description?.trim() ?? ''
  if (!preferredName && !description) {
    if (!options.auto) entry.aiError = 'Please enter a name or description first'
    return
  }
  const signature = buildAiSignature(entry)
  if (options.auto && entry.aiLastSignature === signature) return
  entry.aiLoading = true
  entry.aiError = null
  try {
    const result = await generateAssetTagSuggestions({
      name: preferredName,
      description,
      assetType: entry.asset.type,
      extraHints: buildExtraHints(entry),
    })
    const added = integrateSuggestedTags(entry, result.tags ?? [])
    entry.aiSuggestedTags = result.tags ?? []
    entry.aiLastSignature = signature
    if (!added && !options.auto) {
      entry.aiError = 'AI suggested tags already exist. You can continue editing or upload.'
    }
  } catch (error) {
    if (options.auto) {
      console.warn('Auto tag generation failed', error)
      return
    }
    entry.aiError = (error as Error).message ?? 'Failed to generate tags'
  } finally {
    entry.aiLoading = false
  }
}

function handleEntryDescriptionBlur(entry: UploadAssetEntry): void {
  if (!entry.description?.trim()) return
  void requestAiTagsForEntry(entry, { auto: true })
}

function handleRequestDialogClose(): void {
  if (!shouldConfirmClose.value) {
    internalOpen.value = false
    return
  }
  closeGuardDialogOpen.value = true
}

function confirmDialogClose(): void {
  closeGuardDialogOpen.value = false
  internalOpen.value = false
}

function cancelDialogClose(): void {
  closeGuardDialogOpen.value = false
}

function resetUploadState() {
  uploadEntries.value.forEach((entry) => {
    revokeObjectUrlIfNeeded(entry.thumbnailPreviewUrl)
    entry.thumbnailPreviewUrl = null
  })
  uploadEntries.value = []
  uploadError.value = null
  operationNotice.value = null
  activeEntryId.value = null
  closeGuardDialogOpen.value = false
  replacementPromptOpen.value = false
  pendingReplacementCandidates.value = []
  previewRefs.clear()
  thumbnailInputRefs.clear()
}

async function loadServerTags(options: { force?: boolean } = {}) {
  const force = options.force ?? false
  if (serverTagsLoading.value) return
  if (serverTagsLoaded.value && !force) return
  if (!canReadResource.value) {
    serverTags.value = []
    serverTagsLoaded.value = true
    serverTagsError.value = tagAccessHint.value
    return
  }
  serverTagsLoading.value = true
  serverTagsError.value = null
  try {
    const tags = await fetchAssetTags()
    if (!Array.isArray(tags)) {
      serverTags.value = []
      serverTagsLoaded.value = true
      return
    }
    const map = new Map<string, TagOption>()
    tags.forEach((tag) => {
      if (tag && typeof tag.id === 'string' && tag.id.trim().length) {
        const option = createTagOption(tag.id, typeof tag.name === 'string' ? tag.name : tag.id)
        map.set(option.value, option)
      }
    })
    serverTags.value = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    serverTagsLoaded.value = true
  } catch (error) {
    serverTagsError.value = (error as Error).message ?? 'Failed to load tags'
  } finally {
    serverTagsLoading.value = false
  }
}

async function loadResourceCategories(options: { force?: boolean } = {}) {
  const force = options.force ?? false
  if (resourceCategoriesLoading.value) return
  if (resourceCategoriesLoaded.value && !force) return
  resourceCategoriesLoading.value = true
  resourceCategoriesError.value = null
  try {
    const categories = await fetchResourceCategories()
    resourceCategories.value = Array.isArray(categories) ? categories : []
    resourceCategoriesLoaded.value = true
  } catch (error) {
    resourceCategoriesError.value = (error as Error).message ?? 'Failed to load categories'
  } finally {
    resourceCategoriesLoading.value = false
  }
}

// Series loading disabled while Series input is removed


function findCategoryById(targetId: string | null): ResourceCategory | null {
  if (!targetId) return null
  return categoryIndex.value.get(targetId) ?? null
}

function buildCategoryLabel(category: ResourceCategory | null): string {
  if (!category) return ''
  const segments = Array.isArray(category.path) && category.path.length
    ? category.path.map((item) => (item?.name ?? '').trim()).filter((name) => name.length > 0)
    : [category.name]
  const formatted = buildCategoryPathString(segments)
  return formatted.length ? formatted : (category.name ?? '')
}

function updateEntryCategoryLabel(entry: UploadAssetEntry): void {
  if (!entry) return
  const category = findCategoryById(entry.categoryId)
  const nextLabel = buildCategoryLabel(category)
  if (nextLabel.length) {
    entry.categoryPathLabel = nextLabel
  }
}

function handleEntryCategoryChange(entry: UploadAssetEntry, value: string | null): void {
  const normalized = typeof value === 'string' ? value.trim() : ''
  entry.categoryId = normalized.length ? normalized : null
  updateEntryCategoryLabel(entry)
  markEntryDirty(entry)
}

function handleEntryCategorySelected(entry: UploadAssetEntry, payload: { id: string | null; label: string }): void {
  entry.categoryId = payload.id ?? null
  entry.categoryPathLabel = payload.label ?? ''
  markEntryDirty(entry)
}

function handleEntryCategoryCreated(entry: UploadAssetEntry, category: ResourceCategory): void {
  const label = buildCategoryLabel(category ?? null)
  handleEntryCategoryChange(entry, category?.id ?? null)
  if (label) {
    entry.categoryPathLabel = label
  }
  void loadResourceCategories({ force: true })
}

/* Series helpers removed (Series input temporarily disabled) */

function handlePreviewDimensions(entry: UploadAssetEntry, payload: { length: number; width: number; height: number }): void {
  if (!payload) return
  const applyValue = (key: DimensionKey, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    const current = entry[key]
    if (typeof current === 'number' && Number.isFinite(current) && current > 0) {
      return
    }
    entry[key] = Number.parseFloat(value.toFixed(3))
    markEntryDirty(entry)
  }
  applyValue('dimensionLength', payload.length)
  applyValue('dimensionWidth', payload.width)
  applyValue('dimensionHeight', payload.height)
}

function handlePreviewImageMeta(entry: UploadAssetEntry, payload: { width: number; height: number }): void {
  if (!payload) return
  const applyImageValue = (key: ImageDimensionKey, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    const current = entry[key]
    if (typeof current === 'number' && Number.isFinite(current) && current > 0) {
      return
    }
    entry[key] = Math.round(value)
    markEntryDirty(entry)
  }
  applyImageValue('imageWidth', payload.width)
  applyImageValue('imageHeight', payload.height)
}

function registerPreviewRef(entryId: string, instance: InstanceType<typeof AssetPreviewRenderer> | null): void {
  if (!instance) {
    previewRefs.delete(entryId)
    return
  }
  previewRefs.set(entryId, instance)
  const entry = uploadEntries.value.find((item) => item.assetId === entryId)
  const hasExistingThumbnail = typeof entry?.asset.thumbnail === 'string' && entry.asset.thumbnail.trim().length > 0
  if (entry && isModelAsset(entry.asset) && !entry.thumbnailFile && !hasExistingThumbnail) {
    // Capture default snapshot once preview becomes ready.
    void nextTick(() => capturePreviewThumbnail(entry, { silent: true }))
  }
}

function registerThumbnailInput(entryId: string, element: HTMLInputElement | null): void {
  if (!element) {
    thumbnailInputRefs.delete(entryId)
    return
  }
  thumbnailInputRefs.set(entryId, element)
}

function promptThumbnailUpload(entry: UploadAssetEntry): void {
  if (!entry) return
  const input = thumbnailInputRefs.get(entry.assetId)
  if (!input) return
  input.value = ''
  input.click()
}

function handleThumbnailFileSelected(entry: UploadAssetEntry, event: Event): void {
  if (!entry) return
  const input = event.target as HTMLInputElement | null
  if (!input) return
  const file = input.files?.[0]
  if (!file) {
    input.value = ''
    return
  }
  if (!file.type.startsWith('image/')) {
    entry.error = 'Thumbnail must be an image file.'
    input.value = ''
    return
  }
  revokeObjectUrlIfNeeded(entry.thumbnailPreviewUrl)
  entry.thumbnailFile = file
  entry.thumbnailPreviewUrl = URL.createObjectURL(file)
  entry.thumbnailCapturedAt = Date.now()
  entry.error = null
  markEntryDirty(entry)
  input.value = ''
}

function isSkycubeFileAsset(asset: ProjectAsset): boolean {
  if (asset.type !== 'file') {
    return false
  }
  const extension = getLastExtensionFromFilenameOrUrl(asset.name || asset.downloadUrl || asset.id)
  return isSkyCubeArchiveExtension(extension)
}

function getAssetTypeLabel(asset: ProjectAsset): string {
  if (isSkycubeFileAsset(asset)) {
    return 'skycube'
  }
  return asset.type
}

function isModelAsset(asset: ProjectAsset): boolean {
  if (detectAssetPreviewPresetKind(asset)) {
    return true
  }
  if (['model', 'mesh', 'prefab', 'lod', 'hdri'].includes(asset.type)) {
    return true
  }
  return isSkycubeFileAsset(asset)
}

async function capturePreviewThumbnail(entry: UploadAssetEntry, options: { silent?: boolean } = {}): Promise<void> {
  if (!isModelAsset(entry.asset)) {
    return
  }
  const instance = previewRefs.get(entry.assetId)
  if (!instance?.captureSnapshot) {
    if (!options.silent) {
      entry.error = 'Preview is not ready for capture yet.'
    }
    return
  }
  try {
    const canvas = await instance.captureSnapshot()
    if (!canvas) {
      if (!options.silent) {
        entry.error = 'Failed to capture preview.'
      }
      return
    }
    const file = await createThumbnailFromCanvas(entry.asset, canvas, {
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
    revokeObjectUrlIfNeeded(entry.thumbnailPreviewUrl)
    entry.thumbnailFile = file
    entry.thumbnailPreviewUrl = URL.createObjectURL(file)
    entry.thumbnailCapturedAt = Date.now()
    entry.error = null
    markEntryDirty(entry)
  } catch (error) {
    if (!options.silent) {
      entry.error = (error as Error).message ?? 'Failed to capture thumbnail.'
    }
  }
}

// Initialize entries when dialog opens
watch(
  () => internalOpen.value,
  (open) => {
    if (open) {
      uploadEntries.value = props.assets.map((asset) => createUploadEntry(asset))
      activeEntryId.value = uploadEntries.value[0]?.assetId ?? null
      uploadError.value = null
      void nextTick(() => {
        void loadServerTags()
        void loadResourceCategories()
        // series loading skipped
      })
    } else if (!uploadSubmitting.value) {
      resetUploadState()
    }
  },
  { immediate: false }
)

watch(
  () => uploadEntries.value.map((entry) => entry.assetId),
  (ids) => {
    if (!ids.length) {
      activeEntryId.value = null
      return
    }
    if (activeEntryId.value && ids.includes(activeEntryId.value)) {
      return
    }
    activeEntryId.value = ids[0] ?? null
  },
  { immediate: true },
)

watch(
  () => resourceCategories.value,
  () => {
    uploadEntries.value.forEach((entry) => updateEntryCategoryLabel(entry))
  },
  { deep: true },
)

async function createUploadFileFromCache(asset: ProjectAsset): Promise<File> {
  let file = assetCacheStore.createFileFromCache(asset.id)
  if (file) return file
  await assetCacheStore.loadFromIndexedDb(asset.id)
  file = assetCacheStore.createFileFromCache(asset.id)
  if (file) return file
  throw new Error('资源文件尚未缓存，无法上传')
}

async function resolveEntriesTagIds(entries: UploadAssetEntry[]): Promise<Map<string, string[]>> {
  const resolved = new Map<string, string[]>()
  if (!entries.length) return resolved
  if (!authStore.canResourceWrite) {
    entries.forEach((entry) => {
      resolved.set(entry.assetId, [])
    })
    return resolved
  }
  const existingOptions = uploadTagOptions.value
  const optionById = new Map(existingOptions.map((option) => [option.value, option] as const))
  const optionByName = new Map(existingOptions.map((option) => [option.name.trim().toLowerCase(), option] as const))
  const pendingNames = new Map<string, string>()

  entries.forEach((entry) => {
    entry.tagValues.forEach((value) => {
      const raw = typeof value === 'string' ? value.trim() : ''
      if (!raw.length) return
      if (optionById.has(raw)) return
      const normalizedName = raw.toLowerCase()
      if (optionByName.has(normalizedName)) return
      if (!pendingNames.has(normalizedName)) {
        pendingNames.set(normalizedName, raw)
      }
    })
  })

  if (pendingNames.size > 0) {
    const originalNames = Array.from(pendingNames.values())
    try {
      const created = await createAssetTag({ names: originalNames })
      const optionMap = new Map(serverTags.value.map((entry) => [entry.value, entry] as const))
      created.forEach((tag) => {
        const option = createTagOption(tag.id, tag.name)
        optionMap.set(option.value, option)
        optionById.set(option.value, option)
        optionByName.set(option.name.trim().toLowerCase(), option)
      })
      serverTags.value = Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    } catch (error) {
      const fallback = originalNames[0]
      throw new Error((error as Error).message ?? (fallback ? `Failed to create tag "${fallback}"` : 'Failed to create tag'))
    }
  }

  const updatedOptions = uploadTagOptions.value
  const updatedById = new Map(updatedOptions.map((option) => [option.value, option] as const))
  const updatedByName = new Map(updatedOptions.map((option) => [option.name.trim().toLowerCase(), option] as const))

  entries.forEach((entry) => {
    const resolvedIds: string[] = []
    entry.tagValues.forEach((value) => {
      const raw = typeof value === 'string' ? value.trim() : ''
      if (!raw.length) return
      const matchById = updatedById.get(raw)
      if (matchById) {
        resolvedIds.push(matchById.value)
        return
      }
      const normalized = raw.toLowerCase()
      const matchByName = updatedByName.get(normalized)
      if (matchByName) {
        resolvedIds.push(matchByName.value)
        return
      }
      throw new Error(`标签“${raw}”未能解析为有效 ID，请重试。`)
    })
    resolved.set(entry.assetId, resolvedIds)
  })

  return resolved
}

async function submitUpload(options: { entries?: UploadAssetEntry[] } = {}) {
  if (uploadSubmitting.value) return
  const resolveTargetEntries = () =>
    (options.entries ?? uploadEntries.value).filter((entry) => entry && !entry.replacedWithServerAsset && entry.status !== 'uploading')

  if (!resolveTargetEntries().length) return

  const authenticated = await ensureAuthenticatedForResourceUpload()
  if (!authenticated) {
    uploadError.value = authStore.isAuthenticated
      ? '当前账号无上传权限（缺少 resource:write）。'
      : 'Please log in to upload assets.'
    return
  }

  const targetEntries = resolveTargetEntries()
  if (!targetEntries.length) return

  uploadSubmitting.value = true
  uploadError.value = null
  operationNotice.value = null
  try {
    const tagMap = await resolveEntriesTagIds(targetEntries)
    const replacementCandidates: UploadedReplacementCandidate[] = []
    for (const entry of targetEntries) {
      entry.status = 'uploading'
      entry.error = null
      try {
        const prepared = await buildPreparedEntryMetadata(entry, { includeSourceFile: true, ensureThumbnail: true })
        if (!prepared.file) {
          throw new Error('Asset source file is not available for upload')
        }
        const tagIds = tagMap.get(entry.assetId) ?? []
        const dependencies = await resolveBundleDependencies(prepared.asset, prepared.file)

        const bundle = await buildAssetBundle({
          primaryAsset: prepared.asset,
          primaryFile: prepared.file,
          thumbnailFile: createThumbnailFileForBundle(prepared),
          dependencies,
          name: prepared.name,
          description: prepared.description.length ? prepared.description : null,
          categoryId: prepared.categoryId,
          categoryPathSegments: prepared.categoryPathSegments,
          tagIds,
          color: prepared.color,
          dimensionLength: prepared.dimensionLength,
          dimensionWidth: prepared.dimensionWidth,
          dimensionHeight: prepared.dimensionHeight,
          imageWidth: prepared.imageWidth,
          imageHeight: prepared.imageHeight,
          terrainScatterPreset: prepared.terrainScatterPreset,
          metadata:
            prepared.asset.metadata && typeof prepared.asset.metadata === 'object'
              ? { ...prepared.asset.metadata }
              : null,
          rewriteReferences: shouldRewriteBundleReferences(prepared.asset, prepared.file),
        })

        const uploaded = await uploadAssetBundleToServer({ bundleFile: bundle.file })
        const mapped = mapServerAssetToProjectAsset(uploaded.asset)
        entry.status = 'success'
        entry.uploadedAssetId = mapped.id
        entry.uploadedServerAsset = mapped
        entry.hasPendingChanges = false
        replacementCandidates.push({
          localAssetId: entry.assetId,
          remoteAsset: mapped,
          file: prepared.file,
        })
      } catch (error) {
        entry.status = 'error'
        entry.error = (error as Error).message ?? 'Upload failed'
        entry.hasPendingChanges = true
      }
    }

    const hasErrors = targetEntries.some((entry) => entry.status === 'error')
    if (replacementCandidates.length) {
      pendingReplacementCandidates.value = replacementCandidates
      replacementPromptOpen.value = true
      operationNotice.value = replacementCandidates.length === 1
        ? 'Uploaded 1 asset to the server. Choose whether to replace the local reference.'
        : `Uploaded ${replacementCandidates.length} assets to the server. Choose whether to replace the local references.`
    }
    if (hasErrors) {
      uploadError.value = 'Some assets failed to upload. Please check errors and retry.'
      return
    }

    if (!replacementCandidates.length) {
      operationNotice.value = 'Upload completed.'
    }
  } catch (error) {
    uploadError.value = (error as Error).message ?? 'Failed to upload assets'
  } finally {
    uploadSubmitting.value = false
  }
}

function handleUploadCurrent(): void {
  if (!activeEntry.value) return
  void submitUpload({ entries: [activeEntry.value] })
}

function handleUploadAll(): void {
  void submitUpload()
}

async function confirmReplaceUploaded(): Promise<void> {
  if (replacementApplying.value) {
    return
  }
  replacementApplying.value = true
  uploadError.value = null
  try {
    const replacementMap = new Map<string, string>()
    for (const candidate of pendingReplacementCandidates.value) {
      const replaced = sceneStore.replaceLocalAssetWithServerAsset(candidate.localAssetId, candidate.remoteAsset)
      if (!replaced) {
        throw new Error('Failed to update asset reference')
      }
      await assetCacheStore.storeAssetBlob(replaced.id, {
        blob: candidate.file,
        mimeType: candidate.file.type || null,
        filename: candidate.file.name,
        downloadUrl: replaced.downloadUrl,
      })
      assetCacheStore.removeCache(candidate.localAssetId)
      replacementMap.set(candidate.localAssetId, replaced.id)
      const entry = uploadEntries.value.find((item) => item.assetId === candidate.localAssetId)
      if (entry) {
        entry.replacedWithServerAsset = true
        entry.uploadedServerAsset = replaced
        entry.hasPendingChanges = false
      }
    }
    replacementPromptOpen.value = false
    pendingReplacementCandidates.value = []
    if (replacementMap.size) {
      emit('uploaded', {
        successCount: replacementMap.size,
        replacementMap: Object.fromEntries(replacementMap.entries()),
      })
      operationNotice.value = replacementMap.size === 1
        ? 'Uploaded asset is now using the server reference.'
        : `${replacementMap.size} uploaded assets are now using server references.`
    }
  } catch (error) {
    uploadError.value = (error as Error).message ?? 'Failed to replace local asset references'
  } finally {
    replacementApplying.value = false
  }
}

function keepLocalReferencesAfterUpload(): void {
  replacementPromptOpen.value = false
  pendingReplacementCandidates.value = []
  operationNotice.value = 'Upload completed. Local asset references were kept unchanged.'
}
</script>

<template>
  <v-dialog v-model="internalOpen" max-width="1200" persistent>

    <v-card class="material-details-panel">
      <v-toolbar density="compact" class="panel-toolbar" height="40px">
        <div class="toolbar-text">
          <div class="material-title">Edit Asset Metadata</div>
        </div>
        <v-spacer />
        <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleRequestDialogClose" />
      </v-toolbar>
      <v-card-text>
        <div v-if="uploadEntries.length" class="upload-tabs-container">
          <v-tabs v-model="activeEntryId" class="upload-tabs" density="comfortable" color="primary">
            <v-tab v-for="entry in uploadEntries" :key="entry.assetId" :value="entry.assetId" class="upload-tab">
              <span class="upload-tab__name">{{ entry.name || entry.asset.name }}</span>
              <v-icon v-if="entry.status === 'success'" size="16" color="success">mdi-check-circle</v-icon>
              <v-progress-circular
                v-else-if="entry.status === 'uploading'"
                indeterminate
                size="14"
                width="3"
                color="primary"
              />
              <v-icon v-else-if="entry.status === 'error'" size="16" color="error">mdi-alert-circle</v-icon>
            </v-tab>
          </v-tabs>
          <v-window v-model="activeEntryId" class="upload-window">
            <v-window-item v-for="entry in uploadEntries" :key="entry.assetId" :value="entry.assetId">
              <div class="upload-entry-tab">
                <div class="upload-entry__header">
                  <div>
                    <div class="upload-entry__name">{{ entry.asset.name }}</div>
                    <div class="upload-entry__meta">Local ID: {{ entry.assetId }}</div>
                  </div>
                  <v-chip size="small" color="primary" variant="tonal">{{ getAssetTypeLabel(entry.asset) }}</v-chip>
                </div>
                <div class="upload-entry__status-row">
                  <v-chip v-if="entry.localSaveStatus === 'success'" size="small" color="success" variant="tonal">Local metadata saved</v-chip>
                  <v-chip v-if="entry.status === 'success' && !entry.replacedWithServerAsset" size="small" color="info" variant="tonal">Uploaded to server</v-chip>
                  <v-chip v-if="entry.replacedWithServerAsset" size="small" color="warning" variant="tonal">Using server asset reference</v-chip>
                </div>
                <div v-if="entry.status === 'error'" class="upload-entry__error">{{ entry.error }}</div>
                <div v-if="entry.localSaveStatus === 'error' && entry.localSaveError" class="urload-entry__error">{{ entry.localSaveError }}</div>

                <div class="upload-entry__body">
                  <div class="upload-entry__form">
                    <div class="upload-entry__name-row">
                      <v-text-field
                        class="upload-entry__name-input"
                        :model-value="entry.name"
                        label="Asset Name"
                        density="compact"
                        variant="underlined"
                        :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                        @update:model-value="(value) => handleEntryNameChange(entry, value)">
                      </v-text-field>
                    </div>

                    <!-- Series input temporarily removed -->

                    <div class="upload-entry__category-row">
                      <CategoryPathSelector
                        :model-value="entry.categoryId"
                        :categories="resourceCategories"
                        label="Asset Category"
                        placeholder="Select or create a category"
                        hint="Optional. Leave empty to keep the asset in the root category."
                        class="category-selector"
                        :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset || !canUseRemoteCategorySelector"
                        @update:model-value="(value) => handleEntryCategoryChange(entry, value)"
                        @category-selected="(payload) => handleEntryCategorySelected(entry, payload)"
                        @category-created="(category) => handleEntryCategoryCreated(entry, category)"
                      />
                    </div>
                    <div v-if="categoryAccessHint" class="upload-entry__field-hint upload-entry__field-hint--warning">{{ categoryAccessHint }}</div>
                    <div class="upload-entry__category-row">
                      <v-text-field
                        :model-value="entry.categoryPathLabel"
                        label="Category Path"
                        density="compact"
                        variant="underlined"
                        hint="Optional local category path. Example: Nature / Trees / Pine"
                        persistent-hint
                        :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                        @update:model-value="(value) => handleEntryCategoryPathLabelChange(entry, value)"
                      />
                    </div>

                    <div class="upload-entry__scatter-row">
                      <v-select
                        :model-value="entry.terrainScatterPreset"
                        :items="scatterPresetOptions"
                        item-title="label"
                        item-value="value"
                        label="Terrain Scatter Preset"
                        density="compact"
                        variant="underlined"
                        clearable
                        hide-details
                        :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                        @update:model-value="(value) => handleEntryScatterPresetChange(entry, value as TerrainScatterCategory | null)"
                      >
                        <template #item="{ props, item }">
                          <v-list-item v-bind="props">
                            <template #prepend>
                              <v-icon :icon="item.raw.icon" size="16" />
                            </template>
                          </v-list-item>
                        </template>
                        <template #selection="{ item }">
                          <div class="scatter-select__selection">
                            <v-icon :icon="item.raw.icon" size="16" class="scatter-select__icon" />
                            <span>{{ item.title }}</span>
                          </div>
                        </template>
                      </v-select>
                    </div>

                    

                    <div v-if="entry.asset.type === 'image'" class="upload-entry__dimensions">
                      <div class="upload-entry__dimension-grid">
                        <v-text-field
                          :model-value="formatInteger(entry.imageWidth)"
                          label="Image width (px)"
                          type="number"
                          density="compact"
                          variant="underlined"
                          step="1"
                          min="0"
                          suffix="px"
                          :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                          @update:model-value="(value) => setEntryImageDimension(entry, 'imageWidth', value)"
                        />
                        <v-text-field
                          :model-value="formatInteger(entry.imageHeight)"
                          label="Image height (px)"
                          type="number"
                          density="compact"
                          variant="underlined"
                          step="1"
                          min="0"
                          suffix="px"
                          :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                          @update:model-value="(value) => setEntryImageDimension(entry, 'imageHeight', value)"
                        />
                      </div>
                    </div>

                    <v-textarea
                      class="upload-description-textarea"
                      :model-value="entry.description"
                      label="Description"
                      density="compact"
                      variant="underlined"
                      rows="2"
                      :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                      @update:model-value="(value) => handleEntryDescriptionChange(entry, value)"
                      @blur="() => handleEntryDescriptionBlur(entry)"
                    />

                    <v-combobox
                      class="upload-tags-combobox"
                      :model-value="entry.tagValues"
                      :items="uploadTagOptions"
                      item-title="label"
                      item-value="value"
                      label="Select or create tags"
                      density="comfortable"
                      variant="underlined"
                      multiple
                      chips
                      closable-chips
                      clearable
                      hide-selected
                      new-value-mode="add"
                      :loading="serverTagsLoading"
                      :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                      @update:model-value="(value) => handleEntryTagsChange(entry, value as string[])"
                    />
                    <div v-if="tagAccessHint" class="upload-entry__field-hint upload-entry__field-hint--warning">{{ tagAccessHint }}</div>

                  </div>
                  <div class="upload-entry__preview-pane">
                    <div v-if="entry.assetId === activeEntryId" class="upload-preview-wrapper">
                      <AssetPreviewRenderer
                        :asset="entry.asset"
                        :primary-color="entry.color || entry.asset.color || null"
                        :ref="(instance) => registerPreviewRef(entry.assetId, instance as InstanceType<typeof AssetPreviewRenderer> | null)"
                        @dimensions="(payload) => handlePreviewDimensions(entry, payload)"
                        @image-meta="(payload) => handlePreviewImageMeta(entry, payload)"
                      />

                      <div v-if="hasEntryMetaOverlay(entry)" class="upload-preview__meta-overlay">
                        <template v-if="resolveEntryModelStats(entry)">
                          <div class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">顶点数</span>
                            <span class="upload-preview__meta-v">{{ formatCount(resolveEntryModelStats(entry)!.vertexCount) }}</span>
                          </div>
                          <div class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">面数</span>
                            <span class="upload-preview__meta-v">{{ formatCount(resolveEntryModelStats(entry)!.faceCount) }}</span>
                          </div>
                          <div class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">网格数</span>
                            <span class="upload-preview__meta-v">{{ formatCount(resolveEntryModelStats(entry)!.meshCount) }}</span>
                          </div>
                        </template>
                        <template v-if="(entry.asset.type === 'image' || entry.asset.type === 'texture') && (entry.imageWidth || entry.imageHeight)">
                          <div v-if="entry.imageWidth" class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">宽度</span>
                            <span class="upload-preview__meta-v">{{ Math.round(entry.imageWidth) }} px</span>
                          </div>
                          <div v-if="entry.imageHeight" class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">高度</span>
                            <span class="upload-preview__meta-v">{{ Math.round(entry.imageHeight) }} px</span>
                          </div>
                          <div v-if="entry.imageWidth && entry.imageHeight" class="upload-preview__meta-row">
                            <span class="upload-preview__meta-k">像素数</span>
                            <span class="upload-preview__meta-v">{{ formatCount(Math.round(entry.imageWidth) * Math.round(entry.imageHeight)) }}</span>
                          </div>
                        </template>
                      </div>

                      <div v-if="isModelAsset(entry.asset) || entry.thumbnailPreviewUrl || entry.asset.thumbnail" class="upload-preview__actions">
                        <template v-if="isModelAsset(entry.asset)">
                          <v-btn
                            color="primary"
                            variant="tonal"
                            size="small"
                            icon="mdi-camera"
                            :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                            title="Capture thumbnail"
                            aria-label="Capture thumbnail"
                            @click="() => capturePreviewThumbnail(entry)"
                          />
                          <v-btn
                            color="secondary"
                            variant="tonal"
                            size="small"
                            icon="mdi-upload"
                            :disabled="uploadSubmitting || localSaveSubmitting || entry.status === 'uploading' || entry.replacedWithServerAsset"
                            title="Upload custom thumbnail"
                            aria-label="Upload custom thumbnail"
                            @click="() => promptThumbnailUpload(entry)"
                          />
                          <input
                            type="file"
                            accept="image/*"
                            class="upload-preview__file-input"
                            :ref="(el) => registerThumbnailInput(entry.assetId, el as HTMLInputElement | null)"
                            @change="(event) => handleThumbnailFileSelected(entry, event)"
                          />
                        </template>
                        <div v-if="entry.thumbnailPreviewUrl || entry.asset.thumbnail" class="upload-preview__thumb">
                          <img :src="entry.thumbnailPreviewUrl || entry.asset.thumbnail || ''" alt="Captured thumbnail" />
                          <span class="upload-preview__thumb-label">Current thumbnail</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </v-window-item>
          </v-window>
        </div>
        <div v-else class="upload-empty-state">
          Select local assets to edit metadata.
        </div>
      </v-card-text>
      <v-card-actions class="upload-actions">
        <div class="upload-actions__error" role="status" aria-live="polite">
          <template v-if="uploadError">
            <v-icon size="18" color="error">mdi-alert-circle</v-icon>
            <span>{{ uploadError }}</span>
          </template>
          <template v-else-if="operationNotice">
            <v-icon size="18" color="success">mdi-check-circle</v-icon>
            <span>{{ operationNotice }}</span>
          </template>
        </div>
        <v-spacer />
        <v-btn color="secondary" variant="tonal" :disabled="!canSaveCurrent" :loading="localSaveSubmitting && !!activeEntry && activeEntry.localSaveStatus === 'saving'" @click="handleSaveCurrent">
          Save
        </v-btn>
        <v-btn color="primary" variant="flat" :loading="localSaveSubmitting" :disabled="!canSaveAll" @click="handleSaveAll">
          Save All
        </v-btn>
        <v-btn color="secondary" variant="tonal" :disabled="!canUploadCurrent" :loading="uploadSubmitting && !!activeEntry && activeEntry.status === 'uploading'" @click="handleUploadCurrent">
          Upload
        </v-btn>
        <v-btn color="info" variant="flat" :loading="uploadSubmitting" :disabled="!canUploadAll" @click="handleUploadAll">
          Upload All
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="closeGuardDialogOpen" max-width="420">
    <v-card>
      <v-card-title>Close metadata dialog?</v-card-title>
      <v-card-text>{{ closeGuardMessage }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancelDialogClose">Stay</v-btn>
        <v-btn color="warning" variant="flat" @click="confirmDialogClose">Leave</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="replacementPromptOpen" max-width="460" persistent>
    <v-card>
      <v-card-title>Use Server Asset References?</v-card-title>
      <v-card-text>{{ replacementPromptMessage }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="replacementApplying" @click="keepLocalReferencesAfterUpload">Keep Local References</v-btn>
        <v-btn color="primary" variant="flat" :loading="replacementApplying" @click="confirmReplaceUploaded">Replace References</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 1.0);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
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
.dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.dialog-title__main {
  font-size: 1.1rem;
  font-weight: 600;
}

.dialog-title__subtitle {
  font-size: 0.9rem;
  color: #90a4ae;
}

.upload-tabs-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.upload-tabs :deep(.v-tab) {
  text-transform: none;
  font-weight: 500;
}

.upload-tab {
  gap: 6px;
}

.upload-tab__name {
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-window {
  min-height: 420px;
}

.upload-entry-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 2px 12px;
}

.upload-entry__status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.upload-entry__body {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: stretch;
}

.upload-entry__form {
  flex: 1 1 420px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.upload-entry__preview-pane {
  flex: 1 1 360px;
  min-width: 320px;
  display: flex;
}

.upload-entry__preview-pane :deep(.upload-preview) {
  width: 100%;
}

.upload-entry__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.upload-entry__name {
  font-weight: 600;
  color: #e9ecf1;
}

.upload-entry__meta {
  font-size: 0.8rem;
  color: #90a4ae;
}

.category-selector {
  width: 100%;
}

.upload-entry__name-row,
.upload-entry__series-row,
.upload-entry__category-row,
.upload-entry__color-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.upload-entry__scatter-row {
  display: flex;
}

.upload-entry__color-input {
  min-width: 120px;
}

.upload-entry__color-row :deep(.v-field__append-inner) {
  padding-inline-end: 4px;
}

.color-swatch {
  width: 36px;
  min-width: 36px;
  height: 36px;
  border-radius: 8px;
  box-shadow: none;
}

.color-picker {
  padding: 12px;
}

.scatter-select__selection {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scatter-select__icon {
  margin-right: 4px;

}


.upload-preview-wrapper {
  position: relative;
  width: 100%;
}

.upload-preview__meta-overlay {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 2;
  background: rgba(0, 0, 0, 0.58);
  border-radius: 8px;
  padding: 8px 10px;
  backdrop-filter: blur(4px);
  pointer-events: none;
}

.upload-preview__meta-row {
  display: flex;
  gap: 8px;
  align-items: center;
  line-height: 1.4;
}

.upload-preview__meta-k {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
  min-width: 42px;
}

.upload-preview__meta-v {
  font-size: 0.76rem;
  font-weight: 500;
  color: rgba(233, 236, 241, 0.92);
}

.upload-preview__actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  z-index: 2;
}

.upload-preview__thumb {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.upload-preview__thumb img {
  width: 128px;
  height: auto;
  border-radius: 4px;
  object-fit: cover;
}

.upload-preview__thumb-label {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.85);
}

.upload-preview__file-input {
  display: none;
}

.upload-entry__error {
  color: #ef5350;
  font-size: 0.85rem;
}

.upload-entry__success {
  color: #66bb6a;
  font-size: 0.85rem;
}

.upload-entry__dimensions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-entry__dimension-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.upload-entry__dimension-grid :deep(.v-text-field) {
  flex: 1 1 0;
  min-width: 0;
}

.upload-entry__size-chip {
  align-self: center;
}

.upload-description-textarea :deep(textarea) {
  overflow-y: auto;
  resize: none;
}

.upload-entry__field-hint {
  margin-top: -8px;
  font-size: 0.8rem;
}

.upload-entry__field-hint--warning {
  color: #ef9a9a;
}

.upload-ai-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.upload-ai-row__error {
  color: #ef9a9a;
  font-size: 0.85rem;
}

.upload-ai-row__hint {
  color: #b2dfdb;
  font-size: 0.85rem;
}

.upload-empty-state {
  padding: 48px 12px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  text-align: center;
  color: #90a4ae;
}

.upload-actions {
  padding: 12px 20px;
  gap: 12px;
}

.upload-actions__error {
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef9a9a;
  font-size: 0.9rem;
  flex: 0 1 55%;
}

.upload-actions__error :deep(.v-icon) {
  margin-bottom: -2px;
}
</style>
