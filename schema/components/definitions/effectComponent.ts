import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import {
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
  DEFAULT_GROUND_LIGHT_PARTICLE_COUNT,
  DEFAULT_GROUND_LIGHT_SHOW_PARTICLES,
  DEFAULT_GROUND_LIGHT_SHOW_BEAMS,
  DEFAULT_GROUND_LIGHT_SHOW_RINGS,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_PARTICLE_SIZE_MIN,
  GROUND_LIGHT_PARTICLE_SIZE_MAX,
  GROUND_LIGHT_PARTICLE_COUNT_MIN,
  GROUND_LIGHT_PARTICLE_COUNT_MAX,
  clampWarpGateComponentProps,
  cloneWarpGateComponentProps,
  type WarpGateComponentProps,
  type GroundLightEffectProps,
} from './warpGateComponent'

export const EFFECT_COMPONENT_TYPE = 'effect'
export type EffectTypeId = 'groundLight'

export interface EffectComponentProps {
  effectType: EffectTypeId
  groundLight: WarpGateComponentProps
}

export const DEFAULT_EFFECT_TYPE: EffectTypeId = 'groundLight'

export {
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
  DEFAULT_GROUND_LIGHT_PARTICLE_COUNT,
  DEFAULT_GROUND_LIGHT_SHOW_PARTICLES,
  DEFAULT_GROUND_LIGHT_SHOW_BEAMS,
  DEFAULT_GROUND_LIGHT_SHOW_RINGS,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_PARTICLE_SIZE_MIN,
  GROUND_LIGHT_PARTICLE_SIZE_MAX,
  GROUND_LIGHT_PARTICLE_COUNT_MIN,
  GROUND_LIGHT_PARTICLE_COUNT_MAX,
}

export type { GroundLightEffectProps }

export function clampEffectComponentProps(
  props: Partial<EffectComponentProps> | null | undefined,
): EffectComponentProps {
  const effectType: EffectTypeId = props?.effectType === 'groundLight'
    ? 'groundLight'
    : DEFAULT_EFFECT_TYPE
  const groundLight = clampWarpGateComponentProps(props?.groundLight ?? null)
  return {
    effectType,
    groundLight,
  }
}

export function cloneEffectComponentProps(props: EffectComponentProps): EffectComponentProps {
  return {
    effectType: props.effectType,
    groundLight: cloneWarpGateComponentProps(props.groundLight),
  }
}

class EffectComponent extends Component<EffectComponentProps> {
  constructor(context: ComponentRuntimeContext<EffectComponentProps>) {
    super(context)
  }
}

const effectComponentDefinition: ComponentDefinition<EffectComponentProps> = {
  type: EFFECT_COMPONENT_TYPE,
  label: 'Effect',
  icon: 'mdi-auto-fix',
  order: 70,
  inspector: [],
  canAttach(node: SceneNode) {
    return node.nodeType !== 'Light'
  },
  createDefaultProps(_node: SceneNode) {
    return clampEffectComponentProps(null)
  },
  createInstance(context) {
    return new EffectComponent(context)
  },
}

componentManager.registerDefinition(effectComponentDefinition)

export function createEffectComponentState(
  node: SceneNode,
  overrides?: Partial<EffectComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<EffectComponentProps> {
  const defaults = effectComponentDefinition.createDefaultProps(node)
  const merged = clampEffectComponentProps({
    ...defaults,
    ...overrides,
    groundLight: {
      ...defaults.groundLight,
      ...(overrides?.groundLight ?? {}),
    },
  })
  return {
    id: options.id ?? '',
    type: EFFECT_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { effectComponentDefinition }
