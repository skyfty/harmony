import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { RoadDynamicMesh, SceneNodeComponentState, SceneNode } from '../../index'

export const ROAD_COMPONENT_TYPE = 'road'
export const ROAD_DEFAULT_WIDTH = 2
export const ROAD_MIN_WIDTH = 0.2

export type RoadPoint2D = [number, number]

export interface RoadComponentProps {
  points: RoadPoint2D[]
  width: number
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

  const pointsRaw = Array.isArray((props as RoadComponentProps | undefined)?.points)
    ? (props as RoadComponentProps).points
    : []
  const points = pointsRaw.map(normalizePoint).filter((p): p is RoadPoint2D => !!p)

  const normalizeAssetId = (value: unknown): string | null => {
    return typeof value === 'string' && value.trim().length ? value : null
  }

  return {
    points,
    width,
    bodyAssetId: normalizeAssetId((props as RoadComponentProps | undefined)?.bodyAssetId),
  }
}

export function resolveRoadComponentPropsFromMesh(mesh: RoadDynamicMesh | undefined | null): RoadComponentProps {
  if (!mesh) {
    return {
      points: [],
      width: ROAD_DEFAULT_WIDTH,
      bodyAssetId: null,
    }
  }

  const points = Array.isArray(mesh.points) ? mesh.points : []
  return clampRoadProps({
    points: points as any,
    width: mesh.width,
  })
}

export function cloneRoadComponentProps(props: RoadComponentProps): RoadComponentProps {
  return {
    points: props.points.map((p) => [p[0], p[1]]),
    width: props.width,
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
    points: overrides?.points ?? defaults.points,
    width: overrides?.width ?? defaults.width,
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
