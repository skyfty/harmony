import { zipSync, strToU8 } from 'fflate'
import type { SceneJsonExportDocument, ProjectExportBundleProjectConfig } from '@schema'
import {
  GROUND_PAINT_SIDECAR_FILENAME,
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  serializeGroundPaintSidecar,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@schema'
import { inferExtFromMimeType } from '@schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { collectPunchPointsFromNodes } from './sceneExport'

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
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

function visitSceneNodes(nodes: unknown, visitor: (node: Record<string, any>) => void): void {
  if (!Array.isArray(nodes)) {
    return
  }
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue
    }
    const candidate = node as Record<string, any>
    visitor(candidate)
    visitSceneNodes(candidate.children, visitor)
  }
}

function appendGroundPaintSidecarsToScenePackage(
  sceneId: string,
  document: SceneJsonExportDocument & { groundPaintSidecars?: Record<string, string> },
  files: Record<string, Uint8Array>,
  resources: ScenePackageResourceEntry[],
): void {
  const sidecarMap: Record<string, string> = {}
  visitSceneNodes(document.nodes, (node) => {
    const nodeId = typeof node.id === 'string' ? node.id.trim() : ''
    const dynamicMesh = node.dynamicMesh as Record<string, any> | undefined
    if (!nodeId || !dynamicMesh || dynamicMesh.type !== 'Ground' || !dynamicMesh.terrainPaint) {
      return
    }

    const logicalId = `ground-paint-sidecar:${sceneId}:${nodeId}`
    const bytes = new Uint8Array(serializeGroundPaintSidecar({
      groundNodeId: nodeId,
      terrainPaint: dynamicMesh.terrainPaint,
    }))
    const resourcePath = `scenes/${encodeURIComponent(sceneId)}/ground-paint/${encodeURIComponent(nodeId)}-${GROUND_PAINT_SIDECAR_FILENAME}`
    files[resourcePath] = bytes
    resources.push({
      logicalId,
      resourceType: 'groundPaintSidecar',
      path: resourcePath,
      ext: 'bin',
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
    })
    sidecarMap[nodeId] = logicalId
    delete dynamicMesh.terrainPaint
  })

  if (Object.keys(sidecarMap).length > 0) {
    document.groundPaintSidecars = sidecarMap
  } else if ('groundPaintSidecars' in document) {
    delete document.groundPaintSidecars
  }
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

function collectEmbedAssetsFromScenes(scenes: ScenePackageExportScene[]): Map<string, ResolvedEmbedAsset> {
  const out = new Map<string, ResolvedEmbedAsset>()

  for (const scene of scenes) {
    const doc = scene?.document as SceneJsonExportDocument | null | undefined
    if (!doc || typeof doc !== 'object') {
      continue
    }

    const indexMap: Record<string, unknown> = (doc.assetIndex as Record<string, unknown>) ?? {}
    const resourceAssets: unknown[] = Array.isArray((doc as any)?.resourceSummary?.assets) ? (doc as any).resourceSummary.assets : []

    // Prefer resourceSummary entries (they often include downloadUrl).
    const entryHasLocalSource = (entry: unknown): boolean => {
      if (!entry || typeof entry !== 'object') return false
      const e = entry as Record<string, unknown>
      const src = e.source as Record<string, unknown> | undefined
      return Boolean(src && typeof src.type === 'string' && src.type === 'local')
    }

    for (const item of resourceAssets) {
      const it = item as Record<string, unknown> | null | undefined
      const assetId = typeof it?.assetId === 'string' ? it.assetId.trim() : ''
      if (!assetId) continue
      const downloadUrl = typeof it?.downloadUrl === 'string' ? it.downloadUrl.trim() : ''
      if (!downloadUrl) continue

      // Skip already-known local assets.
      if (entryHasLocalSource(indexMap?.[assetId])) {
        continue
      }

      if (!out.has(assetId)) {
        out.set(assetId, {
          assetId,
          downloadUrl,
          mimeTypeHint: typeof it?.mimeType === 'string' ? it.mimeType : null,
          filenameHint: typeof it?.filename === 'string' ? it.filename : null,
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

export async function exportScenePackageZip(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
  embedAssets?: boolean
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
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.json`

    // Collect local asset IDs from the scene's assetIndex (scene-scoped)
    const indexMap = (scene.document as SceneJsonExportDocument).assetIndex ?? {}
    const localAssetIds: string[] = Object.keys(indexMap).filter((assetId) => {
      try {
        return indexMap[assetId]?.source?.type === 'local'
      } catch (e) {
        return false
      }
    })

    // Prepare a clone of the scene document and ensure assetUrlOverrides exists
    const docClone = JSON.parse(JSON.stringify(scene.document)) as SceneJsonExportDocument & { assetUrlOverrides?: Record<string, string> }
    docClone.assetUrlOverrides = docClone.assetUrlOverrides ?? {}
    if (!Array.isArray(docClone.punchPoints) || docClone.punchPoints.length === 0) {
      const computedPunchPoints = collectPunchPointsFromNodes(docClone.nodes)
      if (computedPunchPoints.length) {
        docClone.punchPoints = computedPunchPoints
      }
    }

    // Apply shared embedded asset overrides (paths within ZIP). These are informational today,
    // but also allow runtimes to redirect by key if they consult this field.
    if (sharedAssetPathById.size > 0) {
      for (const [assetId, resourcePath] of sharedAssetPathById.entries()) {
        docClone.assetUrlOverrides[assetId] = resourcePath
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

      // Place resources under the corresponding scene directory
      const resourcePath = `scenes/${encodeURIComponent(scene.id)}/resources/${assetId}.${ext}`

      files[resourcePath] = bytes
      resources.push({
        logicalId: assetId,
        resourceType: 'localAsset',
        path: resourcePath,
        ext,
        mimeType,
        size: blob.size,
      })

      // update scene document mapping to point to the packaged path
      ;(docClone as any).assetUrlOverrides[assetId] = resourcePath
    }

    appendGroundPaintSidecarsToScenePackage(scene.id, docClone, files, resources)

    // Add the (possibly modified) scene JSON to files and manifest
    files[scenePath] = jsonBytes(docClone)
    manifestScenes.push({ sceneId: scene.id, path: scenePath })
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
