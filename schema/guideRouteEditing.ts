import type { Vector3Like } from './core'
import {
  cloneGuideRouteComponentProps,
  createGuidePathRouteLeg,
  type GuidePathRouteLeg,
  type GuideRouteBranchOrigin,
  type GuideRouteComponentProps,
  type GuideRouteLeg,
  type GuideRoutePathAnchor,
  type GuideRouteStop,
  type GuideRouteTravelMode,
} from './components/definitions/guideRouteComponent'

const FALLBACK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function createGuideRouteEntityId(prefix: string): string {
  const random = Array.from({ length: 8 }, () => (
    FALLBACK_ID_ALPHABET[Math.floor(Math.random() * FALLBACK_ID_ALPHABET.length)]
  )).join('')
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function copyGuideRoutePoint(point: Vector3Like): Vector3Like {
  return { x: point.x, y: point.y, z: point.z }
}

export function pointsEqual(a: Vector3Like, b: Vector3Like, epsilon = 1e-5): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.z - b.z) <= epsilon
  )
}

function createUniqueAnchorId(leg: GuidePathRouteLeg, preferred?: string): string {
  const existing = new Set(leg.anchors.map((anchor) => anchor.id).filter(Boolean))
  if (preferred && !existing.has(preferred)) {
    return preferred
  }
  let id = createGuideRouteEntityId('anchor')
  while (existing.has(id)) {
    id = createGuideRouteEntityId('anchor')
  }
  return id
}

export function createGuideRoutePathAnchor(
  point: Vector3Like,
  id = createGuideRouteEntityId('anchor'),
): GuideRoutePathAnchor {
  return { ...copyGuideRoutePoint(point), id }
}

function trimDuplicatePoints(points: readonly Vector3Like[]): Vector3Like[] {
  const result: Vector3Like[] = []
  for (const point of points) {
    const normalized = copyGuideRoutePoint(point)
    if (!result.length || !pointsEqual(result[result.length - 1]!, normalized)) {
      result.push(normalized)
    }
  }
  return result
}

function resolveDefaultSurfaceProvider(
  leg: GuideRouteLeg | null | undefined,
  explicit: string | null | undefined,
): string | null {
  if (explicit !== undefined) {
    return explicit?.trim() || null
  }
  if (!leg) {
    return null
  }
  return leg.kind === 'road' ? leg.providerNodeId : leg.surfaceProviderNodeId
}

export function appendGuideRoutePathExtension(
  source: GuideRouteComponentProps,
  endpoint: Vector3Like,
  extensionPoints: readonly Vector3Like[],
  options: { surfaceProviderNodeId?: string | null } = {},
): GuideRouteComponentProps {
  const props = cloneGuideRouteComponentProps(source)
  const newPoints = trimDuplicatePoints(extensionPoints)
  if (!newPoints.length) {
    return props
  }
  const lastLeg = props.legs[props.legs.length - 1] ?? null
  if (lastLeg?.kind === 'path') {
    for (const point of newPoints) {
      const lastAnchor = lastLeg.anchors[lastLeg.anchors.length - 1]
      if (!lastAnchor || !pointsEqual(lastAnchor, point)) {
        lastLeg.anchors.push(createGuideRoutePathAnchor(
          point,
          createUniqueAnchorId(lastLeg),
        ))
      }
    }
    return props
  }
  const providerNodeId = resolveDefaultSurfaceProvider(lastLeg, options.surfaceProviderNodeId)
  const anchors = [
    createGuideRoutePathAnchor(endpoint),
    ...newPoints.map((point) => createGuideRoutePathAnchor(point)),
  ]
  props.legs.push(createGuidePathRouteLeg({
    travelMode: lastLeg?.travelMode ?? 'character',
    speedProfile: lastLeg?.speedProfile,
    surfaceProviderNodeId: providerNodeId,
    preserveAuthoredY: !providerNodeId,
    anchors,
  }))
  return props
}

export function prependGuideRoutePathExtension(
  source: GuideRouteComponentProps,
  endpoint: Vector3Like,
  extensionPoints: readonly Vector3Like[],
  options: { surfaceProviderNodeId?: string | null } = {},
): GuideRouteComponentProps {
  const props = cloneGuideRouteComponentProps(source)
  const outward = trimDuplicatePoints(extensionPoints)
  if (!outward.length) {
    return props
  }
  const firstLeg = props.legs[0] ?? null
  if (firstLeg?.kind === 'path') {
    const prepended = outward
      .slice()
      .reverse()
      .filter((point) => !firstLeg.anchors[0] || !pointsEqual(firstLeg.anchors[0], point))
      .map((point) => createGuideRoutePathAnchor(point))
    firstLeg.anchors.unshift(...prepended)
    return props
  }
  const providerNodeId = resolveDefaultSurfaceProvider(firstLeg, options.surfaceProviderNodeId)
  const anchors = [
    ...outward.slice().reverse().map((point) => createGuideRoutePathAnchor(point)),
    createGuideRoutePathAnchor(endpoint),
  ]
  props.legs.unshift(createGuidePathRouteLeg({
    travelMode: firstLeg?.travelMode ?? 'character',
    speedProfile: firstLeg?.speedProfile,
    surfaceProviderNodeId: providerNodeId,
    preserveAuthoredY: !providerNodeId,
    anchors,
  }))
  return props
}

export function createGuideRouteBranchProps(options: {
  parentRouteNodeId: string
  sourceStop: GuideRouteStop
  points: readonly Vector3Like[]
  travelMode: GuideRouteTravelMode
  surfaceProviderNodeId: string | null
}): GuideRouteComponentProps {
  const points = trimDuplicatePoints(options.points)
  const branchOrigin: GuideRouteBranchOrigin = {
    routeNodeId: options.parentRouteNodeId,
    stopId: options.sourceStop.id,
  }
  return {
    version: 3,
    loop: false,
    legs: points.length >= 2
      ? [createGuidePathRouteLeg({
          travelMode: options.travelMode,
          surfaceProviderNodeId: options.surfaceProviderNodeId,
          preserveAuthoredY: !options.surfaceProviderNodeId,
          anchors: points.map((point) => createGuideRoutePathAnchor(point)),
        })]
      : [],
    stops: [],
    transitions: [],
    origin: null,
    branchOrigin,
  }
}

export function insertGuideRoutePathStop(
  source: GuideRouteComponentProps,
  options: {
    legId: string
    anchorIndex: number
    anchor: Vector3Like
    name?: string
    thumbnailAssetId?: string | null
    behavior?: GuideRouteStop['behavior']
  },
): {
  props: GuideRouteComponentProps
  stopId: string
  anchorId: string
} | null {
  const props = cloneGuideRouteComponentProps(source)
  const leg = props.legs.find((entry): entry is GuidePathRouteLeg => (
    entry.id === options.legId && entry.kind === 'path'
  ))
  if (!leg) {
    return null
  }
  const anchorIndex = Math.max(0, Math.min(leg.anchors.length, Math.trunc(options.anchorIndex)))
  const anchorId = createUniqueAnchorId(leg)
  const anchor = createGuideRoutePathAnchor(options.anchor, anchorId)
  leg.anchors.splice(anchorIndex, 0, anchor)
  const stopId = createGuideRouteEntityId('stop')
  props.stops.push({
    id: stopId,
    name: options.name?.trim() || `Stop ${props.stops.length + 1}`,
    thumbnailAssetId: options.thumbnailAssetId?.trim() || null,
    anchor: copyGuideRoutePoint(options.anchor),
    legId: leg.id,
    behavior: options.behavior ? { ...options.behavior } : null,
    controlAnchorId: anchorId,
  })
  return { props, stopId, anchorId }
}

export function addGuideRouteStop(
  source: GuideRouteComponentProps,
  options: {
    legId: string
    anchor: Vector3Like
    name?: string
    thumbnailAssetId?: string | null
    behavior?: GuideRouteStop['behavior']
  },
): { props: GuideRouteComponentProps; stopId: string } | null {
  const props = cloneGuideRouteComponentProps(source)
  if (!props.legs.some((leg) => leg.id === options.legId)) {
    return null
  }
  const stopId = createGuideRouteEntityId('stop')
  props.stops.push({
    id: stopId,
    name: options.name?.trim() || `Stop ${props.stops.length + 1}`,
    thumbnailAssetId: options.thumbnailAssetId?.trim() || null,
    anchor: copyGuideRoutePoint(options.anchor),
    legId: options.legId,
    behavior: options.behavior ? { ...options.behavior } : null,
    controlAnchorId: null,
  })
  return { props, stopId }
}

export function moveGuideRouteStop(
  source: GuideRouteComponentProps,
  stopId: string,
  anchor: Vector3Like,
): GuideRouteComponentProps | null {
  const props = cloneGuideRouteComponentProps(source)
  const stop = props.stops.find((entry) => entry.id === stopId)
  if (!stop) {
    return null
  }
  stop.anchor = copyGuideRoutePoint(anchor)
  if (stop.controlAnchorId) {
    const leg = props.legs.find((entry): entry is GuidePathRouteLeg => (
      entry.id === stop.legId && entry.kind === 'path'
    ))
    const controlAnchor = leg?.anchors.find((entry) => entry.id === stop.controlAnchorId)
    if (controlAnchor) {
      controlAnchor.x = anchor.x
      controlAnchor.y = anchor.y
      controlAnchor.z = anchor.z
    }
  }
  return props
}

export function removeGuideRouteStop(
  source: GuideRouteComponentProps,
  stopId: string,
): {
  props: GuideRouteComponentProps
  removedStop: GuideRouteStop | null
  removedAnchorId: string | null
} {
  const props = cloneGuideRouteComponentProps(source)
  const stop = props.stops.find((entry) => entry.id === stopId) ?? null
  if (!stop) {
    return { props, removedStop: null, removedAnchorId: null }
  }
  props.stops = props.stops.filter((entry) => entry.id !== stopId)
  let removedAnchorId: string | null = null
  if (stop.controlAnchorId) {
    const leg = props.legs.find((entry): entry is GuidePathRouteLeg => (
      entry.id === stop.legId && entry.kind === 'path'
    ))
    if (leg) {
      const nextAnchors = leg.anchors.filter((entry) => entry.id !== stop.controlAnchorId)
      if (nextAnchors.length !== leg.anchors.length && nextAnchors.length >= 2) {
        leg.anchors = nextAnchors
        removedAnchorId = stop.controlAnchorId
      }
    }
  }
  return { props, removedStop: stop, removedAnchorId }
}

export function moveGuideRoutePathAnchor(
  source: GuideRouteComponentProps,
  legId: string,
  anchorId: string,
  point: Vector3Like,
): GuideRouteComponentProps | null {
  const props = cloneGuideRouteComponentProps(source)
  const leg = props.legs.find((entry): entry is GuidePathRouteLeg => (
    entry.id === legId && entry.kind === 'path'
  ))
  const anchor = leg?.anchors.find((entry) => entry.id === anchorId)
  if (!leg || !anchor) {
    return null
  }
  anchor.x = point.x
  anchor.y = point.y
  anchor.z = point.z
  for (const stop of props.stops) {
    if (stop.legId === legId && stop.controlAnchorId === anchorId) {
      stop.anchor = copyGuideRoutePoint(point)
    }
  }
  return props
}

export function unlinkGuideRouteBranchOrigins(
  source: GuideRouteComponentProps,
): GuideRouteComponentProps {
  return {
    ...cloneGuideRouteComponentProps(source),
    branchOrigin: null,
  }
}
