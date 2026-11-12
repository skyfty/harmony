import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneOutlineMesh } from '@schema/core'

const DEFAULT_OUTLINE_COLOR = '#808080'
const OUTLINE_MAX_POINTS = 2048
const OUTLINE_MIN_POINTS = 32
const OUTLINE_PER_MESH_SAMPLE = 256
const OUTLINE_POINT_TARGET = 220
const OUTLINE_DECIMAL_PRECISION = 3
const OUTLINE_QUANTIZE_FACTOR = 10 ** OUTLINE_DECIMAL_PRECISION
const OUTLINE_VERTEX_MERGE_TOLERANCE = 1e-3

export type OutlineMeshOptions = {
  color?: string
  maxPoints?: number
  minPoints?: number
  perMeshSample?: number
  pointTarget?: number
  vertexMergeTolerance?: number
  decimalPrecision?: number
  quantizeFactor?: number
}

export function buildOutlineMeshFromObject(
  object: THREE.Object3D,
  options?: OutlineMeshOptions,
): SceneOutlineMesh | null {
  const color = options?.color ?? DEFAULT_OUTLINE_COLOR
  const maxPoints = options?.maxPoints ?? OUTLINE_MAX_POINTS
  const minPoints = options?.minPoints ?? OUTLINE_MIN_POINTS
  const perMeshSample = options?.perMeshSample ?? OUTLINE_PER_MESH_SAMPLE
  const pointTarget = options?.pointTarget ?? OUTLINE_POINT_TARGET
  const decimalPrecision = options?.decimalPrecision ?? OUTLINE_DECIMAL_PRECISION
  const quantizeFactor = options?.quantizeFactor ?? 10 ** decimalPrecision
  const vertexMergeTolerance = options?.vertexMergeTolerance ?? OUTLINE_VERTEX_MERGE_TOLERANCE

  object.updateMatrixWorld(true)
  const points = collectOutlinePoints(object, maxPoints, perMeshSample)
  const reducedPoints = reduceOutlinePointDensity(points, pointTarget)
  const basePoints = reducedPoints.length >= minPoints ? reducedPoints : points
  const quantizedPoints = quantizeAndDeduplicatePoints(basePoints, quantizeFactor)
  const workingPoints = quantizedPoints.length >= minPoints
    ? quantizedPoints
    : basePoints.map((point) => point.clone())
  if (workingPoints.length < 4) {
    return null
  }

  let geometry: THREE.BufferGeometry | null = null
  try {
    const convexGeometry = new ConvexGeometry(workingPoints)
    geometry = mergeVertices(convexGeometry, vertexMergeTolerance)
    convexGeometry.dispose()
  } catch (error) {
    console.warn('Failed to build convex outline geometry', error)
    return null
  }

  if (!geometry) {
    return null
  }

  geometry.computeVertexNormals()
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positionAttr) {
    geometry.dispose()
    return null
  }

  const positions = Array.from(
    positionAttr.array as ArrayLike<number>,
    (value) => quantizeOutlineValue(value, quantizeFactor),
  )
  const indices = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : []
  const sourceBounds = new THREE.Box3().setFromObject(object)
  const sourceSphere = sourceBounds.isEmpty()
    ? null
    : sourceBounds.getBoundingSphere(new THREE.Sphere())
  geometry.computeBoundingSphere()
  const resolvedSphere = sourceSphere ?? geometry.boundingSphere
  const boundingSphere = resolvedSphere
    ? {
        center: {
          x: quantizeOutlineValue(resolvedSphere.center.x, quantizeFactor),
          y: quantizeOutlineValue(resolvedSphere.center.y, quantizeFactor),
          z: quantizeOutlineValue(resolvedSphere.center.z, quantizeFactor),
        },
        radius: quantizeOutlineValue(resolvedSphere.radius, quantizeFactor),
      }
    : null
  const vertexCount = positionAttr.count
  const triangleCount = indices.length >= 3 ? Math.floor(indices.length / 3) : Math.max(0, vertexCount - 2)
  geometry.dispose()

  return {
    positions,
    indices,
    color,
    boundingSphere,
    vertexCount,
    triangleCount,
  }
}

export function collectOutlinePoints(
  root: THREE.Object3D,
  maxPoints: number,
  perMeshSample: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const scratch = new THREE.Vector3()
  const sources: Array<{
    position: THREE.BufferAttribute
    matrixWorld: THREE.Matrix4
  }> = []
  root.traverse((child) => {
    const mesh = child as THREE.Object3D & { geometry?: THREE.BufferGeometry }
    const meta = mesh as unknown as { isMesh?: boolean; isSkinnedMesh?: boolean; isPoints?: boolean; isLine?: boolean }
    const isMesh = Boolean(meta.isMesh || meta.isSkinnedMesh)
    const isPoints = Boolean(meta.isPoints)
    const isLine = Boolean(meta.isLine)
    if (!isMesh && !isPoints && !isLine) {
      return
    }
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry) {
      return
    }
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positionAttr) {
      return
    }
    sources.push({
      position: positionAttr,
      matrixWorld: mesh.matrixWorld.clone(),
    })
  })

  if (!sources.length || maxPoints <= 0) {
    return points
  }

  // Sample across the whole model instead of exhausting the point budget on
  // the first few meshes. Large imported terrains commonly contain hundreds of
  // spatially separated patches; stopping at the first mesh makes their lazy
  // placeholder bounding sphere reject the actual camera position.
  const meshCount = sources.length
  const selectedSources = meshCount > maxPoints
    ? Array.from({ length: maxPoints }, (_, index) => (
        sources[Math.min(meshCount - 1, Math.floor((index * meshCount) / maxPoints))]
      ))
    : sources
  const samplesPerMesh = Math.max(
    1,
    Math.min(perMeshSample, Math.ceil(maxPoints / selectedSources.length)),
  )
  for (let round = 0; round < samplesPerMesh && points.length < maxPoints; round += 1) {
    for (let sourceIndex = 0; sourceIndex < selectedSources.length && points.length < maxPoints; sourceIndex += 1) {
      const source = selectedSources[sourceIndex]
      if (!source) {
        continue
      }
      const count = source.position.count
      if (count <= 0) {
        continue
      }
      const sampleIndex = samplesPerMesh === 1
        ? Math.floor(count / 2)
        : Math.min(count - 1, Math.round((round * (count - 1)) / (samplesPerMesh - 1)))
      scratch.fromBufferAttribute(source.position, sampleIndex)
      scratch.applyMatrix4(source.matrixWorld)
      points.push(scratch.clone())
    }
  }
  return points
}

export function reduceOutlinePointDensity(points: THREE.Vector3[], maxPoints: number): THREE.Vector3[] {
  if (!Number.isFinite(maxPoints) || maxPoints <= 0 || points.length <= maxPoints) {
    return points.map((point) => point.clone())
  }

  const box = new THREE.Box3().setFromPoints(points)
  if (box.isEmpty()) {
    return points.slice(0, maxPoints).map((point) => point.clone())
  }

  const size = box.getSize(new THREE.Vector3())
  const min = box.min
  const resolution = Math.max(1, Math.ceil(Math.cbrt(maxPoints)))
  const cellSize = new THREE.Vector3(
    size.x > 1e-6 ? size.x / resolution : 1,
    size.y > 1e-6 ? size.y / resolution : 1,
    size.z > 1e-6 ? size.z / resolution : 1,
  )

  const selected: THREE.Vector3[] = []
  const occupied = new Set<string>()
  const fallback: THREE.Vector3[] = []

  const quantize = (value: number, cellLength: number, minValue: number) => {
    if (cellLength <= 0) {
      return 0
    }
    const index = Math.floor((value - minValue) / cellLength)
    return Number.isFinite(index) ? index : 0
  }

  for (const point of points) {
    const qx = quantize(point.x, cellSize.x, min.x)
    const qy = quantize(point.y, cellSize.y, min.y)
    const qz = quantize(point.z, cellSize.z, min.z)
    const key = `${qx}|${qy}|${qz}`
    if (!occupied.has(key)) {
      occupied.add(key)
      selected.push(point.clone())
      if (selected.length >= maxPoints) {
        return selected
      }
    } else {
      fallback.push(point)
    }
  }

  for (const point of fallback) {
    if (selected.length >= maxPoints) {
      break
    }
    selected.push(point.clone())
  }

  return selected
}

export function ensureMinimumPointCoverage(
  points: THREE.Vector3[],
  root: THREE.Object3D,
  minPoints: number,
  maxPoints: number,
): void {
  void points
  void root
  void minPoints
  void maxPoints
}

export function buildBoundingBoxCorners(box: THREE.Box3): THREE.Vector3[] {
  const { min, max } = box
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ]
}

export function quantizeOutlineValue(value: number, quantizeFactor: number): number {
  const scaled = Math.round(value * quantizeFactor) / quantizeFactor
  return Object.is(scaled, -0) ? 0 : scaled
}

export function quantizeAndDeduplicatePoints(points: THREE.Vector3[], quantizeFactor: number): THREE.Vector3[] {
  const unique = new Map<string, THREE.Vector3>()
  for (const point of points) {
    const quantized = point.clone()
    quantized.set(
      quantizeOutlineValue(quantized.x, quantizeFactor),
      quantizeOutlineValue(quantized.y, quantizeFactor),
      quantizeOutlineValue(quantized.z, quantizeFactor),
    )
    const key = `${quantized.x}|${quantized.y}|${quantized.z}`
    if (!unique.has(key)) {
      unique.set(key, quantized)
    }
  }
  return Array.from(unique.values())
}

export const outlineMeshConstants = {
  DEFAULT_OUTLINE_COLOR,
  OUTLINE_MAX_POINTS,
  OUTLINE_MIN_POINTS,
  OUTLINE_PER_MESH_SAMPLE,
  OUTLINE_POINT_TARGET,
  OUTLINE_DECIMAL_PRECISION,
  OUTLINE_QUANTIZE_FACTOR,
  OUTLINE_VERTEX_MERGE_TOLERANCE,
}
