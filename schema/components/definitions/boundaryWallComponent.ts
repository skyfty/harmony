import type { Object3D } from 'three'
import { extractWaterSurfaceMeshMetadataFromUserData, type SceneNode, type SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { WATER_COMPONENT_TYPE } from './waterComponent'

export const BOUNDARY_WALL_COMPONENT_TYPE = 'boundaryWall'
export const BOUNDARY_WALL_DEFAULT_HEIGHT = 8
export const BOUNDARY_WALL_DEFAULT_THICKNESS = 0.6
export const BOUNDARY_WALL_DEFAULT_OFFSET = 0
export const BOUNDARY_WALL_DEFAULT_MODE = 'auto'
export const BOUNDARY_WALL_MIN_HEIGHT = 0.01
export const BOUNDARY_WALL_MIN_THICKNESS = 0.01
export const BOUNDARY_WALL_MIN_OFFSET = -100
export const BOUNDARY_WALL_MAX_OFFSET = 100
export const BOUNDARY_WALL_MAX_CUSTOM_LOOPS = 16
export const BOUNDARY_WALL_MAX_CUSTOM_LOOP_POINTS = 256

const BOUNDARY_WALL_POINT_EPSILON = 1e-4

export type BoundaryWallMode = 'auto' | 'custom'

export interface BoundaryWallCustomPoint {
  x: number
  z: number
}

export interface BoundaryWallCustomLoop {
  points: BoundaryWallCustomPoint[]
  closed: boolean
}

export interface BoundaryWallComponentProps {
  height: number
  thickness: number
  offset: number
  mode: BoundaryWallMode
  customLoops: BoundaryWallCustomLoop[]
}

function normalizeBoundaryWallMode(value: unknown): BoundaryWallMode {
  return value === 'custom' ? 'custom' : 'auto'
}

function clampBoundaryWallCustomLoops(input: unknown): BoundaryWallCustomLoop[] {
  if (!Array.isArray(input)) {
    return []
  }

  const loops: BoundaryWallCustomLoop[] = []
  for (const rawLoop of input.slice(0, BOUNDARY_WALL_MAX_CUSTOM_LOOPS)) {
    if (!rawLoop || typeof rawLoop !== 'object') {
      continue
    }

    const rawPoints = Array.isArray((rawLoop as { points?: unknown }).points)
      ? (rawLoop as { points: unknown[] }).points
      : []
    const points: BoundaryWallCustomPoint[] = []

    for (const rawPoint of rawPoints.slice(0, BOUNDARY_WALL_MAX_CUSTOM_LOOP_POINTS)) {
      let xRaw: unknown
      let zRaw: unknown
      if (Array.isArray(rawPoint)) {
        xRaw = rawPoint[0]
        zRaw = rawPoint[1]
      } else if (rawPoint && typeof rawPoint === 'object') {
        xRaw = (rawPoint as { x?: unknown }).x
        zRaw = (rawPoint as { z?: unknown }).z
      } else {
        continue
      }

      const x = Number(xRaw)
      const z = Number(zRaw)
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        continue
      }

      const previous = points[points.length - 1]
      if (previous) {
        const dx = x - previous.x
        const dz = z - previous.z
        if (dx * dx + dz * dz <= BOUNDARY_WALL_POINT_EPSILON * BOUNDARY_WALL_POINT_EPSILON) {
          continue
        }
      }

      points.push({ x, z })
    }

    const closed = (rawLoop as { closed?: unknown }).closed !== false
    if (closed && points.length >= 3) {
      const first = points[0]!
      const last = points[points.length - 1]!
      const dx = first.x - last.x
      const dz = first.z - last.z
      if (dx * dx + dz * dz <= BOUNDARY_WALL_POINT_EPSILON * BOUNDARY_WALL_POINT_EPSILON) {
        points.pop()
      }
    }

    if (points.length >= (closed ? 3 : 2)) {
      loops.push({ points, closed })
    }
  }

  return loops
}

export function clampBoundaryWallComponentProps(
  props: Partial<BoundaryWallComponentProps> | null | undefined,
): BoundaryWallComponentProps {
  const heightRaw = typeof props?.height === 'number' ? props.height : Number(props?.height)
  const thicknessRaw = typeof props?.thickness === 'number' ? props.thickness : Number(props?.thickness)
  const offsetRaw = typeof props?.offset === 'number' ? props.offset : Number(props?.offset)
  const mode = normalizeBoundaryWallMode((props as { mode?: unknown } | null | undefined)?.mode)
  const customLoops = clampBoundaryWallCustomLoops((props as { customLoops?: unknown } | null | undefined)?.customLoops)

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
    mode,
    customLoops,
  }
}

export function cloneBoundaryWallComponentProps(props: BoundaryWallComponentProps): BoundaryWallComponentProps {
  return {
    height: props.height,
    thickness: props.thickness,
    offset: props.offset,
    mode: props.mode,
    customLoops: props.customLoops.map((loop) => ({
      closed: loop.closed,
      points: loop.points.map((point) => ({ x: point.x, z: point.z })),
    })),
  }
}

export function canAttachBoundaryWallComponent(node: SceneNode): boolean {
  const nodeType = node.nodeType?.toLowerCase?.() ?? ''
  if (nodeType === 'light' || nodeType === 'environment') {
    return false
  }
  const dynamicType = node.dynamicMesh?.type
  if (
    dynamicType === 'Wall'
    || dynamicType === 'Floor'
    || dynamicType === 'Landform'
    || dynamicType === 'Road'
    || dynamicType === 'Region'
  ) {
    return true
  }
  if (node.components?.[WATER_COMPONENT_TYPE]) {
    return true
  }
  if (extractWaterSurfaceMeshMetadataFromUserData(node.userData) !== null) {
    return true
  }
  return true
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
    mode: overrides?.mode ?? defaults.mode,
    customLoops: overrides?.customLoops ?? defaults.customLoops,
  })
  return {
    id: options.id ?? '',
    type: BOUNDARY_WALL_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { boundaryWallComponentDefinition }