import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const VIEW_POINT_COMPONENT_TYPE = 'viewPoint'
export const VIEW_POINT_DEFAULT_INITIAL_VISIBILITY = true

export interface ViewPointComponentProps {
  initiallyVisible: boolean
}

export function clampViewPointComponentProps(
  props: Partial<ViewPointComponentProps> | null | undefined,
): ViewPointComponentProps {
  return {
    initiallyVisible: props?.initiallyVisible !== false,
  }
}

export function cloneViewPointComponentProps(props: ViewPointComponentProps): ViewPointComponentProps {
  return {
    initiallyVisible: props.initiallyVisible,
  }
}

class ViewPointComponent extends Component<ViewPointComponentProps> {
  constructor(context: ComponentRuntimeContext<ViewPointComponentProps>) {
    super(context)
  }

  private applyRuntimeState(object: Object3D | null): void {
    if (!object) {
      return
    }

    const props = this.context.getProps()
    const userData = object.userData ?? (object.userData = {})

    if (!this.context.isEnabled()) {
      if (userData.viewPoint) {
        userData.viewPoint = false
      }
      object.visible = false
      return
    }

    userData.viewPoint = true
    if (typeof userData.viewPointBaseScale !== 'object' || userData.viewPointBaseScale === null) {
      userData.viewPointBaseScale = {
        x: object.scale?.x ?? 1,
        y: object.scale?.y ?? 1,
        z: object.scale?.z ?? 1,
      }
    }
    object.visible = props.initiallyVisible === true
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

const viewPointComponentDefinition: ComponentDefinition<ViewPointComponentProps> = {
  type: VIEW_POINT_COMPONENT_TYPE,
  label: 'View Point',
  icon: 'mdi-eye',
  order: 45,
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
  canAttach(node: SceneNode) {
    const flags = node.editorFlags ?? {}
    return node.nodeType === 'Sphere' && flags.editorOnly === true && flags.ignoreGridSnapping === true
  },
  createDefaultProps(_node: SceneNode) {
    return {
      initiallyVisible: VIEW_POINT_DEFAULT_INITIAL_VISIBILITY,
    }
  },
  createInstance(context) {
    return new ViewPointComponent(context)
  },
}

componentManager.registerDefinition(viewPointComponentDefinition)

export function createViewPointComponentState(
  node: SceneNode,
  overrides?: Partial<ViewPointComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ViewPointComponentProps> {
  const defaults = viewPointComponentDefinition.createDefaultProps(node)
  const merged = clampViewPointComponentProps({
    initiallyVisible: overrides?.initiallyVisible ?? defaults.initiallyVisible,
  })
  return {
    id: options.id ?? '',
    type: VIEW_POINT_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { viewPointComponentDefinition }
