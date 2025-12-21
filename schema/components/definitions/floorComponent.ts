import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { FloorDynamicMesh, SceneNodeComponentState, SceneNode } from '../../index'

export const FLOOR_COMPONENT_TYPE = 'floor'
export const FLOOR_DEFAULT_SMOOTH = 0

export interface FloorComponentProps {
  smooth: number
}

export function clampFloorComponentProps(props: Partial<FloorComponentProps> | null | undefined): FloorComponentProps {
  const smoothRaw = typeof props?.smooth === 'number' && Number.isFinite(props.smooth) ? props.smooth : FLOOR_DEFAULT_SMOOTH
  const smooth = Math.min(1, Math.max(0, smoothRaw))
  return { smooth }
}

export function resolveFloorComponentPropsFromMesh(mesh: FloorDynamicMesh | undefined | null): FloorComponentProps {
  if (!mesh) {
    return clampFloorComponentProps(null)
  }
  return clampFloorComponentProps({ smooth: mesh.smooth })
}

export function cloneFloorComponentProps(props: FloorComponentProps): FloorComponentProps {
  return { smooth: props.smooth }
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
  order: 52,
  inspector: [
    {
      id: 'surface',
      label: 'Surface',
      fields: [
        {
          kind: 'number',
          key: 'smooth',
          label: 'Corner Smoothness',
          min: 0,
          max: 1,
          step: 0.05,
        },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Floor'
  },
  createDefaultProps(node: SceneNode) {
    return resolveFloorComponentPropsFromMesh(node.dynamicMesh?.type === 'Floor' ? node.dynamicMesh : null)
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
  const defaults = resolveFloorComponentPropsFromMesh(node.dynamicMesh?.type === 'Floor' ? node.dynamicMesh : null)
  const merged = clampFloorComponentProps({
    smooth: overrides?.smooth ?? defaults.smooth,
  })
  return {
    id: options.id ?? '',
    type: FLOOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { floorComponentDefinition }
