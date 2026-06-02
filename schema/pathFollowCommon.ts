import * as THREE from 'three'
import {
  buildPolylineMetricData,
  projectPointToPolyline,
  samplePolylineAtS,
  type PolylineMetricData,
  type PolylineMetricMode,
} from './polylineProgress'

export type PathFollowSample = {
  polylineData: PolylineMetricData
  projection: ReturnType<typeof projectPointToPolyline>
  lookaheadPoint: THREE.Vector3
  lookaheadDistance: number
}

const pathFollowProjectionClosestPoint = new THREE.Vector3()

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

export function findClosestWaypointIndex(points: readonly THREE.Vector3[], position: THREE.Vector3): number {
  let bestIndex = 0
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    if (!point) {
      continue
    }
    const distanceSq = position.distanceToSquared(point)
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestIndex = i
    }
  }
  return bestIndex
}

export function findTargetWaypointIndexByProjectedS(
  waypointArcLengths3d: readonly number[],
  projectedS: number,
  loop: boolean,
): number {
  if (!waypointArcLengths3d.length) {
    return 0
  }
  const epsilon = 1e-4
  for (let i = 0; i < waypointArcLengths3d.length; i += 1) {
    const s = waypointArcLengths3d[i] ?? 0
    if (s > projectedS + epsilon) {
      return i
    }
  }
  return loop ? 0 : waypointArcLengths3d.length - 1
}

export function resolvePathFollowSample(options: {
  points: readonly THREE.Vector3[]
  loop: boolean
  currentPosition: THREE.Vector3
  lookaheadDistance: number
  mode?: PolylineMetricMode
  outLookaheadPoint?: THREE.Vector3
  outClosestPoint?: THREE.Vector3
}): PathFollowSample | null {
  const { points, loop, currentPosition, lookaheadDistance } = options
  if (!points || points.length < 2) {
    return null
  }

  const polylineData = buildPolylineMetricData(points, {
    closed: Boolean(loop),
    mode: options.mode ?? '3d',
  })
  if (!polylineData) {
    return null
  }

  const projection = projectPointToPolyline(points, polylineData, currentPosition, options.outClosestPoint ?? pathFollowProjectionClosestPoint)
  const clampedLookaheadDistance = Math.max(0, Number.isFinite(lookaheadDistance) ? lookaheadDistance : 0)
  const lookaheadPoint = options.outLookaheadPoint ?? new THREE.Vector3()
  samplePolylineAtS(points, polylineData, projection.s + clampedLookaheadDistance, lookaheadPoint)

  return {
    polylineData,
    projection,
    lookaheadPoint,
    lookaheadDistance: clampedLookaheadDistance,
  }
}

export function resolvePathFollowPlanarArrivalDistance(
  speedMps: number,
  minDistance: number,
  maxDistance: number,
  speedFactor: number,
): number {
  const safeSpeed = Math.max(0, Number.isFinite(speedMps) ? speedMps : 0)
  const base = Math.max(0, minDistance)
  const computed = Math.min(
    Math.max(base, maxDistance),
    Math.max(base, safeSpeed * Math.max(0, speedFactor)),
  )
  return Math.max(0, computed)
}

export function resolvePathFollowLookaheadDistance(options: {
  speedMps: number
  baseMeters: number
  speedGain: number
  minMeters: number
  maxMeters: number
}): number {
  const safeSpeed = Math.max(0, Number.isFinite(options.speedMps) ? options.speedMps : 0)
  const raw = options.baseMeters + options.speedGain * safeSpeed
  return Math.max(options.minMeters, Math.min(options.maxMeters, Number.isFinite(raw) ? raw : options.minMeters))
}

export function resolvePathFollowProgressFactor(distanceToLookahead: number, lookaheadDistance: number): number {
  if (!Number.isFinite(distanceToLookahead) || !Number.isFinite(lookaheadDistance) || lookaheadDistance <= 1e-6) {
    return 1
  }
  const blend = clamp01(distanceToLookahead / lookaheadDistance)
  return Math.max(0, Math.min(1, blend))
}

