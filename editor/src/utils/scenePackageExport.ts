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

export async function exportScenePackageZip(payload: {
  project: ProjectExportBundleProjectConfig
  scenes: ScenePackageExportScene[]
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
