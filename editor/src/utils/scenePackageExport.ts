import { zipSync, strToU8 } from 'fflate'
import type { SceneJsonExportDocument, ProjectExportBundleProjectConfig } from '@schema'
import {
  GROUND_SCATTER_SIDECAR_FILENAME,
  GROUND_PAINT_SIDECAR_FILENAME,
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@schema'
import { inferExtFromMimeType } from '@schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useGroundPaintStore } from '@/stores/groundPaintStore'
import { useGroundScatterStore } from '@/stores/groundScatterStore'
import { useGroundHeightmapStore } from '@/stores/groundHeightmapStore'
import { buildPackageAssetMapForExport, calculateSceneResourceSummary, useSceneStore } from '@/stores/sceneStore'
import { useScenesStore } from '@/stores/scenesStore'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { PlanningSceneData } from '@/types/planning-scene-data'
import type { PlanningScenePackageImageEntry, PlanningScenePackageSidecar } from '@/types/planning-package'
import { computeSha256Hex, getPlanningImageBlobByHash } from '@/utils/planningImageStorage'
import {
  GROUND_HEIGHTMAP_SIDECAR_FILENAME,
  stripGroundHeightMapsFromSceneDocument,
} from '@/utils/groundHeightSidecar'
import { collectPunchPointsFromNodes } from './sceneExport'
import {
  BUILTIN_WATER_NORMAL_FILENAME,
  isBuiltinWaterNormalAsset,
} from '@/constants/builtinAssets'

function extractAssetIdFromPackageMapKey(key: string): string | null {
  const normalized = typeof key === 'string' ? key.trim() : ''
  if (!normalized) {
    return null
  }
  if (normalized.startsWith('local::')) {
    const assetId = normalized.slice('local::'.length).trim()
    return assetId || null
  }
  if (normalized.startsWith('url::')) {
    const assetId = normalized.slice('url::'.length).trim()
    return assetId || null
  }
  return null
}

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
  planningData?: PlanningSceneData | null
}

// inferExtFromMimeType moved to @schema (assetTypeConversion)

function inferExtFromFilename(filename: string | null | undefined): string | null {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot >= raw.length - 1) return null
  const ext = raw.slice(dot + 1).toLowerCase().trim()
  return ext.length ? ext : null
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2))
}

async function sha256Hex(input: string): Promise<string> {
  const text = typeof input === 'string' ? input : String(input)
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const view = new Uint8Array(digest)
      let out = ''
      for (let i = 0; i < view.length; i += 1) {
        out += view[i]!.toString(16).padStart(2, '0')
      }
      return out
    }
  } catch (_error) {
    // fall through
  }

  // Fallback (non-crypto hash): stable enough for filenames.
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return `djb2_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

type ResolvedEmbedAsset = {
  assetId: string
  downloadUrl: string | null
  mimeTypeHint?: string | null
  filenameHint?: string | null
}

type SceneResourceSummaryAsset = {
  assetId?: string | null
  downloadUrl?: string | null
  mimeType?: string | null
  filename?: string | null
}

type SceneResourceSummary = {
  assets?: SceneResourceSummaryAsset[] | null
}

type SceneExportDocumentWithEditorFields = SceneJsonExportDocument & {
  assetUrlOverrides?: Record<string, string>
  resourceSummary?: SceneResourceSummary
  planningData?: unknown
}

function cloneSceneExportDocument<T>(document: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(document)
  }
  return JSON.parse(JSON.stringify(document)) as T
}

function stripGroundBakedTextureAssetIds(nodes: SceneJsonExportDocument['nodes']): void {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      node.dynamicMesh.terrainPaintBakedTextureAssetId = null
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stripGroundBakedTextureAssetIds(node.children)
    }
  }
}

async function prepareSceneDocumentForPackageExport(document: SceneJsonExportDocument): Promise<SceneJsonExportDocument> {
  const cloned = cloneSceneExportDocument(document) as SceneExportDocumentWithEditorFields
  if (!cloned || typeof cloned !== 'object') {
    return document
  }
  stripGroundBakedTextureAssetIds(cloned.nodes ?? [])
  const looksEditableScene = 'assetIndex' in cloned && 'packageAssetMap' in cloned
  if (!looksEditableScene) {
    return cloned
  }
  const editable = cloned as StoredSceneDocument
  const { packageAssetMap, assetIndex } = await buildPackageAssetMapForExport(editable)
  editable.packageAssetMap = packageAssetMap
  editable.assetIndex = assetIndex
  editable.resourceSummary = await calculateSceneResourceSummary(editable, { embedResources: true })
  return editable
}

function findGroundNode(nodes: SceneJsonExportDocument['nodes']): SceneJsonExportDocument['nodes'][number] | null {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const nested = findGroundNode(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function stripEditorOnlySceneFields(
  document: SceneExportDocumentWithEditorFields,
): void {
  if ('assetUrlOverrides' in document) {
    delete document.assetUrlOverrides
  }
  if ('resourceSummary' in document) {
    delete document.resourceSummary
  }
  if ('planningData' in document) {
    delete document.planningData
  }

  if (document.assetIndex && typeof document.assetIndex === 'object') {
    const nextAssetIndex: NonNullable<SceneJsonExportDocument['assetIndex']> = {}
    Object.entries(document.assetIndex).forEach(([assetId, entry]) => {
      if (!entry || entry.isEditorOnly) {
        return
      }
      nextAssetIndex[assetId] = {
        categoryId: entry.categoryId,
        source: entry.source ? { ...entry.source } : undefined,
        internal: entry.internal,
      }
    })
    document.assetIndex = nextAssetIndex
  }

  if (document.packageAssetMap && typeof document.packageAssetMap === 'object') {
    const retainedAssetIds = new Set(Object.keys(document.assetIndex ?? {}))
    const nextPackageAssetMap: Record<string, string> = {}
    Object.entries(document.packageAssetMap).forEach(([key, value]) => {
      const normalizedValue = typeof value === 'string' ? value.trim() : ''
      const derivedAssetId = extractAssetIdFromPackageMapKey(key)
      if (normalizedValue && retainedAssetIds.has(normalizedValue)) {
        nextPackageAssetMap[key] = value
        return
      }
      if (derivedAssetId && retainedAssetIds.has(derivedAssetId)) {
        nextPackageAssetMap[key] = value
      }
    })
    document.packageAssetMap = nextPackageAssetMap
  }
}

function collectEmbedAssetsFromScenes(scenes: ScenePackageExportScene[]): Map<string, ResolvedEmbedAsset> {
  const out = new Map<string, ResolvedEmbedAsset>()

  for (const scene of scenes) {
    const doc = scene?.document as SceneExportDocumentWithEditorFields | null | undefined
    if (!doc || typeof doc !== 'object') {
      continue
    }

    const indexMap: NonNullable<SceneJsonExportDocument['assetIndex']> = doc.assetIndex ?? {}
    const resourceAssets = Array.isArray(doc.resourceSummary?.assets) ? doc.resourceSummary.assets : []

    // Prefer resourceSummary entries (they often include downloadUrl).
    const entryHasLocalSource = (entry: NonNullable<SceneJsonExportDocument['assetIndex']>[string] | undefined): boolean =>
      entry?.source?.type === 'local'

    for (const item of resourceAssets) {
      const assetId = typeof item?.assetId === 'string' ? item.assetId.trim() : ''
      if (!assetId) continue
      const downloadUrl = typeof item?.downloadUrl === 'string' ? item.downloadUrl.trim() : ''
      if (!downloadUrl) continue

      // Skip already-known local assets.
      if (entryHasLocalSource(indexMap?.[assetId])) {
        continue
      }

      if (!out.has(assetId)) {
        out.set(assetId, {
          assetId,
          downloadUrl,
          mimeTypeHint: typeof item?.mimeType === 'string' ? item.mimeType : null,
          filenameHint: typeof item?.filename === 'string' ? item.filename : null,
        })
      }
    }

    // Fallback: include all non-local assetIndex entries.
    // If we cannot resolve a downloadUrl, export will fail unless the bytes are already cached.
    for (const assetId of Object.keys(indexMap ?? {})) {
      const trimmed = assetId?.trim()
      if (!trimmed || out.has(trimmed)) {
        continue
      }
      if (entryHasLocalSource(indexMap?.[trimmed])) {
        continue
      }
      // If the assetId itself is a URL, we can embed it directly.
      const url = /^(https?:)?\/\//i.test(trimmed) ? trimmed : null
      out.set(trimmed, { assetId: trimmed, downloadUrl: url })
    }
  }

  return out
}

function countSceneCheckpoints(document: SceneJsonExportDocument | null | undefined): number {
  if (!document || typeof document !== 'object') {
    return 0
  }

  if (Array.isArray(document.punchPoints)) {
    return document.punchPoints.length
  }

  const computed = collectPunchPointsFromNodes(document.nodes)
  return computed.length
}

async function resolvePlanningImageBlob(image: {
  imageHash?: string | null
  url?: string | null
  mimeType?: string | null
  filename?: string | null
}): Promise<{ blob: Blob; imageHash: string; mimeType: string; filename: string | null } | null> {
  const hash = typeof image.imageHash === 'string' ? image.imageHash.trim() : ''
  if (hash) {
    const blob = await getPlanningImageBlobByHash(hash)
    if (!blob) {
      throw new Error(`Missing planning image resource (imageHash=${hash}); please reopen the planning image before exporting.`)
    }
    return {
      blob,
      imageHash: hash,
      mimeType: image.mimeType ?? blob.type ?? 'application/octet-stream',
      filename: image.filename ?? null,
    }
  }

  const url = typeof image.url === 'string' ? image.url.trim() : ''
  if (!url) {
    return null
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to read planning image from local URL (${response.status})`)
  }
  const blob = await response.blob()
  const buffer = await blob.arrayBuffer()
  const resolvedHash = await computeSha256Hex(buffer)
  return {
    blob: new Blob([buffer], { type: blob.type || image.mimeType || 'application/octet-stream' }),
    imageHash: resolvedHash,
    mimeType: image.mimeType ?? blob.type ?? 'application/octet-stream',
    filename: image.filename ?? null,
  }
}

async function buildPlanningSidecar(
  sceneId: string,
  planningData: PlanningSceneData,
  files: Record<string, Uint8Array>,
  resources: ScenePackageResourceEntry[],
): Promise<{ planningPath: string; sidecar: PlanningScenePackageSidecar }> {
  const encodedSceneId = encodeURIComponent(sceneId)
  const nextPlanningData = JSON.parse(JSON.stringify(planningData)) as PlanningSceneData
  const images: PlanningScenePackageImageEntry[] = []
  const resourcePathByHash = new Map<string, string>()

  for (const image of nextPlanningData.images ?? []) {
    const resolved = await resolvePlanningImageBlob(image)
    if (!resolved) {
      images.push({
        imageId: image.id,
        imageHash: typeof image.imageHash === 'string' ? image.imageHash : null,
        resourcePath: null,
        filename: image.filename ?? null,
        mimeType: image.mimeType ?? null,
      })
      continue
    }

    image.imageHash = resolved.imageHash
    image.filename = image.filename ?? resolved.filename ?? null
    image.mimeType = image.mimeType ?? resolved.mimeType
    image.url = ''

    let resourcePath = resourcePathByHash.get(resolved.imageHash) ?? null
    if (!resourcePath) {
      const ext = inferExtFromFilename(image.filename) ?? inferExtFromMimeType(image.mimeType ?? resolved.mimeType) ?? 'bin'
      const safeName = resolved.imageHash.length > 16 ? resolved.imageHash.slice(0, 16) : resolved.imageHash
      resourcePath = `scenes/${encodedSceneId}/planning-resources/${safeName}.${ext}`
      files[resourcePath] = new Uint8Array(await resolved.blob.arrayBuffer())
      resourcePathByHash.set(resolved.imageHash, resourcePath)
      resources.push({
        logicalId: `planningImage::${sceneId}::${image.id}`,
        resourceType: 'planningImage',
        path: resourcePath,
        ext,
        mimeType: image.mimeType ?? resolved.mimeType,
        size: resolved.blob.size,
        hash: resolved.imageHash,
      })
    }

    images.push({
      imageId: image.id,
      imageHash: resolved.imageHash,
      resourcePath,
      filename: image.filename ?? resolved.filename ?? null,
      mimeType: image.mimeType ?? resolved.mimeType,
    })
  }

  const planningPath = `scenes/${encodedSceneId}/planning.json`
  return {
    planningPath,
    sidecar: {
      version: 1,
      planningData: nextPlanningData,
      images,
    },
  }
}

export async function exportScenePackageZip(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
  embedAssets?: boolean
  includePlanningData?: boolean
  updateProgress?: (value: number, message?: string) => void
}): Promise<Blob> {
  const createdAt = new Date().toISOString()

  const files: Record<string, Uint8Array> = {}

  // project
  const projectPath = 'project/project.json'
  let checkpointTotal = 0
  for (const scene of payload.scenes) {
    checkpointTotal += countSceneCheckpoints(scene.document)
  }
  const projectWithCheckpointTotal: ProjectExportBundleProjectConfig = {
    ...payload.project,
    checkpointTotal,
  }
  files[projectPath] = jsonBytes(projectWithCheckpointTotal)

  // scenes + per-scene resources (referenced local assets)
  const manifestScenes: ScenePackageManifestV1['scenes'] = []
  const assetCache = useAssetCacheStore()
  const groundHeightmapStore = useGroundHeightmapStore()
  const scenesStore = useScenesStore()
  const sceneStore = useSceneStore()
  const resources: ScenePackageResourceEntry[] = []

  // Shared (project-wide) embedded assets
  const sharedAssetPathById = new Map<string, string>()
  if (payload.embedAssets) {
    const embedAssets = collectEmbedAssetsFromScenes(payload.scenes)
    const total = embedAssets.size
    let done = 0

    for (const item of embedAssets.values()) {
      done += 1
      const ratio = total > 0 ? done / total : 1
      payload.updateProgress?.(85 + Math.round(6 * ratio), `Embedding assets… (${done}/${total})`)

      // Prefer cached blob to avoid refetch.
      let blob: Blob | null = null
      let mimeType = item.mimeTypeHint ?? null
      let filename = item.filenameHint ?? null

      const cached = assetCache.getEntry(item.assetId)
      if (cached?.status === 'cached' && cached.blob) {
        blob = cached.blob
        mimeType = cached.mimeType ?? blob.type ?? mimeType
        filename = cached.filename ?? filename
      }

      if (!blob) {
        if (!item.downloadUrl) {
          throw new Error(
            `Missing downloadUrl for embedded asset (assetId=${item.assetId}). ` +
              `Ensure the scene includes resourceSummary.assets[].downloadUrl for all runtime assets, or that the asset is cached locally before exporting.`,
          )
        }
        const response = await fetch(item.downloadUrl, { method: 'GET', credentials: 'omit', cache: 'no-cache' })
        if (!response.ok) {
          throw new Error(`Failed to download asset for embedding: ${item.assetId} (${response.status})`)
        }
        const contentType = response.headers.get('Content-Type')
        if (contentType && !mimeType) {
          mimeType = contentType
        }
        blob = await response.blob()
        mimeType = mimeType ?? blob.type ?? 'application/octet-stream'
      }

      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ext = inferExtFromFilename(filename) ?? inferExtFromMimeType(mimeType ?? '') ?? 'bin'

      // Store in a shared folder (`resources/`); stable hashed name to avoid path issues.
      const hash = await sha256Hex(item.assetId)
      const safeName = hash.length > 16 ? hash.slice(0, 16) : hash
      const resourcePath = `resources/${safeName}.${ext}`

      // De-dup: if two ids map to same path (shouldn't), last one wins.
      files[resourcePath] = bytes
      sharedAssetPathById.set(item.assetId, resourcePath)
      resources.push({
        logicalId: item.assetId,
        resourceType: 'other',
        path: resourcePath,
        ext,
        mimeType: mimeType ?? 'application/octet-stream',
        size: blob.size,
        hash,
      })
    }
  }

  for (let sIndex = 0; sIndex < payload.scenes.length; sIndex += 1) {
    const scene = payload.scenes[sIndex]!
    const preparedDocument = await prepareSceneDocumentForPackageExport(scene.document)
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.json`
    let planningPath: string | undefined
    let groundHeightsPath: string | undefined
    let groundScatterPath: string | undefined
    let groundPaintPath: string | undefined

    // Collect local asset IDs from the scene's assetIndex (scene-scoped)
    const sidecarSource = typeof structuredClone === 'function'
      ? structuredClone(preparedDocument)
      : JSON.parse(JSON.stringify(preparedDocument))
    const groundNode = findGroundNode(sidecarSource.nodes)
    const groundHeightSidecar = scene.id === sceneStore.currentSceneId
      ? groundHeightmapStore.buildSceneDocumentSidecar(groundNode)
      : await scenesStore.loadGroundHeightSidecar(scene.id)
    const groundScatterSidecar = scene.id === sceneStore.currentSceneId
      ? useGroundScatterStore().buildSceneDocumentSidecar(scene.id, groundNode)
      : await scenesStore.loadGroundScatterSidecar(scene.id)
    const groundPaintSidecar = scene.id === sceneStore.currentSceneId
      ? useGroundPaintStore().buildSceneDocumentSidecar(scene.id, groundNode)
      : await scenesStore.loadGroundPaintSidecar(scene.id)
    stripGroundHeightMapsFromSceneDocument(sidecarSource as StoredSceneDocument)
    const docClone = sidecarSource as SceneExportDocumentWithEditorFields
    stripEditorOnlySceneFields(docClone)

    const indexMap = docClone.assetIndex ?? {}
    const localAssetIds: string[] = Object.keys(indexMap).filter((assetId) => indexMap[assetId]?.source?.type === 'local')

    if (!Array.isArray(docClone.punchPoints) || docClone.punchPoints.length === 0) {
      const computedPunchPoints = collectPunchPointsFromNodes(docClone.nodes)
      if (computedPunchPoints.length) {
        docClone.punchPoints = computedPunchPoints
      }
    }

    for (let aIndex = 0; aIndex < localAssetIds.length; aIndex += 1) {
      const assetId = localAssetIds[aIndex]!
      const ratio = localAssetIds.length ? (aIndex + 1) / localAssetIds.length : 1
      payload.updateProgress?.(85 + Math.round(10 * ratio), `Packaging local assets… (${aIndex + 1}/${localAssetIds.length})`)

      let entry = assetCache.getEntry(assetId)
      if (entry.status !== 'cached' || !entry.blob) {
        await assetCache.loadFromIndexedDb(assetId)
        entry = assetCache.getEntry(assetId)
      }
      if (entry.status !== 'cached' || !entry.blob) {
        throw new Error(`Missing local asset resource (assetId=${assetId}); please ensure the local asset has been written to IndexedDB before exporting.`)
      }

      const blob = entry.blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mimeType = entry.mimeType ?? blob.type ?? 'application/octet-stream'
      const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(mimeType) ?? 'bin'
      const hash = await sha256Hex(assetId)
      const safeName = hash.length > 16 ? hash.slice(0, 16) : hash

      // Place resources under the corresponding scene directory
      const resourcePath = isBuiltinWaterNormalAsset(assetId)
        ? `scenes/${encodeURIComponent(scene.id)}/resources/${BUILTIN_WATER_NORMAL_FILENAME}`
        : `scenes/${encodeURIComponent(scene.id)}/resources/${safeName}.${ext}`

      files[resourcePath] = bytes
      resources.push({
        logicalId: assetId,
        resourceType: 'localAsset',
        path: resourcePath,
        ext,
        mimeType,
        size: blob.size,
        hash,
      })
    }

    // Add the (possibly modified) scene JSON to files and manifest
    files[scenePath] = jsonBytes(docClone)
    if (groundHeightSidecar) {
      groundHeightsPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_HEIGHTMAP_SIDECAR_FILENAME}`
      files[groundHeightsPath] = new Uint8Array(groundHeightSidecar)
    }
    if (groundScatterSidecar) {
      groundScatterPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_SCATTER_SIDECAR_FILENAME}`
      files[groundScatterPath] = new Uint8Array(groundScatterSidecar)
    }
    if (groundPaintSidecar) {
      groundPaintPath = `scenes/${encodeURIComponent(scene.id)}/${GROUND_PAINT_SIDECAR_FILENAME}`
      files[groundPaintPath] = new Uint8Array(groundPaintSidecar)
    }
    if (payload.includePlanningData && scene.planningData) {
      const planningSidecar = await buildPlanningSidecar(scene.id, scene.planningData, files, resources)
      planningPath = planningSidecar.planningPath
      files[planningPath] = jsonBytes(planningSidecar.sidecar)
    }
    manifestScenes.push({ sceneId: scene.id, path: scenePath, planningPath, groundHeightsPath, groundScatterPath, groundPaintPath })
  }

  const manifest: ScenePackageManifestV1 = {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt,
    project: { path: projectPath },
    scenes: manifestScenes,
    resources,
  }

  files['manifest.json'] = jsonBytes(manifest)

  payload.updateProgress?.(96, 'Compressing ZIP…')
  const zipBytes = zipSync(files, { level: 6 })
  // fflate returns Uint8Array<ArrayBufferLike> which fails BlobPart typing; copy into ArrayBuffer.
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}
