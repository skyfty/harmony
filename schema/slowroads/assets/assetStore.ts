import * as THREE from 'three'
import type { AssetBundleManifest } from '../../asset-api'
import { fetchAssetBlob } from '../../assetDownload'
import { loadTextureFromSourceUrl } from '../../textureSourceLoader'
import { SHARED_TEXTURES, type SeasonTextureRef } from '../core/seasonCatalog'

/**
 * Slow Roads 在线素材源（默认走线上资产包，无本地模式、无组件级配置）。
 *
 * - manifest：`https://v.touchmagic.cn/uploads/asset-bundle.json`（admin 资产包
 *   流程产物，101 个文件；每个文件的 URL = 同目录 + `path`）；
 * - 下载走既有 `fetchAssetBlob`（CDN 镜像候选、worker、uni.downloadFile 兜底、
 *   进度回调），纹理经 `loadTextureFromSourceUrl` 加载；
 * - 设备纹理上限 < 4096 时自动改用 `@2048` 变体（manifest 中带 `@2048` 后缀）；
 * - LRU：只保留当前季 + 共享贴图 + 近树模型的字节/纹理解码，其余在换季时释放。
 */

export const SLOWROADS_ASSET_BASE_URL = 'https://v.touchmagic.cn/uploads/'
export const SLOWROADS_ASSET_MANIFEST_FILE = 'asset-bundle.json'
export const SLOWROADS_TEXTURE_2048_THRESHOLD = 4096

interface SlowroadsAssetRuntimeConfig {
  baseUrl: string
  manifestUrl: string
  /** 平台扩展点：小程序端可用 uni.downloadFile 的临时路径直接作为纹理源。 */
  resolveTextureSource?: (file: SlowroadsBundleFile | null, blobUrl: string | null) => string | null
}

let assetRuntimeConfig: SlowroadsAssetRuntimeConfig = {
  baseUrl: SLOWROADS_ASSET_BASE_URL,
  manifestUrl: new URL(SLOWROADS_ASSET_MANIFEST_FILE, SLOWROADS_ASSET_BASE_URL).toString(),
}

export function configureSlowroadsAssetBaseUrl(baseUrl: string, manifestFileName = SLOWROADS_ASSET_MANIFEST_FILE): void {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  assetRuntimeConfig = {
    ...assetRuntimeConfig,
    baseUrl: normalized,
    manifestUrl: new URL(manifestFileName, normalized).toString(),
  }
  sharedSlowroadsAssetStore?.reset()
}

export function configureSlowroadsTextureSourceResolver(
  resolver: SlowroadsAssetRuntimeConfig['resolveTextureSource'] | null,
): void {
  assetRuntimeConfig = { ...assetRuntimeConfig, resolveTextureSource: resolver ?? undefined }
}

export interface SlowroadsBundleFile {
  logicalId: string
  path: string
  size: number
  hash: string
}

export interface SlowroadsAssetStoreStats {
  /** 已解码的纹理数量（当前驻留）。 */
  textureCount: number
  /** 纹理解码显存估算（RGBA8，含 mipmap 33% 余量）。 */
  residentBytes: number
  /** 本会话累计网络字节。 */
  downloadedBytes: number
  pendingDownloads: number
  /** 实际使用的贴图档位（full / 2048）。 */
  variant: 'full' | '2048'
  warnings: string[]
}

export interface SlowroadsAssetStoreOptions {
  /** 设备纹理上限（renderer.capabilities.maxTextureSize）；< 4096 用 @2048 变体。 */
  maxTextureSize?: number
  maxAnisotropy?: number
}

interface TextureEntry {
  texture: THREE.Texture
  objectUrl: string | null
  logicalId: string
  estimatedBytes: number
  lastUsedAt: number
}

interface PendingLoad {
  promise: Promise<THREE.Texture | null>
}

const placeholderWarnings = new Set<string>()

export class SlowroadsAssetStore {
  private readonly options: Required<Pick<SlowroadsAssetStoreOptions, 'maxTextureSize' | 'maxAnisotropy'>>
  private manifest: AssetBundleManifest | null = null
  private manifestPromise: Promise<AssetBundleManifest | null> | null = null
  private manifestFailed = false
  private readonly fileByLogicalId = new Map<string, SlowroadsBundleFile>()
  private readonly textures = new Map<string, TextureEntry>()
  private readonly pending = new Map<string, PendingLoad>()
  private readonly warnings = new Set<string>()
  private downloadedBytes = 0
  private pendingDownloads = 0
  private disposed = false

  constructor(options: SlowroadsAssetStoreOptions = {}) {
    this.options = {
      maxTextureSize: options.maxTextureSize && options.maxTextureSize > 0 ? options.maxTextureSize : 8192,
      maxAnisotropy: options.maxAnisotropy ?? 1,
    }
  }

  get variant(): 'full' | '2048' {
    return this.options.maxTextureSize < SLOWROADS_TEXTURE_2048_THRESHOLD ? '2048' : 'full'
  }

  reset(): void {
    this.manifest = null
    this.manifestPromise = null
    this.manifestFailed = false
    this.fileByLogicalId.clear()
    for (const entry of this.textures.values()) {
      this.disposeEntry(entry)
    }
    this.textures.clear()
    this.warnings.clear()
    this.downloadedBytes = 0
  }

  stats(): SlowroadsAssetStoreStats {
    let residentBytes = 0
    for (const entry of this.textures.values()) {
      residentBytes += entry.estimatedBytes
    }
    return {
      textureCount: this.textures.size,
      residentBytes,
      downloadedBytes: this.downloadedBytes,
      pendingDownloads: this.pendingDownloads,
      variant: this.variant,
      warnings: [...this.warnings],
    }
  }

  private warn(code: string): void {
    this.warnings.add(code)
    placeholderWarnings.add(code)
  }

  private fileUrl(file: SlowroadsBundleFile): string {
    return new URL(file.path, assetRuntimeConfig.baseUrl).toString()
  }

  /** 按设备上限选择档位：`@2048` 变体存在时优先（低配设备）。 */
  private resolveLogicalId(logicalId: string): string {
    if (this.variant === 'full') {
      return logicalId
    }
    const variantId = `${logicalId}@2048`
    return this.fileByLogicalId.has(variantId) ? variantId : logicalId
  }

  async ensureManifest(): Promise<AssetBundleManifest | null> {
    if (this.manifest) {
      return this.manifest
    }
    if (this.manifestFailed) {
      return null
    }
    if (!this.manifestPromise) {
      this.manifestPromise = this.loadManifest()
    }
    return await this.manifestPromise
  }

  private async loadManifest(): Promise<AssetBundleManifest | null> {
    const controller = new AbortController()
    try {
      const payload = await fetchAssetBlob(assetRuntimeConfig.manifestUrl, controller, () => {})
      const bytes = payload.bytes ?? (payload.blob ? await payload.blob.arrayBuffer() : null)
      if (!bytes) {
        throw new Error('manifest 内容为空')
      }
      this.downloadedBytes += bytes.byteLength
      const text = new TextDecoder().decode(new Uint8Array(bytes))
      const parsed = JSON.parse(text) as AssetBundleManifest
      if (!parsed || !Array.isArray(parsed.files)) {
        throw new Error('manifest 结构无效')
      }
      this.manifest = parsed
      this.fileByLogicalId.clear()
      for (const file of parsed.files) {
        if (file && typeof file.logicalId === 'string' && typeof file.path === 'string') {
          this.fileByLogicalId.set(file.logicalId, {
            logicalId: file.logicalId,
            path: file.path,
            size: typeof file.size === 'number' ? file.size : 0,
            hash: typeof file.hash === 'string' ? file.hash : '',
          })
        }
      }
      return parsed
    } catch (error) {
      this.manifestFailed = true
      this.warn(`manifest-failed:${error instanceof Error ? error.message : String(error)}`)
      // 失败后允许后续重试（网络恢复/换季时再试一次）。
      this.manifestPromise = null
      return null
    }
  }

  hasFile(logicalId: string): boolean {
    return this.fileByLogicalId.has(logicalId) || this.fileByLogicalId.has(`${logicalId}@2048`)
  }

  /** 已驻留（或正在加载）的纹理数量。 */
  hasTexture(logicalId: string): boolean {
    return this.textures.has(this.resolveLogicalId(logicalId)) || this.pending.has(this.resolveLogicalId(logicalId))
  }

  /**
   * 获取一组纹理。返回 Map 以**原始 logicalId**（调用方传入的，不带 @2048）为键。
   * 任何单个文件失败都不抛出：对应键缺省，调用方保留旧纹理并读取 warnings。
   */
  async textureSet(
    refs: ReadonlyArray<SeasonTextureRef>,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Map<string, THREE.Texture>> {
    const result = new Map<string, THREE.Texture>()
    const unique: SeasonTextureRef[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      if (seen.has(ref.id)) {
        continue
      }
      seen.add(ref.id)
      unique.push(ref)
    }
    let loaded = 0
    await Promise.all(unique.map(async (ref) => {
      const texture = await this.texture(ref)
      if (texture) {
        result.set(ref.id, texture)
      }
      loaded += 1
      onProgress?.(loaded, unique.length)
    }))
    return result
  }

  async texture(ref: SeasonTextureRef): Promise<THREE.Texture | null> {
    const resolvedId = this.resolveLogicalId(ref.id)
    const entry = this.textures.get(resolvedId)
    if (entry) {
      entry.lastUsedAt = Date.now()
      return entry.texture
    }
    const pending = this.pending.get(resolvedId)
    if (pending) {
      return await pending.promise
    }
    const promise = this.loadTexture(ref, resolvedId)
    this.pending.set(resolvedId, { promise })
    try {
      return await promise
    } finally {
      this.pending.delete(resolvedId)
    }
  }

  private async loadTexture(ref: SeasonTextureRef, resolvedId: string): Promise<THREE.Texture | null> {
    await this.ensureManifest()
    const file = this.fileByLogicalId.get(resolvedId)
    if (!file) {
      this.warn(`missing-file:${resolvedId}`)
      return null
    }
    let objectUrl: string | null = null
    let textureSource: string | null = null
    this.pendingDownloads += 1
    try {
      const controller = new AbortController()
      const payload = await fetchAssetBlob(this.fileUrl(file), controller, () => {})
      this.downloadedBytes += payload.blob?.size ?? 0
      const custom = assetRuntimeConfig.resolveTextureSource?.(file, null)
      if (custom) {
        textureSource = custom
      } else if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && payload.blob) {
        try {
          objectUrl = URL.createObjectURL(payload.blob)
          textureSource = objectUrl
        } catch {
          objectUrl = null
        }
      }
      if (!textureSource) {
        // 平台无 object URL（部分小程序环境）：退回远端直连，交由平台 loader 处理。
        textureSource = this.fileUrl(file)
      }
      const texture = await loadTextureFromSourceUrl(textureSource)
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.colorSpace = ref.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.anisotropy = Math.max(1, Math.min(8, this.options.maxAnisotropy))
      texture.needsUpdate = true
      const image = texture.image as { width?: number; height?: number } | null
      const width = image?.width ?? 0
      const height = image?.height ?? 0
      const estimatedBytes = Math.round(width * height * 4 * 1.34) || file.size * 4
      this.textures.set(resolvedId, {
        texture,
        objectUrl,
        logicalId: resolvedId,
        estimatedBytes,
        lastUsedAt: Date.now(),
      })
      if (resolvedId !== ref.id) {
        // 档位变体：同时以原始 id 命中（texture() 已做 resolve，这里仅兜底）。
      }
      return texture
    } catch (error) {
      if (objectUrl) {
        revokeObjectUrl(objectUrl)
      }
      this.warn(`file-failed:${resolvedId}:${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      this.pendingDownloads -= 1
    }
  }

  /** 下载 `.treebin`（近树模型）原始字节。 */
  async modelBytes(logicalId: string): Promise<ArrayBuffer | null> {
    await this.ensureManifest()
    // manifest 里同时存在基础 id（指向 .obj 源文件）与 `${id}.treebin`（运行时打包格式）；
    // 近树必须取 .treebin（运行时无 OBJLoader，且 .obj 文本不是 treebin 二进制）。
    const file = this.fileByLogicalId.get(`${logicalId}.treebin`)
      ?? this.fileByLogicalId.get(logicalId)
    if (!file) {
      this.warn(`missing-file:${logicalId}`)
      return null
    }
    this.pendingDownloads += 1
    try {
      const controller = new AbortController()
      const payload = await fetchAssetBlob(this.fileUrl(file), controller, () => {})
      const bytes = payload.bytes ?? (payload.blob ? await payload.blob.arrayBuffer() : null)
      if (bytes) {
        this.downloadedBytes += bytes.byteLength
      }
      return bytes
    } catch (error) {
      this.warn(`file-failed:${logicalId}:${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      this.pendingDownloads -= 1
    }
  }

  /** 释放不在 keep 集合里的纹理（换季时调用；共享贴图应始终在 keep 里）。 */
  prune(keepIds: ReadonlySet<string>): void {
    const resolvedKeep = new Set<string>()
    for (const id of keepIds) {
      resolvedKeep.add(id)
      resolvedKeep.add(this.resolveLogicalId(id))
    }
    for (const [key, entry] of this.textures) {
      if (resolvedKeep.has(key) || resolvedKeep.has(entry.logicalId)) {
        continue
      }
      this.disposeEntry(entry)
      this.textures.delete(key)
    }
  }

  disposeAllTextures(): void {
    for (const entry of this.textures.values()) {
      this.disposeEntry(entry)
    }
    this.textures.clear()
  }

  private disposeEntry(entry: TextureEntry): void {
    entry.texture.dispose()
    if (entry.objectUrl) {
      revokeObjectUrl(entry.objectUrl)
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.disposeAllTextures()
    this.warnings.clear()
  }
}

function revokeObjectUrl(url: string): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return
  }
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* noop */
  }
}

let sharedSlowroadsAssetStore: SlowroadsAssetStore | null = null

/** 共享资产库（同一 realm 一个；hosts 用 renderer 的 maxTextureSize 初始化一次）。 */
export function getSharedSlowroadsAssetStore(options: SlowroadsAssetStoreOptions = {}): SlowroadsAssetStore {
  if (!sharedSlowroadsAssetStore) {
    sharedSlowroadsAssetStore = new SlowroadsAssetStore(options)
  }
  return sharedSlowroadsAssetStore
}

export function disposeSharedSlowroadsAssetStore(): void {
  sharedSlowroadsAssetStore?.dispose()
  sharedSlowroadsAssetStore = null
}

/** 当前季 + 共享集的保留下载集合（prune 用）。 */
export function slowroadsSharedRetainIds(seasonRefs: ReadonlyArray<SeasonTextureRef>): Set<string> {
  const ids = new Set<string>()
  for (const ref of seasonRefs) {
    ids.add(ref.id)
  }
  for (const ref of Object.values(SHARED_TEXTURES)) {
    ids.add(ref.id)
  }
  return ids
}
