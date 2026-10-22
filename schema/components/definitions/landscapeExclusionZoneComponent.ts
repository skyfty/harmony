import type { Object3D } from 'three'
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
  createDefaultProps() {
    return clampLandscapeExclusionZoneProps(null)
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
