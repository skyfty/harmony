import * as THREE from 'three'

import {
  deserializeCompiledGroundRenderTile,
  type CompiledGroundManifest,
  type CompiledGroundRenderTileRecord,
} from './compiledGround'

type CompiledGroundRenderRuntime = {
  group: THREE.Group
  meshes: Map<string, THREE.Mesh>
  pendingLoads: Map<string, Promise<void>>
  sourceId: string | null
  revision: number
  lastDebugLogAt: number
  lastDebugSignature: string
}

type SyncCompiledGroundRenderTilesParams = {
  groundObject: THREE.Object3D
  groundDefinition: {
    castShadow?: boolean
  }
  camera: THREE.Camera | null | undefined
  sourceId: string
  revision: number
  manifest: CompiledGroundManifest
  loadTileData: (record: CompiledGroundRenderTileRecord) => Promise<ArrayBuffer | null>
  activeRadiusTiles?: number
  retainRadiusTiles?: number
}

const renderRuntimeMap = new WeakMap<THREE.Object3D, CompiledGroundRenderRuntime>()
const cameraLocalHelper = new THREE.Vector3()

function ensureCompiledGroundRenderRuntime(groundObject: THREE.Object3D): CompiledGroundRenderRuntime {
  const existing = renderRuntimeMap.get(groundObject)
  if (existing) {
    return existing
  }
  const group = new THREE.Group()
  group.name = 'CompiledGroundTiles'
  groundObject.add(group)
  const runtime: CompiledGroundRenderRuntime = {
    group,
    meshes: new Map(),
    pendingLoads: new Map(),
    sourceId: null,
    revision: -1,
    lastDebugLogAt: 0,
    lastDebugSignature: '',
  }
  renderRuntimeMap.set(groundObject, runtime)
  return runtime
}

function disposeCompiledGroundRenderMesh(mesh: THREE.Mesh): void {
  mesh.removeFromParent()
  try {
    mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
}

export function clearCompiledGroundRenderTiles(groundObject: THREE.Object3D): void {
  const runtime = renderRuntimeMap.get(groundObject)
  if (!runtime) {
    return
  }
  runtime.meshes.forEach((mesh) => disposeCompiledGroundRenderMesh(mesh))
  runtime.meshes.clear()
  runtime.pendingLoads.clear()
  runtime.sourceId = null
  runtime.revision = -1
  runtime.lastDebugLogAt = 0
  runtime.lastDebugSignature = ''
}

function resolveGroundMaterial(groundObject: THREE.Object3D): THREE.Material {
  const cached = (groundObject.userData as Record<string, unknown> | undefined)?.groundMaterial
  if (cached && !Array.isArray(cached)) {
    return cached as THREE.Material
  }
  let resolved: THREE.Material | null = null
  groundObject.traverse((child) => {
    if (resolved || !(child as THREE.Mesh).isMesh) {
      return
    }
    const material = (child as THREE.Mesh).material
    resolved = Array.isArray(material) ? (material[0] ?? null) : (material ?? null)
  })
  return resolved ?? new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 1,
    metalness: 0.1,
  })
}

function buildGeometryFromTileBuffer(buffer: ArrayBuffer | null): THREE.BufferGeometry | null {
  const decoded = deserializeCompiledGroundRenderTile(buffer)
  if (!decoded) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(decoded.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(decoded.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function resolveTileWindowRecords(
  groundObject: THREE.Object3D,
  manifest: CompiledGroundManifest,
  camera: THREE.Camera,
  activeRadiusTiles: number,
  retainRadiusTiles: number,
): {
  desired: CompiledGroundRenderTileRecord[]
  retainedKeys: Set<string>
} {
  camera.getWorldPosition(cameraLocalHelper)
  groundObject.worldToLocal(cameraLocalHelper)
  const tileSize = Math.max(1e-6, manifest.renderTileSizeMeters)
  const centerColumn = Math.floor((cameraLocalHelper.x - manifest.bounds.minX) / tileSize)
  const centerRow = Math.floor((cameraLocalHelper.z - manifest.bounds.minZ) / tileSize)
  const desired: Array<{ record: CompiledGroundRenderTileRecord; distSq: number }> = []
  const retainedKeys = new Set<string>()
  for (const record of manifest.renderTiles) {
    const dr = record.row - centerRow
    const dc = record.column - centerColumn
    if (Math.abs(dr) <= retainRadiusTiles && Math.abs(dc) <= retainRadiusTiles) {
      retainedKeys.add(record.key)
    }
    if (Math.abs(dr) > activeRadiusTiles || Math.abs(dc) > activeRadiusTiles) {
      continue
    }
    const dx = record.centerX - cameraLocalHelper.x
    const dz = record.centerZ - cameraLocalHelper.z
    desired.push({ record, distSq: dx * dx + dz * dz })
  }
  desired.sort((left, right) => left.distSq - right.distSq)
  return {
    desired: desired.map((entry) => entry.record),
    retainedKeys,
  }
}

export function syncCompiledGroundRenderTiles(params: SyncCompiledGroundRenderTilesParams): void {
  if (!params.camera) {
    return
  }
  const runtime = ensureCompiledGroundRenderRuntime(params.groundObject)
  if (runtime.sourceId !== params.sourceId || runtime.revision !== params.revision) {
    clearCompiledGroundRenderTiles(params.groundObject)
    runtime.sourceId = params.sourceId
    runtime.revision = params.revision
  }
  const activeRadiusTiles = Math.max(1, Math.trunc(params.activeRadiusTiles ?? 2))
  const retainRadiusTiles = Math.max(activeRadiusTiles, Math.trunc(params.retainRadiusTiles ?? (activeRadiusTiles + 1)))
  const { desired, retainedKeys } = resolveTileWindowRecords(
    params.groundObject,
    params.manifest,
    params.camera,
    activeRadiusTiles,
    retainRadiusTiles,
  )
  const desiredKeys = new Set(desired.map((record) => record.key))
  params.camera.getWorldPosition(cameraLocalHelper)
  params.groundObject.worldToLocal(cameraLocalHelper)
  const debugSignature = [
    params.sourceId,
    params.revision,
    desired.length,
    runtime.meshes.size,
    runtime.pendingLoads.size,
    Math.round(cameraLocalHelper.x),
    Math.round(cameraLocalHelper.z),
  ].join('|')
  const now = Date.now()
  if (
    debugSignature !== runtime.lastDebugSignature
    && (desired.length === 0 || runtime.meshes.size === 0 || now - runtime.lastDebugLogAt >= 1000)
  ) {
    runtime.lastDebugSignature = debugSignature
    runtime.lastDebugLogAt = now
    console.info('[CompiledGroundRender] Sync window', {
      sourceId: params.sourceId,
      revision: params.revision,
      desiredTiles: desired.length,
      retainedTiles: retainedKeys.size,
      loadedMeshes: runtime.meshes.size,
      pendingLoads: runtime.pendingLoads.size,
      activeRadiusTiles,
      retainRadiusTiles,
      cameraLocalX: Math.round(cameraLocalHelper.x),
      cameraLocalZ: Math.round(cameraLocalHelper.z),
      bounds: params.manifest.bounds,
      sampleTileKeys: desired.slice(0, 6).map((record) => record.key),
    })
  }

  runtime.meshes.forEach((mesh, key) => {
    if (desiredKeys.has(key) || retainedKeys.has(key)) {
      return
    }
    disposeCompiledGroundRenderMesh(mesh)
    runtime.meshes.delete(key)
  })

  const material = resolveGroundMaterial(params.groundObject)
  for (const record of desired) {
    if (runtime.meshes.has(record.key) || runtime.pendingLoads.has(record.key)) {
      continue
    }
    const pending = params.loadTileData(record)
      .then((buffer) => {
        const activeRuntime = renderRuntimeMap.get(params.groundObject)
        if (!activeRuntime || activeRuntime.sourceId !== params.sourceId || activeRuntime.revision !== params.revision) {
          return
        }
        if (!(buffer instanceof ArrayBuffer)) {
          console.warn('[CompiledGroundRender] Missing tile buffer', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
          })
          return
        }
        const geometry = buildGeometryFromTileBuffer(buffer)
        if (!geometry) {
          console.warn('[CompiledGroundRender] Failed to decode tile geometry', {
            sourceId: params.sourceId,
            tileKey: record.key,
            path: record.path,
            byteLength: buffer.byteLength,
          })
          return
        }
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `CompiledGroundTile:${record.key}`
        mesh.receiveShadow = true
        mesh.castShadow = params.groundDefinition.castShadow === true
        mesh.frustumCulled = true
        mesh.userData.compiledGroundTile = true
        mesh.userData.compiledGroundTileKey = record.key
        activeRuntime.group.add(mesh)
        activeRuntime.meshes.set(record.key, mesh)
        if (activeRuntime.meshes.size <= 3 || activeRuntime.meshes.size % 8 === 0) {
          console.info('[CompiledGroundRender] Tile mesh attached', {
            sourceId: params.sourceId,
            tileKey: record.key,
            loadedMeshes: activeRuntime.meshes.size,
            pendingLoads: activeRuntime.pendingLoads.size,
            vertexCount: (geometry.getAttribute('position')?.count ?? 0),
          })
        }
      })
      .finally(() => {
        renderRuntimeMap.get(params.groundObject)?.pendingLoads.delete(record.key)
      })
    runtime.pendingLoads.set(record.key, pending)
  }
}
