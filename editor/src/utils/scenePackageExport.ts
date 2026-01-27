import { zipSync, strToU8 } from 'fflate'
import type { SceneJsonExportDocument, ProjectExportBundleProjectConfig } from '@harmony/schema'
import {
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@harmony/schema'
import { inferExtFromMimeType } from '@harmony/schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
}

// inferExtFromMimeType moved to @harmony/schema (assetTypeConversion)

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

function collectEmbedAssetsFromScenes(scenes: ScenePackageExportScene[]): Map<string, ResolvedEmbedAsset> {
  const out = new Map<string, ResolvedEmbedAsset>()

  for (const scene of scenes) {
    const doc: any = scene?.document
    if (!doc || typeof doc !== 'object') {
      continue
    }

    const indexMap: Record<string, any> = doc.assetIndex ?? {}
    const resourceAssets: any[] = Array.isArray(doc?.resourceSummary?.assets) ? doc.resourceSummary.assets : []

    // Prefer resourceSummary entries (they often include downloadUrl).
    for (const item of resourceAssets) {
      const assetId = typeof item?.assetId === 'string' ? item.assetId.trim() : ''
      if (!assetId) continue
      const downloadUrl = typeof item?.downloadUrl === 'string' ? item.downloadUrl.trim() : ''
      if (!downloadUrl) continue

      // Skip already-known local assets.
      try {
        if (indexMap?.[assetId]?.source?.type === 'local') {
          continue
        }
      } catch (_e) {
        // ignore
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
      try {
        if (indexMap?.[trimmed]?.source?.type === 'local') {
          continue
        }
      } catch (_e) {
        // ignore
      }
      // If the assetId itself is a URL, we can embed it directly.
      const url = /^(https?:)?\/\//i.test(trimmed) ? trimmed : null
      out.set(trimmed, { assetId: trimmed, downloadUrl: url })
    }
  }

  return out
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
  files[projectPath] = jsonBytes(payload.project)

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
    const indexMap = (scene.document as any).assetIndex ?? {}
    const localAssetIds: string[] = Object.keys(indexMap).filter((assetId) => {
      try {
        return indexMap[assetId]?.source?.type === 'local'
      } catch (e) {
        return false
      }
    })

    // Prepare a clone of the scene document and ensure assetUrlOverrides exists
    const docClone = JSON.parse(JSON.stringify(scene.document)) as typeof scene.document
    ;(docClone as any).assetUrlOverrides = (docClone as any).assetUrlOverrides ?? {}

    // Apply shared embedded asset overrides (paths within ZIP). These are informational today,
    // but also allow runtimes to redirect by key if they consult this field.
    if (sharedAssetPathById.size > 0) {
      for (const [assetId, resourcePath] of sharedAssetPathById.entries()) {
        ;(docClone as any).assetUrlOverrides[assetId] = resourcePath
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
