import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { sanitizeAnimationClipName } from '../../runtimeAnimationCatalog'

export const ANIMATION_COMPONENT_TYPE = 'animationComponent'

export interface AnimationComponentProps {
  defaultClipName: string | null
  /**
   * 外部动画资产列表（资产库中的 GLB/FBX 等模型资产）。
   * 这些资产中的动画片段会按列表顺序合并进当前节点的动画运行时：
   * 同名 clip 以外部为准，多个外部资产同名时后添加的覆盖先添加的；
   * 未选择或外部无 clip 时回退到模型内置动画。
   */
  animationAssetIds: string[]
  autoplay: boolean
  loop: boolean
  timeScale: number
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false
  }
  return fallback
}

function clampFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function sanitizeAssetId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length ? trimmed : null
}

function sanitizeAssetIds(value: unknown): string[] {
  const ids = Array.isArray(value) ? value : []
  const result: string[] = []
  const seen = new Set<string>()
  ids.forEach((id) => {
    const normalized = sanitizeAssetId(id)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  })
  return result
}

export function clampAnimationComponentProps(
  props:
    | Partial<AnimationComponentProps>
    | { animationAssetId?: unknown }
    | null
    | undefined,
): AnimationComponentProps {
  const raw = (props ?? {}) as Partial<AnimationComponentProps> & { animationAssetId?: unknown }
  const hasAssetIdsArray = Array.isArray(raw.animationAssetIds)
  const legacyAssetId = sanitizeAssetId(raw.animationAssetId)
  const animationAssetIds = hasAssetIdsArray
    ? sanitizeAssetIds(raw.animationAssetIds)
    : legacyAssetId
      ? [legacyAssetId]
      : []
  return {
    defaultClipName: sanitizeAnimationClipName(raw.defaultClipName),
    animationAssetIds,
    autoplay: clampBoolean(raw.autoplay, true),
    loop: clampBoolean(raw.loop, true),
    timeScale: clampFiniteNumber(raw.timeScale, 1),
  }
}

export function cloneAnimationComponentProps(
  props: AnimationComponentProps,
): AnimationComponentProps {
  return {
    defaultClipName: props.defaultClipName,
    animationAssetIds: [...props.animationAssetIds],
    autoplay: props.autoplay,
    loop: props.loop,
    timeScale: props.timeScale,
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
