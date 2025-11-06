import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const WARP_GATE_COMPONENT_TYPE = 'warpGate'

export type WarpGateComponentProps = Record<string, never>

export function clampWarpGateComponentProps(
  props: Partial<WarpGateComponentProps> | null | undefined,
): WarpGateComponentProps {
  void props
  return {}
}

export function cloneWarpGateComponentProps(props: WarpGateComponentProps): WarpGateComponentProps {
  void props
  return {}
}

class WarpGateComponent extends Component<WarpGateComponentProps> {
  constructor(context: ComponentRuntimeContext<WarpGateComponentProps>) {
    super(context)
  }

  private applyRuntimeState(object: Object3D | null): void {
    if (!object) {
      return
    }
    const userData = object.userData ?? (object.userData = {})
    if (!this.context.isEnabled()) {
      if (userData.warpGate) {
        delete userData.warpGate
      }
      return
    }
    userData.warpGate = true
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyRuntimeState(object)
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyRuntimeState(this.context.getRuntimeObject())
  }
}

const warpGateComponentDefinition: ComponentDefinition<WarpGateComponentProps> = {
  type: WARP_GATE_COMPONENT_TYPE,
  label: 'Warp Gate',
  icon: 'mdi-vector-circle',
  order: 50,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {}
  },
  createInstance(context) {
    return new WarpGateComponent(context)
  },
}

componentManager.registerDefinition(warpGateComponentDefinition)

export function createWarpGateComponentState(
  node: SceneNode,
  overrides?: Partial<WarpGateComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<WarpGateComponentProps> {
  const defaults = warpGateComponentDefinition.createDefaultProps(node)
  const props = clampWarpGateComponentProps(overrides ?? defaults)
  return {
    id: options.id ?? '',
    type: WARP_GATE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { warpGateComponentDefinition }
