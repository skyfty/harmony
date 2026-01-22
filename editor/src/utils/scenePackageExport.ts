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
  /**
   * Referenced local asset ids (IndexedDB-backed), typically derived from scene.assetIndex + collectSceneAssetReferences.
   * These will be packed into the ZIP under `resources/localAsset/`.
   */
  localAssetIds?: string[]
  updateProgress?: (value: number, message?: string) => void
}): Promise<Blob> {
  const createdAt = new Date().toISOString()

  const files: Record<string, Uint8Array> = {}

  // project
  const projectPath = 'project/project.json'
  files[projectPath] = jsonBytes(payload.project)

  // scenes
  const manifestScenes: ScenePackageManifestV1['scenes'] = []
  for (let index = 0; index < payload.scenes.length; index += 1) {
    const scene = payload.scenes[index]!
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.json`
    files[scenePath] = jsonBytes(scene.document)
    manifestScenes.push({ sceneId: scene.id, path: scenePath })
  }

  // resources (referenced local assets)
  const assetCache = useAssetCacheStore()
  const resources: ScenePackageResourceEntry[] = []
  const localAssetIds = Array.from(
    new Set((payload.localAssetIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  )
  for (let index = 0; index < localAssetIds.length; index += 1) {
    const assetId = localAssetIds[index]!
    const ratio = localAssetIds.length ? (index + 1) / localAssetIds.length : 1
    payload.updateProgress?.(85 + Math.round(10 * ratio), `打包本地资产… (${index + 1}/${localAssetIds.length})`)

    let entry = assetCache.getEntry(assetId)
    if (entry.status !== 'cached' || !entry.blob) {
      await assetCache.loadFromIndexedDb(assetId)
      entry = assetCache.getEntry(assetId)
    }
    if (entry.status !== 'cached' || !entry.blob) {
      throw new Error(`缺少本地资产资源（assetId=${assetId}），请先确保本地资产已写入 IndexedDB 后再导出`)
    }

    const blob = entry.blob
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const mimeType = entry.mimeType ?? blob.type ?? 'application/octet-stream'
    const ext = inferExtFromFilename(entry.filename) ?? inferExtFromMimeType(mimeType)
    const path = `resources/localAsset/${assetId}.${ext}`

    files[path] = bytes
    resources.push({
      logicalId: assetId,
      resourceType: 'localAsset',
      path,
      ext,
      mimeType,
      size: blob.size,
    })
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

  payload.updateProgress?.(96, '压缩 ZIP…')
  const zipBytes = zipSync(files, { level: 6 })
  // fflate returns Uint8Array<ArrayBufferLike> which fails BlobPart typing; copy into ArrayBuffer.
  const zipArrayBuffer = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(zipArrayBuffer).set(zipBytes)
  return new Blob([zipArrayBuffer], { type: 'application/zip' })
}
