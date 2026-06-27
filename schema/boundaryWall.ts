import * as THREE from 'three'
import type { FloorDynamicMesh, LandformDynamicMesh, RegionDynamicMesh, SceneNode, Vector3Like, WallDynamicMesh } from './core'
import { extractWaterSurfaceMeshMetadataFromUserData } from './core'
import { WATER_COMPONENT_TYPE } from './components'
import {
  findBoundaryWallReferenceNodeById,
  isBoundaryWallReferenceSourceNode,
} from './boundaryWallReference'
import { extractFloorPerimeterChains } from './floorMesh'
import { extractRoadBoundaryChains } from './roadMesh'
import { compileWallSegmentsFromDefinition } from './wallLayout'
import type { BoundaryWallComponentProps, BoundaryWallCustomLoop } from './components'

export type BoundaryWallShapeSegment = {
  halfExtents: [number, number, number]
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
const localMatrixHelper = new THREE.Matrix4()
const relativeMatrixHelper = new THREE.Matrix4()
const quaternionHelper = new THREE.Quaternion()
const relativeQuaternionHelper = new THREE.Quaternion()
const segmentQuaternionHelper = new THREE.Quaternion()
const relativeScaleHelper = new THREE.Vector3()
const localPositionHelper = new THREE.Vector3()
const localRotationHelper = new THREE.Euler()
const localScaleHelper = new THREE.Vector3()
const startHelper = new THREE.Vector3()
const endHelper = new THREE.Vector3()
const directionHelper = new THREE.Vector3()
const unitDirectionHelper = new THREE.Vector3()
const axisXHelper = new THREE.Vector3(1, 0, 0)
const outwardHelper = new THREE.Vector3()
const pointHelper = new THREE.Vector3()
const transformedSegmentCenterHelper = new THREE.Vector3()
const transformedSegmentScaleHelper = new THREE.Vector3()
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

function composeSceneNodeLocalMatrix(node: SceneNode, target = localMatrixHelper): THREE.Matrix4 {
  const position = node.position
  const rotation = node.rotation
  const scale = node.scale
  localPositionHelper.set(
    Number.isFinite(position?.x) ? position.x : 0,
    Number.isFinite(position?.y) ? position.y : 0,
    Number.isFinite(position?.z) ? position.z : 0,
  )
  localRotationHelper.set(
    Number.isFinite(rotation?.x) ? rotation.x : 0,
    Number.isFinite(rotation?.y) ? rotation.y : 0,
    Number.isFinite(rotation?.z) ? rotation.z : 0,
    'XYZ',
  )
  localScaleHelper.set(
    Number.isFinite(scale?.x) ? scale.x : 1,
    Number.isFinite(scale?.y) ? scale.y : 1,
    Number.isFinite(scale?.z) ? scale.z : 1,
  )
  return target.compose(localPositionHelper, new THREE.Quaternion().setFromEuler(localRotationHelper), localScaleHelper)
}

function findSceneNodePath(root: SceneNode | null | undefined, targetId: string): SceneNode[] | null {
  if (!root) {
    return null
  }
  if (root.id === targetId) {
    return [root]
  }
  for (const child of root.children ?? []) {
    const childPath = findSceneNodePath(child, targetId)
    if (childPath) {
      return [root, ...childPath]
    }
  }
  return null
}

function computeReferenceToMountMatrix(mountNode: SceneNode, referenceNode: SceneNode): THREE.Matrix4 | null {
  if (mountNode.id === referenceNode.id) {
    return relativeMatrixHelper.identity()
  }
  const path = findSceneNodePath(mountNode, referenceNode.id)
  if (!path || path.length < 2) {
    return null
  }
  relativeMatrixHelper.identity()
  for (let index = 1; index < path.length; index += 1) {
    const entry = path[index]
    if (!entry) {
      continue
    }
    relativeMatrixHelper.multiply(composeSceneNodeLocalMatrix(entry))
  }
  return relativeMatrixHelper
}

function transformBoundaryWallSegment(
  segment: BoundaryWallShapeSegment,
  referenceToMountMatrix: THREE.Matrix4,
): BoundaryWallShapeSegment {
  referenceToMountMatrix.decompose(transformedSegmentCenterHelper, relativeQuaternionHelper, relativeScaleHelper)
  pointHelper.set(segment.offset[0], segment.offset[1], segment.offset[2]).applyMatrix4(referenceToMountMatrix)
  segmentQuaternionHelper.set(
    segment.orientation[0],
    segment.orientation[1],
    segment.orientation[2],
    segment.orientation[3],
  )
  segmentQuaternionHelper.premultiply(relativeQuaternionHelper).normalize()
  transformedSegmentScaleHelper.set(
    Math.max(BOUNDARY_EPSILON, Math.abs(relativeScaleHelper.x) * segment.halfExtents[0]),
    Math.max(BOUNDARY_EPSILON, Math.abs(relativeScaleHelper.y) * segment.halfExtents[1]),
    Math.max(BOUNDARY_EPSILON, Math.abs(relativeScaleHelper.z) * segment.halfExtents[2]),
  )
  return {
    halfExtents: [
      transformedSegmentScaleHelper.x,
      transformedSegmentScaleHelper.y,
      transformedSegmentScaleHelper.z,
    ],
    offset: [pointHelper.x, pointHelper.y, pointHelper.z],
    orientation: [
      segmentQuaternionHelper.x,
      segmentQuaternionHelper.y,
      segmentQuaternionHelper.z,
      segmentQuaternionHelper.w,
    ],
  }
}

function computeChainAreaXY(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) {
    return 0
  }
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.y - next.x * current.y
  }
  return area * 0.5
}

function sanitizeWaterContourPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const sanitized: Array<{ x: number; y: number }> = []
  for (const point of points) {
    const x = Number(point.x)
    const y = Number(point.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    const previous = sanitized[sanitized.length - 1]
    if (previous) {
      const dx = x - previous.x
      const dy = y - previous.y
      if (dx * dx + dy * dy <= BOUNDARY_EPSILON * BOUNDARY_EPSILON) {
        continue
      }
    }
    sanitized.push({ x, y })
  }
  if (sanitized.length >= 3) {
    const first = sanitized[0]!
    const last = sanitized[sanitized.length - 1]!
    const dx = first.x - last.x
    const dy = first.y - last.y
    if (dx * dx + dy * dy <= BOUNDARY_EPSILON * BOUNDARY_EPSILON) {
      sanitized.pop()
    }
  }
  return sanitized
}

function isWaterBoundaryWallNode(node: SceneNode, object: THREE.Object3D | null | undefined): boolean {
  return Boolean(
    node.components?.[WATER_COMPONENT_TYPE]
    || extractWaterSurfaceMeshMetadataFromUserData(node.userData)
    || findWaterSurfaceMetadataFromObject(object),
  )
}

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

function buildPlanarBoundaryWallSegments(params: {
  chains: BoundaryChain[]
  props: BoundaryWallComponentProps
  baseY: number
}): BoundaryWallShapeSegment[] {
  const { chains, props, baseY } = params
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
        halfExtents: [Math.max(BOUNDARY_EPSILON, length * 0.5), halfHeight, halfThickness],
        offset: [centerX, centerY, centerZ],
        orientation: [quaternionHelper.x, quaternionHelper.y, quaternionHelper.z, quaternionHelper.w],
      })
    }
  })

  return segments
}

function extractCustomBoundaryChains(loops: BoundaryWallCustomLoop[]): BoundaryChain[] {
  return loops
    .map((loop) => ({
      points: sanitizeChainPoints(
        loop.points.map((point) => ({ x: point.x, y: 0, z: point.z })),
        loop.closed,
      ),
      closed: loop.closed,
    }))
    .filter((chain) => chain.points.length >= (chain.closed ? 3 : 2))
}

function extractLandformChains(definition: LandformDynamicMesh): BoundaryChain[] {
  const points = Array.isArray(definition.vertices)
    ? definition.vertices
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

function findWaterSurfaceMetadataFromObject(root: THREE.Object3D | null | undefined) {
  if (!root) {
    return null
  }
  const fromRoot = extractWaterSurfaceMeshMetadataFromUserData((root as { userData?: unknown }).userData)
  if (fromRoot) {
    return fromRoot
  }
  let found: ReturnType<typeof extractWaterSurfaceMeshMetadataFromUserData> = null
  root.traverse((child) => {
    if (found) {
      return
    }
    const metadata = extractWaterSurfaceMeshMetadataFromUserData((child as { userData?: unknown }).userData)
    if (metadata) {
      found = metadata
    }
  })
  return found
}

function extractWaterChains(node: SceneNode, object: THREE.Object3D | null | undefined): BoundaryChain[] {
  const metadata = extractWaterSurfaceMeshMetadataFromUserData(node.userData)
    ?? findWaterSurfaceMetadataFromObject(object)
  if (!metadata) {
    return []
  }
  const points: Vector3Like[] = []
  for (let index = 0; index < metadata.contour.length; index += 2) {
    const x = Number(metadata.contour[index])
    const localContourY = Number(metadata.contour[index + 1])
    if (!Number.isFinite(x) || !Number.isFinite(localContourY)) {
      continue
    }
    points.push({ x, y: localContourY, z: 0 })
  }
  const sanitized = sanitizeChainPoints(points, true)
  return sanitized.length >= 3 ? [{ points: sanitized, closed: true }] : []
}

function buildWaterBoundaryWallSegments(
  node: SceneNode,
  object: THREE.Object3D | null | undefined,
  props: BoundaryWallComponentProps,
): BoundaryWallShapeSegment[] {
  const metadata = extractWaterSurfaceMeshMetadataFromUserData(node.userData)
    ?? findWaterSurfaceMetadataFromObject(object)
  if (!metadata) {
    return []
  }
  const contourPoints = sanitizeWaterContourPoints(
    Array.from({ length: Math.floor(metadata.contour.length / 2) }, (_unused, index) => ({
      x: Number(metadata.contour[index * 2]),
      y: Number(metadata.contour[index * 2 + 1]),
    })),
  )
  if (contourPoints.length < 3) {
    return []
  }
  const bounds = computeRootLocalBounds(object)
  const baseZ = bounds?.min.z ?? 0
  const halfHeight = Math.max(BOUNDARY_EPSILON, props.height * 0.5)
  const halfThickness = Math.max(BOUNDARY_EPSILON, props.thickness * 0.5)
  const area = computeChainAreaXY(contourPoints)
  const segments: BoundaryWallShapeSegment[] = []
  for (let index = 0; index < contourPoints.length; index += 1) {
    const start = contourPoints[index]!
    const end = contourPoints[(index + 1) % contourPoints.length]!
    startHelper.set(start.x, start.y, baseZ)
    endHelper.set(end.x, end.y, baseZ)
    directionHelper.subVectors(endHelper, startHelper)
    directionHelper.z = 0
    const length = directionHelper.length()
    if (!Number.isFinite(length) || length <= BOUNDARY_EPSILON) {
      continue
    }
    unitDirectionHelper.copy(directionHelper).multiplyScalar(1 / length)
    if (area >= 0) {
      outwardHelper.set(unitDirectionHelper.y, -unitDirectionHelper.x, 0)
    } else {
      outwardHelper.set(-unitDirectionHelper.y, unitDirectionHelper.x, 0)
    }
    const shiftX = outwardHelper.x * props.offset
    const shiftY = outwardHelper.y * props.offset
    const centerX = (startHelper.x + endHelper.x) * 0.5 + shiftX
    const centerY = (startHelper.y + endHelper.y) * 0.5 + shiftY
    const centerZ = baseZ + halfHeight
    quaternionHelper.setFromUnitVectors(axisXHelper, unitDirectionHelper)
    segments.push({
      halfExtents: [Math.max(BOUNDARY_EPSILON, length * 0.5), halfThickness, halfHeight],
      offset: [centerX, centerY, centerZ],
      orientation: [quaternionHelper.x, quaternionHelper.y, quaternionHelper.z, quaternionHelper.w],
    })
  }
  return segments
}

function extractRegionChains(definition: RegionDynamicMesh): BoundaryChain[] {
  const points = Array.isArray(definition.vertices)
    ? definition.vertices
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

function extractBoundaryChains(node: SceneNode, object: THREE.Object3D | null | undefined): BoundaryChain[] {
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
  if (dynamicMesh?.type === 'Region') {
    return extractRegionChains(dynamicMesh as RegionDynamicMesh)
  }
  return extractWaterChains(node, object)
}

function extractBoundaryWallSegmentsForNode(
  node: SceneNode,
  object: THREE.Object3D | null | undefined,
  props: BoundaryWallComponentProps,
): BoundaryWallShapeSegment[] {
  if (props.mode === 'custom') {
    return []
  }
  if (isWaterBoundaryWallNode(node, object)) {
    return buildWaterBoundaryWallSegments(node, object, props)
  }
  const chains = extractBoundaryChains(node, object)
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
  return buildPlanarBoundaryWallSegments({ chains, props, baseY })
}

export function buildBoundaryWallSegments(params: {
  node: SceneNode
  object: THREE.Object3D | null
  props: BoundaryWallComponentProps
}): BoundaryWallShapeSegment[] {
  const { node, object, props } = params
  if (props.mode === 'custom') {
    const chains = extractCustomBoundaryChains(props.customLoops)
    if (!chains.length) {
      return []
    }
    const bounds = computeRootLocalBounds(object)
    const baseY = bounds?.min.y ?? 0
    return buildPlanarBoundaryWallSegments({ chains, props, baseY })
  }
  const referenceNode = props.boundaryReferenceNodeId
    ? findBoundaryWallReferenceNodeById(node, props.boundaryReferenceNodeId)
    : node
  if (!referenceNode || !isBoundaryWallReferenceSourceNode(referenceNode)) {
    return []
  }
  const nextSegments = extractBoundaryWallSegmentsForNode(
    referenceNode,
    referenceNode === node ? object : null,
    props,
  )
  if (!nextSegments.length) {
    return []
  }
  if (referenceNode === node) {
    return nextSegments
  }
  const referenceToMountMatrix = computeReferenceToMountMatrix(node, referenceNode)
  if (!referenceToMountMatrix) {
    return []
  }
  return nextSegments.map((segment) => transformBoundaryWallSegment(segment, referenceToMountMatrix))
}
