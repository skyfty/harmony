import * as THREE from 'three'

import type { SceneNode } from './core'
import {
  clampGuideRouteComponentProps,
  type GuideRouteComponentProps,
} from './components/definitions/guideRouteComponent'
import {
  getProceduralLandscapeGuideRouteSurfaceState,
  getProceduralLandscapeRoadCenterlineLocal,
  sampleProceduralLandscapeGuideRouteSurface,
} from './proceduralLandscape/runtime'

export type EvaluatedGuideRouteStatus =
  | 'ready'
  | 'unsupported'
  | 'provider-missing'
  | 'provider-loading'
  | 'provider-error'
  | 'too-few-points'
  | 'surface-gap'

export type EvaluatedGuideRoute = {
  status: EvaluatedGuideRouteStatus
  message: string | null
  routeNodeId: string
  providerNodeId: string | null
  revision: number
  points: THREE.Vector3[]
  normals: THREE.Vector3[]
  dock: boolean[]
  cumulativeLengths: number[]
  totalLength: number
}

export type EvaluateGuideRouteParams = {
  routeNode: SceneNode
  providerObject: THREE.Object3D | null
}

const ROUTE_CACHE_LIMIT = 64
const routeEvaluationCache = new Map<string, EvaluatedGuideRoute>()

function emptyEvaluation(
  routeNode: SceneNode,
  status: EvaluatedGuideRouteStatus,
  message: string,
  providerNodeId: string | null = null,
  revision = 0,
): EvaluatedGuideRoute {
  return {
    status,
    message,
    routeNodeId: routeNode.id,
    providerNodeId,
    revision,
    points: [],
    normals: [],
    dock: [],
    cumulativeLengths: [],
    totalLength: 0,
  }
}

function hashRouteParameters(
  routeNodeId: string,
  props: GuideRouteComponentProps,
  providerMatrix: THREE.Matrix4 | null,
): string {
  const matrix = providerMatrix
    ? Array.from(providerMatrix.elements, (value) => Number(value.toFixed(5))).join(',')
    : ''
  return JSON.stringify([
    routeNodeId,
    props.surfaceProviderNodeId,
    props.routeSource,
    props.sampleSpacingM,
    props.roadLateralOffsetM,
    props.waypoints.map((entry) => [
      entry.name,
      entry.dock === true,
      entry.position.x,
      entry.position.y,
      entry.position.z,
    ]),
    matrix,
  ])
}

function normalizeXZDirection(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z)
  return length > 1e-8
    ? { x: x / length, z: z / length }
    : { x: 1, z: 0 }
}

function densifyWorldControls(
  controls: THREE.Vector3[],
  spacingM: number,
): THREE.Vector3[] {
  if (controls.length < 2) {
    return controls.map((entry) => entry.clone())
  }
  const spacing = Math.max(0.5, spacingM)
  const points: THREE.Vector3[] = []
  for (let segmentIndex = 0; segmentIndex + 1 < controls.length; segmentIndex += 1) {
    const start = controls[segmentIndex]!
    const end = controls[segmentIndex + 1]!
    const planarLength = Math.hypot(end.x - start.x, end.z - start.z)
    const steps = Math.max(1, Math.ceil(planarLength / spacing))
    for (let step = segmentIndex === 0 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps
      points.push(new THREE.Vector3(
        start.x + (end.x - start.x) * t,
        0,
        start.z + (end.z - start.z) * t,
      ))
    }
  }
  return points
}

function resolveGeneratedRoadWorldControls(
  providerNodeId: string,
  providerObject: THREE.Object3D,
  lateralOffsetM: number,
): THREE.Vector3[] {
  const centerline = getProceduralLandscapeRoadCenterlineLocal(providerNodeId)
  const raw = centerline?.pointsXZ
  if (!raw || raw.length < 4) {
    return []
  }
  providerObject.updateMatrixWorld(true)
  const localControls: THREE.Vector3[] = []
  for (let index = 0; index + 1 < raw.length; index += 2) {
    localControls.push(new THREE.Vector3(raw[index]!, 0, raw[index + 1]!))
  }
  if (lateralOffsetM !== 0 && localControls.length >= 2) {
    for (let index = 0; index < localControls.length; index += 1) {
      const previous = localControls[Math.max(0, index - 1)]!
      const next = localControls[Math.min(localControls.length - 1, index + 1)]!
      const direction = normalizeXZDirection(next.x - previous.x, next.z - previous.z)
      localControls[index]!.x += -direction.z * lateralOffsetM
      localControls[index]!.z += direction.x * lateralOffsetM
    }
  }
  return localControls.map((entry) => entry.applyMatrix4(providerObject.matrixWorld))
}

function resolveControlPoints(
  props: GuideRouteComponentProps,
  providerObject: THREE.Object3D | null,
): THREE.Vector3[] {
  if (props.routeSource === 'generated-road' && props.surfaceProviderNodeId && providerObject) {
    return resolveGeneratedRoadWorldControls(
      props.surfaceProviderNodeId,
      providerObject,
      props.roadLateralOffsetM,
    )
  }
  return props.waypoints.map((entry) => new THREE.Vector3(
    entry.position.x,
    entry.position.y,
    entry.position.z,
  ))
}

function buildCumulativeLengths(points: readonly THREE.Vector3[]): number[] {
  const lengths = new Array<number>(points.length)
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      total += points[index]!.distanceTo(points[index - 1]!)
    }
    lengths[index] = total
  }
  return lengths
}

function markDockPoints(
  points: readonly THREE.Vector3[],
  controls: readonly THREE.Vector3[],
  sourceDock: readonly boolean[],
): boolean[] {
  const dock = new Array<boolean>(points.length).fill(false)
  if (!points.length) {
    return dock
  }
  controls.forEach((control, controlIndex) => {
    if (sourceDock[controlIndex] !== true) {
      return
    }
    let nearestIndex = 0
    let nearestDistanceSq = Number.POSITIVE_INFINITY
    points.forEach((point, pointIndex) => {
      const dx = point.x - control.x
      const dz = point.z - control.z
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq
        nearestIndex = pointIndex
      }
    })
    dock[nearestIndex] = true
  })
  return dock
}

function cacheEvaluation(key: string, evaluation: EvaluatedGuideRoute): EvaluatedGuideRoute {
  routeEvaluationCache.set(key, evaluation)
  if (routeEvaluationCache.size > ROUTE_CACHE_LIMIT) {
    const oldestKey = routeEvaluationCache.keys().next().value
    if (typeof oldestKey === 'string') {
      routeEvaluationCache.delete(oldestKey)
    }
  }
  return evaluation
}

export function evaluateGuideRoute(params: EvaluateGuideRouteParams): EvaluatedGuideRoute {
  const { routeNode, providerObject } = params
  const rawProps = routeNode.components?.guideRoute?.props as
    | Partial<GuideRouteComponentProps>
    | null
    | undefined
  if (rawProps?.version !== 2) {
    return emptyEvaluation(
      routeNode,
      'unsupported',
      'Guide Route data is not V2 and is not supported.',
    )
  }
  const props = clampGuideRouteComponentProps(rawProps)
  const providerNodeId = props.surfaceProviderNodeId
  if (!providerNodeId) {
    return emptyEvaluation(
      routeNode,
      'unsupported',
      'This Guide Route is not bound to a surface provider. Recreate the route.',
    )
  }
  const surfaceState = getProceduralLandscapeGuideRouteSurfaceState(providerNodeId)
  if (!surfaceState) {
    return emptyEvaluation(
      routeNode,
      'provider-missing',
      `Surface provider ${providerNodeId} is missing.`,
      providerNodeId,
    )
  }
  if (surfaceState.status !== 'ready') {
    return emptyEvaluation(
      routeNode,
      surfaceState.status === 'error' ? 'provider-error' : 'provider-loading',
      surfaceState.message ?? 'Surface provider is not ready.',
      providerNodeId,
      surfaceState.revision,
    )
  }

  const rawControls = resolveControlPoints(props, providerObject)
  if (rawControls.length < 2) {
    return emptyEvaluation(
      routeNode,
      'too-few-points',
      'Guide Route needs at least two control points.',
      providerNodeId,
      surfaceState.revision,
    )
  }

  const cacheKey = `${surfaceState.revision}|${hashRouteParameters(
    routeNode.id,
    props,
    providerObject?.matrixWorld ?? null,
  )}`
  const cached = routeEvaluationCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const controls = densifyWorldControls(rawControls, props.sampleSpacingM)
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!
    const previous = controls[Math.max(0, index - 1)]!
    const next = controls[Math.min(controls.length - 1, index + 1)]!
    const direction = normalizeXZDirection(next.x - previous.x, next.z - previous.z)
    const facingYaw = Math.atan2(-direction.z, direction.x)
    const sample = sampleProceduralLandscapeGuideRouteSurface(
      providerNodeId,
      control.x,
      control.z,
      facingYaw,
    )
    if (!sample) {
      return cacheEvaluation(cacheKey, emptyEvaluation(
        routeNode,
        'surface-gap',
        `Guide Route has no surface at ${control.x.toFixed(2)}, ${control.z.toFixed(2)}.`,
        providerNodeId,
        surfaceState.revision,
      ))
    }
    points.push(sample.point)
    normals.push(sample.normal)
  }

  const cumulativeLengths = buildCumulativeLengths(points)
  return cacheEvaluation(cacheKey, {
    status: 'ready',
    message: null,
    routeNodeId: routeNode.id,
    providerNodeId,
    revision: surfaceState.revision,
    points,
    normals,
    dock: markDockPoints(
      points,
      rawControls,
      props.waypoints.map((entry) => entry.dock === true),
    ),
    cumulativeLengths,
    totalLength: cumulativeLengths[cumulativeLengths.length - 1] ?? 0,
  })
}

export function sampleEvaluatedGuideRouteAtDistance(
  route: EvaluatedGuideRoute,
  distanceM: number,
): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (route.status !== 'ready' || route.points.length === 0) {
    return null
  }
  const target = Math.max(0, Math.min(route.totalLength, distanceM))
  let low = 0
  let high = route.cumulativeLengths.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) * 0.5)
    if ((route.cumulativeLengths[middle] ?? 0) < target) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const endIndex = Math.max(1, low)
  const startIndex = Math.max(0, endIndex - 1)
  const startLength = route.cumulativeLengths[startIndex] ?? 0
  const endLength = route.cumulativeLengths[endIndex] ?? startLength
  const span = endLength - startLength
  const alpha = span > 1e-8 ? (target - startLength) / span : 0
  const point = route.points[startIndex]!.clone().lerp(route.points[endIndex]!, alpha)
  const normal = route.normals[startIndex]!.clone().lerp(route.normals[endIndex]!, alpha).normalize()
  return { point, normal }
}

export function clearGuideRouteEvaluationCache(): void {
  routeEvaluationCache.clear()
}
