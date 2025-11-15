<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { ResourceCategory } from '@/types/resource-category'
import type { AssetSeries } from '@/types/asset-series'
import CategoryPathSelector from '@/components/common/CategoryPathSelector.vue'
import SeriesSelector from '@/components/common/SeriesSelector.vue'
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
  status: 'pending' | 'uploading' | 'success' | 'error'
  error: string | null
  uploadedAssetId: string | null
  aiLastSignature: string | null
}

type DimensionKey = 'dimensionLength' | 'dimensionWidth' | 'dimensionHeight'
type ImageDimensionKey = 'imageWidth' | 'imageHeight'

// Local state for dialog
const uploadEntries = ref<UploadAssetEntry[]>([])
const uploadPrimaryEntry = computed<UploadAssetEntry | null>(() => uploadEntries.value[0] ?? null)
const uploadPrimaryDescription = computed<string>({
  get() {
    return uploadPrimaryEntry.value?.description ?? ''
  },
  set(value: string) {
    if (uploadPrimaryEntry.value) {
      uploadPrimaryEntry.value.description = value
    }
  },
})
const uploadSelectedTagIds = ref<string[]>([])
const uploadSubmitting = ref(false)
const uploadError = ref<string | null>(null)
const aiTagLoading = ref(false)
const aiTagError = ref<string | null>(null)
const aiSuggestedTags = ref<string[]>([])
const serverTags = ref<TagOption[]>([])
const serverTagsLoaded = ref(false)
const serverTagsLoading = ref(false)
const serverTagsError = ref<string | null>(null)

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

const canSubmitUpload = computed(() => uploadEntries.value.length > 0 && !uploadSubmitting.value)
const canRequestAiTags = computed(() => {
  const entry = uploadEntries.value[0]
  if (!entry) return false
  const name = entry.name?.trim().length ? entry.name.trim() : entry.asset.name?.trim()
  const description = entry.description?.trim() ?? ''
  return Boolean(name || description)
})

// Helpers and UI logic moved from ProjectPanel
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
  }
}

function handleEntryColorInput(entry: UploadAssetEntry, value: string | number | null): void {
  const raw = typeof value === 'number' ? value.toString() : (value ?? '')
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
  entry.colorHexInput = hex.length ? `#${hex.toUpperCase()}` : ''
  if (!hex.length) {
    entry.color = ''
    return
  }
  const normalized = normalizeHexColor(entry.colorHexInput)
  if (normalized) {
    entry.color = normalized
  }
}

function formatDimension(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function setEntryDimension(entry: UploadAssetEntry, key: DimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  entry[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function formatInteger(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : ''
}

function setEntryImageDimension(entry: UploadAssetEntry, key: ImageDimensionKey, value: string | number | null): void {
  const parsed = typeof value === 'number' ? value : Number.parseFloat((value ?? '').toString())
  entry[key] = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
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

function findTagOptionByName(options: TagOption[], name: string): TagOption | undefined {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return undefined
  return options.find((option) => option.name.toLowerCase() === normalized || option.label.toLowerCase() === normalized)
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
  if (entry.asset.type === 'model' || entry.asset.type === 'prefab') {
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

function integrateSuggestedTags(tags: string[]): number {
  if (!tags.length) return 0
  const existing = new Set(
    uploadSelectedTagIds.value
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
  uploadSelectedTagIds.value = [...uploadSelectedTagIds.value, ...appended]
  return appended.length
}

async function requestAiTagsForEntry(entry: UploadAssetEntry, options: { auto?: boolean } = {}): Promise<void> {
  if (aiTagLoading.value) return
  const preferredName = entry.name?.trim().length ? entry.name.trim() : entry.asset.name
  const description = entry.description?.trim() ?? ''
  if (!preferredName && !description) {
    if (!options.auto) aiTagError.value = 'Please enter a name or description first'
    return
  }
  const signature = buildAiSignature(entry)
  if (options.auto && entry.aiLastSignature === signature) return
  aiTagLoading.value = true
  aiTagError.value = null
  try {
    const result = await generateAssetTagSuggestions({
      name: preferredName,
      description,
      assetType: entry.asset.type,
      extraHints: buildExtraHints(entry),
    })
    const added = integrateSuggestedTags(result.tags ?? [])
    aiSuggestedTags.value = result.tags ?? []
    entry.aiLastSignature = signature
    if (!added && !options.auto) {
      aiTagError.value = 'AI suggested tags already exist. You can continue editing or upload.'
    }
  } catch (error) {
    if (options.auto) {
      console.warn('Auto tag generation failed', error)
      return
    }
    aiTagError.value = (error as Error).message ?? 'Failed to generate tags'
  } finally {
    aiTagLoading.value = false
  }
}

function handleGenerateTagsClick(): void {
  const entry = uploadEntries.value[0]
  if (!entry) {
    aiTagError.value = 'No asset available. Please select assets to upload first.'
    return
  }
  void requestAiTagsForEntry(entry, { auto: false })
}

function handleEntryDescriptionBlur(entry: UploadAssetEntry): void {
  if (!entry.description?.trim()) return
  void requestAiTagsForEntry(entry, { auto: true })
}

function resetUploadState() {
  uploadEntries.value = []
  uploadSelectedTagIds.value = []
  uploadError.value = null
  aiTagLoading.value = false
  aiTagError.value = null
  aiSuggestedTags.value = []
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
}

function handleEntryCategorySelected(entry: UploadAssetEntry, payload: { id: string | null; label: string }): void {
  entry.categoryId = payload.id ?? null
  entry.categoryPathLabel = payload.label ?? ''
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

// Initialize entries when dialog opens
watch(
  () => internalOpen.value,
  (open) => {
    if (open) {
      uploadEntries.value = props.assets.map((asset) => {
        const normalizedColor = normalizeHexColor(asset.color ?? null)
        const initialCategoryId = typeof asset.categoryId === 'string' ? asset.categoryId : null
        const initialSegments = Array.isArray(asset.categoryPath)
          ? asset.categoryPath
              .map((item) => (item?.name ?? '').trim())
              .filter((segment) => segment.length > 0)
          : []
        const initialCategoryLabel = asset.categoryPathString
          ?? (initialSegments.length ? buildCategoryPathString(initialSegments) : '')
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
          status: 'pending',
          error: null,
          uploadedAssetId: null,
          aiLastSignature: null,
        }
      })
      uploadSelectedTagIds.value = []
      uploadError.value = null
      void nextTick(() => {
        void loadServerTags()
        void loadResourceCategories()
        void loadAssetSeries()
      })
    } else if (!uploadSubmitting.value) {
      resetUploadState()
    }
  },
  { immediate: false }
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

async function ensureUploadTagIds(): Promise<string[]> {
  const existingOptions = uploadTagOptions.value
  const resolved = new Set<string>()
  const pendingNames = new Map<string, string>()
  const createdNameMap = new Map<string, string>()

  uploadSelectedTagIds.value.forEach((value) => {
    const raw = typeof value === 'string' ? value : (value as TagOption | undefined)?.value ?? ''
    const trimmed = raw.trim()
    if (!trimmed.length) return
    const matchById = existingOptions.find((option) => option.value === trimmed)
    if (matchById) {
      resolved.add(matchById.value)
      return
    }
    const matchByName = findTagOptionByName(existingOptions, trimmed)
    if (matchByName) {
      resolved.add(matchByName.value)
      return
    }
    const normalized = trimmed.toLowerCase()
    if (!pendingNames.has(normalized)) {
      pendingNames.set(normalized, trimmed)
    }
  })

  if (pendingNames.size > 0) {
    const originalNames = Array.from(pendingNames.values())
    try {
      const created = await createAssetTag({ names: originalNames })
      const optionMap = new Map(serverTags.value.map((entry) => [entry.value, entry] as const))
      created.forEach((tag) => {
        const option = createTagOption(tag.id, tag.name)
        optionMap.set(option.value, option)
        createdNameMap.set(option.name.trim().toLowerCase(), option.value)
      })
      serverTags.value = Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
      pendingNames.forEach((_original, normalized) => {
        const createdId = createdNameMap.get(normalized)
        if (createdId) resolved.add(createdId)
      })
    } catch (error) {
      const fallback = originalNames[0]
      throw new Error((error as Error).message ?? (fallback ? `Failed to create tag "${fallback}"` : 'Failed to create tag'))
    }
  }

  const updatedOptions = uploadTagOptions.value
  uploadSelectedTagIds.value = uploadSelectedTagIds.value
    .map((value) => {
      const raw = typeof value === 'string' ? value : (value as TagOption | undefined)?.value ?? ''
      const trimmed = raw.trim()
      if (!trimmed.length) return ''
      const matchById = updatedOptions.find((option) => option.value === trimmed)
      if (matchById) return matchById.value
      const matchByName = findTagOptionByName(updatedOptions, trimmed)
      if (matchByName) return matchByName.value
      const createdId = createdNameMap.get(trimmed.toLowerCase())
      return createdId ?? trimmed
    })
    .filter((value) => value.trim().length > 0)

  uploadSelectedTagIds.value.forEach((id) => {
    const match = updatedOptions.find((option) => option.value === id)
    resolved.add(match ? match.value : id)
  })

  return Array.from(resolved)
}

async function submitUpload() {
  if (uploadSubmitting.value || !uploadEntries.value.length) return
  const missingCategory = uploadEntries.value.find((entry) => !entry.categoryId || !entry.categoryId.trim().length)
  if (missingCategory) {
    uploadError.value = 'Please select a category for all assets'
    return
  }
  uploadSubmitting.value = true
  uploadError.value = null
  try {
    const tagIds = await ensureUploadTagIds()
    const replacementMap = new Map<string, string>()
    for (const entry of uploadEntries.value) {
      if (entry.status === 'success') continue
      entry.status = 'uploading'
      entry.error = null
      try {
        const asset = sceneStore.getAsset(entry.assetId) ?? entry.asset
        if (!asset) throw new Error('Asset not found')
        const file = await createUploadFileFromCache(asset)
        const uploadName = entry.name.trim().length ? entry.name.trim() : asset.name
        const uploadDescription = entry.description.trim()
        const normalizedColor = normalizeHexColor(entry.color)
        const dimensionLength = typeof entry.dimensionLength === 'number' && Number.isFinite(entry.dimensionLength) ? entry.dimensionLength : null
        const dimensionWidth = typeof entry.dimensionWidth === 'number' && Number.isFinite(entry.dimensionWidth) ? entry.dimensionWidth : null
        const dimensionHeight = typeof entry.dimensionHeight === 'number' && Number.isFinite(entry.dimensionHeight) ? entry.dimensionHeight : null
        const imageWidth = typeof entry.imageWidth === 'number' && Number.isFinite(entry.imageWidth) ? Math.round(entry.imageWidth) : null
        const imageHeight = typeof entry.imageHeight === 'number' && Number.isFinite(entry.imageHeight) ? Math.round(entry.imageHeight) : null

        const serverAsset = await uploadAssetToServer({
          file,
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
        replacementMap.set(entry.assetId, replaced.id)
      } catch (error) {
        entry.status = 'error'
        entry.error = (error as Error).message ?? 'Upload failed'
      }
    }

    const hasErrors = uploadEntries.value.some((entry) => entry.status === 'error')
    if (hasErrors) {
      uploadError.value = 'Some assets failed to upload. Please check errors and retry.'
      return
    }

    // Success
    const successCount = replacementMap.size || uploadEntries.value.length
    internalOpen.value = false
    resetUploadState()
    emit('uploaded', { successCount, replacementMap: Object.fromEntries(replacementMap.entries()) })
  } catch (error) {
    uploadError.value = (error as Error).message ?? 'Failed to upload assets'
  } finally {
    uploadSubmitting.value = false
  }
}
</script>

<template>
  <v-dialog v-model="internalOpen" max-width="720" persistent>
    <v-card   class="material-details-panel">
      <v-card-title>Upload Assets to Server</v-card-title>
      <v-card-text>
        <v-alert v-if="uploadError" type="error" variant="tonal" density="comfortable" class="mb-4">
          {{ uploadError }}
        </v-alert>
        <div class="upload-section">
          <div v-for="entry in uploadEntries" :key="entry.assetId" class="upload-entry">
            <div class="upload-entry__header">
              <span class="upload-entry__name">{{ entry.asset.name }}</span>
              <v-chip size="small" color="primary" variant="tonal">{{ entry.asset.type }}</v-chip>
            </div>
            <div class="upload-entry__name-row">
              <v-text-field
                class="upload-entry__name-input"
                v-model="entry.name"
                label="Asset Name"
            density="compact"
            variant="underlined"
                :disabled="uploadSubmitting || entry.status === 'success'"
              />
            </div>
            <div class="upload-entry__series-row ">
              <SeriesSelector
                :model-value="entry.seriesId"
                :series-options="assetSeries"
                label="Asset Series"
                density="compact"
                :loading="assetSeriesLoading"
                :disabled="uploadSubmitting || entry.status === 'success'"
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
                class="category-selector"
                :disabled="uploadSubmitting || entry.status === 'success'"
                @update:model-value="(value) => handleEntryCategoryChange(entry, value)"
                @category-selected="(payload) => handleEntryCategorySelected(entry, payload)"
                @category-created="(category) => handleEntryCategoryCreated(entry, category)"
              />
            </div>
            <div class="upload-entry__color-row">
              <div class="color-input">
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
                  :disabled="uploadSubmitting || entry.status === 'success'"
                  @update:model-value="(value) => handleEntryColorInput(entry, value)"
                />
                <v-menu :close-on-content-click="false" transition="scale-transition" location="bottom start">
                  <template #activator="{ props: menuProps }">
                    <button
                      class="color-swatch"
                      type="button"
                      v-bind="menuProps"
                      :style="{ backgroundColor: entry.color || '#455A64' }"
                      :title="(entry.color || '').toUpperCase() || 'Pick a color'"
                      :disabled="uploadSubmitting || entry.status === 'success'"
                    >
                      <span class="sr-only">Pick color</span>
                    </button>
                  </template>
                  <div class="color-picker">
                    <v-color-picker :model-value="entry.color || '#455A64'" mode="hex" :modes="['hex']" hide-inputs @update:model-value="(value) => applyEntryColor(entry, value as string)" />
                  </div>
                </v-menu>
              </div>
            </div>

            <div v-if="entry.asset.type === 'model' || entry.asset.type === 'prefab'" class="upload-entry__dimensions">
              <v-text-field :model-value="formatDimension(entry.dimensionLength)" label="Length (m)" type="number" density="compact" variant="underlined" step="0.01" min="0" suffix="m" :disabled="uploadSubmitting || entry.status === 'success'" @update:model-value="(value) => setEntryDimension(entry, 'dimensionLength', value)" />
              <v-text-field :model-value="formatDimension(entry.dimensionWidth)" label="Width (m)" type="number" density="compact" variant="underlined" step="0.01" min="0" suffix="m" :disabled="uploadSubmitting || entry.status === 'success'" @update:model-value="(value) => setEntryDimension(entry, 'dimensionWidth', value)" />
              <v-text-field :model-value="formatDimension(entry.dimensionHeight)" label="Height (m)" type="number" density="compact" variant="underlined" step="0.01" min="0" suffix="m" :disabled="uploadSubmitting || entry.status === 'success'" @update:model-value="(value) => setEntryDimension(entry, 'dimensionHeight', value)" />
              <v-chip v-if="entrySizeCategory(entry)" class="upload-entry__size-chip" size="small" color="secondary" variant="tonal">
                Size category: {{ entrySizeCategory(entry) }}
              </v-chip>
            </div>
            <div v-else-if="entry.asset.type === 'image'" class="upload-entry__dimensions">
              <v-text-field :model-value="formatInteger(entry.imageWidth)" label="Image width (px)" type="number" density="compact" variant="underlined" step="1" min="0" suffix="px" :disabled="uploadSubmitting || entry.status === 'success'" @update:model-value="(value) => setEntryImageDimension(entry, 'imageWidth', value)" />
              <v-text-field :model-value="formatInteger(entry.imageHeight)" label="Image height (px)" type="number" density="compact" variant="underlined" step="1" min="0" suffix="px" :disabled="uploadSubmitting || entry.status === 'success'" @update:model-value="(value) => setEntryImageDimension(entry, 'imageHeight', value)" />
            </div>
            <div v-if="entry.status === 'error'" class="upload-entry__error">{{ entry.error }}</div>
            <div v-else-if="entry.status === 'success'" class="upload-entry__success">Uploaded</div>
          </div>
        </div>
        <v-textarea v-model="uploadPrimaryDescription" label="Description" density="compact" variant="underlined" rows="4" class="upload-description-textarea" :disabled="uploadSubmitting || !!(uploadPrimaryEntry && uploadPrimaryEntry.status === 'success')" @blur="() => uploadPrimaryEntry && handleEntryDescriptionBlur(uploadPrimaryEntry)" />
        <v-combobox
          v-model="uploadSelectedTagIds"
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
          :disabled="uploadSubmitting"
        />
        <div class="upload-ai-row">
          <v-btn color="secondary" variant="tonal" size="small" :disabled="uploadSubmitting || !uploadEntries.length || aiTagLoading || !canRequestAiTags" :loading="aiTagLoading" @click="handleGenerateTagsClick">
            Generate tags with AI
          </v-btn>
          <span v-if="aiTagError" class="upload-ai-row__error">{{ aiTagError }}</span>
          <span v-else-if="aiSuggestedTags.length" class="upload-ai-row__hint">Suggested: {{ aiSuggestedTags.join(', ') }}</span>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="uploadSubmitting" @click="internalOpen = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :loading="uploadSubmitting" :disabled="!canSubmitUpload" @click="submitUpload">
          Upload
        </v-btn>
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
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
}


.upload-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.upload-entry {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.upload-entry:last-child {
  border-bottom: none;
}

.upload-entry__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.category-selector {
  width: 100%;
}
.upload-entry__name {
  font-weight: 600;
  color: #e9ecf1;
}

.upload-entry__name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

.upload-entry__name-input {
  flex: 1;
}

.upload-entry__name-input :deep(.v-input) {
  margin-bottom: 0;
}

.upload-entry__category-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 15px;
  flex-wrap: nowrap;
}

.upload-entry__series-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: nowrap;
}

.upload-entry__category-label {
  margin-top: 4px;
  font-size: 0.85rem;
  color: #cfd8dc;
}

.upload-entry__color-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: nowrap;
}

.upload-entry__color-input {
  min-width: 120px;
}

.upload-entry__color-input :deep(.v-input) {
  margin-bottom: 0;
}

.color-input {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 0;
  background: transparent;
}

.color-swatch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.color-swatch:focus-visible {
  outline: 2px solid rgba(107, 152, 255, 0.85);
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

.upload-entry__error {
  color: #ef5350;
  font-size: 0.85rem;
  margin-top: 6px;
}

.upload-entry__success {
  color: #66bb6a;
  font-size: 0.85rem;
  margin-top: 6px;
}

.upload-ai-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.v-textarea + .v-combobox {
  margin-top: 12px;
}

.upload-ai-row__error {
  color: #ef9a9a;
  font-size: 0.85rem;
}

.upload-ai-row__hint {
  color: #b2dfdb;
  font-size: 0.85rem;
}

.upload-entry__dimensions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.upload-entry__size-chip {
  align-self: center;
}

.upload-description-textarea :deep(textarea) {
  overflow-y: auto;
  resize: none;
}
</style>
