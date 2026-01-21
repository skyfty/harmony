import { zipSync, strToU8 } from 'fflate'
import type { SceneJsonExportDocument, ProjectExportBundleProjectConfig, SceneNode } from '@harmony/schema'
import {
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  type ScenePackageManifestV1,
  type ScenePackageResourceEntry,
} from '@harmony/schema'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

export type ScenePackageExportScene = {
  id: string
  document: SceneJsonExportDocument
}

function collectTerrainWeightmapLogicalIdsFromNodes(nodes: SceneNode[], out: Set<string>) {
  for (const node of nodes) {
    const dynamicMesh: any = (node as any)?.dynamicMesh
    if (dynamicMesh?.type === 'Ground') {
      const terrainPaint = dynamicMesh?.terrainPaint
      if (terrainPaint && terrainPaint.version === 1 && terrainPaint.chunks && typeof terrainPaint.chunks === 'object') {
        Object.values(terrainPaint.chunks).forEach((ref: any) => {
          const logicalId = typeof ref?.logicalId === 'string' ? ref.logicalId.trim() : ''
          if (logicalId) {
            out.add(logicalId)
          }
        })
      }
    }
    if (Array.isArray((node as any)?.children) && (node as any).children.length) {
      collectTerrainWeightmapLogicalIdsFromNodes((node as any).children as SceneNode[], out)
    }
  }
}

function collectTerrainWeightmapLogicalIds(document: SceneJsonExportDocument): Set<string> {
  const out = new Set<string>()
  collectTerrainWeightmapLogicalIdsFromNodes(document.nodes ?? [], out)
  return out
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

  // scenes
  const manifestScenes: ScenePackageManifestV1['scenes'] = []
  for (let index = 0; index < payload.scenes.length; index += 1) {
    const scene = payload.scenes[index]!
    const scenePath = `scenes/${encodeURIComponent(scene.id)}/scene.json`
    files[scenePath] = jsonBytes(scene.document)
    manifestScenes.push({ sceneId: scene.id, path: scenePath })
  }

  // resources
  const weightmapIds = new Set<string>()
  payload.scenes.forEach((scene) => {
    collectTerrainWeightmapLogicalIds(scene.document).forEach((id) => weightmapIds.add(id))
  })

  const assetCache = useAssetCacheStore()
  const resources: ScenePackageResourceEntry[] = []
  const weightmapList = Array.from(weightmapIds.values())
  for (let index = 0; index < weightmapList.length; index += 1) {
    const logicalId = weightmapList[index]!
    const ratio = weightmapList.length ? (index + 1) / weightmapList.length : 1
    payload.updateProgress?.(85 + Math.round(10 * ratio), `打包地形权重贴图… (${index + 1}/${weightmapList.length})`)

    let entry = assetCache.getEntry(logicalId)
    if (entry.status !== 'cached' || !entry.blob) {
      await assetCache.loadFromIndexedDb(logicalId)
      entry = assetCache.getEntry(logicalId)
    }
    if (entry.status !== 'cached' || !entry.blob) {
      throw new Error(`缺少地形权重贴图资源（logicalId=${logicalId}），请先保存场景后再导出`)
    }

    const blob = entry.blob
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const ext = 'png'
    const mimeType = entry.mimeType ?? blob.type ?? 'image/png'
    const path = `resources/terrainWeightmap/${logicalId}.${ext}`

    files[path] = bytes
    resources.push({
      logicalId,
      resourceType: 'terrainWeightmap',
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
