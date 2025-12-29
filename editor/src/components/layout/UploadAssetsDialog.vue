<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TerrainScatterCategory } from '@harmony/schema/terrain-scatter'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ResourceCategory } from '@/types/resource-category'
import type { AssetSeries } from '@/types/asset-series'
import CategoryPathSelector from '@/components/common/CategoryPathSelector.vue'
import SeriesSelector from '@/components/common/SeriesSelector.vue'
import AssetPreviewRenderer from '@/components/common/AssetPreviewRenderer.vue'
import { buildCategoryPathString } from '@/utils/categoryPath'
import {
  createAssetTag,
  fetchAssetTags,
  generateAssetTagSuggestions,
  mapServerAssetToProjectAsset,
  fetchResourceCategories,
  fetchAssetSeries,
  createAssetSeries,
  uploadAssetToServer,
} from '@/api/resourceAssets'
import { ensureAuthenticatedForResourceUpload } from '@/utils/uploadGuard'
import {
  generateAssetThumbnail,
  ASSET_THUMBNAIL_HEIGHT,
  ASSET_THUMBNAIL_WIDTH,
  createThumbnailFromCanvas,
} from '@/utils/assetThumbnail'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

const TYPE_COLOR_FALLBACK: Record<ProjectAsset['type'], string> = {
  model: '#26c6da',
  mesh: '#26c6da',
  image: '#1e88e5',
  texture: '#8e24aa',
  hdri: '#009688',
  material: '#ffb74d',
  prefab: '#7986cb',
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
  seriesId: string | null
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
}

type DimensionKey = 'dimensionLength' | 'dimensionWidth' | 'dimensionHeight'
type ImageDimensionKey = 'imageWidth' | 'imageHeight'

// Local state for dialog
const uploadEntries = ref<UploadAssetEntry[]>([])
const previewRefs = ref<Record<string, InstanceType<typeof AssetPreviewRenderer> | null>>({})
const thumbnailInputRefs = ref<Record<string, HTMLInputElement | null>>({})
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
const uploadError = ref<string | null>(null)
const serverTags = ref<TagOption[]>([])
const serverTagsLoaded = ref(false)
const serverTagsLoading = ref(false)
const serverTagsError = ref<string | null>(null)
const closeGuardDialogOpen = ref(false)

const resourceCategories = ref<ResourceCategory[]>([])
const resourceCategoriesLoaded = ref(false)
const resourceCategoriesLoading = ref(false)
const resourceCategoriesError = ref<string | null>(null)

const assetSeries = ref<AssetSeries[]>([])
const assetSeriesLoaded = ref(false)
const assetSeriesLoading = ref(false)
const assetSeriesError = ref<string | null>(null)

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
  const base: TagOption[] = Array.isArray(props.tagOptions) ? props.tagOptions : []
  const map = new Map<string, TagOption>()
  serverTags.value.forEach((option) => {
    if (!map.has(option.value)) map.set(option.value, option)
  })
  base.forEach((option) => {
    if (!map.has(option.value)) map.set(option.value, option)
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
})

const canUploadAll = computed(
  () => uploadEntries.value.some((entry) => entry.status !== 'success') && !uploadSubmitting.value,
)
const canUploadCurrent = computed(() => {
  const entry = activeEntry.value
  if (!entry) return false
  if (uploadSubmitting.value) return false
  return entry.status !== 'success' && entry.status !== 'uploading'
})
const hasUploadingEntries = computed(() => uploadEntries.value.some((entry) => entry.status === 'uploading'))
const hasDirtyEntries = computed(() => uploadEntries.value.some((entry) => entry.hasPendingChanges && entry.status !== 'success'))
const shouldConfirmClose = computed(() => hasUploadingEntries.value || hasDirtyEntries.value)
const closeGuardMessage = computed(() => {
  if (hasUploadingEntries.value) {
    return 'Some assets are still uploading. Closing now may interrupt the process. Continue?'
  }
  if (hasDirtyEntries.value) {
    return 'Some assets have unsaved changes. Close without uploading?'
  }
  return ''
})

// Helpers and UI logic moved from ProjectPanel
function canRequestAiTagsForEntry(entry: UploadAssetEntry | null): boolean {
  if (!entry) return false
  const name = entry.name?.trim().length ? entry.name.trim() : entry.asset.name?.trim()
  const description = entry.description?.trim() ?? ''
  return Boolean(name || description)
}

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

function applyEntryColor(entry: UploadAssetEntry, value: string | null): void {
  const normalized = normalizeHexColor(value)
  if (normalized) {
    entry.color = normalized
    entry.colorHexInput = normalized.toUpperCase()
    markEntryDirty(entry)
  }
}

function handleEntryColorInput(entry: UploadAssetEntry, value: string | number | null): void {
  const raw = typeof value === 'number' ? value.toString() : (value ?? '')
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
  entry.colorHexInput = hex.length ? `#${hex.toUpperCase()}` : ''
  if (!hex.length) {
    entry.color = ''
    markEntryDirty(entry)
    return
  }
  const normalized = normalizeHexColor(entry.colorHexInput)
  if (normalized) {
    entry.color = normalized
    markEntryDirty(entry)
  }
}

function handleEntryColorBlur(entry: UploadAssetEntry): void {
  const normalized = normalizeHexColor(entry.colorHexInput)
  if (!normalized) {
    entry.colorHexInput = ''
    entry.color = ''
    markEntryDirty(entry)
    return
  }
  entry.color = normalized
  entry.colorHexInput = normalized.toUpperCase()
  markEntryDirty(entry)
}

function handleEntryScatterPresetChange(
  entry: UploadAssetEntry,
  value: TerrainScatterCategory | string | null,
): void {
  const normalized = typeof value === 'string' && value.trim().length ? (value as TerrainScatterCategory) : null
  entry.terrainScatterPreset = normalized
  markEntryDirty(entry)
}

function entryColorPreview(entry: UploadAssetEntry): string {
  return (
    normalizeHexColor(entry.color) ??
    normalizeHexColor(entry.asset.color ?? null) ??
    TYPE_COLOR_FALLBACK[entry.asset.type] ??
    '#455A64'
  )
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
    entry.tagValues = value
  } else if (typeof value === 'string') {
    entry.tagValues = value.trim().length ? [value] : []
  } else {
    entry.tagValues = []
  }
  markEntryDirty(entry)
}

function formatDimension(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function setEntryDimension(entry: UploadAssetEntry, key: DimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  entry[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : null
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
  if (['model', 'prefab'].includes(entry.asset.type)) {
    const parts: string[] = []
    if (typeof entry.dimensionLength === 'number' && Number.isFinite(entry.dimensionLength) && entry.dimensionLength > 0) parts.push(`Length ${entry.dimensionLength.toFixed(2)} m`)
    if (typeof entry.dimensionWidth === 'number' && Number.isFinite(entry.dimensionWidth) && entry.dimensionWidth > 0) parts.push(`Width ${entry.dimensionWidth.toFixed(2)} m`)
    if (typeof entry.dimensionHeight === 'number' && Number.isFinite(entry.dimensionHeight) && entry.dimensionHeight > 0) parts.push(`Height ${entry.dimensionHeight.toFixed(2)} m`)
    if (parts.length) hints.push(`Model dimensions ${parts.join(', ')}`)
    const sizeCategory = entrySizeCategory(entry)
    if (sizeCategory) hints.push(`Size category ${sizeCategory}`)
  }
  if (entry.asset.type === 'image') {
    const parts: string[] = []
    if (typeof entry.imageWidth === 'number' && Number.isFinite(entry.imageWidth) && entry.imageWidth > 0) parts.push(`Width ${Math.round(entry.imageWidth)} px`)
    if (typeof entry.imageHeight === 'number' && Number.isFinite(entry.imageHeight) && entry.imageHeight > 0) parts.push(`Height ${Math.round(entry.imageHeight)} px`)
    if (parts.length) hints.push(`Image size ${parts.join(', ')}`)
  }
  return hints
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
  if (entry.status === 'success') {
    return
  }
  if (entry.status === 'error') {
    entry.error = null
  }
  entry.status = 'pending'
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
    seriesId: typeof asset.seriesId === 'string' ? asset.seriesId : null,
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
  }
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

function handleGenerateTagsClick(entry?: UploadAssetEntry): void {
  const target = entry ?? activeEntry.value
  if (!target) {
    return
  }
  void requestAiTagsForEntry(target, { auto: false })
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
    if (entry.thumbnailPreviewUrl) {
      URL.revokeObjectURL(entry.thumbnailPreviewUrl)
      entry.thumbnailPreviewUrl = null
    }
  })
  uploadEntries.value = []
  uploadError.value = null
  activeEntryId.value = null
  closeGuardDialogOpen.value = false
  previewRefs.value = {}
  thumbnailInputRefs.value = {}
}

async function loadServerTags(options: { force?: boolean } = {}) {
  const force = options.force ?? false
  if (serverTagsLoading.value) return
  if (serverTagsLoaded.value && !force) return
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

async function loadAssetSeries(options: { force?: boolean } = {}) {
  const force = options.force ?? false
  if (assetSeriesLoading.value) return
  if (assetSeriesLoaded.value && !force) return
  assetSeriesLoading.value = true
  assetSeriesError.value = null
  try {
    const seriesList = await fetchAssetSeries()
    assetSeries.value = Array.isArray(seriesList)
      ? [...seriesList].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN'))
      : []
    assetSeriesLoaded.value = true
  } catch (error) {
    assetSeriesError.value = (error as Error).message ?? 'Failed to load series'
  } finally {
    assetSeriesLoading.value = false
  }
}

async function handleCreateSeries(payload: { name: string; description?: string | null }): Promise<AssetSeries> {
  const created = await createAssetSeries(payload)
  const map = new Map(assetSeries.value.map((item) => [item.id, item] as const))
  map.set(created.id, created)
  assetSeries.value = Array.from(map.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN'))
  return created
}

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
  entry.categoryPathLabel = buildCategoryLabel(category)
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

function handleEntrySeriesChange(entry: UploadAssetEntry, value: string | null): void {
  const normalized = typeof value === 'string' ? value.trim() : ''
  entry.seriesId = normalized.length ? normalized : null
  markEntryDirty(entry)
}

function handleEntrySeriesCreated(entry: UploadAssetEntry, series: AssetSeries): void {
  if (series && typeof series.id === 'string') {
    handleEntrySeriesChange(entry, series.id)
    const map = new Map(assetSeries.value.map((item) => [item.id, item] as const))
    map.set(series.id, series)
    assetSeries.value = Array.from(map.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN'))
    void loadAssetSeries({ force: true })
  }
}

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
  previewRefs.value = { ...previewRefs.value, [entryId]: instance }
  if (!instance) {
    return
  }
  const entry = uploadEntries.value.find((item) => item.assetId === entryId)
  if (entry && isModelAsset(entry.asset) && !entry.thumbnailFile) {
    // Capture default snapshot once preview becomes ready.
    void nextTick(() => capturePreviewThumbnail(entry, { silent: true }))
  }
}

function registerThumbnailInput(entryId: string, element: HTMLInputElement | null): void {
  const next = { ...thumbnailInputRefs.value }
  if (!element) {
    delete next[entryId]
  } else {
    next[entryId] = element
  }
  thumbnailInputRefs.value = next
}

function promptThumbnailUpload(entry: UploadAssetEntry): void {
  if (!entry) return
  const input = thumbnailInputRefs.value[entry.assetId]
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
  if (entry.thumbnailPreviewUrl) {
    URL.revokeObjectURL(entry.thumbnailPreviewUrl)
  }
  entry.thumbnailFile = file
  entry.thumbnailPreviewUrl = URL.createObjectURL(file)
  entry.thumbnailCapturedAt = Date.now()
  entry.error = null
  markEntryDirty(entry)
  input.value = ''
}

function isModelAsset(asset: ProjectAsset): boolean {
  return ['model', 'mesh', 'prefab'].includes(asset.type)
}

async function capturePreviewThumbnail(entry: UploadAssetEntry, options: { silent?: boolean } = {}): Promise<void> {
  if (!isModelAsset(entry.asset)) {
    return
  }
  const instance = previewRefs.value[entry.assetId]
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
    if (entry.thumbnailPreviewUrl) {
      URL.revokeObjectURL(entry.thumbnailPreviewUrl)
    }
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
      // void nextTick(() => {
      //   void loadServerTags()
      //   void loadResourceCategories()
      //   void loadAssetSeries()
      // })
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
      resolvedIds.push(raw)
    })
    resolved.set(entry.assetId, resolvedIds)
  })

  return resolved
}

async function submitUpload(options: { entries?: UploadAssetEntry[] } = {}) {
  if (uploadSubmitting.value) return
  const resolveTargetEntries = () =>
    (options.entries ?? uploadEntries.value).filter((entry) => entry && entry.status !== 'success')

  if (!resolveTargetEntries().length) return

  const authenticated = await ensureAuthenticatedForResourceUpload()
  if (!authenticated) {
    uploadError.value = 'Please log in to upload assets.'
    return
  }

  const targetEntries = resolveTargetEntries()
  if (!targetEntries.length) return

  uploadSubmitting.value = true
  uploadError.value = null
  try {
    const tagMap = await resolveEntriesTagIds(targetEntries)
    const replacementMap = new Map<string, string>()
    for (const entry of targetEntries) {
      entry.status = 'uploading'
      entry.error = null
      try {
        const asset = sceneStore.getAsset(entry.assetId) ?? entry.asset
        if (!asset) throw new Error('Asset not found')
        const file = await createUploadFileFromCache(asset)
        const uploadName = entry.name.trim().length ? entry.name.trim() : asset.name
        const uploadDescription = entry.description.trim()
        const normalizedColor = normalizeHexColor(entry.color)
        let thumbnailFile: File | null = entry.thumbnailFile
        if (!thumbnailFile) {
          try {
            const thumbnailAsset: ProjectAsset = {
              ...asset,
              color: normalizedColor ?? asset.color,
              previewColor: normalizedColor ?? asset.previewColor,
            }
            thumbnailFile = await generateAssetThumbnail({
              asset: thumbnailAsset,
              file,
              width: ASSET_THUMBNAIL_WIDTH,
              height: ASSET_THUMBNAIL_HEIGHT,
            })
          } catch (thumbnailError) {
            throw new Error(`Failed to generate thumbnail: ${(thumbnailError as Error).message ?? 'Unknown error'}`)
          }
        }
        const dimensionLength = typeof entry.dimensionLength === 'number' && Number.isFinite(entry.dimensionLength) ? entry.dimensionLength : null
        const dimensionWidth = typeof entry.dimensionWidth === 'number' && Number.isFinite(entry.dimensionWidth) ? entry.dimensionWidth : null
        const dimensionHeight = typeof entry.dimensionHeight === 'number' && Number.isFinite(entry.dimensionHeight) ? entry.dimensionHeight : null
        const imageWidth = typeof entry.imageWidth === 'number' && Number.isFinite(entry.imageWidth) ? Math.round(entry.imageWidth) : null
        const imageHeight = typeof entry.imageHeight === 'number' && Number.isFinite(entry.imageHeight) ? Math.round(entry.imageHeight) : null
        const tagIds = tagMap.get(entry.assetId) ?? []

        const serverAsset = await uploadAssetToServer({
          file,
          thumbnailFile,
          name: uploadName,
          type: asset.type,
          description: uploadDescription.length ? uploadDescription : undefined,
          tagIds,
          categoryId: entry.categoryId,
          seriesId: entry.seriesId,
          color: normalizedColor,
          dimensionLength,
          dimensionWidth,
          dimensionHeight,
          imageWidth,
          imageHeight,
          terrainScatterPreset: entry.terrainScatterPreset ?? null,
        })
        const mapped = mapServerAssetToProjectAsset(serverAsset)
        const replaced = sceneStore.replaceLocalAssetWithServerAsset(entry.assetId, mapped, { source: { type: 'url' } })
        if (!replaced) throw new Error('Failed to update asset reference')
        await assetCacheStore.storeAssetBlob(replaced.id, {
          blob: file,
          mimeType: file.type || null,
          filename: file.name,
          downloadUrl: replaced.downloadUrl,
        })
        assetCacheStore.removeCache(entry.assetId)
        entry.status = 'success'
        entry.uploadedAssetId = replaced.id
        entry.hasPendingChanges = false
        replacementMap.set(entry.assetId, replaced.id)
      } catch (error) {
        entry.status = 'error'
        entry.error = (error as Error).message ?? 'Upload failed'
        entry.hasPendingChanges = true
      }
    }

    if (replacementMap.size) {
      emit('uploaded', { successCount: replacementMap.size, replacementMap: Object.fromEntries(replacementMap.entries()) })
    }

    const hasErrors = targetEntries.some((entry) => entry.status === 'error')
    if (hasErrors) {
      uploadError.value = 'Some assets failed to upload. Please check errors and retry.'
      return
    }

    // Keep dialog open after all uploads so users can review results or close manually.
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
</script>

<template>
  <v-dialog v-model="internalOpen" max-width="1200" persistent>

    <v-card class="material-details-panel">
      <v-toolbar density="compact" class="panel-toolbar" height="40px">
        <div class="toolbar-text">
          <div class="material-title">Upload Assets to Server</div>
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
                  <v-chip size="small" color="primary" variant="tonal">{{ entry.asset.type }}</v-chip>
                </div>
                <div v-if="entry.status === 'error'" class="upload-entry__error">{{ entry.error }}</div>

                <div class="upload-entry__body">
                  <div class="upload-entry__form">
                    <div class="upload-entry__name-row">
                      <v-text-field
                        class="upload-entry__name-input"
                        :model-value="entry.name"
                        label="Asset Name"
                        density="compact"
                        variant="underlined"
                        :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                        @update:model-value="(value) => handleEntryNameChange(entry, value)">
                      </v-text-field>
                    </div>

                    <div class="upload-entry__series-row">
                      <SeriesSelector
                        :model-value="entry.seriesId"
                        :series-options="assetSeries"
                        label="Asset Series"
                        density="compact"
                        :loading="assetSeriesLoading"
                        :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                        :clearable="true"
                        :allow-create="true"
                        :create-series="handleCreateSeries"
                        @update:model-value="(value) => handleEntrySeriesChange(entry, value)"
                        @series-created="(series) => handleEntrySeriesCreated(entry, series)"
                      />
                    </div>

                    <div class="upload-entry__category-row">
                      <CategoryPathSelector
                        :model-value="entry.categoryId"
                        :categories="resourceCategories"
                        label="Asset Category"
                        placeholder="Select or create a category"
                        hint="Optional. Leave empty to keep the asset in the root category."
                        class="category-selector"
                        :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                        @update:model-value="(value) => handleEntryCategoryChange(entry, value)"
                        @category-selected="(payload) => handleEntryCategorySelected(entry, payload)"
                        @category-created="(category) => handleEntryCategoryCreated(entry, category)"
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
                        :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
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

                    <div class="upload-entry__color-row">
                      <v-text-field
                        class="upload-entry__color-input"
                        :model-value="entry.colorHexInput"
                        label="Primary Color"
                        density="compact"
                        variant="underlined"
                        placeholder="#RRGGBB"
                        hide-details
                        spellcheck="false"
                        autocorrect="off"
                        autocomplete="off"
                        :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                        @update:model-value="(value) => handleEntryColorInput(entry, value)"
                        @blur="() => handleEntryColorBlur(entry)"
                      >
                        <template #append-inner>
                          <v-menu :close-on-content-click="false" transition="scale-transition" location="bottom start">
                            <template #activator="{ props: menuProps }">
                              <v-btn
                                v-bind="menuProps"
                                class="color-swatch"
                                :style="{ backgroundColor: entryColorPreview(entry) }"
                                variant="tonal"
                                size="small"
                                :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                              >
                                <v-icon color="white" size="16">mdi-eyedropper-variant</v-icon>
                              </v-btn>
                            </template>
                            <div class="color-picker">
                              <v-color-picker
                                :model-value="entryColorPreview(entry)"
                                mode="hex"
                                :modes="['hex']"
                                hide-inputs
                                @update:model-value="(value) => applyEntryColor(entry, value as string)"
                              />
                            </div>
                          </v-menu>
                        </template>
                      </v-text-field>
                    </div>

                    <div v-if="entry.asset.type === 'model' || entry.asset.type === 'prefab'" class="upload-entry__dimensions">
                      <div class="upload-entry__dimension-grid">
                        <v-text-field
                          :model-value="formatDimension(entry.dimensionLength)"
                          label="Length (m)"
                          type="number"
                          density="compact"
                          variant="underlined"
                          step="0.01"
                          min="0"
                          suffix="m"
                          :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                          @update:model-value="(value) => setEntryDimension(entry, 'dimensionLength', value)"
                        />
                        <v-text-field
                          :model-value="formatDimension(entry.dimensionWidth)"
                          label="Width (m)"
                          type="number"
                          density="compact"
                          variant="underlined"
                          step="0.01"
                          min="0"
                          suffix="m"
                          :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                          @update:model-value="(value) => setEntryDimension(entry, 'dimensionWidth', value)"
                        />
                        <v-text-field
                          :model-value="formatDimension(entry.dimensionHeight)"
                          label="Height (m)"
                          type="number"
                          density="compact"
                          variant="underlined"
                          step="0.01"
                          min="0"
                          suffix="m"
                          :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                          @update:model-value="(value) => setEntryDimension(entry, 'dimensionHeight', value)"
                        />
                      </div>
                      <v-chip v-if="entrySizeCategory(entry)" class="upload-entry__size-chip" size="small" color="secondary" variant="tonal">
                        Size category: {{ entrySizeCategory(entry) }}
                      </v-chip>
                    </div>
                    <div v-else-if="entry.asset.type === 'image'" class="upload-entry__dimensions">
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
                          :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
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
                          :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
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
                      :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
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
                      :disabled="uploadSubmitting || entry.status === 'uploading' || entry.status === 'success'"
                      @update:model-value="(value) => handleEntryTagsChange(entry, value as string[])"
                    />

                    <div class="upload-ai-row">
                      <v-btn
                        color="secondary"
                        variant="tonal"
                        size="small"
                        :disabled="uploadSubmitting || !canRequestAiTagsForEntry(entry) || entry.aiLoading"
                        :loading="entry.aiLoading"
                        @click="() => handleGenerateTagsClick(entry)"
                      >
                        Generate tags with AI
                      </v-btn>
                      <span v-if="entry.aiError" class="upload-ai-row__error">{{ entry.aiError }}</span>
                      <span v-else-if="entry.aiSuggestedTags.length" class="upload-ai-row__hint">Suggested: {{ entry.aiSuggestedTags.join(', ') }}</span>
                    </div>
                  </div>
                  <div class="upload-entry__preview-pane">
                    <div class="upload-preview-wrapper">
                      <AssetPreviewRenderer
                        :asset="entry.asset"
                        :primary-color="entry.color || entry.asset.color || null"
                        :ref="(instance) => registerPreviewRef(entry.assetId, instance as InstanceType<typeof AssetPreviewRenderer> | null)"
                        @dimensions="(payload) => handlePreviewDimensions(entry, payload)"
                        @image-meta="(payload) => handlePreviewImageMeta(entry, payload)"
                      />
                      <div v-if="['model', 'mesh', 'prefab'].includes(entry.asset.type)" class="upload-preview__actions">
                        <v-btn
                          color="primary"
                          variant="tonal"
                          size="small"
                          icon="mdi-camera"
                          :disabled="uploadSubmitting || entry.status === 'uploading'"
                          title="Capture thumbnail"
                          aria-label="Capture thumbnail"
                          @click="() => capturePreviewThumbnail(entry)"
                        />
                        <v-btn
                          color="secondary"
                          variant="tonal"
                          size="small"
                          icon="mdi-upload"
                          :disabled="uploadSubmitting || entry.status === 'uploading'"
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
                        <div v-if="entry.thumbnailPreviewUrl" class="upload-preview__thumb">
                          <img :src="entry.thumbnailPreviewUrl" alt="Captured thumbnail" />
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
          Select local assets to begin uploading.
        </div>
      </v-card-text>
      <v-card-actions class="upload-actions">
        <div class="upload-actions__error" role="status" aria-live="polite">
          <template v-if="uploadError">
            <v-icon size="18" color="error">mdi-alert-circle</v-icon>
            <span>{{ uploadError }}</span>
          </template>
        </div>
        <v-spacer />
        <v-btn color="secondary" variant="tonal" :disabled="!canUploadCurrent" :loading="uploadSubmitting && !!activeEntry && activeEntry.status === 'uploading'" @click="handleUploadCurrent">
          Upload Current
        </v-btn>
        <v-btn color="primary" variant="flat" :loading="uploadSubmitting" :disabled="!canUploadAll" @click="handleUploadAll">
          Upload All
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="closeGuardDialogOpen" max-width="420">
    <v-card>
      <v-card-title>Close upload dialog?</v-card-title>
      <v-card-text>{{ closeGuardMessage }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancelDialogClose">Stay</v-btn>
        <v-btn color="warning" variant="flat" @click="confirmDialogClose">Leave</v-btn>
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
