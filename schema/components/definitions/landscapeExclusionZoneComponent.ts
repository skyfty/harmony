import { Euler, Quaternion, Vector3, type Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../core'
import {
  registerLandscapeExclusion,
  unregisterLandscapeExclusion,
  updateLandscapeExclusion,
} from '../../proceduralLandscape/exclusion'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE = 'landscapeExclusionZone'
export const LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS = 20
export const LANDSCAPE_EXCLUSION_ZONE_MIN_RADIUS = 0.5
export const LANDSCAPE_EXCLUSION_ZONE_MAX_RADIUS = 10_000

export interface LandscapeExclusionZoneProps {
  /** World-space radius in meters. Node scaling does not affect this value. */
  radius: number
}

/**
 * Resolve a circle that covers the node-origin-relative footprint of a Floor.
 * Floor vertices are the outer contour; corner smoothing curves inward, so the
 * furthest transformed vertex is sufficient. Other node kinds retain the
 * generic default until they have an equally explicit footprint definition.
 */
export function resolveLandscapeExclusionZoneRadiusForNode(node: SceneNode): number {
  const mesh = node.dynamicMesh
  if (!mesh || mesh.type !== 'Floor' || !Array.isArray(mesh.vertices) || mesh.vertices.length < 3) {
    return LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS
  }

  const scaleX = Math.abs(Number(node.scale?.x))
  const scaleY = Math.abs(Number(node.scale?.y))
  const scaleZ = Math.abs(Number(node.scale?.z))
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || !Number.isFinite(scaleZ)) {
    return LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS
  }

  const rotationX = node.rotation?.x == null ? 0 : Number(node.rotation.x)
  const rotationY = node.rotation?.y == null ? 0 : Number(node.rotation.y)
  const rotationZ = node.rotation?.z == null ? 0 : Number(node.rotation.z)
  if (
    !Number.isFinite(rotationX)
    || !Number.isFinite(rotationY)
    || !Number.isFinite(rotationZ)
  ) {
    return LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS
  }
  const rotation = new Quaternion().setFromEuler(
    new Euler(rotationX, rotationY, rotationZ),
  )
  const thickness = Number(mesh.thickness)
  const halfThickness = Number.isFinite(thickness) ? Math.max(0, thickness) * 0.5 : 0
  const localYValues = halfThickness > 0 ? [-halfThickness, halfThickness] : [0]
  const point = new Vector3()
  let maxRadius = 0
  let validVertexCount = 0

  for (const vertex of mesh.vertices) {
    if (!Array.isArray(vertex) || vertex.length < 2) {
      continue
    }
    const localX = Number(vertex[0])
    const localZ = Number(vertex[1])
    if (!Number.isFinite(localX) || !Number.isFinite(localZ)) {
      continue
    }
    validVertexCount += 1
    for (const localY of localYValues) {
      point
        .set(localX * scaleX, localY * scaleY, localZ * scaleZ)
        .applyQuaternion(rotation)
      const radius = Math.hypot(point.x, point.z)
      if (Number.isFinite(radius)) {
        maxRadius = Math.max(maxRadius, radius)
      }
    }
  }

  if (!validVertexCount) {
    return LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS
  }
  return clampLandscapeExclusionZoneProps({
    // Round outward so the inspector shows a stable meter value that still
    // covers every transformed floor vertex.
    radius: Math.ceil(maxRadius * 100) / 100,
  }).radius
}

export function clampLandscapeExclusionZoneProps(
  props: Partial<LandscapeExclusionZoneProps> | null | undefined,
): LandscapeExclusionZoneProps {
  const numeric = Number(props?.radius)
  const radius = Number.isFinite(numeric)
    ? numeric
    : LANDSCAPE_EXCLUSION_ZONE_DEFAULT_RADIUS
  return {
    radius: Math.max(
      LANDSCAPE_EXCLUSION_ZONE_MIN_RADIUS,
      Math.min(LANDSCAPE_EXCLUSION_ZONE_MAX_RADIUS, radius),
    ),
  }
}

export function cloneLandscapeExclusionZoneProps(
  props: LandscapeExclusionZoneProps,
): LandscapeExclusionZoneProps {
  return { radius: props.radius }
}

function getRegistrationId(nodeId: string, componentId: string): string {
  return `${nodeId}:${componentId}`
}

class LandscapeExclusionZoneComponent extends Component<LandscapeExclusionZoneProps> {
  private object: Object3D | null = null
  private propsValue: LandscapeExclusionZoneProps
  private enabled = true

  constructor(context: ComponentRuntimeContext<LandscapeExclusionZoneProps>) {
    super(context)
    this.propsValue = clampLandscapeExclusionZoneProps(context.getProps())
    this.enabled = context.isEnabled()
    this.register()
  }

  private get registrationId(): string {
    return getRegistrationId(this.context.nodeId, this.context.componentId)
  }

  private register(): void {
    registerLandscapeExclusion(
      this.registrationId,
      this.object,
      this.propsValue.radius,
      this.enabled,
    )
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.object = object
    this.register()
  }

  onPropsUpdated(next: Readonly<LandscapeExclusionZoneProps>): void {
    this.propsValue = clampLandscapeExclusionZoneProps(next)
    updateLandscapeExclusion(this.registrationId, {
      radius: this.propsValue.radius,
    })
  }

  onEnabledChanged(enabled: boolean): void {
    this.enabled = enabled
    updateLandscapeExclusion(this.registrationId, { enabled })
  }

  onDestroy(): void {
    unregisterLandscapeExclusion(this.registrationId)
  }
}

const landscapeExclusionZoneComponentDefinition: ComponentDefinition<LandscapeExclusionZoneProps> = {
  type: LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE,
  label: 'Landscape Exclusion Zone',
  icon: 'mdi-vector-circle',
  order: 94,
  description: 'Keep procedurally generated landscape content outside this node radius.',
  canAttach(node: SceneNode) {
    return node.nodeType === 'Mesh' || node.nodeType === 'Group' || node.nodeType === 'Empty'
  },
  createDefaultProps(node) {
    return clampLandscapeExclusionZoneProps({
      radius: resolveLandscapeExclusionZoneRadiusForNode(node),
    })
  },
  createInstance(context) {
    return new LandscapeExclusionZoneComponent(context)
  },
}

componentManager.registerDefinition(landscapeExclusionZoneComponentDefinition)

export function createLandscapeExclusionZoneComponentState(
  node: SceneNode,
  overrides?: Partial<LandscapeExclusionZoneProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<LandscapeExclusionZoneProps> {
  const defaults = landscapeExclusionZoneComponentDefinition.createDefaultProps(node)
  return {
    id: options.id ?? '',
    type: LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: cloneLandscapeExclusionZoneProps(clampLandscapeExclusionZoneProps({
      ...defaults,
      ...overrides,
    })),
  }
}

export { landscapeExclusionZoneComponentDefinition }
