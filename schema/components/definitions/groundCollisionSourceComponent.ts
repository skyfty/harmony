import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const GROUND_COLLISION_SOURCE_COMPONENT_TYPE = 'groundCollisionSource'

export interface GroundCollisionSourceComponentProps {
  label: string
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function clampGroundCollisionSourceComponentProps(
  props: Partial<GroundCollisionSourceComponentProps> | null | undefined,
): GroundCollisionSourceComponentProps {
  return {
    label: sanitizeString(props?.label) || 'Ground Collision Source',
  }
}

export function cloneGroundCollisionSourceComponentProps(
  props: GroundCollisionSourceComponentProps,
): GroundCollisionSourceComponentProps {
  return {
    label: props.label,
  }
}

class GroundCollisionSourceComponent extends Component<GroundCollisionSourceComponentProps> {
  constructor(context: ComponentRuntimeContext<GroundCollisionSourceComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: THREE.Object3D | null): void {
    if (!object) {
      return
    }
    // Mirrors the Ground Anchor tagging convention so the viewers can spot the
    // node from either the scene document or the runtime object.
    object.userData.groundCollisionSource = true
    object.userData.groundCollisionSourceComponentId = this.context.componentId
    object.userData.groundCollisionSourceNodeId = this.context.nodeId
  }
}

const groundCollisionSourceComponentDefinition: ComponentDefinition<GroundCollisionSourceComponentProps> = {
  type: GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
  label: 'Ground Collision Source',
  description: 'Generate and refresh runtime collision from this node meshes near Ground Anchor probes.',
  icon: 'mdi-vector-square',
  order: 167,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(node: SceneNode) {
    return clampGroundCollisionSourceComponentProps({
      label: node.name?.trim().length ? `${node.name} Collision Source` : 'Ground Collision Source',
    })
  },
  createInstance(context) {
    return new GroundCollisionSourceComponent(context)
  },
}

componentManager.registerDefinition(groundCollisionSourceComponentDefinition)

export function createGroundCollisionSourceComponentState(
  node: SceneNode,
  overrides?: Partial<GroundCollisionSourceComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GroundCollisionSourceComponentProps> {
  const defaults = groundCollisionSourceComponentDefinition.createDefaultProps(node)
  return {
    id: options.id ?? '',
    type: GROUND_COLLISION_SOURCE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampGroundCollisionSourceComponentProps({
      ...defaults,
      ...overrides,
    }),
  }
}

export { groundCollisionSourceComponentDefinition }
