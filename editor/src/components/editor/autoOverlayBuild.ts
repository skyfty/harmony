import * as THREE from 'three'
import type { FloorDynamicMesh, LandformDynamicMesh, SceneNode, Vector3Like, WallDynamicMesh } from '@schema'
import type { Object3D } from 'three'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WaterBuildShape } from '@/types/water-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import { readFloorBuildShapeFromNode, readWallBuildShapeFromNode } from '@/utils/dynamicMeshBuildShapeUserData'
import { isWaterSurfaceNode, readWaterBuildShapeFromNode } from '@/utils/waterBuildShapeUserData'
import { getWaterContourLocalPoints } from './waterSurfaceEditUtils'

const FLOOR_SURFACE_Y_OFFSET = 0.01
const AUTO_OVERLAY_WORLD_GAP = 0.02
const POINT_EPSILON_SQ = 1e-8

export type AutoOverlayTool = 'floor' | 'wall' | 'water'
export type AutoOverlayReferenceType = 'floor' | 'landform' | 'wall' | 'water'
export type AutoOverlayTargetBuildShape = FloorBuildShape | WallBuildShape | WaterBuildShape

export type AutoOverlayBuildPlan = {
  supported: boolean
  reason: string | null
  referenceNodeId: string
  referenceNodeName: string
  referenceType: AutoOverlayReferenceType
  referenceBuildShape: FloorBuildShape | WallBuildShape | WaterBuildShape | null
  targetTool: AutoOverlayTool
  targetBuildShape: AutoOverlayTargetBuildShape
  worldPoints: Vector3Like[]
  closedPath: boolean
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function worldPointFromLocal(
  node: SceneNode,
  runtimeObject: Object3D | null | undefined,
  localPoint: THREE.Vector3,
): THREE.Vector3 {
  if (runtimeObject) {
    runtimeObject.updateMatrixWorld(true)
    return runtimeObject.localToWorld(localPoint.clone())
  }
  return localPoint.add(new THREE.Vector3(
    toFiniteNumber(node.position?.x),
    toFiniteNumber(node.position?.y),
    toFiniteNumber(node.position?.z),
  ))
}

function sanitizeWorldPoints(points: THREE.Vector3[]): Vector3Like[] {
  const out: Vector3Like[] = []
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue
    }
    const previous = out[out.length - 1]
    if (previous) {
      const dx = previous.x - point.x
      const dy = previous.y - point.y
      const dz = previous.z - point.z
      if ((dx * dx) + (dy * dy) + (dz * dz) <= POINT_EPSILON_SQ) {
        continue
      }
    }
    out.push({ x: point.x, y: point.y, z: point.z })
  }

  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    const dx = first.x - last.x
    const dy = first.y - last.y
    const dz = first.z - last.z
    if ((dx * dx) + (dy * dy) + (dz * dz) <= POINT_EPSILON_SQ) {
      out.pop()
    }
  }

  return out
}

function normalizeTargetBuildShape(
  sourceShape: FloorBuildShape | WallBuildShape | WaterBuildShape | null,
  pointCount: number,
): AutoOverlayTargetBuildShape {
  if (sourceShape === 'rectangle' && pointCount === 4) {
    return 'rectangle'
  }
  if (sourceShape === 'circle') {
    return 'circle'
  }
  return 'polygon'
}

function buildWaterOverlayPlan(
  node: SceneNode,
  runtimeObject: Object3D | null | undefined,
  targetTool: AutoOverlayTool,
): AutoOverlayBuildPlan {
  const contourLocal = getWaterContourLocalPoints(node)
  const contour = sanitizeWorldPoints(
    contourLocal
      .map(([x, y]) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null
        }
        // Water local contour lies in XY with local Z=0; raise by a small local Z gap.
        return worldPointFromLocal(node, runtimeObject, new THREE.Vector3(x, y, AUTO_OVERLAY_WORLD_GAP))
      })
      .filter((entry): entry is THREE.Vector3 => Boolean(entry)),
  )

  const buildShape = readWaterBuildShapeFromNode(node)

  if (contour.length < 3) {
    return {
      supported: false,
      reason: '参考 water 轮廓无效，无法自动铺设。',
      referenceNodeId: node.id,
      referenceNodeName: node.name,
      referenceType: 'water',
      referenceBuildShape: buildShape,
      targetTool,
      targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
      worldPoints: contour,
      closedPath: true,
    }
  }

  return {
    supported: true,
    reason: null,
    referenceNodeId: node.id,
    referenceNodeName: node.name,
    referenceType: 'water',
    referenceBuildShape: buildShape,
    targetTool,
    targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
    worldPoints: contour,
    closedPath: true,
  }
}

function buildFloorOverlayPlan(
  node: SceneNode,
  runtimeObject: Object3D | null | undefined,
  targetTool: AutoOverlayTool,
): AutoOverlayBuildPlan {
  const dynamicMesh = node.dynamicMesh as FloorDynamicMesh
  const vertices = Array.isArray(dynamicMesh.vertices) ? dynamicMesh.vertices : []
  const thickness = Math.max(0, toFiniteNumber((dynamicMesh as Partial<FloorDynamicMesh> & { thickness?: unknown }).thickness))
  const localY = thickness + FLOOR_SURFACE_Y_OFFSET + AUTO_OVERLAY_WORLD_GAP
  const contour = sanitizeWorldPoints(
    vertices
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) {
          return null
        }
        const x = Number(entry[0])
        const z = Number(entry[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          return null
        }
        return worldPointFromLocal(node, runtimeObject, new THREE.Vector3(x, localY, z))
      })
      .filter((entry): entry is THREE.Vector3 => Boolean(entry)),
  )

  const buildShape = readFloorBuildShapeFromNode(node)

  if (contour.length < 3) {
    return {
      supported: false,
      reason: '参考 floor 轮廓无效，无法自动铺设。',
      referenceNodeId: node.id,
      referenceNodeName: node.name,
      referenceType: 'floor',
      referenceBuildShape: buildShape,
      targetTool,
      targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
      worldPoints: contour,
      closedPath: true,
    }
  }

  return {
    supported: true,
    reason: null,
    referenceNodeId: node.id,
    referenceNodeName: node.name,
    referenceType: 'floor',
    referenceBuildShape: buildShape,
    targetTool,
    targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
    worldPoints: contour,
    closedPath: true,
  }
}

function buildLandformOverlayPlan(
  node: SceneNode,
  runtimeObject: Object3D | null | undefined,
  targetTool: AutoOverlayTool,
): AutoOverlayBuildPlan {
  const dynamicMesh = node.dynamicMesh as LandformDynamicMesh
  const footprint = Array.isArray(dynamicMesh.footprint) ? dynamicMesh.footprint : []
  const contour = sanitizeWorldPoints(
    footprint
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) {
          return null
        }
        const x = Number(entry[0])
        const z = Number(entry[1])
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          return null
        }
        return worldPointFromLocal(node, runtimeObject, new THREE.Vector3(x, AUTO_OVERLAY_WORLD_GAP, z))
      })
      .filter((entry): entry is THREE.Vector3 => Boolean(entry)),
  )

  const buildShape = readFloorBuildShapeFromNode(node)

  if (contour.length < 3) {
    return {
      supported: false,
      reason: '参考 landform 轮廓无效，无法自动铺设。',
      referenceNodeId: node.id,
      referenceNodeName: node.name,
      referenceType: 'landform',
      referenceBuildShape: buildShape,
      targetTool,
      targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
      worldPoints: contour,
      closedPath: true,
    }
  }

  return {
    supported: true,
    reason: null,
    referenceNodeId: node.id,
    referenceNodeName: node.name,
    referenceType: 'landform',
    referenceBuildShape: buildShape,
    targetTool,
    targetBuildShape: normalizeTargetBuildShape(buildShape, contour.length),
    worldPoints: contour,
    closedPath: true,
  }
}

function computeWallChainLengthSq(points: Array<Vector3Like | null | undefined>): number {
  if (!Array.isArray(points) || points.length < 2) {
    return 0
  }
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    if (!current || !next) {
      continue
    }
    const dx = Number(next.x) - Number(current.x)
    const dy = Number(next.y) - Number(current.y)
    const dz = Number(next.z) - Number(current.z)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
      continue
    }
    total += (dx * dx) + (dy * dy) + (dz * dz)
  }
  return total
}

function buildWallOverlayPlan(
  node: SceneNode,
  runtimeObject: Object3D | null | undefined,
  targetTool: AutoOverlayTool,
): AutoOverlayBuildPlan {
  const dynamicMesh = node.dynamicMesh as WallDynamicMesh
  const buildShape = readWallBuildShapeFromNode(node)
  const chains = Array.isArray(dynamicMesh.chains) ? dynamicMesh.chains : []
  const dimensions = dynamicMesh.dimensions ?? {}
  const height = Math.max(0, toFiniteNumber(dimensions.height))

  // Keep legacy restriction for non-wall targets that need closed contours.
  if (targetTool !== 'wall') {
    if (buildShape === 'line') {
      return {
        supported: false,
        reason: '当前只支持闭合 wall 作为自动铺设参考。',
        referenceNodeId: node.id,
        referenceNodeName: node.name,
        referenceType: 'wall',
        referenceBuildShape: buildShape,
        targetTool,
        targetBuildShape: normalizeTargetBuildShape(buildShape, 0),
        worldPoints: [],
        closedPath: true,
      }
    }

    if (chains.length !== 1 || !chains[0]?.closed) {
      return {
        supported: false,
        reason: '当前只支持单个闭合 wall 轮廓自动铺设。',
        referenceNodeId: node.id,
        referenceNodeName: node.name,
        referenceType: 'wall',
        referenceBuildShape: buildShape,
        targetTool,
        targetBuildShape: normalizeTargetBuildShape(buildShape, 0),
        worldPoints: [],
        closedPath: true,
      }
    }
  }

  const candidateChains = chains
    .filter((chain) => Array.isArray(chain?.points) && chain.points.length >= 2)
    .sort((a, b) => computeWallChainLengthSq(b.points) - computeWallChainLengthSq(a.points))

  const selectedChain = candidateChains[0] ?? null
  if (!selectedChain) {
    return {
      supported: false,
      reason: '参考 wall 轮廓无效，无法自动铺设。',
      referenceNodeId: node.id,
      referenceNodeName: node.name,
      referenceType: 'wall',
      referenceBuildShape: buildShape,
      targetTool,
      targetBuildShape: targetTool === 'wall' ? 'line' : normalizeTargetBuildShape(buildShape, 0),
      worldPoints: [],
      closedPath: false,
    }
  }

  const isClosedPath = Boolean(selectedChain.closed)
  const localPoints = Array.isArray(selectedChain.points) ? selectedChain.points : []
  const contour = sanitizeWorldPoints(
    localPoints
      .map((point) => {
        const x = Number(point?.x)
        const y = Number(point?.y)
        const z = Number(point?.z)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return null
        }
        return worldPointFromLocal(node, runtimeObject, new THREE.Vector3(x, y + height + AUTO_OVERLAY_WORLD_GAP, z))
      })
      .filter((entry): entry is THREE.Vector3 => Boolean(entry)),
  )

  const minPointCount = isClosedPath ? 3 : 2
  if (contour.length < minPointCount) {
    return {
      supported: false,
      reason: '参考 wall 轮廓无效，无法自动铺设。',
      referenceNodeId: node.id,
      referenceNodeName: node.name,
      referenceType: 'wall',
      referenceBuildShape: buildShape,
      targetTool,
      targetBuildShape: targetTool === 'wall'
        ? (isClosedPath ? normalizeTargetBuildShape(buildShape, contour.length) : 'line')
        : normalizeTargetBuildShape(buildShape, contour.length),
      worldPoints: contour,
      closedPath: isClosedPath,
    }
  }

  return {
    supported: true,
    reason: null,
    referenceNodeId: node.id,
    referenceNodeName: node.name,
    referenceType: 'wall',
    referenceBuildShape: buildShape,
    targetTool,
    targetBuildShape: targetTool === 'wall'
      ? (isClosedPath ? normalizeTargetBuildShape(buildShape, contour.length) : 'line')
      : normalizeTargetBuildShape(buildShape, contour.length),
    worldPoints: contour,
    closedPath: isClosedPath,
  }
}

export function resolveAutoOverlayBuildPlan(options: {
  referenceNode: SceneNode
  runtimeObject?: Object3D | null
  targetTool: AutoOverlayTool
}): AutoOverlayBuildPlan | null {
  const { referenceNode, runtimeObject, targetTool } = options
  if (referenceNode.dynamicMesh?.type === 'Floor') {
    return buildFloorOverlayPlan(referenceNode, runtimeObject, targetTool)
  }
  if (referenceNode.dynamicMesh?.type === 'Landform') {
    return buildLandformOverlayPlan(referenceNode, runtimeObject, targetTool)
  }
  if (referenceNode.dynamicMesh?.type === 'Wall') {
    return buildWallOverlayPlan(referenceNode, runtimeObject, targetTool)
  }
  if (isWaterSurfaceNode(referenceNode)) {
    return buildWaterOverlayPlan(referenceNode, runtimeObject, targetTool)
  }
  return null
}

export function buildClosedWallSegmentsFromWorldPoints(points: Vector3Like[]): Array<{ start: Vector3Like; end: Vector3Like }> {
  if (points.length < 3) {
    return []
  }

  const segments: Array<{ start: Vector3Like; end: Vector3Like }> = []
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    segments.push({
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
    })
  }
  return segments
}

export function buildOpenWallSegmentsFromWorldPoints(points: Vector3Like[]): Array<{ start: Vector3Like; end: Vector3Like }> {
  if (points.length < 2) {
    return []
  }

  const segments: Array<{ start: Vector3Like; end: Vector3Like }> = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    segments.push({
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
    })
  }
  return segments
}