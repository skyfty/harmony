import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { FloorDynamicMesh, LandformDynamicMesh, SceneNode, Vector3Like, WallDynamicMesh } from './index'
import { extractWaterSurfaceMeshMetadataFromUserData } from './index'
import { extractFloorPerimeterChains } from './floorMesh'
import { extractRoadBoundaryChains } from './roadMesh'
import { compileWallSegmentsFromDefinition } from './wallLayout'
import type { BoundaryWallComponentProps } from './components'

export type BoundaryWallShapeSegment = {
  shape: CANNON.Box
  offset: [number, number, number]
  orientation: [number, number, number, number]
}

type BoundaryChain = {
  points: Vector3Like[]
  closed: boolean
}

const BOUNDARY_EPSILON = 1e-4

const boxBoundsHelper = new THREE.Box3()
const transformedBoundsHelper = new THREE.Box3()
const matrixHelper = new THREE.Matrix4()
const inverseRootMatrixHelper = new THREE.Matrix4()
const quaternionHelper = new THREE.Quaternion()
const startHelper = new THREE.Vector3()
const endHelper = new THREE.Vector3()
const directionHelper = new THREE.Vector3()
const unitDirectionHelper = new THREE.Vector3()
const axisXHelper = new THREE.Vector3(1, 0, 0)
const outwardHelper = new THREE.Vector3()
const pointHelper = new THREE.Vector3()
const aabbCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]

function sanitizeChainPoints(points: Vector3Like[], closed: boolean): Vector3Like[] {
  const sanitized: Vector3Like[] = []
  for (const point of points) {
    const x = Number(point.x)
    const y = Number(point.y)
    const z = Number(point.z)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue
    }
    const previous = sanitized[sanitized.length - 1]
    if (previous) {
      const dx = x - previous.x
      const dz = z - previous.z
      if (dx * dx + dz * dz <= BOUNDARY_EPSILON * BOUNDARY_EPSILON) {
        continue
      }
    }
    sanitized.push({ x, y, z })
  }
  if (closed && sanitized.length >= 3) {
    const first = sanitized[0]!
    const last = sanitized[sanitized.length - 1]!
    const dx = first.x - last.x
    const dz = first.z - last.z
    if (dx * dx + dz * dz <= BOUNDARY_EPSILON * BOUNDARY_EPSILON) {
      sanitized.pop()
    }
  }
  return sanitized
}

function computeChainAreaXZ(points: Vector3Like[]): number {
  if (points.length < 3) {
    return 0
  }
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.z - next.x * current.z
  }
  return area * 0.5
}

function computeRootLocalBounds(root: THREE.Object3D | null | undefined): THREE.Box3 | null {
  if (!root) {
    return null
  }
  root.updateMatrixWorld(true)
  inverseRootMatrixHelper.copy(root.matrixWorld).invert()
  transformedBoundsHelper.makeEmpty()
  let hasBounds = false
  root.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!geometry) {
      return
    }
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
      return
    }
    matrixHelper.multiplyMatrices(inverseRootMatrixHelper, child.matrixWorld)
    boxBoundsHelper.copy(geometry.boundingBox)
    const { min, max } = boxBoundsHelper
    aabbCorners[0]!.set(min.x, min.y, min.z)
    aabbCorners[1]!.set(min.x, min.y, max.z)
    aabbCorners[2]!.set(min.x, max.y, min.z)
    aabbCorners[3]!.set(min.x, max.y, max.z)
    aabbCorners[4]!.set(max.x, min.y, min.z)
    aabbCorners[5]!.set(max.x, min.y, max.z)
    aabbCorners[6]!.set(max.x, max.y, min.z)
    aabbCorners[7]!.set(max.x, max.y, max.z)
    aabbCorners.forEach((corner) => {
      pointHelper.copy(corner).applyMatrix4(matrixHelper)
      transformedBoundsHelper.expandByPoint(pointHelper)
    })
    hasBounds = true
  })
  return hasBounds && !transformedBoundsHelper.isEmpty() ? transformedBoundsHelper.clone() : null
}

function computeFallbackBaseY(chains: BoundaryChain[]): number {
  let minY = Number.POSITIVE_INFINITY
  chains.forEach((chain) => {
    chain.points.forEach((point) => {
      if (Number.isFinite(point.y)) {
        minY = Math.min(minY, point.y)
      }
    })
  })
  return Number.isFinite(minY) ? minY : 0
}

function extractLandformChains(definition: LandformDynamicMesh): BoundaryChain[] {
  const points = Array.isArray(definition.footprint)
    ? definition.footprint
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) {
          return null
        }
        const x = Number(entry[0])
        const z = Number(entry[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          return null
        }
        return { x, y: 0, z }
      })
      .filter((point): point is Vector3Like => Boolean(point))
    : []
  const sanitized = sanitizeChainPoints(points, true)
  return sanitized.length >= 3 ? [{ points: sanitized, closed: true }] : []
}

function extractWaterChains(node: SceneNode): BoundaryChain[] {
  const metadata = extractWaterSurfaceMeshMetadataFromUserData(node.userData)
  if (!metadata) {
    return []
  }
  const points: Vector3Like[] = []
  for (let index = 0; index < metadata.contour.length; index += 2) {
    const x = Number(metadata.contour[index])
    const z = Number(metadata.contour[index + 1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    points.push({ x, y: 0, z })
  }
  const sanitized = sanitizeChainPoints(points, true)
  return sanitized.length >= 3 ? [{ points: sanitized, closed: true }] : []
}

function extractBoundaryChains(node: SceneNode): BoundaryChain[] {
  const dynamicMesh = node.dynamicMesh
  if (dynamicMesh?.type === 'Wall') {
    const segments = compileWallSegmentsFromDefinition(dynamicMesh as WallDynamicMesh)
    return segments.map((segment) => ({
      points: [
        { x: segment.start.x, y: segment.start.y, z: segment.start.z },
        { x: segment.end.x, y: segment.end.y, z: segment.end.z },
      ],
      closed: false,
    }))
  }
  if (dynamicMesh?.type === 'Floor') {
    return extractFloorPerimeterChains(dynamicMesh as FloorDynamicMesh).map((chain) => ({
      points: chain.points,
      closed: chain.closed,
    }))
  }
  if (dynamicMesh?.type === 'Landform') {
    return extractLandformChains(dynamicMesh as LandformDynamicMesh)
  }
  if (dynamicMesh?.type === 'Road') {
    return extractRoadBoundaryChains(dynamicMesh).map((chain) => ({
      points: chain.points,
      closed: chain.closed,
    }))
  }
  return extractWaterChains(node)
}

export function buildBoundaryWallSegments(params: {
  node: SceneNode
  object: THREE.Object3D | null
  props: BoundaryWallComponentProps
}): BoundaryWallShapeSegment[] {
  const { node, object, props } = params
  const chains = extractBoundaryChains(node)
    .map((chain) => ({
      points: sanitizeChainPoints(chain.points, chain.closed),
      closed: chain.closed,
    }))
    .filter((chain) => chain.points.length >= (chain.closed ? 3 : 2))
  if (!chains.length) {
    return []
  }

  const bounds = computeRootLocalBounds(object)
  const baseY = bounds?.min.y ?? computeFallbackBaseY(chains)
  const halfHeight = Math.max(BOUNDARY_EPSILON, props.height * 0.5)
  const halfThickness = Math.max(BOUNDARY_EPSILON, props.thickness * 0.5)
  const segments: BoundaryWallShapeSegment[] = []

  chains.forEach((chain) => {
    const area = chain.closed ? computeChainAreaXZ(chain.points) : 0
    const count = chain.closed ? chain.points.length : chain.points.length - 1
    for (let index = 0; index < count; index += 1) {
      const start = chain.points[index]!
      const end = chain.points[(index + 1) % chain.points.length]!
      startHelper.set(start.x, baseY, start.z)
      endHelper.set(end.x, baseY, end.z)
      directionHelper.subVectors(endHelper, startHelper)
      directionHelper.y = 0
      const length = directionHelper.length()
      if (!Number.isFinite(length) || length <= BOUNDARY_EPSILON) {
        continue
      }
      unitDirectionHelper.copy(directionHelper).multiplyScalar(1 / length)
      if (chain.closed) {
        if (area >= 0) {
          outwardHelper.set(unitDirectionHelper.z, 0, -unitDirectionHelper.x)
        } else {
          outwardHelper.set(-unitDirectionHelper.z, 0, unitDirectionHelper.x)
        }
      } else {
        outwardHelper.set(unitDirectionHelper.z, 0, -unitDirectionHelper.x)
      }
      const shiftX = outwardHelper.x * props.offset
      const shiftZ = outwardHelper.z * props.offset
      const centerX = (startHelper.x + endHelper.x) * 0.5 + shiftX
      const centerZ = (startHelper.z + endHelper.z) * 0.5 + shiftZ
      const centerY = baseY + halfHeight
      quaternionHelper.setFromUnitVectors(axisXHelper, unitDirectionHelper)
      segments.push({
        shape: new CANNON.Box(new CANNON.Vec3(Math.max(BOUNDARY_EPSILON, length * 0.5), halfHeight, halfThickness)),
        offset: [centerX, centerY, centerZ],
        orientation: [quaternionHelper.x, quaternionHelper.y, quaternionHelper.z, quaternionHelper.w],
      })
    }
  })

  return segments
}