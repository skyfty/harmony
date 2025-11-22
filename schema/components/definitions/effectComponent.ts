import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import {
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_SCALE,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_SCALE_MAX,
  GROUND_LIGHT_SCALE_MIN,
} from './effects/groundLight'
import { effectControllerFactories } from './effects'
import type {
  EffectComponentProps,
  EffectController,
  EffectTypeId,
} from './effects/types'
export type { EffectComponentProps, EffectTypeId } from './effects/types'
export type { GroundLightEffectProps } from './effects/types'
export {
  DEFAULT_GROUND_LIGHT_COLOR,
  DEFAULT_GROUND_LIGHT_INTENSITY,
  DEFAULT_GROUND_LIGHT_SCALE,
  GROUND_LIGHT_INTENSITY_MIN,
  GROUND_LIGHT_INTENSITY_MAX,
  GROUND_LIGHT_SCALE_MIN,
  GROUND_LIGHT_SCALE_MAX,
}

export const EFFECT_COMPONENT_TYPE = 'effect'

export const DEFAULT_EFFECT_TYPE: EffectTypeId = 'groundLight'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
export const RUNTIME_REGISTRY_KEY = '__harmonyEffectRuntime'
export const EFFECT_METADATA_KEY = 'effectComponents'

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const clamped = Math.min(Math.max(value, min), max)
  return Number.isFinite(clamped) ? clamped : fallback
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return fallback
  }
  return `#${trimmed.slice(1).toLowerCase()}`
}

export function clampEffectComponentProps(
  props: Partial<EffectComponentProps> | null | undefined,
): EffectComponentProps {
  const effectType: EffectTypeId = props?.effectType === 'groundLight'
    ? 'groundLight'
    : DEFAULT_EFFECT_TYPE

  const groundLightSource = props?.groundLight ?? {}
  const color = normalizeHexColor((groundLightSource as { color?: string }).color, DEFAULT_GROUND_LIGHT_COLOR)
  const intensity = clampNumber(
    (groundLightSource as { intensity?: number }).intensity,
    GROUND_LIGHT_INTENSITY_MIN,
    GROUND_LIGHT_INTENSITY_MAX,
    DEFAULT_GROUND_LIGHT_INTENSITY,
  )
  const scale = clampNumber(
    (groundLightSource as { scale?: number }).scale,
    GROUND_LIGHT_SCALE_MIN,
    GROUND_LIGHT_SCALE_MAX,
    DEFAULT_GROUND_LIGHT_SCALE,
  )

  return {
    effectType,
    groundLight: {
      color,
      intensity,
      scale,
    },
  }
}

export function cloneEffectComponentProps(props: EffectComponentProps): EffectComponentProps {
  return {
    effectType: props.effectType,
    groundLight: {
      color: props.groundLight.color,
      intensity: props.groundLight.intensity,
      scale: props.groundLight.scale,
    },
  }
}

function createEffectController(type: EffectTypeId, props: EffectComponentProps): EffectController | null {
  const factory = effectControllerFactories[type]
  return factory ? factory(props) : null
}

class EffectComponent extends Component<EffectComponentProps> {
  private controller: EffectController | null = null
  private runtimeObject: Object3D | null = null
  private currentType: EffectTypeId | null = null
  private currentProps: EffectComponentProps = clampEffectComponentProps(null)

  constructor(context: ComponentRuntimeContext<EffectComponentProps>) {
    super(context)
    this.currentProps = clampEffectComponentProps(context.getProps())
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyEffect(object)
  }

  onPropsUpdated(next: Readonly<EffectComponentProps>): void {
    void next
    this.applyEffect(this.context.getRuntimeObject())
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyEffect(this.context.getRuntimeObject())
  }

  onDestroy(): void {
    this.disposeEffect()
    this.updateUserData(this.runtimeObject, null)
    this.unregisterRuntimeInterface(this.runtimeObject)
    this.runtimeObject = null
  }

  private applyEffect(object: Object3D | null, provided?: EffectComponentProps, options: { alreadyClamped?: boolean } = {}): void {
    const isEnabled = this.context.isEnabled()
    const previous = this.runtimeObject

    if (!object || !isEnabled) {
      this.disposeEffect()
      if (previous) {
        this.updateUserData(previous, null)
        this.unregisterRuntimeInterface(previous)
      }
      this.runtimeObject = object
      return
    }

    if (previous && previous !== object) {
      this.disposeEffect()
      this.updateUserData(previous, null)
      this.unregisterRuntimeInterface(previous)
    }

    const effectiveProps = options.alreadyClamped && provided
      ? cloneEffectComponentProps(provided)
      : clampEffectComponentProps(provided ?? this.context.getProps())
    this.currentProps = cloneEffectComponentProps(effectiveProps)
    this.runtimeObject = object

    if (!this.controller || this.currentType !== effectiveProps.effectType) {
      this.disposeEffect()
      this.controller = createEffectController(effectiveProps.effectType, effectiveProps)
      this.currentType = this.controller ? effectiveProps.effectType : null
      if (this.controller) {
        object.add(this.controller.group)
      }
    } else if (this.controller && this.controller.group.parent !== object) {
      this.controller.group.removeFromParent()
      object.add(this.controller.group)
    }

    this.controller?.update(effectiveProps)
    this.updateUserData(object, effectiveProps)
    this.registerRuntimeInterface(object, effectiveProps)
  }

  private disposeEffect(): void {
    if (!this.controller) {
      return
    }
    this.controller.group.parent?.remove(this.controller.group)
    this.controller.dispose()
    this.controller = null
    this.currentType = null
  }

  private updateUserData(object: Object3D | null, props: EffectComponentProps | null): void {
    if (!object) {
      return
    }
    const userData = object.userData ?? (object.userData = {})
    let registry = userData[EFFECT_METADATA_KEY] as Record<string, unknown> | undefined
    if (!registry && props) {
      registry = {}
      userData[EFFECT_METADATA_KEY] = registry
    }
    if (!registry) {
      return
    }
    if (!props) {
      delete registry[this.context.componentId]
      if (!Object.keys(registry).length) {
        delete userData[EFFECT_METADATA_KEY]
      }
      return
    }
    registry[this.context.componentId] = {
      type: props.effectType,
      props: cloneEffectComponentProps(props),
    }
  }

  private registerRuntimeInterface(object: Object3D, props: EffectComponentProps): void {
    const userData = object.userData ?? (object.userData = {})
    let registry = userData[RUNTIME_REGISTRY_KEY] as Record<string, unknown> | undefined
    if (!registry) {
      registry = {}
      userData[RUNTIME_REGISTRY_KEY] = registry
    }
    const self = this
    registry[this.context.componentId] = {
      type: props.effectType,
      getProps(): EffectComponentProps {
        return cloneEffectComponentProps(self.currentProps)
      },
      setProps(patch: Partial<EffectComponentProps> | null | undefined) {
        if (!patch) {
          return
        }
        const next: Partial<EffectComponentProps> = {
          ...self.currentProps,
          ...patch,
          groundLight: {
            ...self.currentProps.groundLight,
            ...(patch.groundLight ?? {}),
          },
        }
        const clamped = clampEffectComponentProps(next)
        self.applyEffect(self.runtimeObject, clamped, { alreadyClamped: true })
      },
      tick(delta: number) {
        self.controller?.tick(delta)
      },
    }
  }

  private unregisterRuntimeInterface(object: Object3D | null | undefined): void {
    if (!object?.userData) {
      return
    }
    const registry = object.userData[RUNTIME_REGISTRY_KEY] as Record<string, unknown> | undefined
    if (!registry) {
      return
    }
    delete registry[this.context.componentId]
    if (!Object.keys(registry).length) {
      delete object.userData[RUNTIME_REGISTRY_KEY]
    }
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
