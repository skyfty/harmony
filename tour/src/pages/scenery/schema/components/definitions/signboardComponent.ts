import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const SIGNBOARD_COMPONENT_TYPE = 'signboard'

export interface SignboardComponentProps {
  label: string
}

export function clampSignboardComponentProps(
  props: Partial<SignboardComponentProps> | null | undefined,
): SignboardComponentProps {
  return {
    label: typeof props?.label === 'string' ? props.label : '',
  }
}

export function cloneSignboardComponentProps(props: SignboardComponentProps): SignboardComponentProps {
  return {
    label: props.label,
  }
}

class SignboardComponent extends Component<SignboardComponentProps> {
  constructor(context: ComponentRuntimeContext<SignboardComponentProps>) {
    super(context)
  }

  private applyRuntimeState(object: Object3D | null): void {
    if (!object) {
      return
    }

    const userData = object.userData ?? (object.userData = {})
    if (!this.context.isEnabled()) {
      if (userData.signboard) {
        userData.signboard = false
      }
      return
    }

    userData.signboard = true
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyRuntimeState(object)
  }

  onPropsUpdated(): void {
    this.applyRuntimeState(this.context.getRuntimeObject())
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyRuntimeState(this.context.getRuntimeObject())
  }
}

const signboardComponentDefinition: ComponentDefinition<SignboardComponentProps> = {
  type: SIGNBOARD_COMPONENT_TYPE,
  label: 'Signboard',
  icon: 'mdi-sign-direction',
  order: 47,
  inspector: [
    {
      id: 'content',
      label: 'Content',
      fields: [
        {
          kind: 'text',
          key: 'label',
          label: 'Display Name',
        },
      ],
    },
  ],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {
      label: '',
    }
  },
  createInstance(context) {
    return new SignboardComponent(context)
  },
}

componentManager.registerDefinition(signboardComponentDefinition)

export function createSignboardComponentState(
  node: SceneNode,
  overrides?: Partial<SignboardComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<SignboardComponentProps> {
  const defaults = signboardComponentDefinition.createDefaultProps(node)
  const merged = clampSignboardComponentProps({
    label: overrides?.label ?? defaults.label,
  })
  return {
    id: options.id ?? '',
    type: SIGNBOARD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { signboardComponentDefinition }