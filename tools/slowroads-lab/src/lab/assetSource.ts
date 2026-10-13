import * as THREE from 'three'
import catalogJson from '../core/assets-catalog.json'
import type { TextureColorSpace } from '../core/seasonCatalog'

/**
 * Lab asset store with two interchangeable sources:
 *
 *  - `local`  — the materialised `assets-src/` directory served by vite
 *    (import.meta.glob URLs). Default for development.
 *  - `server` — HTTP(fetch) download from the packed asset bundle, exactly the
 *    shape the mini program uses (`urlCandidates` -> fetch -> blob -> texture).
 *    The lab uses this mode to validate the on-demand download path before the
 *    assets are uploaded and wired through the editor's asset resolver.
 *
 * Texture ids are the logical ids from `seasonCatalog` (file name minus
 * extension, content hash included). When `maxTextureSize` is set, ids whose
 * full-resolution image exceeds the limit resolve to their generated `@2048`
 * variant instead (same behaviour the viewer/mini program will use).
 */

export type AssetSourceMode = 'local' | 'server'

interface CatalogFileEntry {
  logicalId: string
  file: string
  kind: string
  bytes: number
  width?: number
  height?: number
  variant?: string
  derivedFrom?: string
}

interface CatalogShape {
  files: CatalogFileEntry[]
}

const catalog = catalogJson as unknown as CatalogShape
const catalogById = new Map(catalog.files.map((entry) => [entry.logicalId, entry]))
const variantByBaseId = new Map<string, CatalogFileEntry>()
for (const entry of catalog.files) {
  if (entry.variant && entry.derivedFrom) {
    variantByBaseId.set(entry.derivedFrom, entry)
  }
}

// `?url` keeps vite happy in both dev and build; missing assets (before the
// materialize step) simply yield an empty map and the lab shows a warning.
const localAssetUrls = import.meta.glob('/assets-src/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function localUrlFor(logicalId: string): string | null {
  const entry = catalogById.get(logicalId)
  if (!entry) {
    return null
  }
  return localAssetUrls[`/assets-src/${entry.file}`] ?? null
}

export interface TextureLoadOptions {
  colorSpace: TextureColorSpace
  /** Repeat wrapping for tiling maps; sprite atlases clamp. */
  tiling: boolean
  anisotropy?: number
}

interface CacheEntry {
  texture: THREE.Texture
  bytes: number
  objectUrl: string | null
}

export interface AssetStoreStats {
  /** bytes downloaded since the store was created (server mode only). */
  downloadedBytes: number
  /** approximate decoded RGBA bytes currently resident. */
  residentBytes: number
  textureCount: number
}

export class LabAssetStore {
  readonly mode: AssetSourceMode
  private readonly serverBaseUrl: string
  readonly maxTextureSize: number
  private readonly loader = new THREE.TextureLoader()
  private readonly textures = new Map<string, CacheEntry>()
  private readonly pendingTextures = new Map<string, Promise<THREE.Texture>>()
  private readonly bins = new Map<string, Promise<ArrayBuffer>>()
  private downloadedBytes = 0
  private disposed = false
  private readonly maxAnisotropy: number

  constructor(options: { mode: AssetSourceMode; serverBaseUrl?: string; maxTextureSize?: number; maxAnisotropy?: number }) {
    this.mode = options.mode
    this.serverBaseUrl = (options.serverBaseUrl ?? '').replace(/\/$/, '')
    this.maxTextureSize = Math.max(0, Math.floor(options.maxTextureSize ?? 0))
    this.maxAnisotropy = options.maxAnisotropy ?? 8
  }

  /** Resolve the logical id to the variant that fits the texture size cap. */
  resolveTextureId(logicalId: string): string {
    const entry = catalogById.get(logicalId)
    if (!entry || this.maxTextureSize <= 0) {
      return logicalId
    }
    const longEdge = Math.max(entry.width ?? 0, entry.height ?? 0)
    if (longEdge <= this.maxTextureSize) {
      return logicalId
    }
    const variant = variantByBaseId.get(logicalId)
    return variant ? variant.logicalId : logicalId
  }

  catalogEntry(logicalId: string): CatalogFileEntry | null {
    return catalogById.get(logicalId) ?? null
  }

  /** Sum of the compressed sizes for a set of logical ids (download budget). */
  bytesFor(logicalIds: Iterable<string>): number {
    let total = 0
    for (const id of logicalIds) {
      const entry = catalogById.get(id)
      if (entry) {
        total += entry.bytes
      }
    }
    return total
  }

  private async fetchUrl(logicalId: string): Promise<string> {
    if (this.mode === 'local') {
      const url = localUrlFor(logicalId)
      if (!url) {
        throw new Error(`missing local asset: ${logicalId}`)
      }
      return url
    }
    const entry = catalogById.get(logicalId)
    if (!entry) {
      throw new Error(`unknown asset id: ${logicalId}`)
    }
    const url = `${this.serverBaseUrl}/${encodeURIComponent(entry.file)}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`asset download failed (${response.status}): ${entry.file}`)
    }
    const blob = await response.blob()
    this.downloadedBytes += blob.size
    return URL.createObjectURL(blob)
  }

  async texture(logicalId: string, options: TextureLoadOptions): Promise<THREE.Texture> {
    const resolvedId = this.resolveTextureId(logicalId)
    const cacheKey = `${resolvedId}:${options.tiling ? 'tile' : 'clamp'}`
    const cached = this.textures.get(cacheKey)
    if (cached) {
      return cached.texture
    }
    const pending = this.pendingTextures.get(cacheKey)
    if (pending) {
      return pending
    }
    const promise = (async () => {
      const url = await this.fetchUrl(resolvedId)
      const objectUrl = this.mode === 'server' ? url : null
      try {
        const texture = await this.loader.loadAsync(url)
        if (this.disposed) {
          texture.dispose()
          throw new Error('asset store disposed')
        }
        texture.colorSpace = options.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
        texture.wrapS = options.tiling ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
        texture.wrapT = options.tiling ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
        texture.anisotropy = Math.min(options.anisotropy ?? this.maxAnisotropy, this.maxAnisotropy)
        texture.needsUpdate = true
        const entry = catalogById.get(resolvedId)
        const bytes = entry?.width && entry?.height ? entry.width * entry.height * 4 : 0
        this.textures.set(cacheKey, { texture, bytes, objectUrl })
        return texture
      } finally {
        this.pendingTextures.delete(cacheKey)
      }
    })()
    this.pendingTextures.set(cacheKey, promise)
    return promise
  }

  /** Load a texture set with a progress callback (0..1). */
  async textureSet(
    requests: Array<{ id: string; options: TextureLoadOptions }>,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Map<string, THREE.Texture>> {
    const result = new Map<string, THREE.Texture>()
    let loaded = 0
    const total = requests.length
    await Promise.all(requests.map(async (request) => {
      const texture = await this.texture(request.id, request.options)
      result.set(request.id, texture)
      loaded += 1
      onProgress?.(loaded, total)
    }))
    return result
  }

  async modelBin(logicalId: string): Promise<ArrayBuffer> {
    const binId = `${logicalId}.treebin`
    const cached = this.bins.get(binId)
    if (cached) {
      return cached
    }
    const promise = (async () => {
      const url = await this.fetchUrl(binId)
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`model download failed (${response.status}): ${binId}`)
      }
      const buffer = await response.arrayBuffer()
      if (this.mode === 'server') {
        URL.revokeObjectURL(url)
      }
      return buffer
    })()
    this.bins.set(binId, promise)
    return promise
  }

  /** Release textures not in the retain set (shared + current season). */
  prune(retainIds: Set<string>): void {
    for (const [cacheKey, entry] of [...this.textures]) {
      const idPart = cacheKey.split(':')[0] ?? ''
      const baseId = idPart.endsWith('@2048') ? idPart.slice(0, -'@2048'.length) : idPart
      if (retainIds.has(idPart) || retainIds.has(baseId)) {
        continue
      }
      entry.texture.dispose()
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl)
      }
      this.textures.delete(cacheKey)
    }
  }

  stats(): AssetStoreStats {
    let residentBytes = 0
    for (const entry of this.textures.values()) {
      residentBytes += entry.bytes
    }
    return {
      downloadedBytes: this.downloadedBytes,
      residentBytes,
      textureCount: this.textures.size,
    }
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.textures.values()) {
      entry.texture.dispose()
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl)
      }
    }
    this.textures.clear()
  }
}
