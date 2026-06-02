import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const GROUND_ANCHOR_COMPONENT_TYPE = 'groundAnchor'

export interface GroundAnchorComponentProps {
  label: string
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function clampGroundAnchorComponentProps(
  props: Partial<GroundAnchorComponentProps> | null | undefined,
): GroundAnchorComponentProps {
  return {
    label: sanitizeString(props?.label) || 'Ground Anchor',
  }
}

export function cloneGroundAnchorComponentProps(
  props: GroundAnchorComponentProps,
): GroundAnchorComponentProps {
  return {
    label: props.label,
  }
}

class GroundAnchorComponent extends Component<GroundAnchorComponentProps> {
  constructor(context: ComponentRuntimeContext<GroundAnchorComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: THREE.Object3D | null): void {
    if (!object) {
      return
    }
    object.userData.groundAnchor = true
    object.userData.groundAnchorComponentId = this.context.componentId
    object.userData.groundAnchorNodeId = this.context.nodeId
  }
}

const groundAnchorComponentDefinition: ComponentDefinition<GroundAnchorComponentProps> = {
  type: GROUND_ANCHOR_COMPONENT_TYPE,
  label: 'Ground Anchor',
  description: 'Generate and refresh runtime ground collision near this node.',
  icon: 'mdi-terrain',
  order: 166,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(node: SceneNode) {
    return clampGroundAnchorComponentProps({
      label: node.name?.trim().length ? `${node.name} Ground Anchor` : 'Ground Anchor',
    })
  },
  createInstance(context) {
    return new GroundAnchorComponent(context)
  },
}

componentManager.registerDefinition(groundAnchorComponentDefinition)

export function createGroundAnchorComponentState(
  node: SceneNode,
  overrides?: Partial<GroundAnchorComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GroundAnchorComponentProps> {
  const defaults = groundAnchorComponentDefinition.createDefaultProps(node)
  return {
    id: options.id ?? '',
    type: GROUND_ANCHOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampGroundAnchorComponentProps({
      ...defaults,
      ...overrides,
    }),
  }
}

export { groundAnchorComponentDefinition }
