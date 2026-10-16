import * as THREE from 'three'
import { loadTextureFromSourceUrl } from './textureSourceLoader'
import type { TerrainTextureManifest, TerrainTextureManifestEntry } from './terrainPack'

// The manifest contract lives in the three-free `terrainPack` module so the
// server and the admin upload can validate packs without pulling in three.
export { parseTerrainTextureManifest } from './terrainPack'
export type {
  TerrainTextureManifest,
  TerrainTextureManifestEntry,
  TerrainTextureManifestSlot,
} from './terrainPack'

/**
 * Lazy, visibility-driven texture streaming for terrain GLBs exported by the
 * 3dtiles-viewer tool ("geometry-only GLB + external texture pack").
 *
 * The exporter writes `plTextureBindings` into the mesh node extras (Three.js
 * surfaces those as `userData`). Each binding references a texture id plus the
 * relative `image` (JPEG/PNG) and optional `ktx2` file. The stream binds them
 * to the mesh materials only when the mesh gets near the camera, keeps a
 * byte-budgeted LRU cache, and falls back from KTX2 to JPEG transparently.
 *
 * proceduralLandscape flips `baseMapStreamingEnabled` off in its default
 * `replace` surface mode, so no GLB imagery is downloaded at all.
 */

export interface TerrainTextureBinding {
  slot?: string
  textureId?: string
  materialIndices?: number[]
  image?: string
  ktx2?: string
}

export interface TerrainTextureRequest {
  textureId: string
  slot: TerrainTextureSlot
  image?: string
  ktx2?: string
  width?: number
  height?: number
  bytes?: number
  ktx2Bytes?: number
}

export interface TerrainTextureStreamOptions {
  /** Base URL the relative texture paths are resolved against. */
  baseUrl?: string
  /** Optional manifest that enriches bindings with sizes and file variants. */
  manifest?: TerrainTextureManifest
  /** Custom fetcher; falls back to the shared texture source loader. */
  fetchTexture?: (request: TerrainTextureRequest) => Promise<THREE.Texture | null>
  /** Prefer the KTX2 variant when present. Default true. */
  useKtx2?: boolean
  /** Approximate resident texture memory budget in bytes. Default 64 MiB. */
  memoryBudgetBytes?: number
  /** Max parallel texture requests. Default 3. */
  concurrency?: number
  /** Priority rescan interval in ms. Default 500. */
  updateIntervalMs?: number
  /** Overall streaming switch. Default true. */
  enabled?: boolean
  /** Gates the `map` slot (proceduralLandscape replace mode). Default true. */
  baseMapStreamingEnabled?: boolean
  /** Retry delay for failed fetches in ms. Default 60000. */
  retryFailedAfterMs?: number
  onTextureBound?: (request: TerrainTextureRequest, mesh: THREE.Mesh) => void
  onTextureError?: (request: TerrainTextureRequest, error: unknown) => void
}

export interface TerrainTextureStreamStats {
  pending: number
  loaded: number
  residentBytes: number
}

export interface TerrainTextureStream {
  update(camera: THREE.Camera, nowMs?: number): void
  setEnabled(enabled: boolean): void
  setBaseMapStreamingEnabled(enabled: boolean): void
  getStats(): TerrainTextureStreamStats
  dispose(): void
}

export const TERRAIN_TEXTURE_STREAM_KEY = '__terrainTextureStream'

const TERRAIN_TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
] as const

export type TerrainTextureSlot = (typeof TERRAIN_TEXTURE_SLOTS)[number]

const COLOR_TEXTURE_SLOTS: ReadonlySet<string> = new Set(['map', 'emissiveMap', 'lightMap'])
const DEFAULT_MEMORY_BUDGET = 64 * 1024 * 1024

function isTerrainTextureSlot(value: string | undefined): value is TerrainTextureSlot {
  return typeof value === 'string' && (TERRAIN_TEXTURE_SLOTS as readonly string[]).includes(value)
}

function resolveTextureUrl(baseUrl: string | undefined, relative: string | undefined): string | null {
  const value = relative?.trim()
  if (!value) {
    return null
  }
  if (/^(https?:|blob:|wxfile:)/i.test(value)) {
    return value
  }
  if (!baseUrl) {
    return null
  }
  return `${baseUrl.replace(/\/+$/, '')}/${value.replace(/^\/+/, '')}`
}

function estimateTextureBytes(request: TerrainTextureRequest): number {
  if (typeof request.width === 'number' && typeof request.height === 'number' && request.width > 0 && request.height > 0) {
    return Math.round(request.width * request.height * 4)
  }
  if (typeof request.ktx2Bytes === 'number' && request.ktx2Bytes > 0) {
    return Math.round(request.ktx2Bytes * 8)
  }
  if (typeof request.bytes === 'number' && request.bytes > 0) {
    return Math.round(request.bytes * 4)
  }
  return 4 * 1024 * 1024
}

interface PendingRequest {
  request: TerrainTextureRequest
  mesh: THREE.Mesh
  materialIndices: number[]
  failedAt: number
}

interface ResidentEntry {
  request: TerrainTextureRequest
  mesh: THREE.Mesh
  materialIndices: number[]
  texture: THREE.Texture
  bytes: number
  lastUsedAt: number
}

function materialCountOf(mesh: THREE.Mesh): number {
  return Array.isArray(mesh.material) ? mesh.material.length : 1
}

function normalizeMaterialIndices(binding: TerrainTextureBinding, mesh: THREE.Mesh): number[] {
  const provided = binding.materialIndices
  if (Array.isArray(provided) && provided.length > 0) {
    return provided.filter((index) => Number.isInteger(index) && index >= 0)
  }
  return Array.from({ length: materialCountOf(mesh) }, (_value, index) => index)
}

export function createTerrainTextureStream(
  root: THREE.Object3D,
  options: TerrainTextureStreamOptions = {},
): TerrainTextureStream {
  const baseUrl = options.baseUrl?.trim() || undefined
  const manifestEntries = new Map<string, TerrainTextureManifestEntry>()
  for (const entry of options.manifest?.textures ?? []) {
    if (typeof entry.id === 'string' && entry.id) {
      manifestEntries.set(entry.id, entry)
    }
  }

  const useKtx2 = options.useKtx2 !== false
  const memoryBudget = Math.max(1024 * 1024, options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET)
  const concurrency = Math.max(1, options.concurrency ?? 3)
  const updateIntervalMs = Math.max(0, options.updateIntervalMs ?? 500)
  const retryFailedAfterMs = Math.max(0, options.retryFailedAfterMs ?? 60000)

  let enabled = options.enabled !== false
  let baseMapStreamingEnabled = options.baseMapStreamingEnabled !== false
  let disposed = false
  let lastScanAt = -Infinity
  let activeCount = 0
  let residentBytes = 0

  const pending: PendingRequest[] = []
  const resident: ResidentEntry[] = []
  const queue: PendingRequest[] = []
  const meshDistances = new Map<THREE.Mesh, number>()
  const meshVisibilities = new Map<THREE.Mesh, boolean>()

  const collectPending = (): void => {
    pending.length = 0
    root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) {
        return
      }
      const bindings = (mesh.userData as Record<string, unknown> | undefined)?.plTextureBindings
      if (!Array.isArray(bindings) || bindings.length === 0) {
        return
      }
      for (const raw of bindings) {
        if (typeof raw !== 'object' || raw === null) {
          continue
        }
        const binding = raw as TerrainTextureBinding
        const slot = binding.slot
        const textureId = binding.textureId
        if (!isTerrainTextureSlot(slot) || typeof textureId !== 'string' || !textureId) {
          continue
        }
        const manifestEntry = manifestEntries.get(textureId)
        pending.push({
          request: {
            textureId,
            slot,
            image: manifestEntry?.image ?? binding.image,
            ktx2: manifestEntry?.ktx2 ?? binding.ktx2,
            width: manifestEntry?.width,
            height: manifestEntry?.height,
            bytes: manifestEntry?.bytes,
            ktx2Bytes: manifestEntry?.ktx2Bytes,
          },
          mesh,
          materialIndices: normalizeMaterialIndices(binding, mesh),
          failedAt: 0,
        })
      }
    })
  }

  const applyTexture = (entry: PendingRequest, texture: THREE.Texture, now: number): void => {
    const materials = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]
    for (const materialIndex of entry.materialIndices) {
      const material = materials[materialIndex]
      if (!material) {
        continue
      }
      if (COLOR_TEXTURE_SLOTS.has(entry.request.slot)) {
        texture.colorSpace = THREE.SRGBColorSpace
      }
      const record = material as THREE.Material & Record<string, THREE.Texture | null>
      record[entry.request.slot] = texture
      material.needsUpdate = true
    }
    const bytes = estimateTextureBytes(entry.request)
    resident.push({
      request: entry.request,
      mesh: entry.mesh,
      materialIndices: entry.materialIndices,
      texture,
      bytes,
      lastUsedAt: now,
    })
    residentBytes += bytes
    options.onTextureBound?.(entry.request, entry.mesh)
    evictOverBudget(now)
  }

  const evictOverBudget = (now: number): void => {
    while (residentBytes > memoryBudget && resident.length > 0) {
      resident.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
      const entry = resident.shift()
      if (!entry) {
        break
      }
      entry.texture.dispose()
      const materials = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]
      for (const materialIndex of entry.materialIndices) {
        const material = materials[materialIndex]
        if (!material) {
          continue
        }
        const record = material as THREE.Material & Record<string, THREE.Texture | null>
        if (record[entry.request.slot] === entry.texture) {
          record[entry.request.slot] = null
          material.needsUpdate = true
        }
      }
      residentBytes -= entry.bytes
      pending.push({
        request: entry.request,
        mesh: entry.mesh,
        materialIndices: entry.materialIndices,
        failedAt: now,
      })
    }
  }

  const resolveRequest = async (entry: PendingRequest, now: number): Promise<void> => {
    activeCount += 1
    try {
      let texture: THREE.Texture | null = null
      if (options.fetchTexture) {
        texture = await options.fetchTexture(entry.request)
      } else {
        const ktx2Url = useKtx2 ? resolveTextureUrl(baseUrl, entry.request.ktx2) : null
        const imageUrl = resolveTextureUrl(baseUrl, entry.request.image)
        if (ktx2Url) {
          try {
            texture = await loadTextureFromSourceUrl(ktx2Url)
          } catch (error) {
            options.onTextureError?.(entry.request, error)
          }
        }
        if (!texture && imageUrl) {
          texture = await loadTextureFromSourceUrl(imageUrl)
        }
      }
      if (disposed) {
        texture?.dispose()
        return
      }
      if (!texture) {
        entry.failedAt = now
        options.onTextureError?.(entry.request, new Error(`No usable texture source for ${entry.request.textureId}`))
        return
      }
      applyTexture(entry, texture, now)
    } catch (error) {
      if (!disposed) {
        entry.failedAt = now
        options.onTextureError?.(entry.request, error)
      }
    } finally {
      activeCount -= 1
    }
  }

  const rescan = (camera: THREE.Camera, now: number): void => {
    lastScanAt = now
    meshDistances.clear()
    meshVisibilities.clear()
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    const position = new THREE.Vector3()
    const sphere = new THREE.Sphere()
    const matrix = new THREE.Matrix4()
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3())

    const measure = (mesh: THREE.Mesh): void => {
      mesh.updateMatrixWorld()
      mesh.getWorldPosition(position)
      meshDistances.set(mesh, position.distanceTo(cameraPosition))
      const boundingSphere = mesh.geometry.boundingSphere
      if (!boundingSphere) {
        meshVisibilities.set(mesh, mesh.visible !== false)
        return
      }
      sphere.copy(boundingSphere).applyMatrix4(matrix.copy(mesh.matrixWorld))
      meshVisibilities.set(mesh, mesh.visible !== false && frustum.intersectsSphere(sphere))
    }

    queue.length = 0
    for (const entry of pending) {
      if (!meshDistances.has(entry.mesh)) {
        measure(entry.mesh)
      }
      if (entry.request.slot === 'map' && !baseMapStreamingEnabled) {
        continue
      }
      if (entry.failedAt > 0 && now - entry.failedAt < retryFailedAfterMs) {
        continue
      }
      queue.push(entry)
    }
    queue.sort((a, b) => {
      const visibleDelta = (meshVisibilities.get(a.mesh) ? 0 : 1) - (meshVisibilities.get(b.mesh) ? 0 : 1)
      if (visibleDelta !== 0) {
        return visibleDelta
      }
      return (meshDistances.get(a.mesh) ?? Infinity) - (meshDistances.get(b.mesh) ?? Infinity)
    })
  }

  const drainQueue = (now: number): void => {
    let guard = 0
    while (activeCount < concurrency && queue.length > 0 && guard < 1024) {
      const entry = queue.shift()
      guard += 1
      if (!entry) {
        break
      }
      const alreadyResident = resident.some(
        (residentEntry) =>
          residentEntry.mesh === entry.mesh
          && residentEntry.request.textureId === entry.request.textureId
          && residentEntry.request.slot === entry.request.slot,
      )
      if (alreadyResident) {
        continue
      }
      void resolveRequest(entry, now)
    }
  }

  collectPending()

  const update = (camera: THREE.Camera, nowMs?: number): void => {
    if (disposed || !enabled) {
      return
    }
    const now = nowMs ?? Date.now()
    if (now - lastScanAt >= updateIntervalMs) {
      rescan(camera, now)
    }
    drainQueue(now)
    for (const entry of resident) {
      if (entry.request.slot === 'map' && !baseMapStreamingEnabled) {
        continue
      }
      if ((meshVisibilities.get(entry.mesh) ?? false)) {
        entry.lastUsedAt = now
      }
    }
  }

  const stream: TerrainTextureStream = {
    update,
    setEnabled(next: boolean): void {
      enabled = next
      if (enabled) {
        lastScanAt = -Infinity
      }
    },
    setBaseMapStreamingEnabled(next: boolean): void {
      baseMapStreamingEnabled = next
      if (next) {
        lastScanAt = -Infinity
      }
    },
    getStats(): TerrainTextureStreamStats {
      return {
        pending: pending.length,
        loaded: resident.length,
        residentBytes,
      }
    },
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      for (const entry of resident) {
        entry.texture.dispose()
      }
      resident.length = 0
      pending.length = 0
      queue.length = 0
      residentBytes = 0
    },
  }

  return stream
}

export function attachTerrainTextureStream(
  root: THREE.Object3D,
  options: TerrainTextureStreamOptions = {},
): TerrainTextureStream {
  const existing = getAttachedTerrainTextureStream(root)
  existing?.dispose()
  const stream = createTerrainTextureStream(root, options)
  ;(root.userData as Record<string, unknown>)[TERRAIN_TEXTURE_STREAM_KEY] = stream
  return stream
}

/**
 * Attaches a stream to `root` when (and only when) it carries terrain texture
 * bindings in its mesh extras, deriving the texture base URL from the asset
 * download URL. Returns null when the root has no bindings.
 */
export function attachTerrainTextureStreamFromUrl(
  root: THREE.Object3D,
  downloadUrl: string | null | undefined,
  options: TerrainTextureStreamOptions = {},
): TerrainTextureStream | null {
  let hasBindings = false
  root.traverse((node) => {
    if (Array.isArray((node.userData as Record<string, unknown> | undefined)?.plTextureBindings)) {
      hasBindings = true
    }
  })
  if (!hasBindings) {
    return null
  }
  let baseUrl: string | undefined
  const trimmed = typeof downloadUrl === 'string' ? downloadUrl.trim() : ''
  if (trimmed) {
    const slash = trimmed.lastIndexOf('/')
    baseUrl = slash >= 0 ? trimmed.slice(0, slash + 1) : undefined
  }
  return attachTerrainTextureStream(root, { ...options, baseUrl: options.baseUrl ?? baseUrl })
}

export function getAttachedTerrainTextureStream(root: THREE.Object3D): TerrainTextureStream | null {
  const value = (root.userData as Record<string, unknown> | undefined)?.[TERRAIN_TEXTURE_STREAM_KEY]
  return value && typeof value === 'object' && 'update' in value && 'dispose' in value
    ? value as TerrainTextureStream
    : null
}

export function findTerrainTextureStreamFrom(object: THREE.Object3D): TerrainTextureStream | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const stream = getAttachedTerrainTextureStream(current)
    if (stream) {
      return stream
    }
    current = current.parent
  }
  return null
}

export function updateAttachedTerrainTextureStreams(
  root: THREE.Object3D,
  camera: THREE.Camera,
  nowMs?: number,
): void {
  const seen = new Set<TerrainTextureStream>()
  const visit = (node: THREE.Object3D): void => {
    const stream = getAttachedTerrainTextureStream(node)
    if (stream && !seen.has(stream)) {
      seen.add(stream)
      stream.update(camera, nowMs)
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(root)
}

