import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const GUIDEBOARD_COMPONENT_TYPE = 'guideboard'
export const GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY = false

export interface GuideboardComponentProps {
  initiallyVisible: boolean
}

export function clampGuideboardComponentProps(
  props: Partial<GuideboardComponentProps> | null | undefined,
): GuideboardComponentProps {
  return {
    initiallyVisible: props?.initiallyVisible === true,
  }
}

export function cloneGuideboardComponentProps(props: GuideboardComponentProps): GuideboardComponentProps {
  return {
    initiallyVisible: props.initiallyVisible,
  }
}

class GuideboardComponent extends Component<GuideboardComponentProps> {
  constructor(context: ComponentRuntimeContext<GuideboardComponentProps>) {
    super(context)
  }

  private applyVisibility(object: Object3D | null): void {
    if (!object) {
      return
    }
    const props = this.context.getProps()
    object.visible = props.initiallyVisible === true
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyVisibility(object)
  }

  onPropsUpdated(): void {
    this.applyVisibility(this.context.getRuntimeObject())
  }

  onEnabledChanged(enabled: boolean): void {
    const runtime = this.context.getRuntimeObject()
    if (!runtime) {
      return
    }
    if (!enabled) {
      runtime.visible = false
      return
    }
    this.applyVisibility(runtime)
  }
}

const guideboardComponentDefinition: ComponentDefinition<GuideboardComponentProps> = {
  type: GUIDEBOARD_COMPONENT_TYPE,
  label: 'Guideboard Component',
  icon: 'mdi-sign-direction',
  order: 40,
  inspector: [
    {
      id: 'visibility',
      label: 'Visibility',
      fields: [
        {
          kind: 'boolean',
          key: 'initiallyVisible',
          label: 'Initially Visible',
        },
      ],
    },
  ],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {
      initiallyVisible: GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY,
    }
  },
  createInstance(context) {
    return new GuideboardComponent(context)
  },
}

componentManager.registerDefinition(guideboardComponentDefinition)

export function createGuideboardComponentState(
  node: SceneNode,
  overrides?: Partial<GuideboardComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GuideboardComponentProps> {
  const defaults = guideboardComponentDefinition.createDefaultProps(node)
  const merged = clampGuideboardComponentProps({
    initiallyVisible: overrides?.initiallyVisible ?? defaults.initiallyVisible,
  })
  return {
    id: options.id ?? '',
    type: GUIDEBOARD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { guideboardComponentDefinition }
