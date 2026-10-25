import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNodeComponentState, SceneNode, Vector3Like } from '../../index'

export const GUIDE_ROUTE_COMPONENT_TYPE = 'guideRoute'

export type GuideRouteTravelMode = 'vehicle' | 'character'

export type GuideRouteSpeedProfile = {
  cruiseSpeedMps: number
  lateralAccelLimitMps2: number
}

export type GuideRouteBehaviorRef = {
  nodeId: string
  sequenceId: string
}

export type GuideRoutePathAnchor = Vector3Like & {
  /** Stable identity used by stops and editor handles. */
  id?: string
}

export type GuideRouteRoadOrigin = {
  kind: 'procedural-landscape-road'
  providerNodeId: string
  sourceRevision: number
}

export type GuideRouteBranchOrigin = {
  routeNodeId: string
  stopId: string
}

type GuideRouteLegBase = {
  id: string
  travelMode: GuideRouteTravelMode
  speedProfile: GuideRouteSpeedProfile
}

export type GuideRoadRouteLeg = GuideRouteLegBase & {
  kind: 'road'
  providerNodeId: string
  /** Normalized road arc-length entry. startT > endT travels backward. */
  startT: number
  endT: number
  /** Positive offsets the path to the right of the travel direction. */
  laneOffsetM: number
  sampleSpacingM: number
}

export type GuidePathRouteLeg = GuideRouteLegBase & {
  kind: 'path'
  surfaceProviderNodeId: string | null
  anchors: GuideRoutePathAnchor[]
  preserveAuthoredY: boolean
}

export type GuideRouteLeg = GuideRoadRouteLeg | GuidePathRouteLeg

export type GuideRouteStop = {
  id: string
  name: string
  thumbnailAssetId: string | null
  anchor: Vector3Like
  legId: string
  behavior: GuideRouteBehaviorRef | null
  /** Links a stop on an authored path to one of that leg's control anchors. */
  controlAnchorId?: string | null
}

export type GuideRouteTransition = {
  id: string
  afterLegId: string
  behavior: GuideRouteBehaviorRef
}

export interface GuideRouteComponentProps {
  version: 3
  loop: boolean
  legs: GuideRouteLeg[]
  stops: GuideRouteStop[]
  transitions: GuideRouteTransition[]
  /** Set for routes maintained automatically from a procedural landscape road. */
  origin: GuideRouteRoadOrigin | null
  /** Set when this route was branched from a stop on another route. */
  branchOrigin: GuideRouteBranchOrigin | null
}

export const DEFAULT_GUIDE_ROUTE_CRUISE_SPEED_MPS = 40 / 3.6
export const DEFAULT_GUIDE_ROUTE_LATERAL_ACCEL_MPS2 = 2.5
export const DEFAULT_GUIDE_ROUTE_SAMPLE_SPACING_M = 2

function normalizeOptionalAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeOptionalNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeBehaviorRef(value: unknown): GuideRouteBehaviorRef | null {
  const candidate = value as Partial<GuideRouteBehaviorRef> | null | undefined
  const nodeId = normalizeOptionalNodeId(candidate?.nodeId)
  const sequenceId = normalizeOptionalNodeId(candidate?.sequenceId)
  return nodeId && sequenceId ? { nodeId, sequenceId } : null
}

export function clampGuideRouteTravelMode(value: unknown): GuideRouteTravelMode {
  return value === 'character' ? 'character' : 'vehicle'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function normalizeSpeedProfile(
  value: unknown,
  travelMode: GuideRouteTravelMode,
): GuideRouteSpeedProfile {
  const candidate = value as Partial<GuideRouteSpeedProfile> | null | undefined
  const defaultSpeed = travelMode === 'character'
    ? 1.4
    : DEFAULT_GUIDE_ROUTE_CRUISE_SPEED_MPS
  return {
    cruiseSpeedMps: clampNumber(candidate?.cruiseSpeedMps, defaultSpeed, 0, 50),
    lateralAccelLimitMps2: clampNumber(
      candidate?.lateralAccelLimitMps2,
      DEFAULT_GUIDE_ROUTE_LATERAL_ACCEL_MPS2,
      0.1,
      20,
    ),
  }
}

export function clampGuideRouteVector3(value: unknown): Vector3Like {
  const candidate = value as Partial<Vector3Like> | null | undefined
  return {
    x: clampNumber(candidate?.x, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    y: clampNumber(candidate?.y, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    z: clampNumber(candidate?.z, 0, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  }
}

function normalizeLegId(value: unknown, index: number): string {
  return normalizeOptionalNodeId(value) ?? `leg-${index + 1}`
}

function normalizePathAnchor(value: unknown, index: number): GuideRoutePathAnchor {
  const vector = clampGuideRouteVector3(value)
  const id = normalizeOptionalNodeId((value as Partial<GuideRoutePathAnchor> | null | undefined)?.id)
  return {
    ...vector,
    id: id ?? `anchor-${index + 1}`,
  }
}

function clampGuideRouteLeg(value: unknown, index: number): GuideRouteLeg | null {
  const candidate = value as (Partial<GuideRoadRouteLeg> & Partial<GuidePathRouteLeg>) | null | undefined
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const travelMode = clampGuideRouteTravelMode(candidate.travelMode)
  const base = {
    id: normalizeLegId(candidate.id, index),
    travelMode,
    speedProfile: normalizeSpeedProfile(candidate.speedProfile, travelMode),
  }
  if (candidate.kind === 'road') {
    const providerNodeId = normalizeOptionalNodeId(candidate.providerNodeId)
    if (!providerNodeId) {
      return null
    }
    const startT = clampNumber(candidate.startT, 0, 0, 1)
    const rawEndT = clampNumber(candidate.endT, 1, 0, 1)
    const endT = Math.abs(rawEndT - startT) <= 1e-6
      ? (startT >= 1 ? 0 : 1)
      : rawEndT
    return {
      ...base,
      kind: 'road',
      providerNodeId,
      startT,
      endT,
      laneOffsetM: clampNumber(candidate.laneOffsetM, 0, -50, 50),
      sampleSpacingM: clampNumber(
        candidate.sampleSpacingM,
        DEFAULT_GUIDE_ROUTE_SAMPLE_SPACING_M,
        0.5,
        20,
      ),
    }
  }
  const rawAnchors = Array.isArray(candidate.anchors) ? candidate.anchors : []
  const anchors = rawAnchors.map((anchor, anchorIndex) => normalizePathAnchor(anchor, anchorIndex))
  return {
    ...base,
    kind: 'path',
    surfaceProviderNodeId: normalizeOptionalNodeId(candidate.surfaceProviderNodeId),
    anchors,
    preserveAuthoredY: candidate.preserveAuthoredY === true,
  }
}

function normalizeStop(
  value: unknown,
  index: number,
  legsById: Map<string, GuideRouteLeg>,
): GuideRouteStop | null {
  const candidate = value as Partial<GuideRouteStop> | null | undefined
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const legId = normalizeOptionalNodeId(candidate.legId)
  const leg = legId ? legsById.get(legId) ?? null : null
  if (!legId || !leg) {
    return null
  }
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : `Stop ${index + 1}`
  const anchor = clampGuideRouteVector3(candidate.anchor)
  const requestedControlAnchorId = normalizeOptionalNodeId(candidate.controlAnchorId)
  const controlAnchorId = leg.kind === 'path'
    ? (
        requestedControlAnchorId
        && leg.anchors.some((entry) => entry.id === requestedControlAnchorId)
          ? requestedControlAnchorId
          : leg.anchors.find((entry) => (
              Math.abs(entry.x - anchor.x) <= 1e-4
              && Math.abs(entry.y - anchor.y) <= 1e-4
              && Math.abs(entry.z - anchor.z) <= 1e-4
            ))?.id ?? null
      )
    : null
  return {
    id: normalizeOptionalNodeId(candidate.id) ?? `stop-${index + 1}`,
    name,
    thumbnailAssetId: normalizeOptionalAssetId(candidate.thumbnailAssetId),
    anchor,
    legId,
    behavior: normalizeBehaviorRef(candidate.behavior),
    controlAnchorId,
  }
}

function normalizeTransition(
  value: unknown,
  index: number,
  legIds: Set<string>,
): GuideRouteTransition | null {
  const candidate = value as Partial<GuideRouteTransition> | null | undefined
  const afterLegId = normalizeOptionalNodeId(candidate?.afterLegId)
  const behavior = normalizeBehaviorRef(candidate?.behavior)
  if (!afterLegId || !legIds.has(afterLegId) || !behavior) {
    return null
  }
  return {
    id: normalizeOptionalNodeId(candidate?.id) ?? `transition-${index + 1}`,
    afterLegId,
    behavior,
  }
}

export function clampGuideRouteComponentProps(
  props: Partial<GuideRouteComponentProps> | null | undefined,
): GuideRouteComponentProps {
  const rawLegs = Array.isArray(props?.legs) ? props.legs : []
  const legs = rawLegs
    .map((leg, index) => clampGuideRouteLeg(leg, index))
    .filter((leg): leg is GuideRouteLeg => leg !== null)
  const legsById = new Map(legs.map((leg) => [leg.id, leg]))
  const legIds = new Set(legsById.keys())
  const rawStops = Array.isArray(props?.stops) ? props.stops : []
  const stops = rawStops
    .map((stop, index) => normalizeStop(stop, index, legsById))
    .filter((stop): stop is GuideRouteStop => stop !== null)
  const rawTransitions = Array.isArray(props?.transitions) ? props.transitions : []
  const transitions = rawTransitions
    .map((transition, index) => normalizeTransition(transition, index, legIds))
    .filter((transition): transition is GuideRouteTransition => transition !== null)
  return {
    version: 3,
    loop: props?.loop === true,
    legs,
    stops,
    transitions,
    origin: normalizeRoadOrigin(props?.origin),
    branchOrigin: normalizeBranchOrigin(props?.branchOrigin),
  }
}

export function cloneGuideRouteComponentProps(
  props: GuideRouteComponentProps,
): GuideRouteComponentProps {
  return {
    version: 3,
    loop: props.loop,
    legs: props.legs.map((leg) => (
      leg.kind === 'road'
        ? {
            ...leg,
            speedProfile: { ...leg.speedProfile },
          }
        : {
            ...leg,
            speedProfile: { ...leg.speedProfile },
            anchors: leg.anchors.map((anchor) => ({ ...anchor })),
          }
    )),
    stops: props.stops.map((stop) => ({
      ...stop,
      anchor: { ...stop.anchor },
      behavior: stop.behavior ? { ...stop.behavior } : null,
      controlAnchorId: stop.controlAnchorId ?? null,
    })),
    transitions: props.transitions.map((transition) => ({
      ...transition,
      behavior: { ...transition.behavior },
    })),
    origin: props.origin ? { ...props.origin } : null,
    branchOrigin: props.branchOrigin ? { ...props.branchOrigin } : null,
  }
}

export function createGuideRoadRouteLeg(
  overrides: Partial<GuideRoadRouteLeg> & Pick<GuideRoadRouteLeg, 'providerNodeId'>,
): GuideRoadRouteLeg {
  return clampGuideRouteLeg({
    kind: 'road',
    id: overrides.id ?? `road-${Date.now().toString(36)}`,
    travelMode: overrides.travelMode ?? 'vehicle',
    speedProfile: overrides.speedProfile ?? {},
    providerNodeId: overrides.providerNodeId,
    startT: overrides.startT ?? 0,
    endT: overrides.endT ?? 1,
    laneOffsetM: overrides.laneOffsetM ?? 0,
    sampleSpacingM: overrides.sampleSpacingM ?? DEFAULT_GUIDE_ROUTE_SAMPLE_SPACING_M,
  }, 0) as GuideRoadRouteLeg
}

export function createGuidePathRouteLeg(
  overrides: Partial<Omit<GuidePathRouteLeg, 'anchors'>> & {
    anchors?: GuideRoutePathAnchor[]
  } = {},
): GuidePathRouteLeg {
  return clampGuideRouteLeg({
    kind: 'path',
    id: overrides.id ?? `path-${Date.now().toString(36)}`,
    travelMode: overrides.travelMode ?? 'character',
    speedProfile: overrides.speedProfile ?? {},
    surfaceProviderNodeId: overrides.surfaceProviderNodeId ?? null,
    anchors: overrides.anchors ?? [],
    preserveAuthoredY: overrides.preserveAuthoredY ?? true,
  }, 0) as GuidePathRouteLeg
}

function normalizeRoadOrigin(value: unknown): GuideRouteRoadOrigin | null {
  const candidate = value as Partial<GuideRouteRoadOrigin> | null | undefined
  if (candidate?.kind !== 'procedural-landscape-road') {
    return null
  }
  const providerNodeId = normalizeOptionalNodeId(candidate.providerNodeId)
  if (!providerNodeId) {
    return null
  }
  return {
    kind: 'procedural-landscape-road',
    providerNodeId,
    sourceRevision: Math.max(0, Math.round(Number(candidate.sourceRevision) || 0)),
  }
}

function normalizeBranchOrigin(value: unknown): GuideRouteBranchOrigin | null {
  const candidate = value as Partial<GuideRouteBranchOrigin> | null | undefined
  const routeNodeId = normalizeOptionalNodeId(candidate?.routeNodeId)
  const stopId = normalizeOptionalNodeId(candidate?.stopId)
  return routeNodeId && stopId ? { routeNodeId, stopId } : null
}

class GuideRouteComponent extends Component<GuideRouteComponentProps> {
  constructor(context: ComponentRuntimeContext<GuideRouteComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const guideRouteComponentDefinition: ComponentDefinition<GuideRouteComponentProps> = {
  type: GUIDE_ROUTE_COMPONENT_TYPE,
  label: 'Guide Route',
  icon: 'mdi-map-marker-path',
  order: 66,
  inspector: [
    {
      id: 'legs',
      label: 'Route Legs',
      fields: [],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'GuideRoute'
  },
  createDefaultProps(_node: SceneNode) {
    return clampGuideRouteComponentProps(null)
  },
  createInstance(context) {
    return new GuideRouteComponent(context)
  },
}

componentManager.registerDefinition(guideRouteComponentDefinition)

export function createGuideRouteComponentState(
  node: SceneNode,
  overrides?: Partial<GuideRouteComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GuideRouteComponentProps> {
  const defaults = guideRouteComponentDefinition.createDefaultProps(node)
  return {
    id: options.id ?? '',
    type: GUIDE_ROUTE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampGuideRouteComponentProps({
      ...defaults,
      ...overrides,
      legs: overrides?.legs ?? defaults.legs,
      stops: overrides?.stops ?? defaults.stops,
      transitions: overrides?.transitions ?? defaults.transitions,
    }),
  }
}

export { guideRouteComponentDefinition }
