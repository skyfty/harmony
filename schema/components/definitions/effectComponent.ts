import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const EFFECT_COMPONENT_TYPE = 'effect'
export type EffectTypeId = 'groundLight'

export const DEFAULT_EFFECT_TYPE: EffectTypeId = 'groundLight'
export const DEFAULT_GROUND_LIGHT_COLOR = '#00ffff'
export const DEFAULT_GROUND_LIGHT_INTENSITY = 1
export const GROUND_LIGHT_INTENSITY_MIN = 0
export const GROUND_LIGHT_INTENSITY_MAX = 5

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
export const RUNTIME_REGISTRY_KEY = '__harmonyEffectRuntime'
export const EFFECT_METADATA_KEY = 'effectComponents'

export interface GroundLightEffectProps {
  color: string
  intensity: number
}

export interface EffectComponentProps {
  effectType: EffectTypeId
  groundLight: GroundLightEffectProps
}

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

  return {
    effectType,
    groundLight: {
      color,
      intensity,
    },
  }
}

export function cloneEffectComponentProps(props: EffectComponentProps): EffectComponentProps {
  return {
    effectType: props.effectType,
    groundLight: {
      color: props.groundLight.color,
      intensity: props.groundLight.intensity,
    },
  }
}

type EffectController = {
  readonly group: THREE.Object3D
  update(props: EffectComponentProps): void
  dispose(): void
}

type BeamEntry = {
  material: THREE.ShaderMaterial
  uniforms: {
    uTime: { value: number }
    uColor: { value: THREE.Color }
    uIntensity: { value: number }
  }
}

type RingEntry = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  baseOpacity: number
  rotationSpeed: number
  pulseOffset: number
}

type ParticleState = {
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  velocities: Float32Array
}

const GROUND_LIGHT_GROUP_NAME = 'Effect:GroundLight'
const GROUND_LIGHT_BEAM_COUNT = 16
const GROUND_LIGHT_BEAM_HEIGHT = 6
const GROUND_LIGHT_BEAM_RADIUS = 1.4
const GROUND_LIGHT_RING_COUNT = 3
const GROUND_LIGHT_RING_WIDTH = 0.22
const GROUND_LIGHT_PARTICLE_COUNT = 160
const GROUND_LIGHT_PARTICLE_SIZE = 0.12

const GROUND_LIGHT_BEAM_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GROUND_LIGHT_BEAM_FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  float remap(float value, float inMin, float inMax, float outMin, float outMax) {
    return outMin + (outMax - outMin) * clamp((value - inMin) / max(inMax - inMin, 0.0001), 0.0, 1.0);
  }

  void main() {
    float radial = abs(vUv.x - 0.5) * 2.0;
    float vertical = clamp(vUv.y, 0.0, 1.0);
    float edgeFade = smoothstep(1.0, 0.0, radial);
    float heightFade = smoothstep(1.0, 0.0, vertical);
    float swirl = sin(uTime * 3.2 + radial * 14.0);
    float wave = sin(uTime * 4.0 + vertical * 9.0);
    float flicker = 0.65 + 0.35 * sin(uTime * 5.0 + radial * 6.0);
    float intensityScale = remap(clamp(uIntensity, 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0), 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0, 0.0, 1.4);
    float alpha = edgeFade * heightFade * (0.55 + 0.25 * swirl + 0.2 * wave) * flicker * intensityScale;
    if (alpha <= 0.02) {
      discard;
    }
    gl_FragColor = vec4(uColor, alpha);
  }
`

class GroundLightEffectController implements EffectController {
  readonly group: THREE.Group
  private readonly clock = new THREE.Clock()
  private readonly beams: BeamEntry[] = []
  private readonly beamGeometry: THREE.PlaneGeometry
  private readonly beamGroup: THREE.Group
  private readonly ringEntries: RingEntry[] = []
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly centerDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly glowDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly particleState: ParticleState
  private readonly particleSystem: THREE.Points
  private elapsed = 0
  private lastFrame = -1
  private readonly color = new THREE.Color(DEFAULT_GROUND_LIGHT_COLOR)
  private intensity = DEFAULT_GROUND_LIGHT_INTENSITY
  private intensityFactor = 1
  private disposed = false

  constructor(initial: GroundLightEffectProps) {
    this.group = new THREE.Group()
    this.group.name = GROUND_LIGHT_GROUP_NAME
    this.group.matrixAutoUpdate = true

    this.beamGeometry = new THREE.PlaneGeometry(0.26, GROUND_LIGHT_BEAM_HEIGHT, 1, 1)
    this.beamGeometry.translate(0, GROUND_LIGHT_BEAM_HEIGHT * 0.5, 0)

    this.beamGroup = new THREE.Group()
    this.beamGroup.name = `${GROUND_LIGHT_GROUP_NAME}:Beams`
    this.group.add(this.beamGroup)

    for (let index = 0; index < GROUND_LIGHT_BEAM_COUNT; index += 1) {
      const angle = (index / GROUND_LIGHT_BEAM_COUNT) * Math.PI * 2
      const uniforms = {
        uTime: { value: 0 },
        uColor: { value: this.color.clone() },
        uIntensity: { value: this.intensity },
      }
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: GROUND_LIGHT_BEAM_VERTEX_SHADER,
        fragmentShader: GROUND_LIGHT_BEAM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.beamGeometry, material)
      const radius = GROUND_LIGHT_BEAM_RADIUS * 0.75
      mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      mesh.rotation.y = angle
      this.beamGroup.add(mesh)
      this.beams.push({ material, uniforms })
    }

    for (let index = 0; index < GROUND_LIGHT_RING_COUNT; index += 1) {
      const innerRadius = GROUND_LIGHT_BEAM_RADIUS * (0.45 + index * 0.22)
      const outerRadius = innerRadius + GROUND_LIGHT_RING_WIDTH
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64)
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.28 - index * 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.01 + index * 0.008
      this.group.add(mesh)
      this.rings.push(mesh)
      this.ringEntries.push({
        mesh,
        baseOpacity: material.opacity,
        rotationSpeed: 0.25 + index * 0.08,
        pulseOffset: index * 0.9,
      })
    }

    const discGeometry = new THREE.CircleGeometry(GROUND_LIGHT_BEAM_RADIUS * 0.28, 48)
    const discMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.centerDisc = new THREE.Mesh(discGeometry, discMaterial)
    this.centerDisc.rotation.x = -Math.PI / 2
    this.centerDisc.position.y = 0.015
    this.group.add(this.centerDisc)

    const glowGeometry = new THREE.CircleGeometry(GROUND_LIGHT_BEAM_RADIUS * 2.8, 64)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.glowDisc = new THREE.Mesh(glowGeometry, glowMaterial)
    this.glowDisc.rotation.x = -Math.PI / 2
    this.glowDisc.position.y = 0.005
    this.group.add(this.glowDisc)

    const particleGeometry = new THREE.BufferGeometry()
    const positions = new Float32Array(GROUND_LIGHT_PARTICLE_COUNT * 3)
    const velocities = new Float32Array(GROUND_LIGHT_PARTICLE_COUNT)
    for (let i = 0; i < GROUND_LIGHT_PARTICLE_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * (GROUND_LIGHT_BEAM_RADIUS * 0.7)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = Math.random() * GROUND_LIGHT_BEAM_HEIGHT
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      velocities[i] = 0.5 + Math.random() * 1.4
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const particleMaterial = new THREE.PointsMaterial({
      color: this.color,
      size: GROUND_LIGHT_PARTICLE_SIZE,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.particleState = {
      geometry: particleGeometry,
      material: particleMaterial,
      velocities,
    }
    this.particleSystem = new THREE.Points(particleGeometry, particleMaterial)
    this.group.add(this.particleSystem)

    this.group.onBeforeRender = (renderer) => {
      this.handleBeforeRender(renderer)
    }

    this.applySettings(initial)
  }

  update(props: EffectComponentProps): void {
    this.applySettings(props.groundLight)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.group.onBeforeRender = () => {}
    this.beams.forEach((entry) => {
      entry.material.dispose()
    })
    this.beamGeometry.dispose()
    this.rings.forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    this.centerDisc.geometry.dispose()
    this.centerDisc.material.dispose()
    this.glowDisc.geometry.dispose()
    this.glowDisc.material.dispose()
    this.particleState.geometry.dispose()
    this.particleState.material.dispose()
  }

  private handleBeforeRender(renderer: THREE.WebGLRenderer): void {
    if (this.disposed) {
      return
    }
    const frame = renderer.info.render.frame
    if (frame === this.lastFrame) {
      return
    }
    this.lastFrame = frame
    const delta = this.clock.getDelta()
    this.elapsed += delta

    this.beams.forEach((entry) => {
      entry.uniforms.uTime.value = this.elapsed
      entry.uniforms.uIntensity.value = this.intensity
      entry.uniforms.uColor.value.copy(this.color)
    })
    this.beamGroup.rotation.y += delta * 0.35 * (0.8 + this.intensityFactor * 0.4)

    this.ringEntries.forEach((entry, index) => {
      const oscillation = 0.75 + 0.25 * Math.sin(this.elapsed * 2.2 + entry.pulseOffset)
      entry.mesh.material.opacity = entry.baseOpacity * oscillation * this.intensityFactor
      entry.mesh.rotation.z += entry.rotationSpeed * delta
      if (index === 0) {
        const scalePulse = 1 + Math.sin(this.elapsed * 1.8) * 0.05 * this.intensityFactor
        entry.mesh.scale.setScalar(scalePulse)
      }
    })

    const glowOpacity = 0.28 + Math.sin(this.elapsed * 2.5) * 0.12
    this.glowDisc.material.opacity = glowOpacity * this.intensityFactor
    const glowScale = 1 + Math.sin(this.elapsed * 1.6) * 0.06 * this.intensityFactor
    this.glowDisc.scale.setScalar(glowScale)

    this.centerDisc.material.opacity = 0.55 * this.intensityFactor

    const positions = this.particleState.geometry.attributes.position.array as Float32Array
    const velocities = this.particleState.velocities
    const riseSpeed = 0.8 + this.intensityFactor * 1.1
    for (let i = 0; i < GROUND_LIGHT_PARTICLE_COUNT; i += 1) {
      const offset = i * 3 + 1
      positions[offset] += velocities[i] * riseSpeed * delta
      if (positions[offset] > GROUND_LIGHT_BEAM_HEIGHT) {
        positions[offset] = 0
      }
    }
    this.particleState.geometry.attributes.position.needsUpdate = true
    this.particleState.material.opacity = 0.4 + 0.4 * this.intensityFactor
  }

  private applySettings(settings: GroundLightEffectProps): void {
    this.setColor(settings.color)
    this.setIntensity(settings.intensity)
  }

  private setColor(color: string): void {
    this.color.set(color)
    this.rings.forEach((mesh) => {
      mesh.material.color.copy(this.color)
    })
    this.centerDisc.material.color.copy(this.color)
    this.glowDisc.material.color.copy(this.color)
    this.particleState.material.color.copy(this.color)
  }

  private setIntensity(intensity: number): void {
    this.intensity = Math.min(Math.max(intensity, GROUND_LIGHT_INTENSITY_MIN), GROUND_LIGHT_INTENSITY_MAX)
    const normalized = this.intensity
    const factor = normalized <= 0 ? 0 : 0.35 + (normalized / GROUND_LIGHT_INTENSITY_MAX) * 0.9
    this.intensityFactor = factor
  }
}

function createEffectController(type: EffectTypeId, props: EffectComponentProps): EffectController | null {
  switch (type) {
    case 'groundLight':
      return new GroundLightEffectController(props.groundLight)
    default:
      return null
  }
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
