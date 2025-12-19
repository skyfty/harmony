import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { FloorDynamicMesh, SceneNodeComponentState, SceneNode, Vector2Like } from '../../index'

export const FLOOR_COMPONENT_TYPE = 'floor'

export interface FloorComponentProps {
  points: Vector2Like[]
  assetId?: string | null
}

function normalizeAssetId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

export function clampFloorProps(props: Partial<FloorComponentProps> | null | undefined): FloorComponentProps {
  const points = Array.isArray(props?.points)
    ? props!.points!
        .map((entry) => {
          if (!entry) {
            return null
          }
          const x = Number.isFinite(entry.x) ? entry.x : 0
          const y = Number.isFinite(entry.y) ? entry.y : 0
          return { x, y }
        })
        .filter((entry): entry is { x: number; y: number } => !!entry)
    : []

  return {
    points,
    assetId: normalizeAssetId((props as FloorComponentProps | undefined)?.assetId),
  }
}

export function resolveFloorComponentPropsFromMesh(mesh: FloorDynamicMesh | undefined | null): FloorComponentProps {
  if (!mesh?.points?.length) {
    return { points: [], assetId: null }
  }
  return clampFloorProps({ points: mesh.points, assetId: null })
}

export function cloneFloorComponentProps(props: FloorComponentProps): FloorComponentProps {
  return {
    points: Array.isArray(props.points) ? props.points.map((p) => ({ x: p.x, y: p.y })) : [],
    assetId: props.assetId ?? null,
  }
}

class FloorComponent extends Component<FloorComponentProps> {
  constructor(context: ComponentRuntimeContext<FloorComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const floorComponentDefinition: ComponentDefinition<FloorComponentProps> = {
  type: FLOOR_COMPONENT_TYPE,
  label: 'Floor',
  icon: 'mdi-floor-plan',
  order: 55,
  inspector: [
    {
      id: 'render',
      label: 'Render',
      fields: [
        {
          kind: 'text',
          key: 'assetId',
          label: 'Asset Id',
          placeholder: 'Optional asset id for floor rendering',
        },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Floor'
  },
  createDefaultProps(node: SceneNode) {
    return resolveFloorComponentPropsFromMesh(node.dynamicMesh?.type === 'Floor' ? (node.dynamicMesh as FloorDynamicMesh) : null)
  },
  createInstance(context) {
    return new FloorComponent(context)
  },
}

componentManager.registerDefinition(floorComponentDefinition)

export function createFloorComponentState(
  node: SceneNode,
  overrides?: Partial<FloorComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<FloorComponentProps> {
  const defaults = floorComponentDefinition.createDefaultProps(node)
  const merged = clampFloorProps({
    points: overrides?.points ?? defaults.points,
    assetId: overrides?.assetId ?? defaults.assetId,
  })
  return {
    id: options.id ?? '',
    type: FLOOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { floorComponentDefinition }
