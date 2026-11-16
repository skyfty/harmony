import type { ProjectAsset } from '@/types/project-asset'
import type { useSceneStore } from '@/stores/sceneStore'
import { prepareLocalAssetImport, type LocalAssetImportPhase } from '@/utils/localAssetImport'
import { computeBlobHash, extractExtension } from '@/utils/blob'
import { getExtensionFromMimeType } from '@schema/core'

type SceneStore = ReturnType<typeof useSceneStore>

export interface LocalAssetImportPipelineOptions {
  displayName?: string
  type: ProjectAsset['type']
  description?: string
  previewColor?: string
  directoryId?: string
  autoSave?: boolean
  signal?: AbortSignal
  onPhase?: (phase: LocalAssetImportPhase | 'store-asset' | 'reuse-existing' | 'finalize') => void
}

export interface LocalAssetImportPipelineResult {
  asset: ProjectAsset
  isNew: boolean
}

function resolvePreviewColor(type: ProjectAsset['type']): string {
  switch (type) {
    case 'image':
    case 'texture':
    case 'hdri':
      return '#546E7A'
    case 'model':
    case 'mesh':
    case 'prefab':
    case 'dice':
      return '#455A64'
    case 'material':
      return '#5D4037'
    default:
      return '#37474F'
  }
}

function mergeMetadata(
  current: ProjectAsset['metadata'],
  incoming: ProjectAsset['metadata'],
): ProjectAsset['metadata'] {
  if (!current && !incoming) {
    return null
  }
  return {
    ...(current && typeof current === 'object' ? current : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {}),
  }
}

export async function importLocalAssetFile(
  store: SceneStore,
  file: File,
  options: LocalAssetImportPipelineOptions,
): Promise<LocalAssetImportPipelineResult> {
  const assetId = await computeBlobHash(file)
  const existing = store.getAsset(assetId)
  if (existing) {
    options.onPhase?.('reuse-existing')
    options.onPhase?.('finalize')
    return { asset: existing, isNew: false }
  }

  const displayName = options.displayName?.trim() || file.name?.trim() || 'Local Asset'
  const draftAsset: ProjectAsset = {
    id: assetId,
    name: displayName,
    type: options.type,
    downloadUrl: file.name || displayName,
    previewColor: options.previewColor ?? resolvePreviewColor(options.type),
    thumbnail: null,
    description: options.description ?? displayName,
    metadata: null,
    gleaned: true,
    extension: extractExtension(file.name) ?? getExtensionFromMimeType(file.type) ?? null,
  }

  const prepared = await prepareLocalAssetImport(draftAsset, file, {
    signal: options.signal,
    onPhase: options.onPhase,
  })
  options.onPhase?.('store-asset')
  const { asset } = await store.ensureLocalAssetFromFile(file, {
    type: options.type,
    name: displayName,
    description: options.description ?? displayName,
    previewColor: options.previewColor ?? resolvePreviewColor(options.type),
    gleaned: true,
    autoSave: options.autoSave,
  })

  const updates: Partial<ProjectAsset> = {}
  if (typeof prepared.dimensionLength === 'number' && prepared.dimensionLength > 0) {
    updates.dimensionLength = prepared.dimensionLength
  }
  if (typeof prepared.dimensionWidth === 'number' && prepared.dimensionWidth > 0) {
    updates.dimensionWidth = prepared.dimensionWidth
  }
  if (typeof prepared.dimensionHeight === 'number' && prepared.dimensionHeight > 0) {
    updates.dimensionHeight = prepared.dimensionHeight
  }
  if (typeof prepared.imageWidth === 'number' && prepared.imageWidth > 0) {
    updates.imageWidth = Math.round(prepared.imageWidth)
  }
  if (typeof prepared.imageHeight === 'number' && prepared.imageHeight > 0) {
    updates.imageHeight = Math.round(prepared.imageHeight)
  }
  if (prepared.thumbnailDataUrl) {
    updates.thumbnail = prepared.thumbnailDataUrl
  }
  const metadata = mergeMetadata(asset.metadata, prepared.metadata)
  if (metadata) {
    updates.metadata = metadata
  }

  let registered = Object.keys(updates).length
    ? (store.updateProjectAssetMetadata(asset.id, updates) ?? asset)
    : asset
  if (options.directoryId && !store.moveProjectAssetToDirectory(registered.id, options.directoryId)) {
    registered = store.findAssetInCatalog(registered.id) ?? registered
  }
  options.onPhase?.('finalize')
  return { asset: registered, isNew: true }
}
