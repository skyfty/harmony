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
  bodyAssetId?: string | null
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
      return {
        a,
        b,
        materialId: typeof (segment as any).materialId === 'string' && (segment as any).materialId.trim().length
          ? String((segment as any).materialId)
          : null,
      } as RoadSegment
    })
    .filter((segment): segment is RoadSegment => segment !== null)

  const normalizeAssetId = (value: unknown): string | null => {
    return typeof value === 'string' && value.trim().length ? value : null
  }

  return {
    vertices,
    segments,
    width,
    junctionSmoothing,
    bodyAssetId: normalizeAssetId((props as RoadComponentProps | undefined)?.bodyAssetId),
  }
}

export function resolveRoadComponentPropsFromMesh(mesh: RoadDynamicMesh | undefined | null): RoadComponentProps {
  if (!mesh) {
    return {
      vertices: [],
      segments: [],
      width: ROAD_DEFAULT_WIDTH,
      junctionSmoothing: ROAD_DEFAULT_JUNCTION_SMOOTHING,
      bodyAssetId: null,
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
  })
}

export function cloneRoadComponentProps(props: RoadComponentProps): RoadComponentProps {
  return {
    vertices: props.vertices.map((p) => [p[0], p[1]]),
    segments: props.segments.map((s) => ({ a: s.a, b: s.b, materialId: s.materialId ?? null })),
    width: props.width,
    junctionSmoothing: props.junctionSmoothing,
    bodyAssetId: props.bodyAssetId ?? null,
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
    bodyAssetId: overrides?.bodyAssetId ?? defaults.bodyAssetId,
  })
  return {
    id: options.id ?? '',
    type: ROAD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { roadComponentDefinition }
