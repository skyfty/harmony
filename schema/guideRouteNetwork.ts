import * as THREE from 'three'

import type { SceneNode } from './core'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampGuideRouteComponentProps,
  guideRouteModeSupportsActor,
  type GuideRouteActorKind,
  type GuideRouteComponentProps,
  type GuideRouteLeg,
  type GuideRouteTravelMode,
} from './components/definitions/guideRouteComponent'
import {
  evaluateGuideRoute,
  resolveGuideRoutePrimaryProviderNodeId,
  sampleEvaluatedGuideRouteAtDistance,
  type CompiledGuideLeg,
  type CompiledGuideStop,
  type CompiledGuideTransition,
  type EvaluatedGuideRoute,
} from './guideRouteRuntime'
import type {
  GuideRouteNetworkTravelInfo,
  GuideRouteTravelWindow,
} from './guideRouteTourTarget'
import { buildPolylineMetricData } from './polylineProgress'

export const GUIDE_ROUTE_HANDOFF_STOP_PREFIX = '__guide_route_handoff__'

export type GuideRouteJourneyActor = {
  nodeId: string
  kind: GuideRouteActorKind
  position: { x: number; y: number; z: number }
}

export type GuideRouteJourneySegment = {
  routeNodeId: string
  startDistance: number
  endDistance: number
  direction: -1 | 1
  actorKind: GuideRouteActorKind
  lengthM: number
}

export type GuideRouteJourneyControlSpan = {
  actorKind: GuideRouteActorKind
  actorNodeId: string
  startDistance: number
  endDistance: number
}

export type GuideRouteJourneyHandoff = {
  routeDistance: number
  fromKind: GuideRouteActorKind
  toKind: GuideRouteActorKind
  position: THREE.Vector3
}

export type GuideRouteJourneyPlan = {
  targetRouteNodeId: string
  targetStopId: string
  entryRouteNodeId: string
  entryActorKind: GuideRouteActorKind
  entryPosition: THREE.Vector3
  snapDistanceM: number
  travelDistanceM: number
  switchCount: number
  sourceRouteNodeIds: string[]
  sourceSignature: string
  segments: GuideRouteJourneySegment[]
  controlSpans: GuideRouteJourneyControlSpan[]
  handoffs: GuideRouteJourneyHandoff[]
  route: EvaluatedGuideRoute
  targetReached: boolean
}

export type PlanGuideRouteJourneyOptions = {
  iterNodes: () => Iterable<SceneNode>
  nodeObjectMap: Map<string, THREE.Object3D>
  targetRouteNodeId: string
  destinationStopId: string
  startActorNodeId: string
  startPosition: THREE.Vector3
  actors: GuideRouteJourneyActor[]
}

type RouteSource = {
  node: SceneNode
  props: GuideRouteComponentProps
  evaluation: EvaluatedGuideRoute
  order: number
}

type NetworkVertex = {
  id: string
  point: THREE.Vector3
  edges: string[]
}

type NetworkEdge = {
  id: string
  from: string
  to: string
  points: THREE.Vector3[]
  normals: THREE.Vector3[]
  mode: GuideRouteTravelMode
  length: number
  routeNodeId: string
  sourceStartDistance: number
  sourceEndDistance: number
  leg: GuideRouteLeg
  kind: 'route' | 'branch'
}

type NetworkGraph = {
  vertices: Map<string, NetworkVertex>
  edges: Map<string, NetworkEdge>
  targetVertexId: string
}

type TraversalStep = {
  edge: NetworkEdge
  fromOffset: number
  toOffset: number
  actorKind: GuideRouteActorKind
}

type SearchHandoff = {
  routeDistance: number
  fromKind: GuideRouteActorKind
  toKind: GuideRouteActorKind
}

type SearchPath = {
  steps: TraversalStep[]
  handoffs: SearchHandoff[]
}

type SearchState = {
  vertexId: string
  actorKind: GuideRouteActorKind
  switches: number
  distance: number
  path: SearchPath
}

type EntryCandidate = {
  edge: NetworkEdge
  offset: number
  point: THREE.Vector3
  snapDistanceM: number
  state: SearchState
}

const EPSILON = 1e-4

function otherActorKind(kind: GuideRouteActorKind): GuideRouteActorKind {
  return kind === 'vehicle' ? 'character' : 'vehicle'
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

function buildCumulativeLengths(points: readonly THREE.Vector3[]): number[] {
  const result = new Array<number>(points.length)
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      total += points[index]!.distanceTo(points[index - 1]!)
    }
    result[index] = total
  }
  return result
}

function findLegAtDistance(
  route: EvaluatedGuideRoute,
  distance: number,
): CompiledGuideLeg {
  return route.legs.find((leg) => (
    distance >= leg.routeStartDistance - EPSILON
    && distance <= leg.routeEndDistance + EPSILON
  )) ?? route.legs[route.legs.length - 1]!
}

function sampleRoute(
  route: EvaluatedGuideRoute,
  distance: number,
): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  const sample = sampleEvaluatedGuideRouteAtDistance(route, distance)
  return sample ? { point: sample.point, normal: sample.normal } : null
}

function sliceRouteGeometry(
  route: EvaluatedGuideRoute,
  startDistance: number,
  endDistance: number,
): { points: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const start = sampleRoute(route, startDistance)
  const end = sampleRoute(route, endDistance)
  if (!start || !end) {
    return { points: [], normals: [] }
  }
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  appendUniquePoint(points, normals, start.point, start.normal)
  for (let index = 0; index < route.points.length; index += 1) {
    const distance = route.cumulativeLengths[index] ?? 0
    if (distance > startDistance + EPSILON && distance < endDistance - EPSILON) {
      appendUniquePoint(points, normals, route.points[index]!, route.normals[index]!)
    }
  }
  appendUniquePoint(points, normals, end.point, end.normal)
  return { points, normals }
}

function resolveRouteSources(options: PlanGuideRouteJourneyOptions): {
  target: RouteSource
  sources: RouteSource[]
  signature: string
} | null {
  const all: RouteSource[] = []
  let order = 0
  for (const node of options.iterNodes()) {
    const component = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE]
    if (
      node.dynamicMesh?.type !== 'GuideRoute'
      || !component
      || component.enabled === false
    ) {
      continue
    }
    const props = clampGuideRouteComponentProps(
      component.props as Partial<GuideRouteComponentProps> | null | undefined,
    )
    const providerNodeId = resolveGuideRoutePrimaryProviderNodeId(props)
    const providerObject = providerNodeId
      ? options.nodeObjectMap.get(providerNodeId) ?? null
      : null
    const routeObject = options.nodeObjectMap.get(node.id) ?? null
    const evaluation = evaluateGuideRoute({ routeNode: node, providerObject, routeObject })
    if (evaluation.status !== 'ready') {
      continue
    }
    all.push({ node, props, evaluation, order: order++ })
  }
  const byId = new Map(all.map((source) => [source.node.id, source] as const))
  const target = byId.get(options.targetRouteNodeId) ?? null
  if (!target) {
    return null
  }

  const children = new Map<string, RouteSource[]>()
  const parentIds = new Map<string, string>()
  for (const source of all) {
    const parentId = source.props.branchOrigin?.routeNodeId?.trim() || ''
    if (!parentId || !byId.has(parentId)) {
      continue
    }
    parentIds.set(source.node.id, parentId)
    const entries = children.get(parentId) ?? []
    entries.push(source)
    children.set(parentId, entries)
  }

  let root = target
  const visitedParents = new Set<string>()
  while (!visitedParents.has(root.node.id)) {
    visitedParents.add(root.node.id)
    const parentId = parentIds.get(root.node.id)
    const parent = parentId ? byId.get(parentId) ?? null : null
    if (!parent) {
      break
    }
    root = parent
  }

  const component: RouteSource[] = []
  const visited = new Set<string>()
  const visit = (source: RouteSource): void => {
    if (visited.has(source.node.id)) {
      return
    }
    visited.add(source.node.id)
    component.push(source)
    for (const child of children.get(source.node.id) ?? []) {
      visit(child)
    }
  }
  visit(root)
  if (!visited.has(target.node.id)) {
    visit(target)
  }
  component.sort((left, right) => left.order - right.order)
  const signature = JSON.stringify(component.map((source) => [
    source.node.id,
    source.props,
    source.evaluation.points.length,
    source.evaluation.totalLength,
  ]))
  return { target, sources: component, signature }
}

function vertexKey(routeNodeId: string, routeDistance: number): string {
  return `${routeNodeId}@${routeDistance.toFixed(5)}`
}

function addVertex(
  graph: NetworkGraph,
  id: string,
  point: THREE.Vector3,
): NetworkVertex {
  const existing = graph.vertices.get(id)
  if (existing) {
    return existing
  }
  const vertex = { id, point: point.clone(), edges: [] }
  graph.vertices.set(id, vertex)
  return vertex
}

function addEdge(graph: NetworkGraph, edge: NetworkEdge): void {
  if (graph.edges.has(edge.id)) {
    return
  }
  graph.edges.set(edge.id, edge)
  graph.vertices.get(edge.from)?.edges.push(edge.id)
  graph.vertices.get(edge.to)?.edges.push(edge.id)
}

function sliceLegGeometry(
  leg: CompiledGuideLeg,
  startDistance: number,
  endDistance: number,
): { points: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const points: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  const sample = (distance: number) => {
    const target = Math.max(0, Math.min(leg.totalLength, distance))
    let low = 0
    let high = leg.cumulativeLengths.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) * 0.5)
      if ((leg.cumulativeLengths[middle] ?? 0) < target) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const endIndex = Math.max(1, low)
    const startIndex = Math.max(0, endIndex - 1)
    const startLength = leg.cumulativeLengths[startIndex] ?? 0
    const endLength = leg.cumulativeLengths[endIndex] ?? startLength
    const span = endLength - startLength
    const alpha = span > 1e-8 ? (target - startLength) / span : 0
    return {
      point: leg.points[startIndex]!.clone().lerp(leg.points[endIndex]!, alpha),
      normal: leg.normals[startIndex]!.clone().lerp(leg.normals[endIndex]!, alpha).normalize(),
    }
  }
  const start = sample(startDistance)
  const end = sample(endDistance)
  appendUniquePoint(points, normals, start.point, start.normal)
  for (let index = 0; index < leg.points.length; index += 1) {
    const distance = leg.cumulativeLengths[index] ?? 0
    if (distance > startDistance + EPSILON && distance < endDistance - EPSILON) {
      appendUniquePoint(points, normals, leg.points[index]!, leg.normals[index]!)
    }
  }
  appendUniquePoint(points, normals, end.point, end.normal)
  return { points, normals }
}

function buildNetwork(
  target: RouteSource,
  sources: RouteSource[],
  destinationStopId: string,
): NetworkGraph | null {
  const targetStop = target.evaluation.stops.find(
    (stop) => stop.definition.id === destinationStopId,
  )
  if (!targetStop) {
    return null
  }
  const graph: NetworkGraph = {
    vertices: new Map(),
    edges: new Map(),
    targetVertexId: vertexKey(target.node.id, targetStop.routeDistance),
  }
  const childStopsByParent = new Map<string, Array<{ child: RouteSource; stopId: string }>>()
  for (const source of sources) {
    const origin = source.props.branchOrigin
    if (!origin) {
      continue
    }
    const entries = childStopsByParent.get(origin.routeNodeId) ?? []
    entries.push({ child: source, stopId: origin.stopId })
    childStopsByParent.set(origin.routeNodeId, entries)
  }

  for (const source of sources) {
    const breaks = new Set<number>([0, source.evaluation.totalLength])
    for (const leg of source.evaluation.legs) {
      breaks.add(leg.routeStartDistance)
      breaks.add(leg.routeEndDistance)
    }
    for (const child of childStopsByParent.get(source.node.id) ?? []) {
      const stop = source.evaluation.stops.find(
        (entry) => entry.definition.id === child.stopId,
      )
      if (stop) {
        breaks.add(stop.routeDistance)
      }
    }
    if (source.node.id === target.node.id) {
      breaks.add(targetStop.routeDistance)
    }
    const ordered = [...breaks]
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const startDistance = ordered[index]!
      const endDistance = ordered[index + 1]!
      if (endDistance - startDistance <= EPSILON) {
        continue
      }
      const leg = findLegAtDistance(source.evaluation, (startDistance + endDistance) * 0.5)
      const legStart = Math.max(startDistance, leg.routeStartDistance)
      const legEnd = Math.min(endDistance, leg.routeEndDistance)
      const geometry = sliceLegGeometry(
        leg,
        legStart - leg.routeStartDistance,
        legEnd - leg.routeStartDistance,
      )
      if (geometry.points.length < 2) {
        continue
      }
      const fromId = vertexKey(source.node.id, startDistance)
      const toId = vertexKey(source.node.id, endDistance)
      addVertex(graph, fromId, geometry.points[0]!)
      addVertex(graph, toId, geometry.points[geometry.points.length - 1]!)
      addEdge(graph, {
        id: `${source.node.id}:${startDistance.toFixed(5)}:${endDistance.toFixed(5)}`,
        from: fromId,
        to: toId,
        points: geometry.points,
        normals: geometry.normals,
        mode: leg.travelMode,
        length: (leg.cumulativeLengths.reduce((max, value) => Math.max(max, value), 0) > 0)
          ? (buildCumulativeLengths(geometry.points)[geometry.points.length - 1] ?? 0)
          : 0,
        routeNodeId: source.node.id,
        sourceStartDistance: legStart,
        sourceEndDistance: legEnd,
        leg: leg.definition,
        kind: 'route',
      })
    }

    if (source.evaluation.loop) {
      const firstLeg = source.evaluation.legs[0]
      const lastLeg = source.evaluation.legs[source.evaluation.legs.length - 1]
      const first = source.evaluation.points[0]
      const last = source.evaluation.points[source.evaluation.points.length - 1]
      if (first && last && firstLeg && lastLeg) {
        const commonMode = firstLeg.travelMode === lastLeg.travelMode
          ? firstLeg.travelMode
          : (firstLeg.travelMode === 'both'
              ? lastLeg.travelMode
              : (lastLeg.travelMode === 'both' ? firstLeg.travelMode : null))
        if (commonMode) {
          const fromId = vertexKey(source.node.id, source.evaluation.totalLength)
          const toId = vertexKey(source.node.id, 0)
          addVertex(graph, fromId, last)
          addVertex(graph, toId, first)
          addEdge(graph, {
            id: `${source.node.id}:loop-closure`,
            from: fromId,
            to: toId,
            points: [last.clone(), first.clone()],
            normals: [
              source.evaluation.normals[source.evaluation.normals.length - 1]!.clone(),
              source.evaluation.normals[0]!.clone(),
            ],
            mode: commonMode,
            length: last.distanceTo(first),
            routeNodeId: source.node.id,
            sourceStartDistance: source.evaluation.totalLength,
            sourceEndDistance: 0,
            leg: lastLeg.definition,
            kind: 'route',
          })
        }
      }
    }
  }

  for (const source of sources) {
    const origin = source.props.branchOrigin
    if (!origin) {
      continue
    }
    const parent = sources.find((entry) => entry.node.id === origin.routeNodeId)
    if (!parent) {
      continue
    }
    const parentStop = parent.evaluation.stops.find(
      (stop) => stop.definition.id === origin.stopId,
    )
    const childStart = sampleRoute(source.evaluation, 0)
    const firstLeg = source.evaluation.legs[0]
    if (!parentStop || !childStart || !firstLeg) {
      continue
    }
    const fromId = vertexKey(parent.node.id, parentStop.routeDistance)
    const toId = vertexKey(source.node.id, 0)
    addVertex(graph, fromId, parentStop.projectedPoint)
    addVertex(graph, toId, childStart.point)
    const samePoint = parentStop.projectedPoint.distanceToSquared(childStart.point) <= 1e-8
    addEdge(graph, {
      id: `branch:${parent.node.id}:${origin.stopId}:${source.node.id}`,
      from: fromId,
      to: toId,
      points: samePoint
        ? [parentStop.projectedPoint.clone()]
        : [parentStop.projectedPoint.clone(), childStart.point.clone()],
      normals: [
        sampleRoute(parent.evaluation, parentStop.routeDistance)?.normal.clone()
          ?? new THREE.Vector3(0, 1, 0),
        ...(samePoint ? [] : [childStart.normal.clone()]),
      ],
      mode: 'both',
      length: samePoint ? 0 : parentStop.projectedPoint.distanceTo(childStart.point),
      routeNodeId: source.node.id,
      sourceStartDistance: 0,
      sourceEndDistance: 0,
      leg: firstLeg.definition,
      kind: 'branch',
    })
  }
  return graph.vertices.has(graph.targetVertexId) ? graph : null
}

function projectToEdge(
  edge: NetworkEdge,
  point: THREE.Vector3,
): { offset: number; point: THREE.Vector3; distanceSq: number } {
  if (edge.points.length < 2 || edge.length <= EPSILON) {
    return {
      offset: 0,
      point: edge.points[0]?.clone() ?? new THREE.Vector3(),
      distanceSq: edge.points[0]
        ? (edge.points[0].x - point.x) ** 2 + (edge.points[0].z - point.z) ** 2
        : Number.POSITIVE_INFINITY,
    }
  }
  let bestOffset = 0
  let bestPoint = edge.points[0]!.clone()
  let bestDistanceSq = Number.POSITIVE_INFINITY
  let offset = 0
  for (let index = 0; index + 1 < edge.points.length; index += 1) {
    const start = edge.points[index]!
    const end = edge.points[index + 1]!
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSq = dx * dx + dz * dz
    const segmentLength = Math.sqrt(lengthSq)
    if (segmentLength <= EPSILON) {
      continue
    }
    const alpha = Math.max(0, Math.min(1, (
      (point.x - start.x) * dx + (point.z - start.z) * dz
    ) / lengthSq))
    const candidate = start.clone().lerp(end, alpha)
    const distanceSq = (candidate.x - point.x) ** 2 + (candidate.z - point.z) ** 2
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestOffset = offset + segmentLength * alpha
      bestPoint = candidate
    }
    offset += segmentLength
  }
  return { offset: bestOffset, point: bestPoint, distanceSq: bestDistanceSq }
}

function compareState(left: SearchState, right: SearchState): number {
  return (
    left.switches - right.switches
    || left.distance - right.distance
    || left.vertexId.localeCompare(right.vertexId)
    || left.actorKind.localeCompare(right.actorKind)
  )
}

function searchFromEntry(
  graph: NetworkGraph,
  edge: NetworkEdge,
  offset: number,
  startActorKind: GuideRouteActorKind,
  availableKinds: Set<GuideRouteActorKind>,
): SearchState | null {
  const links = [
    offset > EPSILON
      ? { vertexId: edge.from, distance: offset, fromOffset: offset, toOffset: 0 }
      : null,
    edge.length - offset > EPSILON
      ? { vertexId: edge.to, distance: edge.length - offset, fromOffset: offset, toOffset: edge.length }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  if (!links.length) {
    links.push({
      vertexId: edge.from,
      distance: 0,
      fromOffset: 0,
      toOffset: 0,
    })
  }

  const queue: SearchState[] = []
  const best = new Map<string, SearchState>()
  const pushStart = (actorKind: GuideRouteActorKind, switches: number) => {
    for (const link of links) {
      if (!guideRouteModeSupportsActor(edge.mode, actorKind)) {
        continue
      }
      const path: SearchPath = {
        steps: link.distance > EPSILON
          ? [{ edge, fromOffset: link.fromOffset, toOffset: link.toOffset, actorKind }]
          : [],
        handoffs: switches > 0
          ? [{
              routeDistance: 0,
              fromKind: startActorKind,
              toKind: actorKind,
            }]
          : [],
      }
      const state: SearchState = {
        vertexId: link.vertexId,
        actorKind,
        switches,
        distance: link.distance,
        path,
      }
      const key = `${state.vertexId}|${state.actorKind}`
      const previous = best.get(key)
      if (!previous || compareState(state, previous) < 0) {
        best.set(key, state)
        queue.push(state)
      }
    }
  }

  pushStart(startActorKind, 0)
  const other = otherActorKind(startActorKind)
  if (availableKinds.has(other)) {
    pushStart(other, 1)
  }

  let result: SearchState | null = null
  while (queue.length) {
    queue.sort(compareState)
    const state = queue.shift()!
    if (best.get(`${state.vertexId}|${state.actorKind}`) !== state) {
      continue
    }
    if (state.vertexId === graph.targetVertexId) {
      result = state
      break
    }
    const vertex = graph.vertices.get(state.vertexId)
    if (!vertex) {
      continue
    }
    const opposite = otherActorKind(state.actorKind)
    if (availableKinds.has(opposite)) {
      const switched: SearchState = {
        ...state,
        actorKind: opposite,
        switches: state.switches + 1,
        path: {
          steps: state.path.steps,
          handoffs: [...state.path.handoffs, {
            routeDistance: state.distance,
            fromKind: state.actorKind,
            toKind: opposite,
          }],
        },
      }
      const key = `${switched.vertexId}|${switched.actorKind}`
      const previous = best.get(key)
      if (!previous || compareState(switched, previous) < 0) {
        best.set(key, switched)
        queue.push(switched)
      }
    }
    for (const edgeId of vertex.edges) {
      const edge = graph.edges.get(edgeId)
      if (!edge || !guideRouteModeSupportsActor(edge.mode, state.actorKind)) {
        continue
      }
      const neighborId = edge.from === state.vertexId ? edge.to : edge.from
      const next: SearchState = {
        vertexId: neighborId,
        actorKind: state.actorKind,
        switches: state.switches,
        distance: state.distance + edge.length,
        path: {
          steps: [...state.path.steps, {
            edge,
            fromOffset: edge.from === state.vertexId ? 0 : edge.length,
            toOffset: edge.from === state.vertexId ? edge.length : 0,
            actorKind: state.actorKind,
          }],
          handoffs: state.path.handoffs,
        },
      }
      const key = `${next.vertexId}|${next.actorKind}`
      const previous = best.get(key)
      if (!previous || compareState(next, previous) < 0) {
        best.set(key, next)
        queue.push(next)
      }
    }
  }
  return result
}

function sampleEdgeAtOffset(edge: NetworkEdge, offset: number): {
  point: THREE.Vector3
  normal: THREE.Vector3
} {
  if (!edge.points.length) {
    return {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
    }
  }
  if (edge.points.length === 1 || edge.length <= EPSILON) {
    return {
      point: edge.points[0]!.clone(),
      normal: edge.normals[0]?.clone() ?? new THREE.Vector3(0, 1, 0),
    }
  }
  const target = Math.max(0, Math.min(edge.length, offset))
  let traversed = 0
  for (let index = 0; index + 1 < edge.points.length; index += 1) {
    const start = edge.points[index]!
    const end = edge.points[index + 1]!
    const length = start.distanceTo(end)
    if (target <= traversed + length + EPSILON) {
      const alpha = length > EPSILON ? (target - traversed) / length : 0
      return {
        point: start.clone().lerp(end, alpha),
        normal: (edge.normals[index] ?? new THREE.Vector3(0, 1, 0)).clone()
          .lerp(edge.normals[index + 1] ?? edge.normals[index] ?? new THREE.Vector3(0, 1, 0), alpha)
          .normalize(),
      }
    }
    traversed += length
  }
  return {
    point: edge.points[edge.points.length - 1]!.clone(),
    normal: edge.normals[edge.normals.length - 1]?.clone() ?? new THREE.Vector3(0, 1, 0),
  }
}

function sliceEdge(
  edge: NetworkEdge,
  fromOffset: number,
  toOffset: number,
): { points: THREE.Vector3[]; normals: THREE.Vector3[] } {
  if (Math.abs(toOffset - fromOffset) <= EPSILON) {
    const sample = sampleEdgeAtOffset(edge, fromOffset)
    return { points: [sample.point], normals: [sample.normal] }
  }
  const direction = toOffset >= fromOffset ? 1 : -1
  let start = Math.min(fromOffset, toOffset)
  let end = Math.max(fromOffset, toOffset)
  const samples: Array<{ offset: number; point: THREE.Vector3; normal: THREE.Vector3 }> = []
  const startSample = sampleEdgeAtOffset(edge, start)
  samples.push({ offset: start, ...startSample })
  let traversed = 0
  for (let index = 0; index + 1 < edge.points.length; index += 1) {
    const a = edge.points[index]!
    const b = edge.points[index + 1]!
    traversed += a.distanceTo(b)
    if (traversed > start + EPSILON && traversed < end - EPSILON) {
      samples.push({
        offset: traversed,
        point: b.clone(),
        normal: edge.normals[index + 1]?.clone() ?? new THREE.Vector3(0, 1, 0),
      })
    }
  }
  const endSample = sampleEdgeAtOffset(edge, end)
  samples.push({ offset: end, ...endSample })
  const ordered = direction > 0 ? samples : samples.reverse()
  return {
    points: ordered.map((sample) => sample.point),
    normals: ordered.map((sample) => sample.normal),
  }
}

function sliceJourneyRoute(
  route: EvaluatedGuideRoute,
  startDistance: number,
  endDistance: number,
  destinationStop: CompiledGuideStop,
): EvaluatedGuideRoute | null {
  const geometry = sliceRouteGeometry(route, startDistance, endDistance)
  if (geometry.points.length < 2) {
    return null
  }
  const legs: CompiledGuideLeg[] = []
  let syntheticDistance = 0
  for (const sourceLeg of route.legs) {
    const legStart = Math.max(startDistance, sourceLeg.routeStartDistance)
    const legEnd = Math.min(endDistance, sourceLeg.routeEndDistance)
    if (legEnd - legStart <= EPSILON) {
      continue
    }
    const legGeometry = sliceRouteGeometry(
      {
        ...route,
        points: sourceLeg.points,
        normals: sourceLeg.normals,
        cumulativeLengths: sourceLeg.cumulativeLengths,
        totalLength: sourceLeg.totalLength,
        legs: [sourceLeg],
      },
      legStart - sourceLeg.routeStartDistance,
      legEnd - sourceLeg.routeStartDistance,
    )
    const legCumulative = buildCumulativeLengths(legGeometry.points)
    const metricData = buildPolylineMetricData(legGeometry.points, { closed: false, mode: '3d' })
    if (!metricData || legGeometry.points.length < 2) {
      continue
    }
    const length = legCumulative[legCumulative.length - 1] ?? 0
    legs.push({
      ...sourceLeg,
      points: legGeometry.points,
      normals: legGeometry.normals,
      cumulativeLengths: legCumulative,
      metricData,
      totalLength: length,
      routeStartDistance: syntheticDistance,
      routeEndDistance: syntheticDistance + length,
    })
    syntheticDistance += length
  }
  if (!legs.length) {
    return null
  }
  const mapDistance = (distance: number) => distance - startDistance
  const stops = route.stops
    .filter((stop) => (
      stop.routeDistance > startDistance + EPSILON
      && stop.routeDistance <= endDistance + EPSILON
      && !(stop.routeNodeId === destinationStop.routeNodeId
        && stop.definition.id === destinationStop.definition.id)
    ))
    .map((stop) => ({
      ...stop,
      routeDistance: Math.max(0, Math.min(syntheticDistance, mapDistance(stop.routeDistance))),
    }))
  stops.push({
    ...destinationStop,
    routeDistance: syntheticDistance,
    legId: legs[legs.length - 1]!.definition.id,
  })
  const cumulativeLengths = buildCumulativeLengths(geometry.points)
  return {
    ...route,
    points: geometry.points,
    normals: geometry.normals,
    cumulativeLengths,
    totalLength: cumulativeLengths[cumulativeLengths.length - 1] ?? syntheticDistance,
    legs,
    stops: stops.sort((left, right) => left.routeDistance - right.routeDistance),
    transitions: route.transitions
      .filter((transition) => (
        transition.routeDistance > startDistance + EPSILON
        && transition.routeDistance <= endDistance + EPSILON
      ))
      .map((transition) => ({
        ...transition,
        routeDistance: Math.max(0, Math.min(syntheticDistance, mapDistance(transition.routeDistance))),
      })),
    loop: false,
  }
}

function chooseActorNodeId(
  kind: GuideRouteActorKind,
  point: THREE.Vector3,
  actors: GuideRouteJourneyActor[],
  preferred: Map<GuideRouteActorKind, string>,
): string | null {
  const prior = preferred.get(kind)
  if (prior && actors.some((actor) => actor.nodeId === prior && actor.kind === kind)) {
    return prior
  }
  let best: GuideRouteJourneyActor | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const actor of actors) {
    if (actor.kind !== kind) {
      continue
    }
    const dx = actor.position.x - point.x
    const dz = actor.position.z - point.z
    const distance = dx * dx + dz * dz
    if (
      distance < bestDistance
      || (distance === bestDistance && best && actor.nodeId.localeCompare(best.nodeId) < 0)
    ) {
      best = actor
      bestDistance = distance
    }
  }
  return best?.nodeId ?? null
}

export function planGuideRouteJourney(
  options: PlanGuideRouteJourneyOptions,
): GuideRouteJourneyPlan | null {
  const resolved = resolveRouteSources(options)
  if (!resolved) {
    return null
  }
  const targetStop = resolved.target.evaluation.stops.find(
    (stop) => stop.definition.id === options.destinationStopId,
  )
  if (!targetStop) {
    return null
  }
  const graph = buildNetwork(resolved.target, resolved.sources, options.destinationStopId)
  if (!graph) {
    return null
  }
  const startActor = options.actors.find((actor) => actor.nodeId === options.startActorNodeId)
  if (!startActor) {
    return null
  }
  const availableKinds = new Set(options.actors.map((actor) => actor.kind))
  const targetPoint = graph.vertices.get(graph.targetVertexId)?.point
  if (!targetPoint) {
    return null
  }
  if (Math.hypot(
    options.startPosition.x - targetPoint.x,
    options.startPosition.z - targetPoint.z,
  ) <= 0.05) {
    const emptyRoute: EvaluatedGuideRoute = {
      status: 'ready',
      message: null,
      routeNodeId: targetStop.routeNodeId,
      providerNodeId: resolved.target.evaluation.providerNodeId,
      revision: resolved.target.evaluation.revision,
      loop: false,
      points: [targetPoint.clone()],
      normals: [new THREE.Vector3(0, 1, 0)],
      cumulativeLengths: [0],
      totalLength: 0,
      legs: [],
      stops: [targetStop],
      transitions: [],
      warnings: [],
    }
    return {
      targetRouteNodeId: targetStop.routeNodeId,
      targetStopId: targetStop.definition.id,
      entryRouteNodeId: targetStop.routeNodeId,
      entryActorKind: startActor.kind,
      entryPosition: targetPoint.clone(),
      snapDistanceM: 0,
      travelDistanceM: 0,
      switchCount: 0,
      sourceRouteNodeIds: resolved.sources.map((source) => source.node.id),
      sourceSignature: resolved.signature,
      segments: [],
      controlSpans: [],
      handoffs: [],
      route: emptyRoute,
      targetReached: true,
    }
  }

  let best: EntryCandidate | null = null
  for (const edge of graph.edges.values()) {
    const projection = projectToEdge(edge, options.startPosition)
    if (!Number.isFinite(projection.distanceSq)) {
      continue
    }
    const state = searchFromEntry(
      graph,
      edge,
      projection.offset,
      startActor.kind,
      availableKinds,
    )
    if (!state) {
      continue
    }
    const candidate: EntryCandidate = {
      edge,
      offset: projection.offset,
      point: projection.point,
      snapDistanceM: Math.sqrt(Math.max(0, projection.distanceSq)),
      state,
    }
    if (
      !best
      || candidate.state.switches < best.state.switches
      || (
        candidate.state.switches === best.state.switches
        && candidate.snapDistanceM < best.snapDistanceM - EPSILON
      )
      || (
        candidate.state.switches === best.state.switches
        && Math.abs(candidate.snapDistanceM - best.snapDistanceM) <= EPSILON
        && candidate.state.distance < best.state.distance - EPSILON
      )
      || (
        candidate.state.switches === best.state.switches
        && Math.abs(candidate.snapDistanceM - best.snapDistanceM) <= EPSILON
        && Math.abs(candidate.state.distance - best.state.distance) <= EPSILON
        && candidate.edge.id.localeCompare(best.edge.id) < 0
      )
    ) {
      best = candidate
    }
  }
  if (!best) {
    return null
  }

  const sourceById = new Map(resolved.sources.map((source) => [source.node.id, source] as const))
  const originalBuildJourneyRoute = (path: SearchPath) => {
    const points: THREE.Vector3[] = []
    const normals: THREE.Vector3[] = []
    const legs: CompiledGuideLeg[] = []
    const stops: CompiledGuideStop[] = []
    const transitions: CompiledGuideTransition[] = []
    const segments: GuideRouteJourneySegment[] = []
    let routeDistance = 0
    const seenStops = new Set<string>()
    const seenTransitions = new Set<string>()

    for (const step of path.steps) {
      const source = sourceById.get(step.edge.routeNodeId)
      if (!source) {
        return null
      }
      const geometry = sliceEdge(step.edge, step.fromOffset, step.toOffset)
      const legPoints: THREE.Vector3[] = []
      const legNormals: THREE.Vector3[] = []
      for (let pointIndex = 0; pointIndex < geometry.points.length; pointIndex += 1) {
        appendUniquePoint(points, normals, geometry.points[pointIndex]!, geometry.normals[pointIndex]!)
        appendUniquePoint(legPoints, legNormals, geometry.points[pointIndex]!, geometry.normals[pointIndex]!)
      }
      if (legPoints.length < 2) {
        continue
      }
      const legCumulative = buildCumulativeLengths(legPoints)
      const legLength = legCumulative[legCumulative.length - 1] ?? 0
      const metricData = buildPolylineMetricData(legPoints, { closed: false, mode: '3d' })
      if (!metricData) {
        continue
      }
      const definition: GuideRouteLeg = { ...step.edge.leg, travelMode: step.actorKind }
      const syntheticLeg: CompiledGuideLeg = {
        definition,
        points: legPoints,
        normals: legNormals,
        cumulativeLengths: legCumulative,
        metricData,
        totalLength: legLength,
        routeStartDistance: routeDistance,
        routeEndDistance: routeDistance + legLength,
        travelMode: step.actorKind,
        speedProfile: step.edge.leg.speedProfile,
      }
      const stepStart = routeDistance
      const sourceLow = Math.min(step.edge.sourceStartDistance, step.edge.sourceEndDistance)
      const sourceHigh = Math.max(step.edge.sourceStartDistance, step.edge.sourceEndDistance)
      const mapSourceDistance = (sourceDistance: number): number | null => {
        const offset = Math.abs(sourceDistance - step.edge.sourceStartDistance)
        const synthetic = step.toOffset >= step.fromOffset
          ? offset - step.fromOffset
          : step.fromOffset - offset
        if (synthetic < -EPSILON || synthetic > legLength + EPSILON) {
          return null
        }
        return stepStart + Math.max(0, Math.min(legLength, synthetic))
      }
      for (const stop of source.evaluation.stops) {
        if (stop.routeDistance < sourceLow - EPSILON || stop.routeDistance > sourceHigh + EPSILON) {
          continue
        }
        const mapped = mapSourceDistance(stop.routeDistance)
        const key = `${stop.routeNodeId}:${stop.definition.id}`
        if (mapped === null || seenStops.has(key)) {
          continue
        }
        seenStops.add(key)
        stops.push({ ...stop, legId: definition.id, routeDistance: mapped })
      }
      for (const transition of source.evaluation.transitions) {
        if (
          transition.routeDistance < sourceLow - EPSILON
          || transition.routeDistance > sourceHigh + EPSILON
        ) {
          continue
        }
        const mapped = mapSourceDistance(transition.routeDistance)
        const key = `${transition.routeNodeId}:${transition.definition.id}`
        if (mapped === null || seenTransitions.has(key)) {
          continue
        }
        seenTransitions.add(key)
        transitions.push({ ...transition, routeDistance: mapped })
      }
      legs.push(syntheticLeg)
      if (step.edge.kind === 'route') {
        segments.push({
          routeNodeId: step.edge.routeNodeId,
          startDistance: step.edge.sourceStartDistance,
          endDistance: step.edge.sourceEndDistance,
          direction: step.edge.sourceEndDistance >= step.edge.sourceStartDistance ? 1 : -1,
          actorKind: step.actorKind,
          lengthM: legLength,
        })
      }
      routeDistance += legLength
    }
    if (!legs.length) {
      return null
    }
    const targetStopKey = `${targetStop.routeNodeId}:${targetStop.definition.id}`
    const existingTarget = stops.find((stop) => (
      `${stop.routeNodeId}:${stop.definition.id}` === targetStopKey
    ))
    if (existingTarget) {
      existingTarget.routeDistance = routeDistance
      existingTarget.legId = legs[legs.length - 1]!.definition.id
    } else {
      stops.push({
        ...targetStop,
        routeDistance,
        legId: legs[legs.length - 1]!.definition.id,
      })
    }
    const cumulativeLengths = buildCumulativeLengths(points)
    return {
      segments,
      route: {
        status: 'ready',
        message: null,
        routeNodeId: targetStop.routeNodeId,
        providerNodeId: resolved.target.evaluation.providerNodeId,
        revision: resolved.target.evaluation.revision,
        loop: false,
        points,
        normals,
        cumulativeLengths,
        totalLength: cumulativeLengths[cumulativeLengths.length - 1] ?? 0,
        legs,
        stops: stops.sort((left, right) => left.routeDistance - right.routeDistance),
        transitions: transitions.sort((left, right) => left.routeDistance - right.routeDistance),
        warnings: resolved.target.evaluation.warnings.slice(),
      } satisfies EvaluatedGuideRoute,
    }
  }

  const built = originalBuildJourneyRoute(best.state.path)
  if (!built) {
    return null
  }
  const totalLength = built.route.totalLength
  const firstStep = best.state.path.steps[0]
  const firstActorKind = firstStep?.actorKind ?? startActor.kind
  const preferredActors = new Map<GuideRouteActorKind, string>()
  preferredActors.set(startActor.kind, startActor.nodeId)
  const spans: GuideRouteJourneyControlSpan[] = []
  let spanStart = 0
  let spanKind = firstActorKind
  let spanStartPoint = best.point.clone()
  let currentOffset = 0
  const orderedSteps = best.state.path.steps
  for (let index = 0; index < orderedSteps.length; index += 1) {
    const step = orderedSteps[index]!
    const length = sliceEdge(step.edge, step.fromOffset, step.toOffset).points
      .reduce((sum, point, pointIndex, entries) => (
        pointIndex > 0 ? sum + point.distanceTo(entries[pointIndex - 1]!) : sum
      ), 0)
    if (step.actorKind !== spanKind) {
      const actorNodeId = chooseActorNodeId(
        spanKind,
        spanStartPoint,
        options.actors,
        preferredActors,
      )
      if (!actorNodeId) {
        return null
      }
      preferredActors.set(spanKind, actorNodeId)
      spans.push({
        actorKind: spanKind,
        actorNodeId,
        startDistance: spanStart,
        endDistance: currentOffset,
      })
      spanKind = step.actorKind
      spanStart = currentOffset
      spanStartPoint = sampleEvaluatedGuideRouteAtDistance(
        built.route,
        currentOffset,
      )?.point.clone() ?? best.point.clone()
    }
    currentOffset += length
  }
  const finalActorNodeId = chooseActorNodeId(
    spanKind,
    spanStartPoint,
    options.actors,
    preferredActors,
  )
  if (!finalActorNodeId) {
    return null
  }
  preferredActors.set(spanKind, finalActorNodeId)
  spans.push({
    actorKind: spanKind,
    actorNodeId: finalActorNodeId,
    startDistance: spanStart,
    endDistance: totalLength,
  })
  const handoffs = best.state.path.handoffs.map((handoff) => {
    const syntheticDistance = Math.max(0, Math.min(totalLength, handoff.routeDistance))
    return {
      ...handoff,
      routeDistance: syntheticDistance,
      position: (() => {
        const sample = sampleEvaluatedGuideRouteAtDistance(built.route, syntheticDistance)
        return sample?.point.clone() ?? best.point.clone()
      })(),
    }
  })
  const networkInfo: GuideRouteNetworkTravelInfo = {
    entryRouteNodeId: best.edge.routeNodeId,
    entryActorKind: firstActorKind,
    snapDistanceM: best.snapDistanceM,
    travelDistanceM: totalLength,
    switchCount: best.state.switches,
    sourceRouteNodeIds: resolved.sources.map((source) => source.node.id),
    sourceSignature: resolved.signature,
    segments: built.segments,
    controlSpans: spans.map(({ actorKind, startDistance, endDistance }) => ({
      actorKind,
      startDistance,
      endDistance,
    })),
    handoffs: handoffs.map(({ routeDistance, fromKind, toKind }) => ({
      routeDistance,
      fromKind,
      toKind,
    })),
  }
  return {
    targetRouteNodeId: targetStop.routeNodeId,
    targetStopId: targetStop.definition.id,
    entryRouteNodeId: networkInfo.entryRouteNodeId,
    entryActorKind: networkInfo.entryActorKind,
    entryPosition: best.point.clone(),
    snapDistanceM: networkInfo.snapDistanceM,
    travelDistanceM: networkInfo.travelDistanceM,
    switchCount: networkInfo.switchCount,
    sourceRouteNodeIds: networkInfo.sourceRouteNodeIds,
    sourceSignature: networkInfo.sourceSignature,
    segments: built.segments,
    controlSpans: spans,
    handoffs,
    route: built.route,
    targetReached: totalLength <= EPSILON,
  }
}

export function buildGuideRouteJourneySpanWindow(
  plan: GuideRouteJourneyPlan,
  spanIndex: number,
): GuideRouteTravelWindow | null {
  const span = plan.controlSpans[spanIndex]
  if (!span) {
    return null
  }
  const isFinal = spanIndex === plan.controlSpans.length - 1
  const destinationStop: CompiledGuideStop | null = isFinal
    ? plan.route.stops.find((stop) => (
        stop.routeNodeId === plan.targetRouteNodeId
        && stop.definition.id === plan.targetStopId
      )) ?? null
    : (() => {
        const sample = sampleEvaluatedGuideRouteAtDistance(plan.route, span.endDistance)
        const leg = plan.route.legs.find((entry) => (
          span.endDistance >= entry.routeStartDistance - EPSILON
          && span.endDistance <= entry.routeEndDistance + EPSILON
        )) ?? plan.route.legs[plan.route.legs.length - 1]
        if (!sample || !leg) {
          return null
        }
        return {
          routeNodeId: plan.targetRouteNodeId,
          definition: {
            id: `${GUIDE_ROUTE_HANDOFF_STOP_PREFIX}${spanIndex}`,
            name: 'Guide Route handoff',
            thumbnailAssetId: null,
            anchor: {
              x: sample.point.x,
              y: sample.point.y,
              z: sample.point.z,
            },
            legId: leg.definition.id,
            behavior: null,
            controlAnchorId: null,
          },
          legId: leg.definition.id,
          legDistance: Math.max(
            0,
            Math.min(leg.totalLength, span.endDistance - leg.routeStartDistance),
          ),
          routeDistance: span.endDistance,
          projectedPoint: sample.point.clone(),
          projectionDistance: 0,
          behavior: null,
        } satisfies CompiledGuideStop
      })()
  if (!destinationStop) {
    return null
  }
  const route = isFinal
    ? sliceJourneyRoute(plan.route, span.startDistance, span.endDistance, destinationStop)
    : sliceJourneyRoute(plan.route, span.startDistance, span.endDistance, destinationStop)
  if (!route) {
    return null
  }
  return {
    destinationStopId: destinationStop.definition.id,
    direction: 1,
    startDistance: 0,
    endDistance: route.totalLength,
    route,
    network: {
      entryRouteNodeId: plan.entryRouteNodeId,
      entryActorKind: plan.entryActorKind,
      snapDistanceM: plan.snapDistanceM,
      travelDistanceM: plan.travelDistanceM,
      switchCount: plan.switchCount,
      sourceRouteNodeIds: plan.sourceRouteNodeIds,
      sourceSignature: plan.sourceSignature,
      segments: plan.segments,
      controlSpans: plan.controlSpans.map(({ actorKind, startDistance, endDistance }) => ({
        actorKind,
        startDistance,
        endDistance,
      })),
      handoffs: plan.handoffs.map(({ routeDistance, fromKind, toKind }) => ({
        routeDistance,
        fromKind,
        toKind,
      })),
    },
  }
}
