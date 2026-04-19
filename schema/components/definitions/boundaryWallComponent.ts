import type { Object3D } from 'three'
import { extractWaterSurfaceMeshMetadataFromUserData, type SceneNode, type SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const BOUNDARY_WALL_COMPONENT_TYPE = 'boundaryWall'
export const BOUNDARY_WALL_DEFAULT_HEIGHT = 8
export const BOUNDARY_WALL_DEFAULT_THICKNESS = 0.6
export const BOUNDARY_WALL_DEFAULT_OFFSET = 0
export const BOUNDARY_WALL_MIN_HEIGHT = 0.01
export const BOUNDARY_WALL_MIN_THICKNESS = 0.01
export const BOUNDARY_WALL_MIN_OFFSET = -100
export const BOUNDARY_WALL_MAX_OFFSET = 100

export interface BoundaryWallComponentProps {
  height: number
  thickness: number
  offset: number
}

export function clampBoundaryWallComponentProps(
  props: Partial<BoundaryWallComponentProps> | null | undefined,
): BoundaryWallComponentProps {
  const heightRaw = typeof props?.height === 'number' ? props.height : Number(props?.height)
  const thicknessRaw = typeof props?.thickness === 'number' ? props.thickness : Number(props?.thickness)
  const offsetRaw = typeof props?.offset === 'number' ? props.offset : Number(props?.offset)

  return {
    height: Number.isFinite(heightRaw)
      ? Math.max(BOUNDARY_WALL_MIN_HEIGHT, heightRaw)
      : BOUNDARY_WALL_DEFAULT_HEIGHT,
    thickness: Number.isFinite(thicknessRaw)
      ? Math.max(BOUNDARY_WALL_MIN_THICKNESS, thicknessRaw)
      : BOUNDARY_WALL_DEFAULT_THICKNESS,
    offset: Number.isFinite(offsetRaw)
      ? Math.max(BOUNDARY_WALL_MIN_OFFSET, Math.min(BOUNDARY_WALL_MAX_OFFSET, offsetRaw))
      : BOUNDARY_WALL_DEFAULT_OFFSET,
  }
}

export function cloneBoundaryWallComponentProps(props: BoundaryWallComponentProps): BoundaryWallComponentProps {
  return {
    height: props.height,
    thickness: props.thickness,
    offset: props.offset,
  }
}

export function canAttachBoundaryWallComponent(node: SceneNode): boolean {
  const dynamicType = node.dynamicMesh?.type
  if (
    dynamicType === 'Wall'
    || dynamicType === 'Floor'
    || dynamicType === 'Landform'
    || dynamicType === 'Road'
  ) {
    return true
  }
  return extractWaterSurfaceMeshMetadataFromUserData(node.userData) !== null
}

class BoundaryWallComponent extends Component<BoundaryWallComponentProps> {
  constructor(context: ComponentRuntimeContext<BoundaryWallComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const boundaryWallComponentDefinition: ComponentDefinition<BoundaryWallComponentProps> = {
  type: BOUNDARY_WALL_COMPONENT_TYPE,
  label: 'Boundary Wall',
  icon: 'mdi-wall-sconce-flat-variant',
  order: 54,
  inspector: [
    {
      id: 'boundary-wall',
      label: 'Boundary Wall',
      fields: [
        {
          kind: 'number',
          key: 'height',
          label: 'Height (m)',
          min: BOUNDARY_WALL_MIN_HEIGHT,
          step: 0.1,
        },
        {
          kind: 'number',
          key: 'thickness',
          label: 'Thickness (m)',
          min: BOUNDARY_WALL_MIN_THICKNESS,
          step: 0.05,
        },
        {
          kind: 'number',
          key: 'offset',
          label: 'Offset (m)',
          min: BOUNDARY_WALL_MIN_OFFSET,
          max: BOUNDARY_WALL_MAX_OFFSET,
          step: 0.05,
        },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return canAttachBoundaryWallComponent(node)
  },
  createDefaultProps(_node: SceneNode) {
    return clampBoundaryWallComponentProps(null)
  },
  createInstance(context) {
    return new BoundaryWallComponent(context)
  },
}

componentManager.registerDefinition(boundaryWallComponentDefinition)

export function createBoundaryWallComponentState(
  node: SceneNode,
  overrides?: Partial<BoundaryWallComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<BoundaryWallComponentProps> {
  const defaults = boundaryWallComponentDefinition.createDefaultProps(node)
  const merged = clampBoundaryWallComponentProps({
    height: overrides?.height ?? defaults.height,
    thickness: overrides?.thickness ?? defaults.thickness,
    offset: overrides?.offset ?? defaults.offset,
  })
  return {
    id: options.id ?? '',
    type: BOUNDARY_WALL_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { boundaryWallComponentDefinition }