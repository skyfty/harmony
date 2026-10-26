import * as THREE from 'three'

import {
  sampleEvaluatedGuideRouteAtDistance,
  type CompiledGuideStop,
  type CompiledGuideTransition,
  type EvaluatedGuideRoute,
} from './guideRouteRuntime'

export type GuideRouteTourTargetOptions = {
  routeNodeId: string
  destinationStopId: string
}

export type GuideRouteTravelWindow = {
  destinationStopId: string
  direction: -1 | 1
  startDistance: number
  endDistance: number
  route: EvaluatedGuideRoute
}

const DISTANCE_EPSILON = 1e-4

function resolveLoopClosureLength(route: EvaluatedGuideRoute): number {
  const first = route.points[0]
  const last = route.points[route.points.length - 1]
  return first && last ? first.distanceTo(last) : 0
}

function clampDistance(route: EvaluatedGuideRoute, value: number, loop: boolean): number {
  const totalLength = route.totalLength + (loop ? resolveLoopClosureLength(route) : 0)
  return Math.max(0, Math.min(totalLength, Number.isFinite(value) ? value : 0))
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

function resolveTravelDirection(
  route: EvaluatedGuideRoute,
  startDistance: number,
  endDistance: number,
  loop: boolean,
): { direction: -1 | 1; distance: number } | null {
  const totalLength = route.totalLength
  const loopLength = totalLength + resolveLoopClosureLength(route)
  if (totalLength <= DISTANCE_EPSILON || (loop && loopLength <= DISTANCE_EPSILON)) {
    return null
  }

  if (loop) {
    const forward = (endDistance - startDistance + loopLength) % loopLength
    const backward = (startDistance - endDistance + loopLength) % loopLength
    if (forward <= DISTANCE_EPSILON && backward <= DISTANCE_EPSILON) {
      return null
    }
    return backward < forward
      ? { direction: -1, distance: backward }
      : { direction: 1, distance: forward }
  }

  const delta = endDistance - startDistance
  if (Math.abs(delta) <= DISTANCE_EPSILON) {
    return null
  }
  return delta > 0
    ? { direction: 1, distance: delta }
    : { direction: -1, distance: -delta }
}

function createWindowRoute(
  route: EvaluatedGuideRoute,
  startDistance: number,
  endDistance: number,
  direction: -1 | 1,
  loop: boolean,
): EvaluatedGuideRoute {
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  const sampleAt = (distance: number) => {
    const sample = sampleEvaluatedGuideRouteAtDistance(route, distance)
    if (!sample || !loop || distance <= route.totalLength + DISTANCE_EPSILON) {
      return sample
    }
    const first = route.points[0]
    const last = route.points[route.points.length - 1]
    if (!first || !last) {
      return sample
    }
    const closureLength = first.distanceTo(last)
    if (closureLength <= DISTANCE_EPSILON) {
      return sample
    }
    const alpha = Math.max(0, Math.min(1, (distance - route.totalLength) / closureLength))
    return {
      point: last.clone().lerp(first, alpha),
      normal: route.normals[route.normals.length - 1]!.clone()
        .lerp(route.normals[0]!, alpha)
        .normalize(),
    }
  }
  const startSample = sampleAt(startDistance)
  if (!startSample) {
    return route
  }
  points.push(startSample.point)
  normals.push(startSample.normal)

  const appendIndex = (index: number) => {
    points.push(route.points[index]!.clone())
    normals.push(route.normals[index]!.clone())
  }
  const isForward = direction > 0
  const wraps = isForward
    ? endDistance < startDistance
    : endDistance > startDistance
  const appendRange = (
    startIndex: number,
    endIndexExclusive: number,
    step: 1 | -1,
    includeAboveStart: boolean,
    includeBelowEnd: boolean,
  ) => {
    for (
      let index = startIndex;
      step > 0 ? index < endIndexExclusive : index >= endIndexExclusive;
      index += step
    ) {
      const distance = route.cumulativeLengths[index] ?? 0
      const inRange = isForward
        ? (
            (!includeAboveStart || distance > startDistance + DISTANCE_EPSILON)
            && (!includeBelowEnd || distance < endDistance - DISTANCE_EPSILON)
          )
        : (
            (!includeAboveStart || distance < startDistance - DISTANCE_EPSILON)
            && (!includeBelowEnd || distance > endDistance + DISTANCE_EPSILON)
          )
      if (inRange) {
        appendIndex(index)
      }
    }
  }

  if (!wraps) {
    if (isForward) {
      appendRange(0, route.points.length, 1, true, true)
    } else {
      appendRange(route.points.length - 1, -1, -1, true, true)
    }
  } else if (isForward) {
    appendRange(0, route.points.length, 1, true, false)
    appendRange(0, route.points.length, 1, false, true)
  } else {
    appendRange(route.points.length - 1, -1, -1, true, false)
    appendRange(route.points.length - 1, -1, -1, false, true)
  }

  const endSample = sampleAt(endDistance)
  if (!endSample) {
    return route
  }
  points.push(endSample.point)
  normals.push(endSample.normal)

  const cumulativeLengths = buildCumulativeLengths(points)
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0
  const mapRouteDistance = (routeDistance: number): number | null => {
    if (!Number.isFinite(routeDistance)) {
      return null
    }
    const epsilon = DISTANCE_EPSILON
    if (!loop) {
      const mapped = direction > 0
        ? routeDistance - startDistance
        : startDistance - routeDistance
      if (mapped < -epsilon || mapped > totalLength + epsilon) {
        return null
      }
      return Math.max(0, Math.min(totalLength, mapped))
    }

    const loopLength = route.totalLength + resolveLoopClosureLength(route)
    if (loopLength <= epsilon) {
      return null
    }
    const normalizeDistance = (distance: number) => (
      ((distance % loopLength) + loopLength) % loopLength
    )
    const normalizedStart = normalizeDistance(startDistance)
    const normalizedRouteDistance = normalizeDistance(routeDistance)
    const mapped = direction > 0
      ? normalizeDistance(normalizedRouteDistance - normalizedStart)
      : normalizeDistance(normalizedStart - normalizedRouteDistance)
    if (mapped > totalLength + epsilon) {
      return null
    }
    return Math.max(0, Math.min(totalLength, mapped))
  }
  const stops = route.stops.flatMap((stop): CompiledGuideStop[] => {
    const mappedDistance = mapRouteDistance(stop.routeDistance)
    return mappedDistance === null
      ? []
      : [{ ...stop, routeDistance: mappedDistance }]
  }).sort((left, right) => left.routeDistance - right.routeDistance)
  const transitions = route.transitions.flatMap((transition): CompiledGuideTransition[] => {
    const mappedDistance = mapRouteDistance(transition.routeDistance)
    return mappedDistance === null
      ? []
      : [{ ...transition, routeDistance: mappedDistance }]
  }).sort((left, right) => left.routeDistance - right.routeDistance)
  return {
    ...route,
    points,
    normals,
    cumulativeLengths,
    totalLength,
    legs: route.legs.map((leg) => ({
      ...leg,
      routeStartDistance: 0,
      routeEndDistance: totalLength,
    })),
    stops,
    transitions,
  }
}

export function buildGuideRouteTravelWindow(
  route: EvaluatedGuideRoute,
  startDistance: number,
  options: GuideRouteTourTargetOptions,
  loop: boolean,
): GuideRouteTravelWindow | null {
  if (route.status !== 'ready' || route.points.length < 2) {
    return null
  }
  if (options.routeNodeId !== route.routeNodeId) {
    return null
  }
  const destinationStop = route.stops.find((stop) => stop.definition.id === options.destinationStopId) ?? null
  if (!destinationStop) {
    return null
  }
  const destinationDistance = destinationStop.routeDistance
  const start = clampDistance(route, startDistance, loop)
  const end = clampDistance(route, destinationDistance, loop)
  const travelDirection = resolveTravelDirection(route, start, end, loop)
  if (!travelDirection) {
    return null
  }
  const windowRoute = createWindowRoute(route, start, end, travelDirection.direction, loop)
  return {
    destinationStopId: destinationStop.definition.id,
    direction: travelDirection.direction,
    startDistance: start,
    endDistance: end,
    route: windowRoute,
  }
}
