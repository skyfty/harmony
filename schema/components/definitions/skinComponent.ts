import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const SKIN_COMPONENT_TYPE = 'skinComponent'

export interface SkinComponentProps {
  /** 帽子外部模型资产。 */
  hatAssetId: string | null
  /** 眼镜外部模型资产。 */
  glassesAssetId: string | null
  /** 头发外部模型资产。 */
  hairAssetId: string | null
  /** 上衣外部模型资产。 */
  topAssetId: string | null
  /** 裤子外部模型资产。 */
  pantsAssetId: string | null
  /** 鞋子外部模型资产。 */
  shoesAssetId: string | null
}

function sanitizeAssetId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length ? trimmed : null
}

export function clampSkinComponentProps(
  props: Partial<SkinComponentProps> | null | undefined,
): SkinComponentProps {
  return {
    hatAssetId: sanitizeAssetId(props?.hatAssetId),
    glassesAssetId: sanitizeAssetId(props?.glassesAssetId),
    hairAssetId: sanitizeAssetId(props?.hairAssetId),
    topAssetId: sanitizeAssetId(props?.topAssetId),
    pantsAssetId: sanitizeAssetId(props?.pantsAssetId),
    shoesAssetId: sanitizeAssetId(props?.shoesAssetId),
  }
}

export function cloneSkinComponentProps(props: SkinComponentProps): SkinComponentProps {
  return {
    hatAssetId: props.hatAssetId,
    glassesAssetId: props.glassesAssetId,
    hairAssetId: props.hairAssetId,
    topAssetId: props.topAssetId,
    pantsAssetId: props.pantsAssetId,
    shoesAssetId: props.shoesAssetId,
  }
}

class SkinComponent extends Component<SkinComponentProps> {
  constructor(context: ComponentRuntimeContext<SkinComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    if (!object) {
      return
    }
    object.userData.skinComponent = true
    object.userData.skinComponentNodeId = this.context.nodeId
    object.userData.skinComponentId = this.context.componentId
  }
}

const skinComponentDefinition: ComponentDefinition<SkinComponentProps> = {
  type: SKIN_COMPONENT_TYPE,
  label: 'Skin',
  icon: 'mdi-hanger',
  order: 165,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType ?? ''
    const hasSourceAsset = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
    return hasSourceAsset && (nodeType === 'Mesh' || nodeType === 'Group')
  },
  createDefaultProps() {
    return clampSkinComponentProps(null)
  },
  createInstance(context) {
    return new SkinComponent(context)
  },
}

componentManager.registerDefinition(skinComponentDefinition)

export function createSkinComponentState(
  node: SceneNode,
  overrides?: Partial<SkinComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<SkinComponentProps> {
  const defaults = skinComponentDefinition.createDefaultProps(node)
  const merged = clampSkinComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: SKIN_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { skinComponentDefinition }
