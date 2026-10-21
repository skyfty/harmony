import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNodeComponentState, SceneNode, Vector3Like } from '../../index'

export const GUIDE_ROUTE_COMPONENT_TYPE = 'guideRoute'

export type GuideRouteWaypoint = {
  name: string
  position: Vector3Like
  /** When true, AutoTour should pause at this waypoint. */
  dock?: boolean
}

export type GuideRouteRouteSource = 'drawn' | 'generated-road'

export interface GuideRouteComponentProps {
  /** Breaking Guide Route contract. Fixed terrain-space Y values are ignored. */
  version: 2
  surfaceProviderNodeId: string | null
  routeSource: GuideRouteRouteSource
  sampleSpacingM: number
  roadLateralOffsetM: number
  waypoints: GuideRouteWaypoint[]
}

function normalizeGuideRouteWaypointName(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : `P${index + 1}`
}

function clampVector3Like(value: unknown): Vector3Like {
  const v = (value as { x?: unknown; y?: unknown; z?: unknown } | null | undefined) ?? undefined
  const x = typeof v?.x === 'number' && Number.isFinite(v.x) ? v.x : 0
  const y = typeof v?.y === 'number' && Number.isFinite(v.y) ? v.y : 0
  const z = typeof v?.z === 'number' && Number.isFinite(v.z) ? v.z : 0
  return { x, y, z }
}

export function buildGuideRouteWaypointsFromPositions(
  positions: Array<Vector3Like | null | undefined> | null | undefined,
  source: Array<Partial<GuideRouteWaypoint> | null | undefined> = [],
): GuideRouteWaypoint[] {
  const rawPositions = Array.isArray(positions) ? positions : []
  return rawPositions.map((position, index) => {
    const entry = source[index]
    return {
      name: normalizeGuideRouteWaypointName(entry?.name, index),
      position: clampVector3Like(position),
      dock: entry?.dock === true,
    }
  })
}

function normalizeProviderNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeRouteSource(value: unknown): GuideRouteRouteSource {
  return value === 'generated-road' ? 'generated-road' : 'drawn'
}

function clampFinite(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

export function clampGuideRouteComponentProps(props: Partial<GuideRouteComponentProps> | null | undefined): GuideRouteComponentProps {
  const rawWaypoints = Array.isArray((props as GuideRouteComponentProps | undefined)?.waypoints)
    ? (props as GuideRouteComponentProps).waypoints
    : []

  const sanitizedEntries = rawWaypoints.filter((entry) => !!entry && typeof entry === 'object') as Array<Partial<GuideRouteWaypoint>>
  const waypoints = buildGuideRouteWaypointsFromPositions(
    sanitizedEntries.map((entry) => entry.position),
    sanitizedEntries,
  )

  return {
    version: 2,
    surfaceProviderNodeId: normalizeProviderNodeId(props?.surfaceProviderNodeId),
    routeSource: normalizeRouteSource(props?.routeSource),
    sampleSpacingM: clampFinite(props?.sampleSpacingM, 2, 0.5, 20),
    roadLateralOffsetM: clampFinite(props?.roadLateralOffsetM, 0, -50, 50),
    waypoints,
  }
}

export function cloneGuideRouteComponentProps(props: GuideRouteComponentProps): GuideRouteComponentProps {
  return {
    version: 2,
    surfaceProviderNodeId: props.surfaceProviderNodeId,
    routeSource: props.routeSource,
    sampleSpacingM: props.sampleSpacingM,
    roadLateralOffsetM: props.roadLateralOffsetM,
    waypoints: props.waypoints.map((w) => ({
      name: w.name,
      position: { x: w.position.x, y: w.position.y, z: w.position.z },
      dock: w.dock === true,
    })),
  }
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
      id: 'waypoints',
      label: 'Waypoints',
      fields: [],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'GuideRoute'
  },
  createDefaultProps(node: SceneNode) {
    void node
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
  const merged = clampGuideRouteComponentProps({
    ...defaults,
    ...overrides,
    waypoints: overrides?.waypoints ?? defaults.waypoints,
  })
  return {
    id: options.id ?? '',
    type: GUIDE_ROUTE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { guideRouteComponentDefinition }
