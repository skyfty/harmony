import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const PROTAGONIST_COMPONENT_TYPE = 'protagonist'

export interface ProtagonistComponentProps {
  name: string
  initialVisibleNodeIds: string[]
}

export function clampProtagonistComponentProps(
  props: Partial<ProtagonistComponentProps> | null | undefined,
): ProtagonistComponentProps {
  const rawIds = (props as any)?.initialVisibleNodeIds
  const initialVisibleNodeIds = Array.isArray(rawIds)
    ? rawIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
    : []
  return {
    name: typeof props?.name === 'string' ? props.name : '',
    initialVisibleNodeIds,
  }
}

export function cloneProtagonistComponentProps(props: ProtagonistComponentProps): ProtagonistComponentProps {
  return {
    name: props.name,
    initialVisibleNodeIds: Array.isArray(props.initialVisibleNodeIds) ? [...props.initialVisibleNodeIds] : [],
  }
}

class ProtagonistComponent extends Component<ProtagonistComponentProps> {
  constructor(context: ComponentRuntimeContext<ProtagonistComponentProps>) {
    super(context)
  }

  private applyRuntimeState(object: Object3D | null): void {
    if (!object) {
      return
    }

    const userData = object.userData ?? (object.userData = {})

    if (!this.context.isEnabled()) {
      if (userData.protagonist) {
        userData.protagonist = false
      }
      return
    }

    userData.protagonist = true
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

const protagonistComponentDefinition: ComponentDefinition<ProtagonistComponentProps> = {
  type: PROTAGONIST_COMPONENT_TYPE,
  label: 'Protagonist',
  icon: 'mdi-account',
  order: 42,
  inspector: [
    {
      id: 'identity',
      label: 'Identity',
      fields: [
        {
          kind: 'text',
          key: 'name',
          label: 'Name',
        },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    const flags = node.editorFlags ?? {}
    return node.nodeType === 'Capsule' && flags.editorOnly === true
  },
  createDefaultProps(_node: SceneNode) {
    return {
      name: 'Protagonist',
      initialVisibleNodeIds: [],
    }
  },
  createInstance(context) {
    return new ProtagonistComponent(context)
  },
}

componentManager.registerDefinition(protagonistComponentDefinition)

export function createProtagonistComponentState(
  node: SceneNode,
  overrides?: Partial<ProtagonistComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ProtagonistComponentProps> {
  const defaults = protagonistComponentDefinition.createDefaultProps(node)
  const merged = clampProtagonistComponentProps({
    name: overrides?.name ?? defaults.name,
    initialVisibleNodeIds: overrides?.initialVisibleNodeIds ?? defaults.initialVisibleNodeIds,
  })
  return {
    id: options.id ?? '',
    type: PROTAGONIST_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { protagonistComponentDefinition }
