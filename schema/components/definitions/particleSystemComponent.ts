import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import {
  PARTICLE_SYSTEM_COMPONENT_TYPE,
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  type ParticleSystemComponentProps,
} from '../../particles/particleSchema'
import { createParticlePresetProps } from '../../particles/particlePresets'
import {
  createParticleSystemRuntime,
  registerParticleSystemRuntime,
  unregisterParticleSystemRuntime,
  type ParticleSystemRuntimeHandle,
} from '../../particles/particleRuntime'

class ParticleSystemComponent extends Component<ParticleSystemComponentProps> {
  private runtime: ParticleSystemRuntimeHandle | null = null
  private attachedObject: Object3D | null = null

  constructor(context: ComponentRuntimeContext<ParticleSystemComponentProps>) {
    super(context)
  }

  onInit(): void {
    this.ensureRuntime(this.context.getRuntimeObject())
  }

  onRuntimeAttached(object: Object3D | null): void {
    if (!object) {
      this.detachRuntime()
      return
    }
    this.ensureRuntime(object)
  }

  onUpdate(deltaTime: number): void {
    this.runtime?.tick(deltaTime, this.context.getFrameState())
  }

  onDestroy(): void {
    this.detachRuntime()
  }

  private ensureRuntime(object: Object3D | null): void {
    if (!object) {
      return
    }
    this.detachRuntime()
    const props = clampParticleSystemComponentProps(this.context.getProps())
    this.runtime = createParticleSystemRuntime(props)
    object.add(this.runtime.group)
    registerParticleSystemRuntime(object, this.context.componentId, this.runtime)
    this.attachedObject = object
  }

  private detachRuntime(): void {
    if (this.attachedObject) {
      unregisterParticleSystemRuntime(this.attachedObject, this.context.componentId)
    }
    this.runtime?.dispose()
    this.runtime = null
    this.attachedObject = null
  }
}

const particleSystemComponentDefinition: ComponentDefinition<ParticleSystemComponentProps> = {
  type: PARTICLE_SYSTEM_COMPONENT_TYPE,
  label: 'Particle System',
  icon: 'mdi-weather-night-partly-cloudy',
  order: 72,
  inspector: [],
  recreateOnPropsChange: true,
  canAttach(node: SceneNode) {
    return node.nodeType !== 'Light'
  },
  createDefaultProps(_node: SceneNode) {
    return createParticlePresetProps('groundAuraLite')
  },
  createInstance(context) {
    return new ParticleSystemComponent(context)
  },
}

componentManager.registerDefinition(particleSystemComponentDefinition)

export function createParticleSystemComponentState(
  node: SceneNode,
  overrides?: Partial<ParticleSystemComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ParticleSystemComponentProps> {
  const defaults = particleSystemComponentDefinition.createDefaultProps(node)
  const merged = clampParticleSystemComponentProps({
    ...defaults,
    ...overrides,
    playback: {
      ...defaults.playback,
      ...(overrides?.playback ?? {}),
    },
    budget: {
      ...defaults.budget,
      ...(overrides?.budget ?? {}),
    },
    transform: {
      ...defaults.transform,
      ...(overrides?.transform ?? {}),
    },
    render: {
      ...defaults.render,
      ...(overrides?.render ?? {}),
    },
    exposedParams: {
      ...defaults.exposedParams,
      ...(overrides?.exposedParams ?? {}),
    },
    emitters: overrides?.emitters ?? defaults.emitters,
  })
  return {
    id: options.id ?? '',
    type: PARTICLE_SYSTEM_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: cloneParticleSystemComponentProps(merged),
  }
}

export {
  PARTICLE_SYSTEM_COMPONENT_TYPE,
  particleSystemComponentDefinition,
}
export {
  PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY,
  PARTICLE_SYSTEM_METADATA_KEY,
  PARTICLE_SYSTEM_ACTIVE_FLAG,
  DEFAULT_PARTICLE_BUDGET,
  DEFAULT_PARTICLE_EXPOSED_PARAMS,
  clampParticleBudgetProps,
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  estimateParticleSystemCost,
  type ParticleBlendMode,
  type ParticleBudgetProps,
  type ParticleEmitterConfig,
  type ParticleExposedParams,
  type ParticlePlaybackProps,
  type ParticleQualityTier,
  type ParticleRenderProps,
  type ParticleSystemComponentProps,
  type ParticleTransformProps,
} from '../../particles/particleSchema'
export {
  createParticlePresetProps,
  getParticlePresetDefinition,
  listParticlePresets,
} from '../../particles/particlePresets'
export {
  PARTICLE_TEXTURE_RESOLVER_KEY,
  getParticleTextureResolver,
  setParticleTextureResolver,
  type ParticleTextureResolver,
} from '../../particles/particleTextureResolver'
export {
  applyParticleRuntimeCommand,
  resolveParticleRuntimeEntry,
  type ParticleRuntimeCommand,
} from '../../particles/particleBehaviorBridge'
export {
  createParticleSystemRuntime,
  registerParticleSystemRuntime,
  unregisterParticleSystemRuntime,
  type ParticleRuntimeRegistryEntry,
  type ParticleSystemRuntimeHandle,
} from '../../particles/particleRuntime'
