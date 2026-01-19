import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const PRELOADABLE_COMPONENT_TYPE = 'preloadable'

export interface PreloadableComponentProps {
  // no configuration required
}

export function clampPreloadableComponentProps(
  _props: Partial<PreloadableComponentProps> | null | undefined,
): PreloadableComponentProps {
  return {}
}

export function clonePreloadableComponentProps(_props: PreloadableComponentProps): PreloadableComponentProps {
  return {}
}

class PreloadableComponent extends Component<PreloadableComponentProps> {
  constructor(context: ComponentRuntimeContext<PreloadableComponentProps>) {
    super(context)
  }
}

const preloadableComponentDefinition: ComponentDefinition<PreloadableComponentProps> = {
  type: PRELOADABLE_COMPONENT_TYPE,
  label: 'Preloadable',
  description: 'Preload node assets (node + subtree) on scene entry to avoid runtime stutter.',
  icon: 'mdi-download',
  order: 95,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {}
  },
  createInstance(context) {
    return new PreloadableComponent(context)
  },
}

componentManager.registerDefinition(preloadableComponentDefinition)

export function createPreloadableComponentState(
  _node: SceneNode,
  _overrides?: Partial<PreloadableComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<PreloadableComponentProps> {
  return {
    id: options.id ?? '',
    type: PRELOADABLE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: {},
  }
}

export { preloadableComponentDefinition }
