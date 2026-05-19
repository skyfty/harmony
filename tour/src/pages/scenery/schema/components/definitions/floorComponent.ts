import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { FloorDynamicMesh, SceneNodeComponentState, SceneNode, Vector2Like } from '../../index'

export const FLOOR_COMPONENT_TYPE = 'floor'
export const FLOOR_DEFAULT_SMOOTH = 0
export const FLOOR_DEFAULT_THICKNESS = 0
export const FLOOR_MIN_THICKNESS = 0
export const FLOOR_MAX_THICKNESS = 10

export const FLOOR_DEFAULT_SIDE_UV_SCALE: { x: number; y: number } = { x: 1, y: 1 }

export interface FloorComponentProps {
  smooth: number
  /** Thickness in meters. */
  thickness: number
  /** Side-wall UV repeats per meter (U/V). */
  sideUvScale: { x: number; y: number }
}

export function clampFloorComponentProps(props: Partial<FloorComponentProps> | null | undefined): FloorComponentProps {
  const smoothRaw = typeof props?.smooth === 'number' && Number.isFinite(props.smooth) ? props.smooth : FLOOR_DEFAULT_SMOOTH
  const smooth = Math.min(1, Math.max(0, smoothRaw))

  const thicknessRaw = typeof props?.thickness === 'number' && Number.isFinite(props.thickness)
    ? props.thickness
    : FLOOR_DEFAULT_THICKNESS
  const thickness = Math.min(FLOOR_MAX_THICKNESS, Math.max(FLOOR_MIN_THICKNESS, thicknessRaw))

  const sideUvScaleRaw = props?.sideUvScale as Vector2Like | null | undefined
  const sideX = typeof (sideUvScaleRaw as any)?.x === 'number' ? Number((sideUvScaleRaw as any).x) : Number.NaN
  const sideY = typeof (sideUvScaleRaw as any)?.y === 'number' ? Number((sideUvScaleRaw as any).y) : Number.NaN
  const sideUvScale = {
    x: Number.isFinite(sideX) ? Math.max(0, sideX) : FLOOR_DEFAULT_SIDE_UV_SCALE.x,
    y: Number.isFinite(sideY) ? Math.max(0, sideY) : FLOOR_DEFAULT_SIDE_UV_SCALE.y,
  }

  return { smooth, thickness, sideUvScale }
}

export function resolveFloorComponentPropsFromMesh(mesh: FloorDynamicMesh | undefined | null): FloorComponentProps {
  if (!mesh) {
    return clampFloorComponentProps(null)
  }
  return clampFloorComponentProps({
    smooth: mesh.smooth,
    thickness: mesh.thickness,
    sideUvScale: (mesh.sideUvScale ?? undefined) as Vector2Like | undefined,
  })
}

export function cloneFloorComponentProps(props: FloorComponentProps): FloorComponentProps {
  return {
    smooth: props.smooth,
    thickness: props.thickness,
    sideUvScale: { x: props.sideUvScale.x, y: props.sideUvScale.y },
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
  order: 52,
  inspector: [
    {
      id: 'surface',
      label: 'Surface',
      fields: [
        {
          kind: 'number',
          key: 'thickness',
          label: 'Thickness (m)',
          min: FLOOR_MIN_THICKNESS,
          max: FLOOR_MAX_THICKNESS,
          step: 0.05,
        },
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
    thickness: overrides?.thickness ?? defaults.thickness,
    sideUvScale: overrides?.sideUvScale ?? defaults.sideUvScale,
  })
  return {
    id: options.id ?? '',
    type: FLOOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { floorComponentDefinition }
