import type { Object3D } from 'three'
import type { BehaviorComponentProps, SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { createEmptyBehaviorComponentProps } from '../../behaviors/definitions'
import {
  registerBehaviorComponent,
  unregisterBehaviorComponent,
  updateBehaviorComponent,
  updateBehaviorObject,
} from '../../behaviors/runtime'

export const BEHAVIOR_COMPONENT_TYPE = 'behavior'

class BehaviorComponent extends Component<BehaviorComponentProps> {
  constructor(context: ComponentRuntimeContext<BehaviorComponentProps>) {
    super(context)
  }

  onInit(): void {
    registerBehaviorComponent(
      this.context.nodeId,
      this.context.getProps().behaviors ?? [],
      this.context.getRuntimeObject(),
    )
  }

  onRuntimeAttached(object: Object3D | null): void {
    updateBehaviorObject(this.context.nodeId, object)
  }

  onPropsUpdated(next: Readonly<BehaviorComponentProps>): void {
    updateBehaviorComponent(this.context.nodeId, next.behaviors ?? [])
  }

  onDestroy(): void {
    unregisterBehaviorComponent(this.context.nodeId)
  }
}

const behaviorComponentDefinition: ComponentDefinition<BehaviorComponentProps> = {
  type: BEHAVIOR_COMPONENT_TYPE,
  label: 'Behavior Component',
  icon: 'mdi-script-text-outline',
  order: 120,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return createEmptyBehaviorComponentProps()
  },
  createInstance(context) {
    return new BehaviorComponent(context)
  },
}

componentManager.registerDefinition(behaviorComponentDefinition)

export function createBehaviorComponentState(
  node: SceneNode,
  overrides?: Partial<BehaviorComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<BehaviorComponentProps> {
  const defaults = behaviorComponentDefinition.createDefaultProps(node)
  const props: BehaviorComponentProps = {
    behaviors: overrides?.behaviors ?? defaults.behaviors,
  }
  return {
    id: options.id ?? '',
    type: BEHAVIOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { behaviorComponentDefinition }
