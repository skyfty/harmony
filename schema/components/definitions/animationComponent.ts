import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { sanitizeAnimationClipName } from '../../runtimeAnimationCatalog'

export const ANIMATION_COMPONENT_TYPE = 'animationComponent'

export interface AnimationComponentProps {
  defaultClipName: string | null
  autoplay: boolean
}

export function clampAnimationComponentProps(
  props: Partial<AnimationComponentProps> | null | undefined,
): AnimationComponentProps {
  return {
    defaultClipName: sanitizeAnimationClipName(props?.defaultClipName),
    autoplay: props?.autoplay !== false,
  }
}

export function cloneAnimationComponentProps(
  props: AnimationComponentProps,
): AnimationComponentProps {
  return {
    defaultClipName: props.defaultClipName,
    autoplay: props.autoplay,
  }
}

class AnimationComponent extends Component<AnimationComponentProps> {
  constructor(context: ComponentRuntimeContext<AnimationComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    if (!object) {
      return
    }
    object.userData.animationComponent = true
    object.userData.animationComponentNodeId = this.context.nodeId
    object.userData.animationComponentId = this.context.componentId
  }
}

const animationComponentDefinition: ComponentDefinition<AnimationComponentProps> = {
  type: ANIMATION_COMPONENT_TYPE,
  label: 'Animation',
  icon: 'mdi-animation-play-outline',
  order: 160,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType ?? ''
    const hasSourceAsset = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
    return hasSourceAsset && (nodeType === 'Mesh' || nodeType === 'Group')
  },
  createDefaultProps() {
    return clampAnimationComponentProps(null)
  },
  createInstance(context) {
    return new AnimationComponent(context)
  },
}

componentManager.registerDefinition(animationComponentDefinition)

export function createAnimationComponentState(
  node: SceneNode,
  overrides?: Partial<AnimationComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<AnimationComponentProps> {
  const defaults = animationComponentDefinition.createDefaultProps(node)
  const merged = clampAnimationComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: ANIMATION_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { animationComponentDefinition }
