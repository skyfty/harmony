import * as THREE from 'three'

import {
  deserializeGroundChunkData,
  parseGroundChunkKey,
  resolveGroundChunkCoordFromWorldPosition,
  type GroundChunkManifestRecord,
  type GroundRuntimeDynamicMesh,
} from './index'

type InfiniteGroundChunkMeshRuntime = {
  group: THREE.Group
  meshes: Map<string, THREE.Mesh>
  pendingLoads: Map<string, Promise<void>>
  sourceId: string | null
  revision: number
}

type SyncInfiniteGroundChunkMeshesParams = {
  groundObject: THREE.Object3D
  groundDefinition: GroundRuntimeDynamicMesh
  camera: THREE.Camera | null | undefined
  sourceId: string
  manifestRevision: number
  manifestRecords: Record<string, GroundChunkManifestRecord>
  loadChunkData: (record: GroundChunkManifestRecord) => Promise<ArrayBuffer | null>
  resolveActiveRecord?: (chunkKey: string) => GroundChunkManifestRecord | null | undefined
}

const infiniteGroundChunkMeshRuntimeMap = new WeakMap<THREE.Object3D, InfiniteGroundChunkMeshRuntime>()

function ensureInfiniteGroundChunkMeshRuntime(groundObject: THREE.Object3D): InfiniteGroundChunkMeshRuntime {
  const existing = infiniteGroundChunkMeshRuntimeMap.get(groundObject)
  if (existing) {
    return existing
  }

  const group = new THREE.Group()
  group.name = 'GroundRuntimeChunks'
  const ownerNodeId = typeof groundObject.userData?.nodeId === 'string' ? groundObject.userData.nodeId : null
  group.userData.nodeId = ownerNodeId
  group.userData.ownerNodeId = ownerNodeId
  group.userData.dynamicMeshType = 'Ground'
  group.userData.groundRuntimeChunks = true
  groundObject.add(group)

  const runtime: InfiniteGroundChunkMeshRuntime = {
    group,
    meshes: new Map(),
    pendingLoads: new Map(),
    sourceId: null,
    revision: -1,
  }
  infiniteGroundChunkMeshRuntimeMap.set(groundObject, runtime)
  return runtime
}

function disposeInfiniteGroundChunkMesh(mesh: THREE.Mesh): void {
  mesh.removeFromParent()
  try {
    mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
}

export function clearInfiniteGroundChunkMeshes(groundObject: THREE.Object3D): void {
  const runtime = infiniteGroundChunkMeshRuntimeMap.get(groundObject)
  if (!runtime) {
    return
  }
  runtime.meshes.forEach((mesh) => disposeInfiniteGroundChunkMesh(mesh))
  runtime.meshes.clear()
  runtime.pendingLoads.clear()
  runtime.sourceId = null
  runtime.revision = -1
}

function resolveInfiniteGroundChunkMaterial(groundObject: THREE.Object3D): THREE.Material {
  const cachedMaterialValue = (groundObject.userData as Record<string, unknown> | undefined)?.groundMaterial
  const cachedMaterial = Array.isArray(cachedMaterialValue)
    ? cachedMaterialValue[0] as THREE.Material | undefined
    : cachedMaterialValue as THREE.Material | undefined
  if (cachedMaterial) {
    return cachedMaterial
  }

  let resolved: THREE.Material | null = null
  groundObject.traverse((child) => {
    if (resolved || !(child as THREE.Mesh).isMesh) {
      return
    }
    const meshMaterial = (child as THREE.Mesh).material
    resolved = Array.isArray(meshMaterial)
      ? (meshMaterial[0] as THREE.Material | null) ?? null
      : (meshMaterial as THREE.Material | null) ?? null
  })
  if (resolved) {
    return resolved
  }

  return new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 1,
    metalness: 0.1,
  })
}

function buildInfiniteGroundChunkGeometry(
  record: GroundChunkManifestRecord,
  heightValues: Float32Array | null,
  fallbackHeight: number,
): THREE.BufferGeometry {
  const resolution = Math.max(1, Math.trunc(record.resolution))
  const vertexColumns = resolution + 1
  const vertexRows = resolution + 1
  const vertexCount = vertexColumns * vertexRows
  const cellSize = record.chunkSizeMeters / resolution
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = vertexCount > 65535
    ? new Uint32Array(resolution * resolution * 6)
    : new Uint16Array(resolution * resolution * 6)

  let vertexIndex = 0
  for (let row = 0; row < vertexRows; row += 1) {
    for (let column = 0; column < vertexColumns; column += 1) {
      const heightIndex = row * vertexColumns + column
      positions[vertexIndex * 3 + 0] = record.originX + column * cellSize
      positions[vertexIndex * 3 + 1] = heightValues?.[heightIndex] ?? fallbackHeight
      positions[vertexIndex * 3 + 2] = record.originZ + row * cellSize
      uvs[vertexIndex * 2 + 0] = column / resolution
      uvs[vertexIndex * 2 + 1] = 1 - row / resolution
      vertexIndex += 1
    }
  }

  let indexPointer = 0
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1
      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function decodeInfiniteGroundChunkHeights(buffer: ArrayBuffer | null, resolution: number): Float32Array | null {
  if (!(buffer instanceof ArrayBuffer)) {
    return null
  }

  const decoded = deserializeGroundChunkData(buffer)
  if (decoded) {
    const decodedResolution = Math.max(1, Math.trunc(decoded.header.resolution))
    if (decodedResolution === Math.max(1, Math.trunc(resolution))) {
      const heights = decoded.heights instanceof Float32Array ? decoded.heights : Float32Array.from(decoded.heights)
      return heights.length ? heights : null
    }
  }

  const expectedVertexCount = (Math.max(1, resolution) + 1) * (Math.max(1, resolution) + 1)
  if (buffer.byteLength !== expectedVertexCount * Float32Array.BYTES_PER_ELEMENT) {
    return null
  }
  return new Float32Array(buffer)
}

function resolveVisibleManifestChunkRecords(
  groundObject: THREE.Object3D,
  groundDefinition: GroundRuntimeDynamicMesh,
  camera: THREE.Camera,
  manifestRecords: Record<string, GroundChunkManifestRecord>,
): GroundChunkManifestRecord[] {
  const chunkSizeCandidate = groundDefinition.chunkSizeMeters
  const chunkSizeMeters = typeof chunkSizeCandidate === 'number' && Number.isFinite(chunkSizeCandidate) && chunkSizeCandidate > 0
    ? chunkSizeCandidate
    : 100
  const renderRadiusCandidate = groundDefinition.renderRadiusChunks
  const renderRadiusChunks = typeof renderRadiusCandidate === 'number' && Number.isFinite(renderRadiusCandidate) && renderRadiusCandidate >= 0
    ? Math.max(0, Math.trunc(renderRadiusCandidate))
    : 0

  groundObject.updateMatrixWorld(true)
  const cameraWorld = new THREE.Vector3()
  camera.getWorldPosition(cameraWorld)
  const cameraLocal = groundObject.worldToLocal(cameraWorld)
  const centerCoord = resolveGroundChunkCoordFromWorldPosition(cameraLocal.x, cameraLocal.z, chunkSizeMeters)
  const visibleRecords: GroundChunkManifestRecord[] = []
  for (let chunkZ = centerCoord.chunkZ - renderRadiusChunks; chunkZ <= centerCoord.chunkZ + renderRadiusChunks; chunkZ += 1) {
    for (let chunkX = centerCoord.chunkX - renderRadiusChunks; chunkX <= centerCoord.chunkX + renderRadiusChunks; chunkX += 1) {
      const key = `${chunkX}:${chunkZ}`
      const record = manifestRecords[key]
      if (record) {
        visibleRecords.push(record)
      }
    }
  }
  return visibleRecords
}

export function syncInfiniteGroundChunkMeshes(params: SyncInfiniteGroundChunkMeshesParams): boolean {
  if (!params.camera) {
    return false
  }

  const runtime = ensureInfiniteGroundChunkMeshRuntime(params.groundObject)
  if (runtime.sourceId !== params.sourceId || runtime.revision !== params.manifestRevision) {
    runtime.meshes.forEach((mesh) => disposeInfiniteGroundChunkMesh(mesh))
    runtime.meshes.clear()
    runtime.pendingLoads.clear()
    runtime.sourceId = params.sourceId
    runtime.revision = params.manifestRevision
  }

  const visibleRecords = resolveVisibleManifestChunkRecords(
    params.groundObject,
    params.groundDefinition,
    params.camera,
    params.manifestRecords,
  )
  const desiredKeys = new Set(visibleRecords.map((record) => record.key))
  let changed = false

  runtime.meshes.forEach((mesh, key) => {
    if (desiredKeys.has(key)) {
      return
    }
    disposeInfiniteGroundChunkMesh(mesh)
    runtime.meshes.delete(key)
    runtime.pendingLoads.delete(key)
    changed = true
  })

  const fallbackHeight = typeof params.groundDefinition.baseHeight === 'number' && Number.isFinite(params.groundDefinition.baseHeight)
    ? params.groundDefinition.baseHeight
    : 0

  for (const record of visibleRecords) {
    if (runtime.meshes.has(record.key) || runtime.pendingLoads.has(record.key)) {
      continue
    }
    const pending = params.loadChunkData(record)
      .then((buffer) => {
        const activeRuntime = infiniteGroundChunkMeshRuntimeMap.get(params.groundObject)
        if (!activeRuntime || activeRuntime.sourceId !== params.sourceId || activeRuntime.revision !== params.manifestRevision) {
          return
        }
        const activeRecord = params.resolveActiveRecord?.(record.key) ?? params.manifestRecords[record.key] ?? null
        if (!activeRecord || activeRecord.revision !== record.revision) {
          return
        }
        const parsedCoord = parseGroundChunkKey(record.key)
        const heights = decodeInfiniteGroundChunkHeights(buffer, record.resolution)
        const geometry = buildInfiniteGroundChunkGeometry(record, heights, fallbackHeight)
        const mesh = new THREE.Mesh(geometry, resolveInfiniteGroundChunkMaterial(params.groundObject))
        mesh.name = `GroundRuntimeChunk:${record.key}`
        mesh.receiveShadow = true
        mesh.castShadow = params.groundDefinition.castShadow === true
        mesh.userData.dynamicMeshType = 'Ground'
        mesh.userData.groundRuntimeChunk = true
        mesh.userData.groundChunkKey = record.key
        if (parsedCoord) {
          mesh.userData.groundChunk = {
            chunkRow: parsedCoord.chunkZ,
            chunkColumn: parsedCoord.chunkX,
          }
        }
        activeRuntime.group.add(mesh)
        activeRuntime.meshes.set(record.key, mesh)
      })
      .catch((error) => {
        console.warn('加载地形 chunk 数据失败', record.key, error)
      })
      .finally(() => {
        const activeRuntime = infiniteGroundChunkMeshRuntimeMap.get(params.groundObject)
        activeRuntime?.pendingLoads.delete(record.key)
      })
    runtime.pendingLoads.set(record.key, pending)
  }

  return changed
}