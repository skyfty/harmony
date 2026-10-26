import * as THREE from 'three'

import type { SceneNode } from './core'
import {
  clampGuideRouteComponentProps,
  type GuidePathRouteLeg,
  type GuideRoadRouteLeg,
  type GuideRouteBehaviorRef,
  type GuideRouteComponentProps,
  type GuideRouteLeg,
  type GuideRouteSpeedProfile,
  type GuideRouteStop,
  type GuideRouteTransition,
} from './components/definitions/guideRouteComponent'
import {
  getProceduralLandscapeGuideRouteSurfaceState,
  getProceduralLandscapeRoadCenterlineLocal,
  sampleProceduralLandscapeGuideRouteSurface,
} from './proceduralLandscape/runtime'
import {
  buildPolylineMetricData,
  projectPointToPolyline,
  samplePolylineAtS,
  type PolylineMetricData,
} from './polylineProgress'

export type EvaluatedGuideRouteStatus =
  | 'ready'
  | 'unsupported'
  | 'empty-route'
  | 'provider-missing'
  | 'provider-loading'
  | 'provider-error'
  | 'invalid-leg'
  | 'surface-gap'

export type CompiledGuideLeg = {
  definition: GuideRouteLeg
  points: THREE.Vector3[]
  normals: THREE.Vector3[]
  cumulativeLengths: number[]
  metricData: PolylineMetricData
  totalLength: number
  routeStartDistance: number
  routeEndDistance: number
  travelMode: GuideRouteLeg['travelMode']
  speedProfile: GuideRouteSpeedProfile
}

export type CompiledGuideStop = {
  definition: GuideRouteStop
  legId: string
  legDistance: number
  routeDistance: number
  projectedPoint: THREE.Vector3
  projectionDistance: number
  behavior: GuideRouteBehaviorRef | null
}

export type GuideRouteStopEventContext = {
  isTourTarget: boolean
}

export type CompiledGuideTransition = {
  definition: GuideRouteTransition
  afterLegId: string
  routeDistance: number
  behavior: GuideRouteBehaviorRef
}

export type EvaluatedGuideRoute = {
  status: EvaluatedGuideRouteStatus
  message: string | null
  routeNodeId: string
  providerNodeId: string | null
  revision: number
  loop: boolean
  points: THREE.Vector3[]
  normals: THREE.Vector3[]
  cumulativeLengths: number[]
  totalLength: number
  legs: CompiledGuideLeg[]
  stops: CompiledGuideStop[]
  transitions: CompiledGuideTransition[]
  warnings: string[]
  drop?: boolean
}

export type EvaluateGuideRouteParams = {
  routeNode: SceneNode
  providerObject: THREE.Object3D | null
  routeObject?: THREE.Object3D | null
}

export function resolveGuideRoutePrimaryProviderNodeId(
  props: Partial<GuideRouteComponentProps> | null | undefined,
): string | null {
  const normalized = clampGuideRouteComponentProps(props)
  for (const leg of normalized.legs) {
    if (leg.kind === 'road') {
      return leg.providerNodeId
    }
  }
  for (const leg of normalized.legs) {
    if (leg.kind === 'path' && leg.surfaceProviderNodeId) {
      return leg.surfaceProviderNodeId
    }
  }
  return null
}

type LegCompilationResult =
  | {
      ok: true
      leg: CompiledGuideLeg
      providerRevision: number
      providerNodeId: string | null
      warnings: string[]
    }
  | {
      ok: false
      status: EvaluatedGuideRouteStatus
      message: string
      providerRevision: number
      providerNodeId: string | null
    }

const ROUTE_CACHE_LIMIT = 64
const routeEvaluationCache = new Map<string, EvaluatedGuideRoute>()
const UP = new THREE.Vector3(0, 1, 0)

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
    loop: false,
    points: [],
    normals: [],
    cumulativeLengths: [],
    totalLength: 0,
    legs: [],
    stops: [],
    transitions: [],
    warnings: [],
  }
}

function normalizeXZDirection(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z)
  return length > 1e-8
    ? { x: x / length, z: z / length }
    : { x: 1, z: 0 }
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

function appendUniquePoint(
  points: THREE.Vector3[],
  normals: THREE.Vector3[],
  point: THREE.Vector3,
  normal: THREE.Vector3,
): void {
  const previous = points[points.length - 1]
  if (previous && previous.distanceToSquared(point) <= 1e-8) {
    normals[normals.length - 1] = normal.clone()
    return
  }
  points.push(point.clone())
  normals.push(normal.clone())
}

function resolveRoadWorldCenterline(
  providerNodeId: string,
  providerObject: THREE.Object3D,
): THREE.Vector3[] {
  const centerline = getProceduralLandscapeRoadCenterlineLocal(providerNodeId)
  const raw = centerline?.pointsXZ
  if (!raw || raw.length < 4) {
    return []
  }
  providerObject.updateMatrixWorld(true)
  const points: THREE.Vector3[] = []
  for (let index = 0; index + 1 < raw.length; index += 2) {
    points.push(new THREE.Vector3(raw[index]!, 0, raw[index + 1]!))
  }
  for (const point of points) {
    point.applyMatrix4(providerObject.matrixWorld)
  }
  return points
}

function compileRoadLeg(
  definition: GuideRoadRouteLeg,
  providerObjects: Map<string, THREE.Object3D>,
): LegCompilationResult {
  const state = getProceduralLandscapeGuideRouteSurfaceState(definition.providerNodeId)
  if (!state) {
    return {
      ok: false,
      status: 'provider-missing',
      message: `Road provider ${definition.providerNodeId} is missing.`,
      providerRevision: 0,
      providerNodeId: definition.providerNodeId,
    }
  }
  if (state.status !== 'ready') {
    return {
      ok: false,
      status: state.status === 'error' ? 'provider-error' : 'provider-loading',
      message: state.message ?? 'Road provider is not ready.',
      providerRevision: state.revision,
      providerNodeId: definition.providerNodeId,
    }
  }
  const providerObject = providerObjects.get(definition.providerNodeId) ?? null
  const centerline = providerObject
    ? resolveRoadWorldCenterline(definition.providerNodeId, providerObject)
    : []
  if (centerline.length < 2) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Road leg ${definition.id} has no generated road centerline.`,
      providerRevision: state.revision,
      providerNodeId: definition.providerNodeId,
    }
  }
  const sourceMetric = buildPolylineMetricData(centerline, { closed: false, mode: 'xz' })
  if (!sourceMetric || sourceMetric.totalLength <= 1e-6) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Road leg ${definition.id} has a degenerate centerline.`,
      providerRevision: state.revision,
      providerNodeId: definition.providerNodeId,
    }
  }

  const startT = Math.max(0, Math.min(1, definition.startT))
  const endT = Math.max(0, Math.min(1, definition.endT))
  const startS = sourceMetric.totalLength * startT
  const endS = sourceMetric.totalLength * endT
  const directionSign = endS >= startS ? 1 : -1
  const travelLength = Math.abs(endS - startS)
  if (travelLength <= 1e-6) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Road leg ${definition.id} has a zero-length interval.`,
      providerRevision: state.revision,
      providerNodeId: definition.providerNodeId,
    }
  }

  const sampleCount = Math.max(2, Math.ceil(travelLength / Math.max(0.5, definition.sampleSpacingM)) + 1)
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  const center = new THREE.Vector3()
  const before = new THREE.Vector3()
  const after = new THREE.Vector3()
  for (let index = 0; index < sampleCount; index += 1) {
    const alpha = index / (sampleCount - 1)
    const sourceS = startS + (endS - startS) * alpha
    samplePolylineAtS(centerline, sourceMetric, sourceS, center)
    samplePolylineAtS(centerline, sourceMetric, sourceS - 0.5, before)
    samplePolylineAtS(centerline, sourceMetric, sourceS + 0.5, after)
    const tangent = normalizeXZDirection(
      (after.x - before.x) * directionSign,
      (after.z - before.z) * directionSign,
    )
    center.x += -tangent.z * definition.laneOffsetM
    center.z += tangent.x * definition.laneOffsetM
    const surface = sampleProceduralLandscapeGuideRouteSurface(
      definition.providerNodeId,
      center.x,
      center.z,
      Math.atan2(-tangent.z, tangent.x),
    )
    if (!surface) {
      return {
        ok: false,
        status: 'surface-gap',
        message: `Road leg ${definition.id} has no surface at ${center.x.toFixed(2)}, ${center.z.toFixed(2)}.`,
        providerRevision: state.revision,
        providerNodeId: definition.providerNodeId,
      }
    }
    appendUniquePoint(points, normals, surface.point, surface.normal)
  }
  const cumulativeLengths = buildCumulativeLengths(points)
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0
  const metricData = buildPolylineMetricData(points, { closed: false, mode: '3d' })
  if (!metricData || totalLength <= 1e-6) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Road leg ${definition.id} could not be sampled.`,
      providerRevision: state.revision,
      providerNodeId: definition.providerNodeId,
    }
  }
  return {
    ok: true,
    providerRevision: state.revision,
    providerNodeId: definition.providerNodeId,
    warnings: [],
    leg: {
      definition,
      points,
      normals,
      cumulativeLengths,
      metricData,
      totalLength,
      routeStartDistance: 0,
      routeEndDistance: totalLength,
      travelMode: definition.travelMode,
      speedProfile: definition.speedProfile,
    },
  }
}

function compilePathLeg(definition: GuidePathRouteLeg): LegCompilationResult {
  if (definition.anchors.length < 2) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Path leg ${definition.id} needs at least two anchors.`,
      providerRevision: 0,
      providerNodeId: definition.surfaceProviderNodeId,
    }
  }
  if (definition.surfaceProviderNodeId) {
    const state = getProceduralLandscapeGuideRouteSurfaceState(definition.surfaceProviderNodeId)
    if (!state) {
      return {
        ok: false,
        status: 'provider-missing',
        message: `Surface provider ${definition.surfaceProviderNodeId} is missing.`,
        providerRevision: 0,
        providerNodeId: definition.surfaceProviderNodeId,
      }
    }
    if (state.status !== 'ready') {
      return {
        ok: false,
        status: state.status === 'error' ? 'provider-error' : 'provider-loading',
        message: state.message ?? 'Surface provider is not ready.',
        providerRevision: state.revision,
        providerNodeId: definition.surfaceProviderNodeId,
      }
    }
  }

  const anchors = definition.anchors.map((anchor) => new THREE.Vector3(anchor.x, anchor.y, anchor.z))
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  for (let segmentIndex = 0; segmentIndex + 1 < anchors.length; segmentIndex += 1) {
    const start = anchors[segmentIndex]!
    const end = anchors[segmentIndex + 1]!
    const planarLength = Math.hypot(end.x - start.x, end.z - start.z)
    const steps = Math.max(1, Math.ceil(planarLength / 2))
    for (let step = segmentIndex === 0 ? 0 : 1; step <= steps; step += 1) {
      const alpha = step / steps
      const point = new THREE.Vector3().lerpVectors(start, end, alpha)
      let normal = UP.clone()
      if (definition.surfaceProviderNodeId && !definition.preserveAuthoredY) {
        const direction = normalizeXZDirection(end.x - start.x, end.z - start.z)
        const surface = sampleProceduralLandscapeGuideRouteSurface(
          definition.surfaceProviderNodeId,
          point.x,
          point.z,
          Math.atan2(-direction.z, direction.x),
        )
        if (!surface) {
          return {
            ok: false,
            status: 'surface-gap',
            message: `Path leg ${definition.id} has no surface at ${point.x.toFixed(2)}, ${point.z.toFixed(2)}.`,
            providerRevision: 0,
            providerNodeId: definition.surfaceProviderNodeId,
          }
        }
        point.copy(surface.point)
        normal = surface.normal
      }
      appendUniquePoint(points, normals, point, normal)
    }
  }
  const cumulativeLengths = buildCumulativeLengths(points)
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0
  const metricData = buildPolylineMetricData(points, { closed: false, mode: '3d' })
  if (!metricData || totalLength <= 1e-6) {
    return {
      ok: false,
      status: 'invalid-leg',
      message: `Path leg ${definition.id} has a degenerate path.`,
      providerRevision: 0,
      providerNodeId: definition.surfaceProviderNodeId,
    }
  }
  return {
    ok: true,
    providerRevision: 0,
    providerNodeId: definition.surfaceProviderNodeId,
    warnings: [],
    leg: {
      definition,
      points,
      normals,
      cumulativeLengths,
      metricData,
      totalLength,
      routeStartDistance: 0,
      routeEndDistance: totalLength,
      travelMode: definition.travelMode,
      speedProfile: definition.speedProfile,
    },
  }
}

function buildCacheKey(
  routeNode: SceneNode,
  props: GuideRouteComponentProps,
  providerMatrix: THREE.Matrix4 | null,
  routeMatrix: THREE.Matrix4 | null,
  providerSourceSignature: string,
): string {
  const matrix = (value: THREE.Matrix4 | null) => value
    ? Array.from(value.elements, (entry) => Number(entry.toFixed(5))).join(',')
    : ''
  return JSON.stringify([
    routeNode.id,
    matrix(providerMatrix),
    matrix(routeMatrix),
    providerSourceSignature,
    props,
  ])
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

function findLegContainingDistance(
  legs: readonly CompiledGuideLeg[],
  distance: number,
): CompiledGuideLeg | null {
  for (const leg of legs) {
    if (distance >= leg.routeStartDistance - 1e-6 && distance <= leg.routeEndDistance + 1e-6) {
      return leg
    }
  }
  return legs[legs.length - 1] ?? null
}

export function evaluateGuideRoute(params: EvaluateGuideRouteParams): EvaluatedGuideRoute {
  const { routeNode, providerObject, routeObject } = params
  const rawProps = routeNode.components?.guideRoute?.props as
    | Partial<GuideRouteComponentProps>
    | null
    | undefined
  if (rawProps?.version !== 3) {
    return emptyEvaluation(
      routeNode,
      'unsupported',
      'Guide Route data is not V3. Recreate this route.',
    )
  }
  const props = clampGuideRouteComponentProps(rawProps)
  if (!props.legs.length) {
    return emptyEvaluation(routeNode, 'empty-route', 'Guide Route needs at least one leg.')
  }

  const providerObjects = new Map<string, THREE.Object3D>()
  const routeProviderId = props.legs.find((leg): leg is GuideRoadRouteLeg => leg.kind === 'road')?.providerNodeId
  if (providerObject && routeProviderId) {
    providerObjects.set(routeProviderId, providerObject)
  }

  const providerMatrix = providerObject?.matrixWorld ?? null
  routeObject?.updateMatrixWorld(true)
  const providerSourceSignature = JSON.stringify(props.legs.map((leg) => {
    if (leg.kind === 'road') {
      return [
        leg.providerNodeId,
        getProceduralLandscapeGuideRouteSurfaceState(leg.providerNodeId)?.revision ?? 0,
        getProceduralLandscapeRoadCenterlineLocal(leg.providerNodeId)?.pointsXZ ?? [],
      ]
    }
    return [
      leg.surfaceProviderNodeId,
      leg.surfaceProviderNodeId
        ? getProceduralLandscapeGuideRouteSurfaceState(leg.surfaceProviderNodeId)?.revision ?? 0
        : 0,
    ]
  }))
  const cacheKey = buildCacheKey(
    routeNode,
    props,
    providerMatrix,
    routeObject?.matrixWorld ?? null,
    providerSourceSignature,
  )
  const cached = routeEvaluationCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const compiledLegs: CompiledGuideLeg[] = []
  let providerRevision = 0
  let providerNodeId: string | null = null
  const warnings: string[] = []
  let routeDistance = 0
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []

  for (const leg of props.legs) {
    const result = leg.kind === 'road'
      ? compileRoadLeg(leg, providerObjects)
      : compilePathLeg(leg)
    if (!result.ok) {
      return cacheEvaluation(cacheKey, emptyEvaluation(
        routeNode,
        result.status,
        result.message,
        result.providerNodeId,
        Math.max(providerRevision, result.providerRevision),
      ))
    }
    providerRevision = Math.max(providerRevision, result.providerRevision)
    providerNodeId ??= result.providerNodeId
    warnings.push(...result.warnings)
    const compiled = result.leg
    compiled.routeStartDistance = routeDistance
    for (let index = 0; index < compiled.points.length; index += 1) {
      appendUniquePoint(points, normals, compiled.points[index]!, compiled.normals[index]!)
    }
    routeDistance += compiled.totalLength
    compiled.routeEndDistance = routeDistance
    compiledLegs.push(compiled)
  }

  if (points.length < 2) {
    return cacheEvaluation(cacheKey, emptyEvaluation(
      routeNode,
      'invalid-leg',
      'Guide Route has no usable path.',
      providerNodeId,
      providerRevision,
    ))
  }
  const cumulativeLengths = buildCumulativeLengths(points)
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0
  const stops: CompiledGuideStop[] = []
  for (const stop of props.stops) {
    const leg = compiledLegs.find((entry) => entry.definition.id === stop.legId)
    if (!leg || leg.points.length < 2) {
      continue
    }
    const projectionMetric = buildPolylineMetricData(leg.points, {
      closed: false,
      mode: 'xz',
    })
    if (!projectionMetric) {
      continue
    }
    const projection = projectPointToPolyline(
      leg.points,
      projectionMetric,
      new THREE.Vector3(stop.anchor.x, stop.anchor.y, stop.anchor.z),
      new THREE.Vector3(),
    )
    const projectionDistance = Math.sqrt(Math.max(0, projection.distanceSq))
    const segmentStart = leg.cumulativeLengths[projection.segmentIndex] ?? 0
    const segmentEnd = leg.cumulativeLengths[projection.segmentIndex + 1] ?? segmentStart
    const clampedLegS = Math.max(
      0,
      Math.min(leg.totalLength, segmentStart + (segmentEnd - segmentStart) * projection.t),
    )
    stops.push({
      definition: stop,
      legId: leg.definition.id,
      legDistance: clampedLegS,
      routeDistance: leg.routeStartDistance + clampedLegS,
      projectedPoint: projection.closestPoint.clone(),
      projectionDistance,
      behavior: stop.behavior,
    })
    if (projectionDistance > 1000) {
      warnings.push(`Stop ${stop.name || stop.id} is ${projectionDistance.toFixed(0)}m from its assigned leg.`)
    }
  }
  stops.sort((a, b) => (
    a.routeDistance - b.routeDistance
    || props.stops.findIndex((entry) => entry.id === a.definition.id)
      - props.stops.findIndex((entry) => entry.id === b.definition.id)
  ))
  const transitions: CompiledGuideTransition[] = []
  for (const transition of props.transitions) {
    const leg = compiledLegs.find((entry) => entry.definition.id === transition.afterLegId)
    if (!leg) {
      continue
    }
    transitions.push({
      definition: transition,
      afterLegId: transition.afterLegId,
      routeDistance: leg.routeEndDistance,
      behavior: transition.behavior,
    })
  }
  transitions.sort((a, b) => a.routeDistance - b.routeDistance)

  const evaluation: EvaluatedGuideRoute = {
    status: 'ready',
    message: null,
    routeNodeId: routeNode.id,
    providerNodeId,
    revision: providerRevision,
    loop: props.loop,
    points,
    normals,
    cumulativeLengths,
    totalLength,
    legs: compiledLegs,
    stops,
    transitions,
    warnings,
  }
  return cacheEvaluation(cacheKey, evaluation)
}

export function sampleEvaluatedGuideRouteAtDistance(
  route: EvaluatedGuideRoute,
  distanceM: number,
): {
  point: THREE.Vector3
  normal: THREE.Vector3
  leg: CompiledGuideLeg | null
} | null {
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
  return {
    point,
    normal,
    leg: findLegContainingDistance(route.legs, target),
  }
}

export function resolveCompiledGuideLegAtDistance(
  route: EvaluatedGuideRoute,
  distanceM: number,
): CompiledGuideLeg | null {
  return findLegContainingDistance(route.legs, Math.max(0, Math.min(route.totalLength, distanceM)))
}

export function clearGuideRouteEvaluationCache(): void {
  routeEvaluationCache.clear()
}
