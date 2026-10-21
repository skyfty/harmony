import * as THREE from 'three'

import { isSingleTrackRoad } from './proceduralLandscape/roadStyle'

export type RoadLaneRow = {
  x: number
  z: number
  y: number
  heading: number
}

export type RoadLanePose = {
  x: number
  y: number
  z: number
  yawRad: number
  distance: number
}

export type RoadLanePoseOptions = {
  worldX: number
  worldZ: number
  facingYawRad: number
  halfWidth: number
  columnHeights?: readonly (readonly number[])[] | null
  surfaceLift?: number
}

export function selectNearestRoadLanePose(
  candidates: ReadonlyArray<RoadLanePose | null | undefined>,
): RoadLanePose | null {
  let best: RoadLanePose | null = null
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.distance < best.distance)) {
      best = candidate
    }
  }
  return best
}

export type VehicleAxisIndices = {
  rightIndex: 0 | 1 | 2
  upIndex: 0 | 1 | 2
  forwardIndex: 0 | 1 | 2
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const SEGMENT_EPSILON = 1e-8

function readFinite(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function sampleColumnHeight(
  columns: readonly number[] | null | undefined,
  lateralRatio: number,
): number | null {
  if (!columns || columns.length < 2) {
    return null
  }
  const clampedRatio = THREE.MathUtils.clamp(lateralRatio, -1, 1)
  const position = ((clampedRatio + 1) * 0.5) * (columns.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.min(columns.length - 1, lowerIndex + 1)
  const blend = position - lowerIndex
  const lower = readFinite(columns[lowerIndex])
  const upper = readFinite(columns[upperIndex])
  if (lower == null || upper == null) {
    return null
  }
  return lower + (upper - lower) * blend
}

/**
 * Projects a world-space vehicle position onto the nearest procedural road
 * segment and returns the center of the right-hand travel lane.
 *
 * The road rows use XZ heading angles where direction = (cos h, sin h). The
 * result uses the Three.js yaw convention where direction = (cos yaw, -sin yaw).
 */
export function resolveRoadLanePoseFromRows(
  rows: ReadonlyArray<RoadLaneRow>,
  options: RoadLanePoseOptions,
): RoadLanePose | null {
  if (rows.length < 2) {
    return null
  }
  const worldX = readFinite(options.worldX)
  const worldZ = readFinite(options.worldZ)
  const facingYawRad = readFinite(options.facingYawRad)
  const halfWidth = readFinite(options.halfWidth)
  if (worldX == null || worldZ == null || facingYawRad == null || halfWidth == null || halfWidth <= 0) {
    return null
  }

  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestIndex = -1
  let bestT = 0
  let bestX = 0
  let bestZ = 0

  for (let index = 0; index + 1 < rows.length; index += 1) {
    const start = rows[index]!
    const end = rows[index + 1]!
    const segmentX = end.x - start.x
    const segmentZ = end.z - start.z
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ
    if (lengthSq <= SEGMENT_EPSILON) {
      continue
    }
    const t = THREE.MathUtils.clamp(
      ((worldX - start.x) * segmentX + (worldZ - start.z) * segmentZ) / lengthSq,
      0,
      1,
    )
    const candidateX = start.x + segmentX * t
    const candidateZ = start.z + segmentZ * t
    const deltaX = worldX - candidateX
    const deltaZ = worldZ - candidateZ
    const distanceSq = deltaX * deltaX + deltaZ * deltaZ
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestIndex = index
      bestT = t
      bestX = candidateX
      bestZ = candidateZ
    }
  }

  if (bestIndex < 0 || !Number.isFinite(bestDistanceSq)) {
    return null
  }

  const start = rows[bestIndex]!
  const end = rows[bestIndex + 1]!
  const segmentX = end.x - start.x
  const segmentZ = end.z - start.z
  const segmentLength = Math.hypot(segmentX, segmentZ)
  if (!(segmentLength > SEGMENT_EPSILON)) {
    return null
  }
  const routeDirX = segmentX / segmentLength
  const routeDirZ = segmentZ / segmentLength
  const facingDirX = Math.cos(facingYawRad)
  const facingDirZ = -Math.sin(facingYawRad)
  const directionSign = facingDirX * routeDirX + facingDirZ * routeDirZ < 0 ? -1 : 1
  const travelDirX = routeDirX * directionSign
  const travelDirZ = routeDirZ * directionSign
  const rightX = -travelDirZ
  const rightZ = travelDirX
  const laneOffset = isSingleTrackRoad(halfWidth * 2) ? 0 : halfWidth * 0.5

  const startColumns = options.columnHeights?.[bestIndex] ?? null
  const endColumns = options.columnHeights?.[bestIndex + 1] ?? null
  const lateralRatio = halfWidth > 0 ? (laneOffset * directionSign) / halfWidth : 0
  const startColumnHeight = sampleColumnHeight(startColumns, lateralRatio)
  const endColumnHeight = sampleColumnHeight(endColumns, lateralRatio)
  const startHeight = startColumnHeight ?? start.y
  const endHeight = endColumnHeight ?? end.y
  const surfaceLift = readFinite(options.surfaceLift) ?? 0

  return {
    x: bestX + rightX * laneOffset,
    y: startHeight + (endHeight - startHeight) * bestT + surfaceLift,
    z: bestZ + rightZ * laneOffset,
    yawRad: Math.atan2(-travelDirZ, travelDirX),
    distance: Math.sqrt(bestDistanceSq),
  }
}

const orientationMatrix = new THREE.Matrix4()
const orientationForward = new THREE.Vector3()
const orientationRight = new THREE.Vector3()
const orientationAxes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

/**
 * Builds an upright world rotation that maps the vehicle's configured local
 * forward axis onto a world direction derived from `yawRad`.
 */
export function computeUprightVehicleYawQuaternion(
  axes: VehicleAxisIndices,
  yawRad: number,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  const safeYaw = Number.isFinite(yawRad) ? yawRad : 0
  const axisIndices = [axes.rightIndex, axes.upIndex, axes.forwardIndex]
  if (new Set(axisIndices).size !== 3) {
    return target.setFromAxisAngle(WORLD_UP, safeYaw)
  }

  orientationForward.set(Math.cos(safeYaw), 0, -Math.sin(safeYaw)).normalize()
  orientationRight.copy(orientationForward).cross(WORLD_UP).normalize()
  orientationAxes[0]!.set(0, 0, 0)
  orientationAxes[1]!.set(0, 0, 0)
  orientationAxes[2]!.set(0, 0, 0)
  orientationAxes[axes.rightIndex]!.copy(orientationRight)
  orientationAxes[axes.upIndex]!.copy(WORLD_UP)
  orientationAxes[axes.forwardIndex]!.copy(orientationForward)

  orientationMatrix.makeBasis(orientationAxes[0]!, orientationAxes[1]!, orientationAxes[2]!)
  if (orientationMatrix.determinant() < 0) {
    orientationRight.negate()
    orientationAxes[axes.rightIndex]!.copy(orientationRight)
    orientationMatrix.makeBasis(orientationAxes[0]!, orientationAxes[1]!, orientationAxes[2]!)
  }
  return target.setFromRotationMatrix(orientationMatrix)
}
