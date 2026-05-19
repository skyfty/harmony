import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const SCENE_STATE_ANCHOR_COMPONENT_TYPE = 'sceneStateAnchor'

export interface SceneStateAnchorComponentProps {
  // no configuration required
}

export function clampSceneStateAnchorComponentProps(
  _props: Partial<SceneStateAnchorComponentProps> | null | undefined,
): SceneStateAnchorComponentProps {
  return {}
}

export function cloneSceneStateAnchorComponentProps(
  _props: SceneStateAnchorComponentProps,
): SceneStateAnchorComponentProps {
  return {}
}

class SceneStateAnchorComponent extends Component<SceneStateAnchorComponentProps> {
  constructor(context: ComponentRuntimeContext<SceneStateAnchorComponentProps>) {
    super(context)
  }
}

const sceneStateAnchorComponentDefinition: ComponentDefinition<SceneStateAnchorComponentProps> = {
  type: SCENE_STATE_ANCHOR_COMPONENT_TYPE,
  label: 'Scene State Anchor',
  description: 'Persist node transform when switching scenes and restore on return.',
  icon: 'mdi-map-marker',
  order: 90,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {}
  },
  createInstance(context) {
    return new SceneStateAnchorComponent(context)
  },
}

componentManager.registerDefinition(sceneStateAnchorComponentDefinition)

export function createSceneStateAnchorComponentState(
  _node: SceneNode,
  _overrides?: Partial<SceneStateAnchorComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<SceneStateAnchorComponentProps> {
  return {
    id: options.id ?? '',
    type: SCENE_STATE_ANCHOR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: {},
  }
}

export { sceneStateAnchorComponentDefinition }
