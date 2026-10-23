import {
  readTerrainPackAssetMetadata,
  TERRAIN_DEM_STORAGE_LAYOUT,
} from '@schema/terrainPack'
import type { TerrainDemPackageSidecar } from '@schema/terrainDemPackage'
import type {
  ProceduralLandscapeDemOrthoResolver,
  ProceduralLandscapeDemOrthoTexture,
} from '@schema/proceduralLandscape/demOrthoResolver'
import type { ProjectAsset } from '@/types/project-asset'
import { parseTerrainDemSidecarJson } from '@/utils/terrainDemPackage'
import { resolveTerrainDemRasterUrl } from '@/utils/terrainPackLibrary'

const DEM_ORTHO_MAX_SIZE = 2048

type WorkerResponse =
  | {
      kind: 'decode-dem-ortho-result'
      requestId: number
      width: number
      height: number
      sourceWidth: number
      sourceHeight: number
      rgb: ArrayBuffer
    }
  | {
      kind: 'decode-dem-ortho-error'
      requestId: number
      message: string
    }

type PendingDecode = {
  resolve: (value: Extract<WorkerResponse, { kind: 'decode-dem-ortho-result' }>) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let requestId = 0
const pendingDecodes = new Map<number, PendingDecode>()

function getWorker(): Worker {
  if (worker) {
    return worker
  }
  if (typeof Worker === 'undefined') {
    throw new Error('当前运行环境不支持正射纹理 Worker。')
  }
  worker = new Worker(new URL('../workers/demOrthoDecode.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const pending = pendingDecodes.get(message.requestId)
    if (!pending) {
      return
    }
    pendingDecodes.delete(message.requestId)
    if (message.kind === 'decode-dem-ortho-error') {
      pending.reject(new Error(message.message))
    } else {
      pending.resolve(message)
    }
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || '正射纹理解析 Worker 失败。')
    pendingDecodes.forEach((pending) => pending.reject(error))
    pendingDecodes.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function decodeOrthoTiffInWorker(
  buffer: ArrayBuffer,
  sidecar: TerrainDemPackageSidecar,
): Promise<Extract<WorkerResponse, { kind: 'decode-dem-ortho-result' }>> {
  const activeWorker = getWorker()
  const id = ++requestId
  return new Promise((resolve, reject) => {
    pendingDecodes.set(id, { resolve, reject })
    try {
      activeWorker.postMessage({
        kind: 'decode-dem-ortho',
        requestId: id,
        buffer,
        sidecar,
        maxSize: DEM_ORTHO_MAX_SIZE,
      }, [buffer])
    } catch (error) {
      pendingDecodes.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function basename(path: string): string {
  return path.trim().replace(/\\/g, '/').split('/').pop() ?? path
}

export interface TerrainDemOrthoFileInfo {
  file: string
  sourceZipHash: string | null
}

export function getTerrainDemOrthoFileInfo(
  asset: ProjectAsset | null | undefined,
): TerrainDemOrthoFileInfo | null {
  const metadata = readTerrainPackAssetMetadata(asset?.metadata?.terrainPack)
  if (
    !asset
    || metadata?.kind !== 'dem'
    || metadata.storageLayout !== TERRAIN_DEM_STORAGE_LAYOUT
    || typeof metadata.orthoFile !== 'string'
    || !metadata.orthoFile.trim()
  ) {
    return null
  }
  return {
    file: metadata.orthoFile.trim(),
    sourceZipHash: metadata.sourceZipHash ?? null,
  }
}

export interface CreateDemOrthoResolverOptions {
  getAsset(assetId: string): ProjectAsset | null
  ensureAssetFile(assetId: string, options: { asset: ProjectAsset }): Promise<File | null>
  ensureCachedFile(cacheId: string, url: string, name: string): Promise<File | null>
}

export function createProceduralLandscapeDemOrthoResolver(
  options: CreateDemOrthoResolverOptions,
): ProceduralLandscapeDemOrthoResolver {
  const resultCache = new Map<string, ProceduralLandscapeDemOrthoTexture>()
  const pendingLoads = new Map<string, Promise<ProceduralLandscapeDemOrthoTexture>>()

  const canResolve = (assetId: string): boolean => {
    return Boolean(getTerrainDemOrthoFileInfo(options.getAsset(assetId)))
  }

  const load = async (assetId: string): Promise<ProceduralLandscapeDemOrthoTexture> => {
    const asset = options.getAsset(assetId)
    const info = getTerrainDemOrthoFileInfo(asset)
    if (!asset || !info) {
      throw new Error('当前 DEM 资源缺少 ortho.tif。')
    }
    const sourceKey = [
      asset.id,
      asset.updatedAt ?? '',
      asset.contentHash ?? '',
      info.sourceZipHash ?? '',
    ].join('|')
    const cached = resultCache.get(sourceKey)
    if (cached) {
      resultCache.delete(sourceKey)
      resultCache.set(sourceKey, cached)
      return cached
    }
    const pending = pendingLoads.get(sourceKey)
    if (pending) {
      return pending
    }

    const loading = (async (): Promise<ProceduralLandscapeDemOrthoTexture> => {
      const sidecarFile = await options.ensureAssetFile(asset.id, { asset })
      if (!sidecarFile) {
        throw new Error('无法下载 DEM 元数据 dem.json。')
      }
      const sidecar = parseTerrainDemSidecarJson(new Uint8Array(await sidecarFile.arrayBuffer()))
      if (!sidecar.ortho) {
        throw new Error('dem.json 未声明 ortho.tif。')
      }
      const orthoUrl = resolveTerrainDemRasterUrl(asset.downloadUrl, sidecar.ortho.file)
      const orthoFile = await options.ensureCachedFile(
        `terrain-dem:${sourceKey}:ortho-tif`,
        orthoUrl,
        basename(sidecar.ortho.file),
      )
      if (!orthoFile) {
        throw new Error(`无法下载 DEM 正射影像 ${sidecar.ortho.file}。`)
      }
      const buffer = await orthoFile.arrayBuffer()
      const decoded = await decodeOrthoTiffInWorker(buffer, sidecar)
      const texture: ProceduralLandscapeDemOrthoTexture = {
        width: decoded.width,
        height: decoded.height,
        rgb: new Uint8Array(decoded.rgb),
        sourceBytes: orthoFile.size,
        sourceKey,
      }
      resultCache.set(sourceKey, texture)
      while (resultCache.size > 4) {
        const oldest = resultCache.keys().next().value as string | undefined
        if (!oldest) {
          break
        }
        resultCache.delete(oldest)
      }
      return texture
    })()
    pendingLoads.set(sourceKey, loading)
    try {
      return await loading
    } finally {
      pendingLoads.delete(sourceKey)
    }
  }

  return { canResolve, load }
}
