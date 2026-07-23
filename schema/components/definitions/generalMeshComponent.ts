import type { Mesh, Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../core'

export const GENERAL_MESH_COMPONENT_TYPE = 'generalMesh'
export const GENERAL_MESH_DEFAULT_ENABLE_FRUSTUM_CULLING = true

export interface GeneralMeshComponentProps {
  enableFrustumCulling: boolean
}

export function clampGeneralMeshComponentProps(
  props: Partial<GeneralMeshComponentProps> | null | undefined,
): GeneralMeshComponentProps {
  return {
    enableFrustumCulling: props?.enableFrustumCulling !== false,
  }
}

export function cloneGeneralMeshComponentProps(props: GeneralMeshComponentProps): GeneralMeshComponentProps {
  return {
    enableFrustumCulling: props.enableFrustumCulling,
  }
}

function applyFrustumCulling(object: Object3D | null, enabled: boolean): void {
  object?.traverse((child) => {
    const mesh = child as Mesh
    if ((mesh as any).isMesh) {
      mesh.frustumCulled = enabled
    }
  })
}

class GeneralMeshComponent extends Component<GeneralMeshComponentProps> {
  constructor(context: ComponentRuntimeContext<GeneralMeshComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    applyFrustumCulling(object, clampGeneralMeshComponentProps(this.context.getProps()).enableFrustumCulling)
  }

  onPropsUpdated(nextProps: Readonly<GeneralMeshComponentProps>): void {
    applyFrustumCulling(this.context.getRuntimeObject(), clampGeneralMeshComponentProps(nextProps).enableFrustumCulling)
  }
}

const generalMeshComponentDefinition: ComponentDefinition<GeneralMeshComponentProps> = {
  type: GENERAL_MESH_COMPONENT_TYPE,
  label: 'General Mesh',
  icon: 'mdi-cube-outline',
  order: 92,
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType
    const hasSourceAsset = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
    return hasSourceAsset && (nodeType === 'Mesh' || nodeType === 'Group')
  },
  createDefaultProps() {
    return { enableFrustumCulling: GENERAL_MESH_DEFAULT_ENABLE_FRUSTUM_CULLING }
  },
  createInstance(context) {
    return new GeneralMeshComponent(context)
  },
}

componentManager.registerDefinition(generalMeshComponentDefinition)

export function createGeneralMeshComponentState(
  node: SceneNode,
  overrides?: Partial<GeneralMeshComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GeneralMeshComponentProps> {
  const defaults = generalMeshComponentDefinition.createDefaultProps(node)
  return {
    id: options.id ?? '',
    type: GENERAL_MESH_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampGeneralMeshComponentProps({ ...defaults, ...overrides }),
  }
}

export { generalMeshComponentDefinition }
