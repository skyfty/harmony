import * as THREE from 'three'
import type { Mesh as VhacdMesh, Options as VhacdOptions } from 'vhacd-js'
import type {
  RigidbodyConvexDecompositionConfig,
  RigidbodyConvexMeshPart,
  RigidbodyPhysicsShape,
  RigidbodyVector3Tuple,
} from '@schema/components'

export type ConvexHullMesh = {
  positions: Float64Array
  indices: Uint32Array
}

export type ConvexDecomposeWorkerRequest = {
  __type: 'convex-decompose-request'
  requestId: number
  positions: Float64Array
  indices: Uint32Array
  options: VhacdOptions
}

export type ConvexDecomposeWorkerResponse =
  | {
      __type: 'convex-decompose-result'
      requestId: number
      hulls: ConvexHullMesh[]
    }
  | {
      __type: 'convex-decompose-error'
      requestId: number
      message: string
    }

export type ConvexDecomposeWorldTransform = {
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
  scale: { x: number; y: number; z: number }
}

const DEFAULT_CONVEX_MESH_DECIMAL_PRECISION = 3
const DEFAULT_CONVEX_MESH_MERGE_TOLERANCE = 1e-3

let decomposeWorker: Worker | null = null
let nextDecomposeRequestId = 1
const pendingDecomposeRequests = new Map<
  number,
  {
    resolve: (hulls: ConvexHullMesh[]) => void
    reject: (error: Error) => void
  }
>()

function quantizeConvexMeshValue(value: number, precision: number): number {
  const factor = 10 ** precision
  const scaled = Math.round(value * factor) / factor
  return Object.is(scaled, -0) ? 0 : scaled
}

function getConvexDecomposeWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (decomposeWorker) {
    return decomposeWorker
  }
  try {
    decomposeWorker = new Worker(new URL('@/workers/convexDecompose.worker.ts', import.meta.url), {
      type: 'module',
    })
    decomposeWorker.onmessage = (event: MessageEvent<ConvexDecomposeWorkerResponse>) => {
      const data = event.data
      if (!data || typeof data !== 'object') {
        return
      }
      const pending = pendingDecomposeRequests.get(data.requestId)
      if (!pending) {
        return
      }
      pendingDecomposeRequests.delete(data.requestId)
      if (data.__type === 'convex-decompose-result') {
        pending.resolve(Array.isArray(data.hulls) ? data.hulls : [])
      } else if (data.__type === 'convex-decompose-error') {
        pending.reject(new Error(data.message || 'Convex decomposition failed'))
      }
    }
    decomposeWorker.onerror = (event) => {
      const pendingRequests = Array.from(pendingDecomposeRequests.values())
      pendingDecomposeRequests.clear()
      pendingRequests.forEach((pending) => {
        pending.reject(new Error(event?.message ?? 'Convex decomposition worker failed'))
      })
      decomposeWorker?.terminate()
      decomposeWorker = null
    }
    return decomposeWorker
  } catch (error) {
    console.warn('[convex-decompose] Failed to create decomposition worker', error)
    decomposeWorker = null
    return null
  }
}

export function disposeConvexDecomposeWorker(): void {
  const worker = decomposeWorker
  decomposeWorker = null
  if (worker) {
    worker.terminate()
  }
  const pendingRequests = Array.from(pendingDecomposeRequests.values())
  pendingDecomposeRequests.clear()
  pendingRequests.forEach((pending) => {
    pending.reject(new Error('Convex decomposition worker disposed'))
  })
}

async function decomposeConvexHullsInWorker(
  mesh: VhacdMesh,
  options: VhacdOptions,
): Promise<ConvexHullMesh[]> {
  const worker = getConvexDecomposeWorker()
  if (!worker) {
    return decomposeConvexHullsOnMainThread(mesh, options)
  }
  const requestId = nextDecomposeRequestId
  nextDecomposeRequestId += 1
  return new Promise<ConvexHullMesh[]>((resolve, reject) => {
    pendingDecomposeRequests.set(requestId, { resolve, reject })
    const request: ConvexDecomposeWorkerRequest = {
      __type: 'convex-decompose-request',
      requestId,
      positions: mesh.positions,
      indices: mesh.indices,
      options,
    }
    worker.postMessage(request, [mesh.positions.buffer, mesh.indices.buffer])
  })
}

async function decomposeConvexHullsOnMainThread(
  mesh: VhacdMesh,
  options: VhacdOptions,
): Promise<ConvexHullMesh[]> {
  const module = await import('vhacd-js')
  const decomposer = await module.ConvexMeshDecomposition.create()
  return decomposer.computeConvexHulls(mesh, options)
}

export async function decomposeConvexHulls(
  mesh: VhacdMesh,
  options: VhacdOptions,
  preferWorker = true,
): Promise<ConvexHullMesh[]> {
  if (preferWorker) {
    try {
      return await decomposeConvexHullsInWorker(mesh, options)
    } catch (error) {
      console.warn('[convex-decompose] Worker decomposition failed, falling back to main thread', error)
      return decomposeConvexHullsOnMainThread(
        {
          positions: new Float64Array(mesh.positions),
          indices: new Uint32Array(mesh.indices),
        },
        options,
      )
    }
  }
  return decomposeConvexHullsOnMainThread(mesh, options)
}

function toVhacdOptions(config: RigidbodyConvexDecompositionConfig): VhacdOptions {
  return {
    maxHulls: config.maxHulls,
    voxelResolution: config.voxelResolution,
    maxVerticesPerHull: config.maxVerticesPerHull,
    minVolumePercentError: config.minVolumePercentError,
    maxRecursionDepth: config.maxRecursionDepth,
    shrinkWrap: config.shrinkWrap,
    fillMode: config.fillMode,
    findBestPlane: config.findBestPlane,
  }
}

type MeshCandidate = THREE.Object3D & {
  isMesh?: boolean
  geometry?: THREE.BufferGeometry
  isInstancedMesh?: boolean
  count?: number
  instanceMatrix?: THREE.InstancedBufferAttribute
}

export function extractMergedTriangleMesh(root: THREE.Object3D): ConvexHullMesh | null {
  root.updateMatrixWorld(true)

  let totalVertices = 0
  let totalTriangles = 0
  const meshCandidates: Array<{
    mesh: MeshCandidate
    positionCount: number
    trianglesPerInstance: number
    instanceCount: number
  }> = []

  root.traverse((child) => {
    const candidate = child as MeshCandidate
    if (!candidate.isMesh) {
      return
    }
    const geometry = candidate.geometry
    if (!geometry) {
      return
    }
    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positionAttribute || positionAttribute.count < 3) {
      return
    }
    const isInstanced = candidate.isInstancedMesh === true
    const instanceCount = isInstanced
      ? Math.max(0, Math.trunc(candidate.count ?? 0))
      : 1
    if (!(instanceCount > 0)) {
      return
    }
    const indexAttribute = geometry.getIndex()
    const trianglesPerInstance = indexAttribute && indexAttribute.count >= 3
      ? Math.floor(indexAttribute.count / 3)
      : Math.floor(positionAttribute.count / 3)
    if (!(trianglesPerInstance > 0)) {
      return
    }
    totalVertices += positionAttribute.count * instanceCount
    totalTriangles += trianglesPerInstance * instanceCount
    meshCandidates.push({
      mesh: candidate,
      positionCount: positionAttribute.count,
      trianglesPerInstance,
      instanceCount,
    })
  })

  if (!meshCandidates.length || totalVertices < 4 || totalTriangles < 1) {
    return null
  }

  const positions = new Float64Array(totalVertices * 3)
  const indices = new Uint32Array(totalTriangles * 3)
  const instanceMatrixHelper = new THREE.Matrix4()
  const vertexHelper = new THREE.Vector3()
  let vertexCursor = 0
  let indexCursor = 0

  for (const entry of meshCandidates) {
    const { mesh, positionCount, trianglesPerInstance, instanceCount } = entry
    const geometry = mesh.geometry
    if (!geometry) {
      continue
    }
    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positionAttribute) {
      continue
    }
    const indexAttribute = geometry.getIndex()
    const isInstanced = mesh.isInstancedMesh === true
    const instanceMatrixArray = isInstanced
      ? mesh.instanceMatrix?.array
      : null

    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
      if (isInstanced && instanceMatrixArray) {
        instanceMatrixHelper.fromArray(instanceMatrixArray, instanceIndex * 16)
        instanceMatrixHelper.multiplyMatrices(mesh.matrixWorld, instanceMatrixHelper)
      } else {
        instanceMatrixHelper.copy(mesh.matrixWorld)
      }

      const instanceVertexBase = vertexCursor
      for (let vertexIndex = 0; vertexIndex < positionCount; vertexIndex += 1) {
        vertexHelper.fromBufferAttribute(positionAttribute, vertexIndex)
        vertexHelper.applyMatrix4(instanceMatrixHelper)
        const offset = vertexCursor * 3
        positions[offset] = vertexHelper.x
        positions[offset + 1] = vertexHelper.y
        positions[offset + 2] = vertexHelper.z
        vertexCursor += 1
      }

      if (indexAttribute && indexAttribute.count >= 3) {
        for (let triangle = 0; triangle < trianglesPerInstance; triangle += 1) {
          const base = triangle * 3
          const a = indexAttribute.getX(base)
          const b = indexAttribute.getX(base + 1)
          const c = indexAttribute.getX(base + 2)
          if (a >= positionCount || b >= positionCount || c >= positionCount) {
            continue
          }
          indices[indexCursor] = instanceVertexBase + a
          indices[indexCursor + 1] = instanceVertexBase + b
          indices[indexCursor + 2] = instanceVertexBase + c
          indexCursor += 3
        }
      } else {
        for (let triangle = 0; triangle < trianglesPerInstance; triangle += 1) {
          const base = triangle * 3
          indices[indexCursor] = instanceVertexBase + base
          indices[indexCursor + 1] = instanceVertexBase + base + 1
          indices[indexCursor + 2] = instanceVertexBase + base + 2
          indexCursor += 3
        }
      }
    }
  }

  if (vertexCursor < 4 || indexCursor < 3) {
    return null
  }
  if (vertexCursor !== totalVertices || indexCursor !== indices.length) {
    return {
      positions: positions.slice(0, vertexCursor * 3) as Float64Array,
      indices: indices.slice(0, indexCursor) as Uint32Array,
    }
  }
  return { positions, indices }
}

function composeDecomposeMatrix(
  transform: ConvexDecomposeWorldTransform | null | undefined,
): THREE.Matrix4 {
  if (!transform) {
    return new THREE.Matrix4().identity()
  }
  const position = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z)
  const quaternion = new THREE.Quaternion(
    transform.quaternion.x,
    transform.quaternion.y,
    transform.quaternion.z,
    transform.quaternion.w,
  )
  const scale = new THREE.Vector3(
    Math.max(1e-4, Math.abs(transform.scale.x) || 1),
    Math.max(1e-4, Math.abs(transform.scale.y) || 1),
    Math.max(1e-4, Math.abs(transform.scale.z) || 1),
  )
  return new THREE.Matrix4().compose(position, quaternion, scale)
}

export function transformMeshPositionsToHostLocal(
  mesh: ConvexHullMesh,
  sourceWorldTransform: ConvexDecomposeWorldTransform | null,
  hostWorldTransform: ConvexDecomposeWorldTransform | null,
): ConvexHullMesh {
  const inverseSourceMatrix = new THREE.Matrix4()
  if (sourceWorldTransform) {
    inverseSourceMatrix.copy(composeDecomposeMatrix(sourceWorldTransform)).invert()
  } else {
    inverseSourceMatrix.identity()
  }

  const relativeMatrix = new THREE.Matrix4()
  if (sourceWorldTransform && hostWorldTransform) {
    relativeMatrix
      .copy(composeDecomposeMatrix(hostWorldTransform))
      .invert()
      .multiply(composeDecomposeMatrix(sourceWorldTransform))
  } else {
    relativeMatrix.identity()
  }

  const vectorHelper = new THREE.Vector3()
  const positions = new Float64Array(mesh.positions.length)
  for (let index = 0; index + 2 < mesh.positions.length; index += 3) {
    vectorHelper.set(
      mesh.positions[index] ?? 0,
      mesh.positions[index + 1] ?? 0,
      mesh.positions[index + 2] ?? 0,
    )
    if (sourceWorldTransform) {
      vectorHelper.applyMatrix4(inverseSourceMatrix)
    }
    if (sourceWorldTransform && hostWorldTransform) {
      vectorHelper.applyMatrix4(relativeMatrix)
    }
    positions[index] = vectorHelper.x
    positions[index + 1] = vectorHelper.y
    positions[index + 2] = vectorHelper.z
  }
  return {
    positions,
    indices: mesh.indices,
  }
}

function quantizeAndDeduplicateHullVertices(
  positions: ArrayLike<number>,
  indices: Uint32Array,
  options: { decimalPrecision: number; vertexMergeTolerance: number },
): { vertices: ArrayLike<number>; indices: Uint32Array; uniqueCount: number } | null {
  const vertexCount = positions.length / 3
  const tolerance = Math.max(0, options.vertexMergeTolerance)
  const scale = Math.max(1, 1 / Math.max(1e-9, tolerance))
  const dedupeKey = (x: number, y: number, z: number) => {
    const qx = Math.round(x * scale)
    const qy = Math.round(y * scale)
    const qz = Math.round(z * scale)
    return `${qx}|${qy}|${qz}`
  }
  const uniqueVertices: number[] = []
  const vertexMap = new Map<string, number>()
  const remapped: number[] = []

  for (let index = 0; index < indices.length; index += 1) {
    const sourceIndex = indices[index]
    if (sourceIndex === undefined || sourceIndex >= vertexCount) {
      return null
    }
    const offset = sourceIndex * 3
    const x = quantizeConvexMeshValue(positions[offset] ?? 0, options.decimalPrecision)
    const y = quantizeConvexMeshValue(positions[offset + 1] ?? 0, options.decimalPrecision)
    const z = quantizeConvexMeshValue(positions[offset + 2] ?? 0, options.decimalPrecision)
    const key = dedupeKey(x, y, z)
    let targetIndex = vertexMap.get(key)
    if (targetIndex === undefined) {
      targetIndex = uniqueVertices.length / 3
      vertexMap.set(key, targetIndex)
      uniqueVertices.push(x, y, z)
    }
    remapped.push(targetIndex)
  }

  const uniqueCount = uniqueVertices.length / 3
  if (uniqueCount < 4) {
    return null
  }
  return {
    vertices: uniqueVertices,
    indices: new Uint32Array(remapped),
    uniqueCount,
  }
}

function hullCentroid(positions: ArrayLike<number>): { x: number; y: number; z: number } {
  const count = Math.floor(positions.length / 3)
  if (count <= 0) {
    return { x: 0, y: 0, z: 0 }
  }
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < count; index += 1) {
    x += positions[index * 3] ?? 0
    y += positions[index * 3 + 1] ?? 0
    z += positions[index * 3 + 2] ?? 0
  }
  return {
    x: x / count,
    y: y / count,
    z: z / count,
  }
}

export function convexHullsToRigidbodyParts(
  hulls: readonly ConvexHullMesh[],
  config: RigidbodyConvexDecompositionConfig,
): RigidbodyConvexMeshPart[] {
  const maxHulls = Math.max(1, Math.trunc(config.maxHulls))
  const parts: RigidbodyConvexMeshPart[] = []
  for (const hull of hulls.slice(0, maxHulls)) {
    if (hull.positions.length < 12 || hull.indices.length < 3) {
      continue
    }
    const deduplicated = quantizeAndDeduplicateHullVertices(
      hull.positions,
      hull.indices,
      {
        decimalPrecision: DEFAULT_CONVEX_MESH_DECIMAL_PRECISION,
        vertexMergeTolerance: DEFAULT_CONVEX_MESH_MERGE_TOLERANCE,
      },
    )
    if (!deduplicated) {
      continue
    }
    const center = hullCentroid(deduplicated.vertices)
    const vertices: RigidbodyVector3Tuple[] = []
    for (let index = 0; index < deduplicated.uniqueCount; index += 1) {
      vertices.push([
        quantizeConvexMeshValue((deduplicated.vertices[index * 3] ?? 0) - center.x, DEFAULT_CONVEX_MESH_DECIMAL_PRECISION),
        quantizeConvexMeshValue((deduplicated.vertices[index * 3 + 1] ?? 0) - center.y, DEFAULT_CONVEX_MESH_DECIMAL_PRECISION),
        quantizeConvexMeshValue((deduplicated.vertices[index * 3 + 2] ?? 0) - center.z, DEFAULT_CONVEX_MESH_DECIMAL_PRECISION),
      ])
    }
    const faces: number[][] = []
    const normalizedIndices = deduplicated.indices
    for (let index = 0; index + 2 < normalizedIndices.length; index += 3) {
      const a = normalizedIndices[index]
      const b = normalizedIndices[index + 1]
      const c = normalizedIndices[index + 2]
      if (a === undefined || b === undefined || c === undefined || a === b || b === c || a === c) {
        continue
      }
      faces.push([a, b, c])
    }
    if (faces.length < 4) {
      continue
    }
    parts.push({
      vertices,
      faces,
      offset: [center.x, center.y, center.z],
      rotation: [0, 0, 0],
    })
  }
  return parts
}

export async function buildConvexMeshShapeFromObject(
  object: THREE.Object3D,
  config: RigidbodyConvexDecompositionConfig,
  sourceWorldTransform: ConvexDecomposeWorldTransform | null,
  hostWorldTransform: ConvexDecomposeWorldTransform | null,
): Promise<{ shape: Extract<RigidbodyPhysicsShape, { kind: 'convex-mesh' }>; config: RigidbodyConvexDecompositionConfig } | null> {
  const merged = extractMergedTriangleMesh(object)
  if (!merged) {
    return null
  }
  const localMesh = transformMeshPositionsToHostLocal(
    merged,
    sourceWorldTransform,
    hostWorldTransform,
  )
  let hulls: ConvexHullMesh[] = []
  try {
    hulls = await decomposeConvexHulls(
      {
        positions: localMesh.positions,
        indices: localMesh.indices,
      },
      toVhacdOptions(config),
    )
  } catch (error) {
    console.warn('[convex-decompose] V-HACD decomposition failed, using fallback collider', error)
    return null
  }
  const parts = convexHullsToRigidbodyParts(hulls, config)
  if (!parts.length) {
    return null
  }
  return {
    shape: {
      kind: 'convex-mesh',
      parts,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      applyScale: true,
    },
    config: {
      ...config,
      usedHulls: parts.length,
    },
  }
}
