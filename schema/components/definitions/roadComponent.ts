import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { RoadDynamicMesh, RoadSegment, SceneNodeComponentState, SceneNode } from '../../index'

export const ROAD_COMPONENT_TYPE = 'road'
export const ROAD_DEFAULT_WIDTH = 2
export const ROAD_MIN_WIDTH = 0.2
export const ROAD_DEFAULT_JUNCTION_SMOOTHING = 0

export type RoadPoint2D = [number, number]

export interface RoadComponentProps {
  vertices: RoadPoint2D[]
  segments: RoadSegment[]
  width: number
  junctionSmoothing: number
  laneLines: boolean
  shoulders: boolean
  bodyAssetId?: string | null
  /** Sampling density factor for terrain-conforming road (higher = more sample points). Default 1.0 */
  samplingDensityFactor?: number
  /** Smoothing strength factor for terrain-adaptive height smoothing (higher = smoother). Default 1.0 */
  smoothingStrengthFactor?: number
  /** Minimum clearance/offset above terrain surface (meters). Default 0.01 */
  minClearance?: number
  /** Lane line strip width (meters). Default from ROAD_LANE_LINE_WIDTH constant */
  laneLineWidth?: number
  /** Shoulder strip width (meters). Default from ROAD_SHOULDER_WIDTH constant */
  shoulderWidth?: number
}

function normalizePoint(value: unknown): RoadPoint2D | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }
  const x = Number(value[0])
  const y = Number(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }
  return [x, y]
}

export function clampRoadProps(props: Partial<RoadComponentProps> | null | undefined): RoadComponentProps {
  const width = Number.isFinite(props?.width) ? Math.max(ROAD_MIN_WIDTH, props!.width!) : ROAD_DEFAULT_WIDTH

  const smoothingRaw = (props as RoadComponentProps | undefined)?.junctionSmoothing
  const smoothing = typeof smoothingRaw === 'number' ? smoothingRaw : Number(smoothingRaw)
  const junctionSmoothing = Number.isFinite(smoothing) ? Math.min(1, Math.max(0, smoothing)) : ROAD_DEFAULT_JUNCTION_SMOOTHING

  const verticesRaw = Array.isArray((props as RoadComponentProps | undefined)?.vertices)
    ? (props as RoadComponentProps).vertices
    : []
  const vertices = verticesRaw.map(normalizePoint).filter((p): p is RoadPoint2D => !!p)

  const segmentsRaw = Array.isArray((props as RoadComponentProps | undefined)?.segments)
    ? (props as RoadComponentProps).segments
    : []
  const segments = segmentsRaw
    .map((segment): RoadSegment | null => {
      if (!segment || typeof segment !== 'object') {
        return null
      }
      const a = Math.trunc(Number((segment as any).a))
      const b = Math.trunc(Number((segment as any).b))
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
        return null
      }
      return { a, b } as RoadSegment
    })
    .filter((segment): segment is RoadSegment => segment !== null)

  const laneLines = Boolean(props?.laneLines)
  const shoulders = Boolean(props?.shoulders)

  const normalizeAssetId = (value: unknown): string | null => {
    return typeof value === 'string' && value.trim().length ? value : null
  }

  const samplingDensityFactorRaw = (props as RoadComponentProps | undefined)?.samplingDensityFactor
  const samplingDensityFactor = Number.isFinite(samplingDensityFactorRaw)
    ? Math.max(0.1, Math.min(5, samplingDensityFactorRaw as number))
    : 1.0

  const smoothingStrengthFactorRaw = (props as RoadComponentProps | undefined)?.smoothingStrengthFactor
  const smoothingStrengthFactor = Number.isFinite(smoothingStrengthFactorRaw)
    ? Math.max(0.1, Math.min(5, smoothingStrengthFactorRaw as number))
    : 1.0

  const minClearanceRaw = (props as RoadComponentProps | undefined)?.minClearance
  const minClearance = Number.isFinite(minClearanceRaw)
    ? Math.max(0, Math.min(2, minClearanceRaw as number))
    : 0.01

  const laneLineWidthRaw = (props as RoadComponentProps | undefined)?.laneLineWidth
  const laneLineWidth = Number.isFinite(laneLineWidthRaw)
    ? Math.max(0.01, Math.min(1, laneLineWidthRaw as number))
    : undefined

  const shoulderWidthRaw = (props as RoadComponentProps | undefined)?.shoulderWidth
  const shoulderWidth = Number.isFinite(shoulderWidthRaw)
    ? Math.max(0.01, Math.min(2, shoulderWidthRaw as number))
    : undefined

  return {
    vertices,
    segments,
    width,
    junctionSmoothing,
    laneLines,
    shoulders,
    bodyAssetId: normalizeAssetId((props as RoadComponentProps | undefined)?.bodyAssetId),
    samplingDensityFactor,
    smoothingStrengthFactor,
    minClearance,
    laneLineWidth,
    shoulderWidth,
  }
}

export function resolveRoadComponentPropsFromMesh(mesh: RoadDynamicMesh | undefined | null): RoadComponentProps {
  if (!mesh) {
    return {
      laneLines: false,
      shoulders: false,
      vertices: [],
      segments: [],
      width: ROAD_DEFAULT_WIDTH,
      junctionSmoothing: ROAD_DEFAULT_JUNCTION_SMOOTHING,
      bodyAssetId: null,
      samplingDensityFactor: 1.0,
      smoothingStrengthFactor: 1.0,
      minClearance: 0.01,
    }
  }

  const vertices = Array.isArray(mesh.vertices) ? mesh.vertices : []
  const segments = Array.isArray(mesh.segments) && mesh.segments.length
    ? mesh.segments
    : (vertices.length >= 2
      ? Array.from({ length: vertices.length - 1 }, (_value, index) => ({ a: index, b: index + 1 }))
      : [])
  return clampRoadProps({
    vertices: vertices as any,
    segments: segments as any,
    width: mesh.width,
    junctionSmoothing: ROAD_DEFAULT_JUNCTION_SMOOTHING,
    laneLines: false,
    shoulders: false,
    samplingDensityFactor: 1.0,
    smoothingStrengthFactor: 1.0,
    minClearance: 0.01,
  })
}

export function cloneRoadComponentProps(props: RoadComponentProps): RoadComponentProps {
  return {
    vertices: props.vertices.map((p) => [p[0], p[1]]),
    segments: props.segments.map((s) => ({ a: s.a, b: s.b })),
    width: props.width,
    junctionSmoothing: props.junctionSmoothing,
    laneLines: props.laneLines,
    shoulders: props.shoulders,
    bodyAssetId: props.bodyAssetId ?? null,
    samplingDensityFactor: props.samplingDensityFactor ?? 1.0,
    smoothingStrengthFactor: props.smoothingStrengthFactor ?? 1.0,
    minClearance: props.minClearance ?? 0.01,
    laneLineWidth: props.laneLineWidth,
    shoulderWidth: props.shoulderWidth,
  }
}

class RoadComponent extends Component<RoadComponentProps> {
  constructor(context: ComponentRuntimeContext<RoadComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const roadComponentDefinition: ComponentDefinition<RoadComponentProps> = {
  type: ROAD_COMPONENT_TYPE,
  label: 'Road',
  icon: 'mdi-road-variant',
  order: 51,
  inspector: [
    {
      id: 'dimensions',
      label: 'Dimensions',
      fields: [{ kind: 'number', key: 'width', label: 'Width (m)', min: ROAD_MIN_WIDTH, step: 0.1 }],
    },
    {
      id: 'details',
      label: 'Details',
      fields: [
        { kind: 'boolean', key: 'laneLines', label: 'Show Lane Lines' },
        { kind: 'boolean', key: 'shoulders', label: 'Show Shoulders' },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Road'
  },
  createDefaultProps(node: SceneNode) {
    return resolveRoadComponentPropsFromMesh(node.dynamicMesh?.type === 'Road' ? node.dynamicMesh : null)
  },
  createInstance(context) {
    return new RoadComponent(context)
  },
}

componentManager.registerDefinition(roadComponentDefinition)

export function createRoadComponentState(
  node: SceneNode,
  overrides?: Partial<RoadComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<RoadComponentProps> {
  const defaults = roadComponentDefinition.createDefaultProps(node)
  const merged = clampRoadProps({
    vertices: overrides?.vertices ?? defaults.vertices,
    segments: overrides?.segments ?? defaults.segments,
    width: overrides?.width ?? defaults.width,
    junctionSmoothing: overrides?.junctionSmoothing ?? defaults.junctionSmoothing,
    laneLines: overrides?.laneLines ?? defaults.laneLines,
    shoulders: overrides?.shoulders ?? defaults.shoulders,
    bodyAssetId: overrides?.bodyAssetId ?? defaults.bodyAssetId,
    samplingDensityFactor: overrides?.samplingDensityFactor ?? defaults.samplingDensityFactor,
    smoothingStrengthFactor: overrides?.smoothingStrengthFactor ?? defaults.smoothingStrengthFactor,
    minClearance: overrides?.minClearance ?? defaults.minClearance,
    laneLineWidth: overrides?.laneLineWidth ?? defaults.laneLineWidth,
    shoulderWidth: overrides?.shoulderWidth ?? defaults.shoulderWidth,
  })
  return {
    id: options.id ?? '',
    type: ROAD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { roadComponentDefinition }
