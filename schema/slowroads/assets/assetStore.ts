import * as THREE from 'three'
import type { AssetBundleManifest } from '../../asset-api'
import { downloadAssetTempFilePath, fetchAssetBlob } from '../../assetDownload'
import { loadTextureFromSourceUrl } from '../../textureSourceLoader'
import { SHARED_TEXTURES, type SeasonTextureRef } from '../core/seasonCatalog'

/**
 * Slow Roads 在线素材源（默认走线上资产包，无本地模式、无组件级配置）。
 *
 * - manifest：`https://v.touchmagic.cn/uploads/slowroads/asset-bundle.json`（admin 资产包
 *   流程产物，119 个文件；每个文件的 URL = 同目录 + `path`；旧的平铺 `uploads/`
 *   目录已不再对外提供文件，服务端返回 403，因此 baseUrl 必须带 `slowroads/`）；
 * - 下载走既有 `fetchAssetBlob`（CDN 镜像候选、worker、uni.downloadFile 兜底、
 *   进度回调），纹理经 `loadTextureFromSourceUrl` 加载；
 * - 设备纹理上限 < 4096 时自动改用 `@2048` 变体（manifest 中带 `@2048` 后缀）；
 * - LRU：只保留当前季 + 共享贴图 + 近树模型的字节/纹理解码，其余在换季时释放。
 */

export const SLOWROADS_ASSET_BASE_URL = 'https://v.touchmagic.cn/uploads/slowroads/'
export const SLOWROADS_ASSET_MANIFEST_FILE = 'asset-bundle.json'
export const SLOWROADS_TEXTURE_2048_THRESHOLD = 4096
/** Bump when replacing stable asset files behind an unchanged manifest path. */
export const SLOWROADS_ASSET_MANIFEST_VERSION = '2'

const SLOWROADS_TEXTURE_LOAD_CONCURRENCY = 2
const SLOWROADS_TEXTURE_LOAD_ATTEMPTS = 2
const SLOWROADS_TEXTURE_RETRY_DELAY_MS = 150
const SLOWROADS_TEXTURE_LOAD_TIMEOUT_MS = 20_000

export function resolveSlowroadsLogicalId(
  variant: 'full' | '2048',
  logicalId: string,
): string {
  return variant === '2048' ? `${logicalId}@2048` : logicalId
}

/**
 * Resolve the ordered texture candidates for one logical asset.
 *
 * The preferred device variant stays first. If it is absent or fails at
 * runtime, the alternate manifest variant is used before reporting the texture
 * as missing.
 */
export function resolveSlowroadsTextureCandidateIds(
  logicalId: string,
  primaryId: string,
  hasFile: (candidateId: string) => boolean,
): string[] {
  const candidates: string[] = []
  const push = (candidateId: string): void => {
    if (candidateId && hasFile(candidateId) && !candidates.includes(candidateId)) {
      candidates.push(candidateId)
    }
  }

  push(primaryId)
  push(primaryId.endsWith('@2048') ? logicalId : `${logicalId}@2048`)
  return candidates
}

interface SlowroadsAssetRuntimeConfig {
  baseUrl: string
  manifestUrl: string
  /** 平台扩展点：小程序端可用 uni.downloadFile 的临时路径直接作为纹理源。 */
  resolveTextureSource?: (file: SlowroadsBundleFile | null, blobUrl: string | null) => string | null
}

/**
 * Join an absolute asset base URL with a relative bundle path without relying
 * on the DOM `URL` constructor. WeChat mini-program subpackages can evaluate
 * this module before the three-platform adapter installs its URL polyfill, so
 * `new URL(...)` at module scope crashes the whole scenery subpackage.
 */
function resolveAssetUrl(baseUrl: string, path: string): string {
  const normalizedPath = typeof path === 'string' ? path.trim() : ''
  if (/^(?:https?:|data:|blob:|wxfile:)/i.test(normalizedPath)) {
    return normalizedPath
  }
  const normalizedBase = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (!normalizedBase) {
    return normalizedPath
  }
  return `${normalizedBase.replace(/\/+$/, '')}/${normalizedPath.replace(/^\/+/, '')}`
}

/**
 * Keep the stable upload path (which the server/CDN serves) while forcing a
 * fresh request whenever the manifest reports new bytes for the same logical
 * asset. This prevents a long-lived CDN cache from serving an older @2048
 * atlas after the asset bundle has been repaired.
 */
export function resolveSlowroadsVersionedAssetUrl(url: string, contentHash: string | null | undefined): string {
  const normalizedUrl = typeof url === 'string' ? url.trim() : ''
  const normalizedHash = typeof contentHash === 'string' ? contentHash.trim() : ''
  if (!normalizedUrl || !normalizedHash) {
    return normalizedUrl
  }
  const separator = normalizedUrl.includes('?') ? '&' : '?'
  return `${normalizedUrl}${separator}v=${encodeURIComponent(normalizedHash)}`
}

function versionSlowroadsManifestUrl(url: string): string {
  return resolveSlowroadsVersionedAssetUrl(url, SLOWROADS_ASSET_MANIFEST_VERSION)
}

let assetRuntimeConfig: SlowroadsAssetRuntimeConfig = {
  baseUrl: SLOWROADS_ASSET_BASE_URL,
  manifestUrl: versionSlowroadsManifestUrl(
    resolveAssetUrl(SLOWROADS_ASSET_BASE_URL, SLOWROADS_ASSET_MANIFEST_FILE),
  ),
}

export function configureSlowroadsAssetBaseUrl(baseUrl: string, manifestFileName = SLOWROADS_ASSET_MANIFEST_FILE): void {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  assetRuntimeConfig = {
    ...assetRuntimeConfig,
    baseUrl: normalized,
    manifestUrl: versionSlowroadsManifestUrl(resolveAssetUrl(normalized, manifestFileName)),
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
  /**
   * Explicit variant policy. Mini programs use the existing @2048 imposter
   * atlases even when the GPU reports a larger texture limit.
   */
  preferredVariant?: 'full' | '2048'
  /**
   * Mini programs can hand a downloaded temp-file path directly to their
   * Image implementation. This avoids materialising every PNG as an
   * ArrayBuffer, Blob and eventually a base64 data URL on the JS thread.
   */
  preferLocalFileTextures?: boolean
}

export interface SlowroadsTextureSetOptions {
  /** Called as soon as one texture is decoded, before the whole set settles. */
  onTexture?: (ref: SeasonTextureRef, texture: THREE.Texture) => void
}

interface TextureEntry {
  texture: THREE.Texture
  objectUrl: string | null
  requestedLogicalId: string
  logicalId: string
  estimatedBytes: number
  lastUsedAt: number
}

interface PendingLoad {
  promise: Promise<THREE.Texture | null>
}

interface TextureLoadAttempt {
  texture: THREE.Texture | null
  error: string
}

export class SlowroadsAssetStore {
  private readonly options: Required<Pick<SlowroadsAssetStoreOptions, 'maxTextureSize' | 'maxAnisotropy'>>
    & { preferredVariant: 'full' | '2048' | null; preferLocalFileTextures: boolean }
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
      preferredVariant: options.preferredVariant === 'full' || options.preferredVariant === '2048'
        ? options.preferredVariant
        : null,
      preferLocalFileTextures: options.preferLocalFileTextures === true,
    }
  }

  /**
   * Update device-derived limits after the shared store already exists. The
   * landscape runtime can construct the singleton before the viewer has a
   * renderer, so without this pass every texture keeps the default anisotropy
   * of 1 even on devices that support 8/16.
   */
  configure(options: SlowroadsAssetStoreOptions): void {
    const nextMaxTextureSize = options.maxTextureSize != null
      && Number.isFinite(options.maxTextureSize)
      && options.maxTextureSize > 0
      ? options.maxTextureSize
      : this.options.maxTextureSize
    const nextMaxAnisotropy = options.maxAnisotropy != null
      && Number.isFinite(options.maxAnisotropy)
      && options.maxAnisotropy > 0
      ? options.maxAnisotropy
      : this.options.maxAnisotropy
    this.options.maxTextureSize = nextMaxTextureSize
    this.options.maxAnisotropy = nextMaxAnisotropy
    if (options.preferredVariant === 'full' || options.preferredVariant === '2048') {
      this.options.preferredVariant = options.preferredVariant
    }
    if (typeof options.preferLocalFileTextures === 'boolean') {
      this.options.preferLocalFileTextures = options.preferLocalFileTextures
    }
    const anisotropy = Math.max(1, Math.min(8, nextMaxAnisotropy))
    for (const entry of this.textures.values()) {
      entry.texture.anisotropy = anisotropy
      entry.texture.needsUpdate = true
    }
  }

  get variant(): 'full' | '2048' {
    if (this.options.preferredVariant) {
      return this.options.preferredVariant
    }
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
  }

  private fileUrl(file: SlowroadsBundleFile): string {
    return resolveSlowroadsVersionedAssetUrl(
      resolveAssetUrl(assetRuntimeConfig.baseUrl, file.path),
      file.hash,
    )
  }

  /** 按设备上限选择档位：`@2048` 变体存在时优先（低配设备）。 */
  private resolveLogicalId(logicalId: string): string {
    if (this.variant === 'full') {
      return logicalId
    }
    // Resolve optimistically. Manifest loading is asynchronous and the first
    // texture request would otherwise miss @2048 and permanently cache full.
    return resolveSlowroadsLogicalId(this.variant, logicalId)
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
    const resolvedId = this.resolveLogicalId(logicalId)
    return this.findResidentTexture(logicalId, resolvedId) !== null
      || this.pending.has(resolvedId)
      || this.pending.has(logicalId)
  }

  private findResidentTexture(
    requestedLogicalId: string,
    resolvedId: string,
  ): TextureEntry | null {
    const direct = this.textures.get(resolvedId) ?? this.textures.get(requestedLogicalId)
    if (direct) {
      return direct
    }
    for (const entry of this.textures.values()) {
      if (entry.requestedLogicalId === requestedLogicalId) {
        return entry
      }
    }
    return null
  }

  /**
   * 获取一组纹理。返回 Map 以**原始 logicalId**（调用方传入的，不带 @2048）为键。
   * 任何单个文件失败都不抛出：对应键缺省，调用方保留旧纹理并读取 warnings。
   */
  async textureSet(
    refs: ReadonlyArray<SeasonTextureRef>,
    onProgress?: (loaded: number, total: number) => void,
    options: SlowroadsTextureSetOptions = {},
  ): Promise<Map<string, THREE.Texture>> {
    await this.ensureManifest()
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
    let nextIndex = 0
    const workerCount = Math.min(SLOWROADS_TEXTURE_LOAD_CONCURRENCY, unique.length)
    const loadNext = async (): Promise<void> => {
      while (nextIndex < unique.length) {
        const ref = unique[nextIndex]
        nextIndex += 1
        if (!ref) {
          break
        }
        const texture = await this.texture(ref)
        if (texture) {
          result.set(ref.id, texture)
          if (options.onTexture) {
            try {
              options.onTexture(ref, texture)
            } catch (error) {
              this.warn(`texture-callback-failed:${ref.id}:${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }
        loaded += 1
        onProgress?.(loaded, unique.length)
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => loadNext()))
    return result
  }

  async texture(ref: SeasonTextureRef): Promise<THREE.Texture | null> {
    await this.ensureManifest()
    const resolvedId = this.resolveLogicalId(ref.id)
    const entry = this.findResidentTexture(ref.id, resolvedId)
    if (entry) {
      entry.lastUsedAt = Date.now()
      return entry.texture
    }
    const pending = this.pending.get(resolvedId)
      ?? this.pending.get(ref.id)
    if (pending) {
      return await pending.promise
    }
    const promise = this.loadTextureWithFallback(ref, resolvedId)
    this.pending.set(resolvedId, { promise })
    try {
      return await promise
    } finally {
      this.pending.delete(resolvedId)
    }
  }

  private async loadTextureWithFallback(
    ref: SeasonTextureRef,
    resolvedId: string,
  ): Promise<THREE.Texture | null> {
    const candidates = resolveSlowroadsTextureCandidateIds(
      ref.id,
      resolvedId,
      (candidateId) => this.fileByLogicalId.has(candidateId),
    )
    if (!candidates.length) {
      this.warn(`missing-file:${ref.id}`)
      return null
    }

    let lastError = ''
    for (const candidateId of candidates) {
      for (let attempt = 1; attempt <= SLOWROADS_TEXTURE_LOAD_ATTEMPTS; attempt += 1) {
        const result = await this.loadTextureCandidate(
          ref,
          candidateId,
          attempt === 1 && this.options.preferLocalFileTextures,
        )
        if (result.texture) {
          return result.texture
        }
        lastError = result.error || lastError
        if (attempt < SLOWROADS_TEXTURE_LOAD_ATTEMPTS) {
          await delay(SLOWROADS_TEXTURE_RETRY_DELAY_MS * attempt)
        }
      }
    }

    this.warn(`file-failed:${ref.id}:${lastError || 'unknown'}`)
    return null
  }

  private async loadTextureCandidate(
    ref: SeasonTextureRef,
    logicalId: string,
    preferLocalFile: boolean,
  ): Promise<TextureLoadAttempt> {
    await this.ensureManifest()
    const file = this.fileByLogicalId.get(logicalId)
    if (!file) {
      return { texture: null, error: `missing-file:${logicalId}` }
    }
    let objectUrl: string | null = null
    let textureSource: string | null = null
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), SLOWROADS_TEXTURE_LOAD_TIMEOUT_MS)
    this.pendingDownloads += 1
    try {
      const fileUrl = this.fileUrl(file)
      if (preferLocalFile) {
        try {
          const localPath = await downloadAssetTempFilePath(fileUrl, controller, () => {})
          if (localPath) {
            textureSource = localPath
            this.downloadedBytes += file.size
          }
        } catch {
          // Fall through to the regular blob path. Local-file decoding support
          // differs between mini-program base libraries.
        }
      }
      if (!textureSource) {
        const payload = await fetchAssetBlob(fileUrl, controller, () => {}, { fileDownload: true })
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
          textureSource = fileUrl
        }
      }
      const texture = await withTimeout(
        loadTextureFromSourceUrl(textureSource),
        SLOWROADS_TEXTURE_LOAD_TIMEOUT_MS,
        `texture-decode-timeout:${ref.id}`,
      )
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.colorSpace = ref.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.anisotropy = Math.max(1, Math.min(8, this.options.maxAnisotropy))
      texture.needsUpdate = true
      const image = texture.image as { width?: number; height?: number } | null
      const width = image?.width ?? 0
      const height = image?.height ?? 0
      const estimatedBytes = Math.round(width * height * 4 * 1.34) || file.size * 4
      this.textures.set(file.logicalId, {
        texture,
        objectUrl,
        requestedLogicalId: ref.id,
        logicalId: file.logicalId,
        estimatedBytes,
        lastUsedAt: Date.now(),
      })
      return { texture, error: '' }
    } catch (error) {
      if (objectUrl) {
        revokeObjectUrl(objectUrl)
      }
      return {
        texture: null,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timeoutHandle)
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
      if (
        resolvedKeep.has(key)
        || resolvedKeep.has(entry.logicalId)
        || resolvedKeep.has(entry.requestedLogicalId)
      ) {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)))
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), Math.max(1, milliseconds))
    promise.then(
      (value) => {
        clearTimeout(handle)
        resolve(value)
      },
      (error) => {
        clearTimeout(handle)
        reject(error)
      },
    )
  })
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
  } else if (
    options.maxTextureSize != null
    || options.maxAnisotropy != null
    || options.preferredVariant != null
  ) {
    sharedSlowroadsAssetStore.configure(options)
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
