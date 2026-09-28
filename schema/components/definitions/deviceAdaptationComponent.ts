import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import {
  DEVICE_ADAPTATION_COMPONENT_TYPE,
  normalizeDeviceAdaptationNodeProps,
  type DeviceAdaptationComponentProps,
} from '../../deviceAdaptation'

export { DEVICE_ADAPTATION_COMPONENT_TYPE }
export type { DeviceAdaptationComponentProps, DeviceAdaptationNodeRule } from '../../deviceAdaptation'
export { normalizeDeviceAdaptationNodeProps } from '../../deviceAdaptation'

class DeviceAdaptationComponent extends Component<DeviceAdaptationComponentProps> {
  constructor(context: ComponentRuntimeContext<DeviceAdaptationComponentProps>) {
    super(context)
  }
  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }
  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const deviceAdaptationComponentDefinition: ComponentDefinition<DeviceAdaptationComponentProps> = {
  type: DEVICE_ADAPTATION_COMPONENT_TYPE,
  label: 'Device Adaptation',
  description: 'Apply profile-specific loading and rendering behavior to this node.',
  icon: 'mdi-cellphone-cog',
  order: 96,
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps() {
    return { rules: [] }
  },
  createInstance(context) {
    return new DeviceAdaptationComponent(context)
  },
}

componentManager.registerDefinition(deviceAdaptationComponentDefinition)

export function createDeviceAdaptationComponentState(
  _node: SceneNode,
  overrides?: Partial<DeviceAdaptationComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<DeviceAdaptationComponentProps> {
  return {
    id: options.id ?? '',
    type: DEVICE_ADAPTATION_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: normalizeDeviceAdaptationNodeProps(overrides),
  }
}

export { deviceAdaptationComponentDefinition }
